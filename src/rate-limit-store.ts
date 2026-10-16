/**
 * Per-account, per-model rate-limit records, persisted across restarts.
 *
 * The user runs the same model on two endpoints and rotates between them when one
 * is throttled, so the reset instant has to survive a restart: a limit recorded at
 * 21:54 must still read "until 09:54" after DSH is restarted at 23:00. That is the
 * whole reason this is a file and not in-memory state.
 *
 * Limits are keyed by `uid:enterpriseId` *and* model id, because the gateway
 * throttles per model: measured 2026-10-16, `deepseek-v4.1-flash` answered 429
 * while `hy3` answered 200 on the same credential at the same moment. A single
 * account-wide flag would therefore be wrong in both directions — it would hide a
 * usable model and fail to hide a throttled one.
 *
 * Only observed facts are stored: the instant the gateway named, when it was seen,
 * and the gateway's own words. A record whose reset instant has passed is treated
 * as absent on read (and dropped on the next write), so a stale entry can never
 * make the UI claim a model is blocked when it is not.
 *
 * Not a place for secrets: model ids, timestamps, and the gateway's user-facing
 * message only — never a token.
 *
 * @module dsh-workbuddy-connect/rate-limit-store
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { isRateLimitActive, type WorkBuddyRateLimit } from './rate-limit.ts'

/** On-disk format this reader accepts; other versions are discarded. */
const RATE_LIMIT_FORMAT_VERSION = 1

/** Basename of the CN variant's rate-limit file inside the Harness home. */
export const WORKBUDDY_RATE_LIMIT_FILENAME = '.workbuddy-ratelimit.json'

interface RateLimitDocument {
  version: typeof RATE_LIMIT_FORMAT_VERSION
  /** `uid:enterpriseId` → model id → record. */
  accounts: Record<string, Record<string, WorkBuddyRateLimit>>
}

/** Plugin-owned rate-limit-file path inside the Harness home. */
export function workbuddyRateLimitPath(filename: string = WORKBUDDY_RATE_LIMIT_FILENAME): string {
  return join(resolveDshHome(), filename)
}

/** Whether a parsed value is a record this reader can trust. */
function isRecord(value: unknown): value is WorkBuddyRateLimit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  return typeof entry['model'] === 'string' && entry['model'] !== ''
    && typeof entry['resetAtMs'] === 'number' && Number.isFinite(entry['resetAtMs'])
    && typeof entry['seenAtMs'] === 'number' && Number.isFinite(entry['seenAtMs'])
    && typeof entry['raw'] === 'string'
}

/** Options for {@link WorkBuddyRateLimitStore}. */
export interface WorkBuddyRateLimitStoreOptions {
  /** Explicit state-file path, overriding the `$DSH_HOME` default. */
  path?: string
}

/**
 * Recorded rate limits, read once and written atomically.
 *
 * Reads stay forgiving (a corrupt file is "nothing recorded"), writes propagate —
 * the same split the visibility store uses. A failed write must not be reported as
 * a saved limit, and the in-memory map is left untouched so a re-read cannot
 * disagree with the disk.
 */
export class WorkBuddyRateLimitStore {
  private readonly path: string
  private accounts: Record<string, Record<string, WorkBuddyRateLimit>> | undefined

  constructor(options: WorkBuddyRateLimitStoreOptions | string = {}) {
    this.path = typeof options === 'string'
      ? options
      : options.path ?? workbuddyRateLimitPath()
  }

  /** Resolved state-file path, for the CLI and tests. */
  filePath(): string {
    return this.path
  }

  private load(): Record<string, Record<string, WorkBuddyRateLimit>> {
    if (this.accounts !== undefined) return this.accounts
    const accounts: Record<string, Record<string, WorkBuddyRateLimit>> = {}
    if (existsSync(this.path)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const document = parsed as Record<string, unknown>
          const raw = document['version'] === RATE_LIMIT_FORMAT_VERSION ? document['accounts'] : undefined
          if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
            for (const [account, models] of Object.entries(raw)) {
              if (typeof models !== 'object' || models === null || Array.isArray(models)) continue
              const kept: Record<string, WorkBuddyRateLimit> = {}
              for (const [model, record] of Object.entries(models)) {
                if (isRecord(record)) kept[model] = record
              }
              if (Object.keys(kept).length > 0) accounts[account] = kept
            }
          }
        }
      } catch {
        // Corrupt or unreadable: treated as nothing recorded.
      }
    }
    this.accounts = accounts
    return accounts
  }

  /**
   * The limit still in force for one account's model, if any.
   *
   * Expired records answer `undefined` without touching the file: the caller is
   * asking "is this model blocked *now*", and rewriting on every read would make
   * a read a write.
   */
  active(account: string, model: string, nowMs: number = Date.now()): WorkBuddyRateLimit | undefined {
    const record = this.load()[account]?.[model]
    return isRateLimitActive(record, nowMs) ? record : undefined
  }

  /** Every still-active limit for one account, for the card's status document. */
  activeFor(account: string, nowMs: number = Date.now()): readonly WorkBuddyRateLimit[] {
    const models = this.load()[account]
    if (models === undefined) return []
    return Object.values(models).filter(record => isRateLimitActive(record, nowMs))
  }

  /**
   * Record a 429 for one account's model, persisting before committing.
   *
   * A later observation always wins: the gateway's own reset instant is the only
   * authority, and re-throttling the same model extends it.
   */
  record(account: string, limit: WorkBuddyRateLimit): void {
    const accounts = { ...this.load() }
    accounts[account] = { ...accounts[account], [limit.model]: limit }
    this.persist(accounts)
    this.accounts = accounts
  }

  /** Drop one model's record — used when a request succeeds against it again. */
  clear(account: string, model: string): void {
    const current = this.load()[account]
    if (current === undefined || current[model] === undefined) return
    const next = { ...current }
    delete next[model]
    const accounts = { ...this.load() }
    if (Object.keys(next).length === 0) delete accounts[account]
    else accounts[account] = next
    this.persist(accounts)
    this.accounts = accounts
  }

  /** Drop every expired record, so the file cannot grow without bound. */
  prune(nowMs: number = Date.now()): void {
    const accounts: Record<string, Record<string, WorkBuddyRateLimit>> = {}
    let changed = false
    for (const [account, models] of Object.entries(this.load())) {
      const kept: Record<string, WorkBuddyRateLimit> = {}
      for (const [model, record] of Object.entries(models)) {
        if (isRateLimitActive(record, nowMs)) kept[model] = record
        else changed = true
      }
      if (Object.keys(kept).length > 0) accounts[account] = kept
    }
    if (!changed) return
    this.persist(accounts)
    this.accounts = accounts
  }

  private persist(accounts: Record<string, Record<string, WorkBuddyRateLimit>>): void {
    const directory = dirname(this.path)
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
    const document: RateLimitDocument = { version: RATE_LIMIT_FORMAT_VERSION, accounts }
    const temporary = resolve(`${this.path}.tmp`)
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, this.path)
  }
}
