/**
 * Sign-in and daily check-in for WorkBuddy, driven from this plugin's own CLI.
 *
 * Two capabilities that share one reason to live here rather than in a
 * standalone script: both talk to the *same* endpoints this plugin already
 * knows about, so keeping a second copy of the base URLs and header shape
 * would be one more thing to keep in sync by hand.
 *
 * ## Why sign-in is part of the plugin at all
 *
 * Since WorkBuddy 5.6 the desktop apps seal `accessToken`/`refreshToken` at
 * rest (see `desktop-credential-protection.ts`), which is why reading the
 * desktop app's file may require launching its binary as a decryption oracle.
 * Signing in from here avoids that dependency entirely: the authorization
 * flow is ordinary HTTPS, so this module can obtain a **plaintext** credential
 * that {@link parseWorkBuddyAuth} already understands. The desktop app is then
 * only needed for as long as the operator wants it.
 *
 * ## Deliberate omissions
 *
 * `X-Device-Token` (Tencent's native risk-control fingerprint) is never sent.
 * It cannot be produced outside the vendor's native SDK, and the endpoint
 * accepts its absence as an explicit "not configured" state — which is also
 * what makes the absence measurable rather than guessed at.
 *
 * @module dsh-workbuddy-connect/signin
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { FALLBACK_CN_APP_VERSION } from './client-identity.ts'
import {
  CLIENT_UA,
  CN_BILLING_BASE,
  CN_CHAT_BASE,
  GLOBAL_BASE,
  regionOf,
  type WorkBuddyRegion,
} from './upstream.ts'
import type { WorkBuddyVariant } from './variants.ts'

/** Directory under `$DSH_HOME` holding the plaintext sign-in documents. */
const SIGNIN_DIR = 'workbuddy-auth'

/** Upstream business code meaning "the browser has not finished yet". */
const PENDING_LOGIN = 11217
/** Upstream business code meaning "the account record is not ready yet". */
const PENDING_ACCOUNT = 12151

/**
 * Above this, an upstream timestamp is already milliseconds; below it, it is
 * seconds. Mirrors the threshold `expiryToMs` uses in `auth.ts`.
 */
const MS_THRESHOLD = 1e12

/**
 * Client version presented when opening the sign-in page.
 *
 * The real desktop client appends this, and a page opened without it is not
 * the page the vendor expects an operator to land on. Reuses the CN fallback
 * version so the two halves agree on one number.
 */
const CLIENT_VERSION = FALLBACK_CN_APP_VERSION

/** Sign-in endpoints. */
export interface WorkBuddySigninEndpoints {
  /** Host serving the OAuth handshake and account lookup. */
  base: string
  /** Host serving billing, including check-in. */
  billingBase: string
  /** `Origin`/`Referer` presented on every request. */
  origin: string
}

/** Envelope shape of every upstream JSON answer. */
interface UpstreamEnvelope {
  status: number
  ok: boolean
  code?: number
  msg?: string
  data?: Record<string, unknown>
  document: Record<string, unknown>
  nonJson?: true
}

/**
 * Endpoint set for one variant.
 *
 * The CN product splits its hosts: chat lives on `copilot.tencent.com` while
 * billing — and therefore `Origin`/`Referer` — is `www.codebuddy.cn`, which is
 * why the two cannot be collapsed into one constant. The international product
 * serves everything from its single host.
 */
export function signinEndpointsFor(variant: WorkBuddyVariant): WorkBuddySigninEndpoints {
  return variant.region === 'global'
    ? { base: GLOBAL_BASE, billingBase: GLOBAL_BASE, origin: GLOBAL_BASE }
    : { base: CN_CHAT_BASE, billingBase: CN_BILLING_BASE, origin: CN_BILLING_BASE }
}

/** Absolute path of the plaintext sign-in document for one variant. */
export function signinPathFor(variant: WorkBuddyVariant): string {
  return join(resolveDshHome(), SIGNIN_DIR, variant.signinFilename)
}

/** Read a `{code,msg,data}` envelope, tolerating a top-level payload. */
async function readEnvelope(response: Response): Promise<UpstreamEnvelope> {
  const text = await response.text()
  let document: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    document = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return { status: response.status, ok: response.ok, msg: text.slice(0, 200), document: {}, nonJson: true }
  }
  const rawData = document['data']
  const message = document['msg'] ?? document['message'] ?? document['error']
  return {
    status: response.status,
    ok: response.ok,
    ...typeof document['code'] === 'number' ? { code: document['code'] } : {},
    ...typeof message === 'string' ? { msg: message } : {},
    ...typeof rawData === 'object' && rawData !== null && !Array.isArray(rawData)
      ? { data: rawData as Record<string, unknown> }
      : {},
    document,
  }
}

/**
 * Base headers for the sign-in and check-in requests.
 *
 * `Origin`/`Referer` cannot be omitted: the gateway rejects a request that does
 * not look like it came from the product's own web surface.
 */
function baseHeaders(endpoints: WorkBuddySigninEndpoints, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': CLIENT_UA,
    Origin: endpoints.origin,
    Referer: `${endpoints.origin}/`,
    ...extra,
  }
}

/**
 * Business headers for the billing calls.
 *
 * Identity travels as `X-User-Id`/`X-Enterprise-Id` when known, and as the
 * vendor's own `X-No-*: 1` "not configured" marker when not — an account
 * lookup that fails is not a reason to abandon a check-in the gateway would
 * otherwise accept.
 */
function businessHeaders(
  endpoints: WorkBuddySigninEndpoints,
  credential: SigninCredentialView,
): Record<string, string> {
  const headers = baseHeaders(endpoints, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${credential.accessToken}`,
  })
  if (credential.uid === undefined) headers['X-No-User-Id'] = '1'
  else headers['X-User-Id'] = credential.uid
  if (credential.enterpriseId === undefined) headers['X-No-Enterprise-Id'] = '1'
  else {
    headers['X-Enterprise-Id'] = credential.enterpriseId
    headers['X-Tenant-Id'] = credential.enterpriseId
  }
  if (credential.domain === '') headers['X-No-Department-Info'] = '1'
  else headers['X-Domain'] = credential.domain
  return headers
}

/** Identity fields the billing headers need. */
interface SigninCredentialView {
  accessToken: string
  uid?: string
  enterpriseId?: string
  domain: string
}

/** Normalize an upstream expiry, which may be epoch seconds or milliseconds. */
function expiryToMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || value <= 0) return undefined
  return value > MS_THRESHOLD ? value : value * 1000
}

/** Derive an expiry from a relative `expiresIn`-style field. */
function relativeExpiryToMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || value <= 0) return undefined
  return Date.now() + value * 1000
}

// ── Authorization flow ──────────────────────────────────────────────────────

/** A pending authorization, as the gateway issued it. */
export interface WorkBuddyAuthorizationRequest {
  state: string
  /** The URL to open, already corrected. */
  authUrl: string
  /** Corrections applied to the gateway's URL, for display. */
  notes: readonly string[]
}

/**
 * Repair the `authUrl` the gateway hands back.
 *
 * Two defects are measurable, and both produce a page that blames the operator
 * rather than the link:
 *
 * 1. **`platform` is always `workbuddy`**, even for the international product,
 *    which lands the operator on the wrong product's sign-in page.
 * 2. **`state` (and `version`) may be missing**, without which the page reports
 *    an incomplete sign-in link.
 */
export function normalizeAuthUrl(
  rawUrl: string,
  variant: Pick<WorkBuddyVariant, 'platform'>,
  state: string,
): { url: string, notes: string[] } {
  let url = rawUrl.trim()
  const notes: string[] = []

  if (variant.platform !== 'workbuddy') {
    const wrong = 'platform=workbuddy&'
    if (url.includes(wrong)) {
      url = url.replace(wrong, `platform=${variant.platform}&`)
      notes.push(`platform corrected to ${variant.platform}`)
    }
  }
  if (!url.includes(`state=${state}`)) {
    url += `${url.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}`
    notes.push('added the missing state')
  }
  if (!/[?&]version=/u.test(url)) {
    url += `${url.includes('?') ? '&' : '?'}version=${encodeURIComponent(CLIENT_VERSION)}`
    notes.push('added the version parameter')
  }
  return { url, notes }
}

/** Begin an authorization: allocate a `state` and get the URL to open. */
export async function startAuthorization(
  variant: WorkBuddyVariant,
  endpoints: WorkBuddySigninEndpoints = signinEndpointsFor(variant),
): Promise<WorkBuddyAuthorizationRequest> {
  const response = await fetch(`${endpoints.base}/v2/plugin/auth/state?platform=${variant.platform}`, {
    method: 'POST',
    headers: baseHeaders(endpoints, { 'Content-Type': 'application/json' }),
    body: '{}',
  })
  const envelope = await readEnvelope(response)
  const state = envelope.data?.['state']
  const authUrl = envelope.data?.['authUrl']
  if (!response.ok || envelope.code !== 0 || typeof state !== 'string' || state === '') {
    throw new Error(
      `authorization request failed (HTTP ${response.status}, code ${envelope.code ?? '-'}): ${envelope.msg ?? 'no state in the response'}`,
    )
  }
  if (typeof authUrl !== 'string' || authUrl === '') throw new Error('the upstream returned no authUrl')
  const { url, notes } = normalizeAuthUrl(authUrl, variant, state)
  return { state, authUrl: url, notes }
}

/**
 * Open a URL in the operator's browser.
 *
 * On Windows this must go through `rundll32`, never `cmd /c start`: `cmd`
 * treats `&` as a command separator, so an authorization URL — which always
 * carries several query parameters — would be truncated at the first `&` and
 * the page would report an incomplete link.
 */
export function openInBrowser(url: string): boolean {
  try {
    if (process.platform === 'win32') {
      spawn('rundll32', ['url.dll,FileProtocolHandler', url], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
    }
    return true
  } catch {
    return false
  }
}

/** Tokens as the gateway issued them, normalized to epoch milliseconds. */
export interface WorkBuddyIssuedTokens {
  accessToken: string
  refreshToken: string
  expiresAtMs?: number
  refreshExpiresAtMs?: number
  /** Domain exactly as the upstream reported it (may be absent). */
  domain?: string
}

/**
 * Poll for the token.
 *
 * `11217` is the gateway's documented "still waiting" code; any other
 * non-zero code is reported once so a genuine failure is visible instead of
 * hiding behind the progress line.
 */
export async function pollAuthorization(
  variant: WorkBuddyVariant,
  state: string,
  options: {
    timeoutMs?: number
    endpoints?: WorkBuddySigninEndpoints
    onTick?: (secondsLeft: number, note?: string) => void
  } = {},
): Promise<WorkBuddyIssuedTokens> {
  const endpoints = options.endpoints ?? signinEndpointsFor(variant)
  const deadline = Date.now() + (options.timeoutMs ?? 300_000)
  let lastNote: string | undefined
  while (Date.now() < deadline) {
    const response = await fetch(`${endpoints.base}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`, {
      headers: baseHeaders(endpoints),
    })
    const envelope = await readEnvelope(response)
    const accessToken = envelope.data?.['accessToken']
    if (envelope.code === 0 && typeof accessToken === 'string' && accessToken !== '') {
      const data = envelope.data ?? {}
      const refreshToken = data['refreshToken']
      const expiresAtMs = expiryToMs(data['expiresAt']) ?? relativeExpiryToMs(data['expiresIn'])
      const refreshExpiresAtMs = expiryToMs(data['refreshExpiresAt']) ?? relativeExpiryToMs(data['refreshExpiresIn'])
      const domain = data['domain']
      return {
        accessToken,
        refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
        ...expiresAtMs === undefined ? {} : { expiresAtMs },
        ...refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs },
        ...typeof domain === 'string' ? { domain } : {},
      }
    }
    if (envelope.code !== PENDING_LOGIN) {
      const note = `code ${envelope.code ?? '-'}: ${envelope.msg ?? '(no message)'}`
      if (note !== lastNote) lastNote = note
    }
    options.onTick?.(Math.ceil((deadline - Date.now()) / 1000), lastNote)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`timed out waiting for sign-in (${Math.round((options.timeoutMs ?? 300_000) / 1000)}s)`)
}

/** Account identity, when the gateway can supply it. */
export interface WorkBuddyAccount {
  uid?: string
  nickname?: string
  enterpriseId?: string
}

/**
 * Fetch the account record.
 *
 * Failing here is not fatal: a credential without a uid still authenticates,
 * it only loses the per-account features keyed by uid.
 */
export async function fetchAccount(
  variant: WorkBuddyVariant,
  state: string,
  accessToken: string,
  options: { timeoutMs?: number, endpoints?: WorkBuddySigninEndpoints } = {},
): Promise<WorkBuddyAccount> {
  const endpoints = options.endpoints ?? signinEndpointsFor(variant)
  const deadline = Date.now() + (options.timeoutMs ?? 30_000)
  const pick = (value: Record<string, unknown>): WorkBuddyAccount => {
    const uid = value['uid']
    const nickname = value['nickname']
    const enterpriseId = value['enterpriseId']
    return {
      ...typeof uid === 'string' && uid !== '' ? { uid } : {},
      ...typeof nickname === 'string' && nickname !== '' ? { nickname } : {},
      ...typeof enterpriseId === 'string' && enterpriseId !== '' ? { enterpriseId } : {},
    }
  }
  while (Date.now() < deadline) {
    const response = await fetch(`${endpoints.base}/v2/plugin/login/account?state=${encodeURIComponent(state)}`, {
      headers: baseHeaders(endpoints, { Authorization: `Bearer ${accessToken}` }),
    })
    const envelope = await readEnvelope(response)
    if (envelope.code === 0 && envelope.data !== undefined) return pick(envelope.data)
    if (envelope.code !== PENDING_ACCOUNT) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  // Fallback: the account list endpoint.
  try {
    const response = await fetch(`${endpoints.base}/v2/plugin/accounts`, {
      headers: baseHeaders(endpoints, { Authorization: `Bearer ${accessToken}` }),
    })
    const envelope = await readEnvelope(response)
    const raw = envelope.data?.['accounts'] ?? envelope.data
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0]
      if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
        return pick(first as Record<string, unknown>)
      }
    }
  } catch {
    // Best effort only.
  }
  return {}
}

/**
 * The `domain` to persist for a freshly issued credential.
 *
 * Derived through the same {@link regionOf} rule the credential store uses, so
 * the written document can never disagree with how the store will read it. The
 * international product is forced: the gateway has been observed echoing a
 * non-`workbuddy.ai` domain, and copying that through would make the store
 * classify an international credential as CN and refuse to load it with
 * `credential-region-mismatch`.
 */
export function resolveIssuedDomain(variant: WorkBuddyVariant, issued: string | undefined): string {
  const trimmed = (issued ?? '').trim()
  if (variant.region === 'global') return 'workbuddy.ai'
  // CN: keep a CN domain verbatim, but never let a global domain leak into the
  // CN slot — that is the mirror image of the mismatch above.
  return trimmed === '' || regionOf(trimmed) === 'global' ? '' : trimmed
}

/** The plaintext document shape {@link parseWorkBuddyAuth} accepts. */
export interface WorkBuddySigninDocument {
  auth: {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    refreshExpiresAt?: number
    domain: string
  }
  account: WorkBuddyAccount
}

/** Build the on-disk document from issued tokens plus identity. */
export function buildSigninDocument(input: {
  tokens: WorkBuddyIssuedTokens
  account: WorkBuddyAccount
  domain: string
}): WorkBuddySigninDocument {
  const { tokens, account, domain } = input
  return {
    auth: {
      accessToken: tokens.accessToken,
      ...tokens.refreshToken === '' ? {} : { refreshToken: tokens.refreshToken },
      ...tokens.expiresAtMs === undefined ? {} : { expiresAt: tokens.expiresAtMs },
      ...tokens.refreshExpiresAtMs === undefined ? {} : { refreshExpiresAt: tokens.refreshExpiresAtMs },
      domain,
    },
    account: { ...account },
  }
}

/**
 * Write a plaintext sign-in document.
 *
 * `0600`/`0700` are requested rather than assumed, and the parent directory is
 * created with the same intent. The file is written even on platforms that do
 * not honour POSIX modes on Windows, because the directory is still outside any
 * repository and the operator is told where it went.
 */
export async function writeSigninDocument(path: string, document: WorkBuddySigninDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const text = `${JSON.stringify(document, null, 2)}\n`
  await withFileLock(path, async () => {
    try {
      await writeFileAtomic(path, text, { mode: 0o600, dirMode: 0o700 })
    } catch {
      await writeFile(path, text, { mode: 0o600 })
    }
  })
}

// ── Daily check-in ──────────────────────────────────────────────────────────

/** One attempted endpoint and its outcome. */
export interface WorkBuddyCheckinAttempt {
  url: string
  status?: number
  code?: number
  msg?: string
  error?: string
}

/** Check-in state as far as the upstream reports it. */
export interface WorkBuddyCheckinStatus {
  /** `undefined` when the upstream did not say. */
  checkedToday?: boolean
  streakDays?: number
  raw: UpstreamEnvelope
  attempts: readonly WorkBuddyCheckinAttempt[]
}

/**
 * Candidate status paths per region.
 *
 * The international product's prefix is inconsistent — its status endpoint has
 * been observed both with and without the `/v2` segment while its claim
 * endpoint always carries it — so both spellings are tried rather than one
 * being guessed at.
 */
function checkinStatusPaths(region: WorkBuddyRegion): readonly string[] {
  return region === 'global'
    ? ['/billing/meter/checkin-activity-status', '/v2/billing/meter/checkin-activity-status']
    : ['/v2/billing/meter/checkin-activity-status']
}

/** Path claiming the daily reward; always carries the version segment. */
const CHECKIN_CLAIM_PATH = '/v2/billing/meter/daily-checkin'

/** POST an empty JSON body and read the envelope. */
async function postJson(url: string, headers: Record<string, string>): Promise<UpstreamEnvelope> {
  const response = await fetch(url, { method: 'POST', headers, body: '{}' })
  return await readEnvelope(response)
}

/** Read the first field present, tolerating the upstream's naming drift. */
function firstDefined(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key]
  }
  return undefined
}

/**
 * Query check-in state.
 *
 * A 404 means the path spelling is wrong and the next candidate is tried; any
 * other answer — including a rejection — is authoritative, because retrying a
 * different spelling after a 403 would only generate more rejected requests.
 */
export async function queryCheckinStatus(
  variant: WorkBuddyVariant,
  credential: SigninCredentialView,
  endpoints: WorkBuddySigninEndpoints = signinEndpointsFor(variant),
): Promise<WorkBuddyCheckinStatus> {
  const attempts: WorkBuddyCheckinAttempt[] = []
  let last: UpstreamEnvelope | undefined
  for (const path of checkinStatusPaths(variant.region)) {
    const url = `${endpoints.billingBase}${path}`
    let envelope: UpstreamEnvelope
    try {
      envelope = await postJson(url, businessHeaders(endpoints, credential))
    } catch (error: unknown) {
      attempts.push({ url, error: error instanceof Error ? error.message : String(error) })
      continue
    }
    attempts.push({
      url,
      status: envelope.status,
      ...envelope.code === undefined ? {} : { code: envelope.code },
      ...envelope.msg === undefined ? {} : { msg: envelope.msg },
    })
    if (envelope.status !== 404) {
      last = envelope
      break
    }
    last = envelope
  }
  if (last === undefined) {
    return { raw: { status: 0, ok: false, document: {} }, attempts }
  }
  const data = last.data ?? {}
  const checked = firstDefined(data, ['today_checked_in', 'todayCheckedIn', 'checked_in', 'checkedIn', 'signed'])
  const streak = firstDefined(data, ['continuity_days', 'continuityDays', 'streak'])
  return {
    ...typeof checked === 'boolean' ? { checkedToday: checked } : {},
    ...typeof streak === 'number' ? { streakDays: streak } : {},
    raw: last,
    attempts,
  }
}

/** How to read a claim attempt. */
export type WorkBuddyClaimOutcome =
  /** The reward was granted by this call. */
  | { state: 'claimed', credits?: number }
  /** Already claimed today; the endpoint is idempotent. */
  | { state: 'already' }
  /** This product has no check-in activity at all. */
  | { state: 'no-activity' }
  /** Rejected by device risk control (401/403). */
  | { state: 'blocked', status: number }
  /** Anything else, with the upstream's own wording. */
  | { state: 'failed', status: number, code?: number, message?: string }
  /** The request never completed. */
  | { state: 'unreachable', error: string }

/**
 * Claim the daily reward.
 *
 * The two products answer with the **same** `code` 10001 but different
 * meanings, so the message text is the only signal that separates "already
 * claimed today" (CN, normal) from "no check-in activity" (international, also
 * normal). `checkedToday === false` from the preceding status query is the
 * corroborating evidence: if the status just said "not yet", a failure cannot
 * have been "already claimed".
 */
export async function claimDailyCheckin(
  variant: WorkBuddyVariant,
  credential: SigninCredentialView,
  status: WorkBuddyCheckinStatus,
  endpoints: WorkBuddySigninEndpoints = signinEndpointsFor(variant),
): Promise<WorkBuddyClaimOutcome> {
  const url = `${endpoints.billingBase}${CHECKIN_CLAIM_PATH}`
  let envelope: UpstreamEnvelope
  try {
    envelope = await postJson(url, businessHeaders(endpoints, credential))
  } catch (error: unknown) {
    return { state: 'unreachable', error: error instanceof Error ? error.message : String(error) }
  }
  if (envelope.status === 401 || envelope.status === 403) return { state: 'blocked', status: envelope.status }
  if (envelope.ok && (envelope.code === undefined || envelope.code === 0)) {
    const data = envelope.data ?? {}
    const gained = firstDefined(data, ['credits', 'points', 'amount'])
    return { state: 'claimed', ...typeof gained === 'number' ? { credits: gained } : {} }
  }
  const message = envelope.msg ?? ''
  if (status.checkedToday === false && /未开启|已过期|expired|inactive|not\s*(?:open|active|available)/iu.test(message)) {
    return { state: 'no-activity' }
  }
  if (/已签|already|重复/iu.test(message)) return { state: 'already' }
  return {
    state: 'failed',
    status: envelope.status,
    ...envelope.code === undefined ? {} : { code: envelope.code },
    ...message === '' ? {} : { message },
  }
}
