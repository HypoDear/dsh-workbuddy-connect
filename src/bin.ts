#!/usr/bin/env node
/** Standalone status/diagnostics CLI for the dsh-workbuddy-connect bundle. */

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WorkBuddyCredentialStore, workbuddyOwnAuthPath } from './auth.ts'
import { WorkBuddyUpstreamClient } from './upstream.ts'
import { FALLBACK_WORKBUDDY_AI_MODELS, FALLBACK_WORKBUDDY_MODELS } from './catalog.ts'
import { WORKBUDDY_CONNECT_VERSION } from './version.ts'
import { isHeartbeatProcessAlive, readHostHeartbeat, workbuddyHostHeartbeatPath } from './host-heartbeat.ts'
import { atRestKeyProviderFor } from './desktop-credential-protection.ts'
import { CN_VARIANT, variantFor, WORKBUDDY_VARIANTS, type WorkBuddyVariant } from './variants.ts'
import { resolveAppVersion } from './app-version.ts'
import {
  buildSigninDocument,
  claimDailyCheckin,
  fetchAccount,
  openInBrowser,
  pollAuthorization,
  queryCheckinStatus,
  resolveIssuedDomain,
  signinEndpointsFor,
  signinPathFor,
  startAuthorization,
  writeSigninDocument,
} from './signin.ts'

type Action = 'checkin' | 'doctor' | 'login' | 'logout' | 'status'

const JSON_SCHEMA_VERSION = 1

/** Remove token-like strings from an unexpected diagnostic message. */
function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, '$1[redacted]')
}

function printHelp(): void {
  process.stdout.write([
    'Usage: dsh-workbuddy-connect <checkin|doctor|login|logout|status> [options]',
    '',
    '  doctor   secret-free sign-in and environment diagnostics',
    '  status   sign-in state, remaining WorkBuddy credit, and host-bundle health',
    '  login    sign in over HTTPS and write a plaintext credential (no desktop app needed)',
    '  checkin  query the daily check-in reward; --claim to claim it when available',
    '  logout   remove the plugin-owned credential copy (the desktop app keeps its sign-in)',
    '',
    '  --provider  which product to inspect; defaults to workbuddy',
    `              one of: ${WORKBUDDY_VARIANTS.map(variant => variant.id).join(', ')}`,
    '  --json      emit one secret-free JSON document (doctor/status/login/checkin)',
    '  --no-open   login: print the sign-in URL instead of opening a browser',
    '  --claim     checkin: actually claim the reward, not just query it',
    '',
  ].join('\n'))
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

/**
 * One variant's store plus the client that performs its refreshes.
 *
 * The key provider is built by the same shared helper the plugin host uses,
 * so the CLI's `doctor`/`status` and the browser card can never disagree
 * about which product's Electron a variant resolves.
 */
function makeStore(variant: WorkBuddyVariant): WorkBuddyCredentialStore {
  const client = new WorkBuddyUpstreamClient()
  return new WorkBuddyCredentialStore({
    variant,
    refresh: credential => client.refreshToken(credential),
    keyProvider: atRestKeyProviderFor(variant),
  })
}

/** The plugin-owned credential copy for one variant, for display. */
function ownAuthPath(variant: WorkBuddyVariant): string {
  return makeStore(variant).ownAuthPath()
}

/** Fallback roster size for one variant. */
function fallbackCount(variant: WorkBuddyVariant): number {
  return variant.id === CN_VARIANT.id ? FALLBACK_WORKBUDDY_MODELS.length : FALLBACK_WORKBUDDY_AI_MODELS.length
}

async function doctor(jsonOutput: boolean, variant: WorkBuddyVariant): Promise<number> {
  const store = makeStore(variant)
  const status = await store.status()
  const desktopPresent = await store.desktopFilePresent()
  const desktopFormat = await store.desktopAuthFormat()
  // Name the file that was actually hit (e.g. the XDG data-home copy on
  // UOS/deepin), falling back to the first *possible* location
  // when none exists so the hint still says where to point WORKBUDDY_AUTH_FILE.
  const desktopPath = await store.resolvedDesktopAuthPath() ?? store.desktopAuthPath()
  const heartbeat = await readHostHeartbeat()
  const hostAlive = heartbeat !== undefined && isHeartbeatProcessAlive(heartbeat)
  // Only the international variant needs a UA, and reading it is how `doctor`
  // answers "where would the catalog version come from" without guessing.
  const appVersion = variant.region === 'global' ? await resolveAppVersion() : undefined
  // A signed-out state beside an encrypted file usually means the unlock
  // failed, not that nobody is signed in: the status reason carries the real
  // cause, it is promoted to the first hint, and the generic "sign in again"
  // hint is suppressed — sending the user to re-login would be the wrong fix.
  const decryptionNote = status.state === 'signed-out' && desktopFormat === 'encrypted' && status.reason !== undefined
    ? `Encrypted desktop credential could not be used: ${status.reason}`
    : undefined
  const report = {
    schemaVersion: JSON_SCHEMA_VERSION,
    package: 'dsh-workbuddy-connect',
    version: WORKBUDDY_CONNECT_VERSION,
    node: process.version,
    provider: variant.id,
    displayName: variant.displayName,
    desktopAuthFile: {
      path: desktopPath ?? `(no platform default; set ${variant.env})`,
      present: desktopPresent,
      // How the file reads on disk: absent | plaintext | encrypted |
      // unrecognized. WorkBuddy 5.6 seals its token fields, so "encrypted"
      // is a healthy state, not an error — the unlock is attempted (and its
      // failure explained) by the sign-in state below.
      format: desktopFormat,
    },
    ownAuthFile: ownAuthPath(variant),
    ...appVersion === undefined ? {} : {
      catalogUserAgent: {
        version: appVersion.version,
        source: appVersion.source,
        ...appVersion.bundle === undefined ? {} : { bundle: appVersion.bundle },
      },
    },
    hostHeartbeat: {
      path: workbuddyHostHeartbeatPath(),
      present: heartbeat !== undefined,
      ...heartbeat === undefined ? {} : { registeredAt: heartbeat.registeredAt, pid: heartbeat.pid },
      processAlive: hostAlive,
    },
    signIn: status.state,
    fallbackModels: fallbackCount(variant),
    hints: [
      ...decryptionNote !== undefined ? [decryptionNote]
        : status.state === 'signed-out' ? [`Sign in once in the ${variant.appName} desktop app, then run status again.`] : [],
      ...desktopPresent ? [] : [`No ${variant.appName} desktop auth file at the expected path; set ${variant.env} if it lives elsewhere.`],
      ...hostAlive ? [] : ['Host bundle not running in this DSH profile (or the process exited). The browser card and provider are unavailable until DSH starts the plugin.'],
    ],
  }
  if (jsonOutput) {
    printJson({ ...report, ...decryptionNote === undefined ? {} : { decryptionNote } })
  } else {
    process.stdout.write([
      `${variant.displayName} Connect ${WORKBUDDY_CONNECT_VERSION} on ${process.version}`,
      `Desktop auth file: ${report.desktopAuthFile.present ? 'present' : 'missing'} — ${desktopFormat} (${report.desktopAuthFile.path})`,
      `Host bundle: ${hostAlive ? `running (pid ${heartbeat!.pid})` : heartbeat !== undefined ? 'stale heartbeat (process exited)' : 'not started'}`,
      `Sign-in state: ${report.signIn}`,
      `Static fallback models: ${report.fallbackModels}`,
      ...appVersion === undefined ? [] : [`Catalog User-Agent version: ${appVersion.version} (${appVersion.source})`],
      ...report.hints.map(hint => `Hint: ${hint}`),
      '',
    ].join('\n'))
  }
  return status.state === 'signed-in' && desktopPresent ? 0 : 1
}

async function status(jsonOutput: boolean, variant: WorkBuddyVariant): Promise<number> {
  const store = makeStore(variant)
  const client = new WorkBuddyUpstreamClient()
  const authStatus = await store.status()
  const heartbeat = await readHostHeartbeat()
  const hostAlive = heartbeat !== undefined && isHeartbeatProcessAlive(heartbeat)
  const hostState = hostAlive ? 'running' : heartbeat !== undefined ? 'stale' : 'not-started'
  if (authStatus.state !== 'signed-in') {
    if (jsonOutput) {
      printJson({ schemaVersion: JSON_SCHEMA_VERSION, package: 'dsh-workbuddy-connect', version: WORKBUDDY_CONNECT_VERSION, provider: variant.id, status: 'signed-out', hostBundle: hostState })
    } else {
      process.stdout.write(`${variant.displayName} Connect: signed out\nHost bundle: ${hostState}\n`)
    }
    return 1
  }
  let credits: { total: number; unlimited?: true; error?: string } | undefined
  try {
    const credential = await store.current()
    if (credential !== undefined) {
      const fetched = await client.fetchCredits(credential)
      credits = {
        total: fetched.total,
        ...fetched.unlimited === true ? { unlimited: true } : {},
      }
    }
  } catch (error: unknown) {
    credits = { total: 0, error: safeMessage(error) }
  }
  const expiresAt = authStatus.expiresAtMs !== undefined ? new Date(authStatus.expiresAtMs).toISOString() : undefined
  if (jsonOutput) {
    printJson({
      schemaVersion: JSON_SCHEMA_VERSION,
      package: 'dsh-workbuddy-connect',
      version: WORKBUDDY_CONNECT_VERSION,
      provider: variant.id,
      status: 'signed-in',
      ...expiresAt === undefined ? {} : { accessTokenExpires: expiresAt },
      ...authStatus.nickname === undefined ? {} : { nickname: authStatus.nickname },
      ...authStatus.domain === undefined || authStatus.domain === '' ? {} : { domain: authStatus.domain },
      source: authStatus.source,
      credits: credits?.total,
      ...credits?.unlimited === true ? { creditsUnlimited: true } : {},
      ...credits?.error === undefined ? {} : { creditsError: credits.error },
      hostBundle: hostState,
    })
    return 0
  }
  process.stdout.write([
    `${variant.displayName} Connect: signed in${authStatus.nickname === undefined ? '' : ` as ${authStatus.nickname}`}`,
    ...expiresAt === undefined ? [] : [`Access token expires ${expiresAt} (refresh is automatic)`],
    credits?.error !== undefined
      ? `Remaining credit: unavailable (${credits.error})`
      // An uncapped quota has no balance to print; showing the placeholder 0
      // would read as "exhausted".
      : credits?.unlimited === true
        ? 'Remaining credit: unlimited'
        : `Remaining credit: ${credits?.total ?? 'unknown'}`,
    `Host bundle: ${hostAlive ? `running (pid ${heartbeat!.pid})` : hostState === 'stale' ? 'stale heartbeat (DSH process exited)' : 'not started in this profile'}`,
    'Client card: load failures are logged to the browser console only; the host provider is unaffected.',
    '',
  ].join('\n'))
  return 0
}

/**
 * Sign in over plain HTTPS and persist a plaintext credential.
 *
 * The point of doing this here is that it removes the plugin's only hard
 * dependency on the desktop app: the credential written below is readable by
 * {@link WorkBuddyCredentialStore} without ever launching an Electron binary,
 * so the app can be uninstalled once this succeeds.
 */
async function login(
  variant: WorkBuddyVariant,
  options: { open: boolean, timeoutSec: number, json: boolean },
): Promise<number> {
  const endpoints = signinEndpointsFor(variant)
  const request = await startAuthorization(variant, endpoints)
  const output: string[] = []
  if (options.json) {
    printJson({
      schemaVersion: JSON_SCHEMA_VERSION,
      package: 'dsh-workbuddy-connect',
      version: WORKBUDDY_CONNECT_VERSION,
      provider: variant.id,
      status: 'awaiting-browser',
      authUrl: request.authUrl,
      ...request.notes.length === 0 ? {} : { notes: request.notes },
      signinFile: signinPathFor(variant),
    })
  } else {
    process.stdout.write([
      `Signing in to ${variant.displayName} (${endpoints.base})`,
      '',
      'Open this URL in a browser to continue:',
      '',
      `  ${request.authUrl}`,
      '',
      ...request.notes.length === 0 ? [] : [`  (link corrected: ${request.notes.join('; ')})`],
      `  Copy the WHOLE link: a truncated URL is reported by the page as an incomplete sign-in link.`,
      '',
    ].join('\n'))
    if (options.open) {
      process.stdout.write(openInBrowser(request.authUrl)
        ? '  (browser launch attempted; copy the URL manually if nothing opened)\n\n'
        : '  (could not launch a browser; copy the URL above)\n\n')
    }
  }
  const tokens = await pollAuthorization(variant, request.state, {
    timeoutMs: options.timeoutSec * 1000,
    endpoints,
    onTick: (secondsLeft, note) => {
      if (options.json) return
      process.stdout.write(`\r  waiting for the browser… ${secondsLeft}s   ${note ?? ''}`)
    },
  })
  if (!options.json) process.stdout.write('\r  signed in, finishing…                    \n')

  const account = await fetchAccount(variant, request.state, tokens.accessToken, { endpoints })
  const domain = resolveIssuedDomain(variant, tokens.domain)
  const document = buildSigninDocument({ tokens, account, domain })
  const path = signinPathFor(variant)
  await writeSigninDocument(path, document)

  if (options.json) {
    printJson({
      schemaVersion: JSON_SCHEMA_VERSION,
      package: 'dsh-workbuddy-connect',
      version: WORKBUDDY_CONNECT_VERSION,
      provider: variant.id,
      status: 'signed-in',
      signinFile: path,
      domain,
      ...account.nickname === undefined ? {} : { nickname: account.nickname },
      ...tokens.expiresAtMs === undefined ? {} : { accessTokenExpires: new Date(tokens.expiresAtMs).toISOString() },
      ...tokens.refreshExpiresAtMs === undefined ? {} : { refreshTokenExpires: new Date(tokens.refreshExpiresAtMs).toISOString() },
    })
    return 0
  }

  process.stdout.write([
    `Signed in to ${variant.displayName}${account.nickname === undefined ? '' : ` as ${account.nickname}`}.`,
    `Credential written to ${path} (mode 0600).`,
    ...tokens.expiresAtMs === undefined ? [] : [`Access token expires ${new Date(tokens.expiresAtMs).toISOString()} (refresh is automatic).`],
    ...tokens.refreshExpiresAtMs === undefined
      ? ['The upstream did not report a refresh expiry; re-run login when the token eventually lapses.']
      : [`Refresh token expires ${new Date(tokens.refreshExpiresAtMs).toISOString()}.`],
    '',
    'Next: point the plugin at it and restart DSH so the profile sees the variable:',
    '',
    `  [Environment]::SetEnvironmentVariable('${variant.env}', '${path}', 'User')`,
    '',
    'The desktop app is no longer required for this product once that works.',
    '',
  ].join('\n'))
  return 0
}

/** Query (and optionally claim) the daily check-in reward. */
async function checkin(
  variant: WorkBuddyVariant,
  options: { claim: boolean, json: boolean },
): Promise<number> {
  const store = makeStore(variant)
  const status = await store.status()
  if (status.state !== 'signed-in') {
    if (options.json) {
      printJson({ schemaVersion: JSON_SCHEMA_VERSION, package: 'dsh-workbuddy-connect', version: WORKBUDDY_CONNECT_VERSION, provider: variant.id, status: 'signed-out' })
    } else {
      process.stdout.write(`${variant.displayName}: signed out; run login first.\n`)
    }
    return 1
  }
  const credential = await store.current()
  if (credential === undefined) {
    process.stderr.write('dsh-workbuddy-connect: no usable credential\n')
    return 1
  }
  const view = {
    accessToken: credential.accessToken,
    ...credential.uid === '' ? {} : { uid: credential.uid },
    ...credential.enterpriseId === undefined ? {} : { enterpriseId: credential.enterpriseId },
    domain: credential.domain,
  }
  const endpoints = signinEndpointsFor(variant)
  const queried = await queryCheckinStatus(variant, view, endpoints)
  const httpStatus = queried.raw.status
  const reached = queried.raw.ok || queried.raw.status !== 0

  if (options.json) {
    const claimed = options.claim && queried.checkedToday !== true && reached
      ? await claimDailyCheckin(variant, view, queried, endpoints)
      : undefined
    printJson({
      schemaVersion: JSON_SCHEMA_VERSION,
      package: 'dsh-workbuddy-connect',
      version: WORKBUDDY_CONNECT_VERSION,
      provider: variant.id,
      status: 'checked',
      reachable: reached,
      httpStatus,
      ...queried.checkedToday === undefined ? {} : { checkedToday: queried.checkedToday },
      ...queried.streakDays === undefined ? {} : { streakDays: queried.streakDays },
      ...claimed === undefined ? {} : { claim: claimed },
    })
    return reached ? 0 : 1
  }

  const lines: string[] = [`${variant.displayName} check-in (no X-Device-Token is sent):`]
  if (!reached) {
    lines.push('  the endpoint was unreachable; check connectivity and retry.', '')
    process.stdout.write(lines.join('\n'))
    return 1
  }
  lines.push(`  status query: HTTP ${httpStatus}${queried.raw.code === undefined ? '' : `, code ${queried.raw.code}`}`)
  if (queried.checkedToday !== undefined) lines.push(`  checked in today: ${queried.checkedToday ? 'yes' : 'no'}`)
  if (queried.streakDays !== undefined) lines.push(`  consecutive days: ${queried.streakDays}`)

  if (httpStatus === 401 || httpStatus === 403) {
    lines.push(
      '',
      '  Rejected by device risk control (401/403).',
      '  The check-in endpoint wants X-Device-Token, a native risk-control',
      '  fingerprint that cannot be produced outside the vendor SDK.',
      '  Conclusion: automated check-in is not available for this account.',
      '',
    )
    process.stdout.write(lines.join('\n'))
    return 1
  }
  if (!queried.raw.ok || (queried.raw.code !== undefined && queried.raw.code !== 0)) {
    lines.push('', `  the query did not succeed: ${queried.raw.msg ?? '(no message)'}`, '')
    process.stdout.write(lines.join('\n'))
    return 1
  }
  if (!options.claim) {
    lines.push('', '  (read-only; pass --claim to claim the reward)', '')
    process.stdout.write(lines.join('\n'))
    return 0
  }
  if (queried.checkedToday === true) {
    lines.push('', '  already claimed today.', '')
    process.stdout.write(lines.join('\n'))
    return 0
  }

  const outcome = await claimDailyCheckin(variant, view, queried, endpoints)
  const closing: string[] = ['']
  let code = 0
  switch (outcome.state) {
    case 'claimed':
      closing.push(`  claimed${outcome.credits === undefined ? '' : ` ${outcome.credits}`}.`, '', '  automated check-in works for this account.')
      break
    case 'already':
      closing.push('  already claimed today (the upstream reports this as a business error; it is normal).')
      break
    case 'no-activity':
      closing.push(
        '  The upstream reports no check-in activity (or it has lapsed).',
        '  This matches the status query saying "not yet", so it is not a failure:',
        '  this product simply has no check-in to perform.',
      )
      break
    case 'blocked':
      closing.push(`  rejected by device risk control (HTTP ${outcome.status}); automated check-in is not available.`)
      code = 1
      break
    case 'unreachable':
      closing.push(`  the claim request did not complete: ${outcome.error}`)
      code = 1
      break
    case 'failed':
      closing.push(
        `  the claim did not succeed: HTTP ${outcome.status}${outcome.code === undefined ? '' : `, code ${outcome.code}`}${outcome.message === undefined ? '' : `: ${outcome.message}`}`,
      )
      code = 1
      break
  }
  closing.push('')
  process.stdout.write(lines.concat(closing).join('\n'))
  return code
}

/** Execute one boot-free command. */
export async function run(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    return 0
  }
  const [rawAction, ...flags] = argv
  const actions: readonly Action[] = ['checkin', 'doctor', 'login', 'logout', 'status']
  if (!actions.includes(rawAction as Action)) {
    process.stderr.write(`dsh-workbuddy-connect: expected checkin, doctor, login, logout, or status; got ${JSON.stringify(rawAction)}\n`)
    return 1
  }
  const action = rawAction as Action
  const jsonOutput = flags.includes('--json')
  // `--claim` and `--no-open` are subcommand flags, not global ones; they are
  // collected here so the shared flag validator below can ignore them for the
  // commands that accept them and still reject them elsewhere.
  const claim = flags.includes('--claim')
  const noOpen = flags.includes('--no-open')

  // `--provider <id>` (or `--provider=<id>`); absent means the CN provider, so
  // every existing invocation keeps its behaviour.
  let providerId: string | undefined
  const rest: string[] = []
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]!
    if (flag === '--provider') {
      providerId = flags[index + 1]
      index += 1
      continue
    }
    if (flag.startsWith('--provider=')) {
      providerId = flag.slice('--provider='.length)
      continue
    }
    rest.push(flag)
  }
  const variant = providerId === undefined ? CN_VARIANT : variantFor(providerId)
  if (variant === undefined) {
    process.stderr.write(
      `dsh-workbuddy-connect: unknown provider ${JSON.stringify(providerId)}; expected one of ${WORKBUDDY_VARIANTS.map(v => v.id).join(', ')}\n`,
    )
    return 1
  }
  // Each action accepts `--json` plus its own flags; anything else is a typo
  // that must not be silently ignored, so the accepted set is spelled out.
  const accepted: Record<Action, readonly string[]> = {
    doctor: ['--json'],
    status: ['--json'],
    logout: [],
    login: ['--json', '--no-open'],
    checkin: ['--json', '--claim'],
  }
  const allowed = accepted[action]
  const unknown = rest.filter(flag => !allowed.includes(flag))
  if (unknown.length > 0) {
    process.stderr.write(`dsh-workbuddy-connect: invalid options for ${action}: ${unknown.join(' ')}\n`)
    return 1
  }
  try {
    switch (action) {
      case 'doctor':
        return await doctor(jsonOutput, variant)
      case 'status':
        return await status(jsonOutput, variant)
      case 'login':
        return await login(variant, { open: !noOpen, timeoutSec: 300, json: jsonOutput })
      case 'checkin':
        return await checkin(variant, { claim, json: jsonOutput })
      case 'logout': {
        const store = makeStore(variant)
        // Only this variant's plugin-owned copy is removed: the desktop app's
        // own sign-in is never touched, and the model group is not promised to
        // disappear (the desktop file may still supply a credential).
        await store.logout()
        process.stdout.write(
          `${variant.displayName} Connect: removed ${store.ownAuthPath()}; the desktop app's sign-in is untouched\n`,
        )
        return 0
      }
    }
  } catch (error: unknown) {
    process.stderr.write(`dsh-workbuddy-connect: ${action} failed: ${safeMessage(error)}\n`)
    return 1
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2))
}
