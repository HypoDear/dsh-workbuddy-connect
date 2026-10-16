/**
 * Rate-limit reset times, parsed out of the upstream's own 429 message.
 *
 * The endpoints publish the reset *only* as prose. Measured 2026-10-16 on the CN
 * gateway:
 *
 * ```
 * HTTP 429 {"code":6004,
 *   "msg":"您的使用量已超出频率限制，将在 2026-10-16 09:54:17 UTC+8 重置，您也可以切换其他模型继续使用。"}
 * ```
 *
 * There is no `Retry-After`, no `X-RateLimit-*`, and no dedicated field — the
 * timestamp lives inside `msg` (and, for the international gateway, inside
 * `displayMsg.*`). The parse is therefore deliberately *shape*-based rather than
 * wording-based: find a date, a time, and a timezone anywhere in the text. That
 * keeps working if the copy is reworded, translated, or moved between fields,
 * which a `将在 (.*) 重置` pattern would not.
 *
 * The window is 12 hours, anchored at the moment the limit was *triggered*
 * (measured: trigger 21:54:17 → reset 09:54:17 the next day). The reset time is
 * absolute, so it is stored as an instant and never re-derived from "now".
 *
 * @module dsh-workbuddy-connect/rate-limit
 */

/** How long one limit lasts, per measurement. Only used for display copy. */
export const RATE_LIMIT_WINDOW_MS = 12 * 3600 * 1000

/** One model's active limit, as recorded from a real 429. */
export interface WorkBuddyRateLimit {
  /** Model id the gateway refused. Limits are per model, not per account. */
  model: string
  /** When the limit lifts, epoch milliseconds. */
  resetAtMs: number
  /** When the 429 was observed, epoch milliseconds. */
  seenAtMs: number
  /** The upstream's own words, trimmed. Shown when the parse is unusable. */
  raw: string
}

/** Timezone offsets the upstream spells out, in minutes. */
const ZONE_OFFSETS: Record<string, number> = {
  'UTC': 0, 'GMT': 0, 'Z': 0,
  'UTC+8': 8 * 60, 'UTC-8': -8 * 60,
  'UTC+0': 0, 'UTC+9': 9 * 60, 'UTC+7': 7 * 60,
  'CST': 8 * 60, 'GMT+8': 8 * 60,
}

/**
 * Pull a reset instant out of an upstream message.
 *
 * Accepts the two spellings the gateways actually emit — `2026-10-16 09:54:17
 * UTC+8` and `2026-10-16T09:54:17+08:00` — plus a bare `... UTC+8` suffix. A
 * timestamp without a zone is read as UTC+8, the zone both gateways report in;
 * that is a fallback for a reworded message, not a measured case.
 *
 * @returns the instant, or `undefined` when no usable timestamp is present.
 */
export function parseRateLimitReset(text: string): number | undefined {
  if (typeof text !== 'string' || text === '') return undefined

  // ISO 8601 with an explicit numeric offset: 2026-10-16T09:54:17+08:00
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})\s*(?:([+-])(\d{2}):?(\d{2})|Z)/u)
  if (iso !== null) {
    const [, y, mo, d, h, mi, s, sign, oh, om] = iso
    const offsetMinutes = sign === undefined
      ? 0
      : (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om))
    const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
    return utcMs - offsetMinutes * 60 * 1000
  }

  // `YYYY-MM-DD HH:MM:SS` followed by a named zone somewhere after it.
  const named = text.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/u)
  if (named === null) return undefined
  const [, y, mo, d, h, mi, s] = named
  const after = text.slice((named.index ?? 0) + named[0].length, (named.index ?? 0) + named[0].length + 12)
  const zone = after.match(/UTC\s*([+-]\d{1,2})?|GMT\s*([+-]\d{1,2})?|Z\b/u)
  let offsetMinutes = 8 * 60
  if (zone !== null) {
    const signed = zone[1] ?? zone[2]
    if (signed !== undefined) offsetMinutes = Number(signed) * 60
    else offsetMinutes = 0
  }
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return utcMs - offsetMinutes * 60 * 1000
}

/**
 * Extract the human-readable reason from a 429 body, for the `raw` field.
 *
 * Prefers the localized `displayMsg` the international gateway uses, then `msg`,
 * then the body itself — the same precedence the shim already applies to errors.
 */
export function rateLimitReason(body: string): string {
  const trimmed = body.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>
        const display = obj['displayMsg']
        if (typeof display === 'object' && display !== null && !Array.isArray(display)) {
          const zh = (display as Record<string, unknown>)['zh']
          if (typeof zh === 'string' && zh !== '') return zh.slice(0, 300)
        }
        const msg = obj['msg']
        if (typeof msg === 'string' && msg !== '') return msg.slice(0, 300)
      }
    } catch {
      // Not JSON: fall through to the raw body.
    }
  }
  return trimmed.slice(0, 300)
}

/** Whether a stored limit is still in force at `nowMs`. */
export function isRateLimitActive(limit: WorkBuddyRateLimit | undefined, nowMs: number): boolean {
  return limit !== undefined && Number.isFinite(limit.resetAtMs) && limit.resetAtMs > nowMs
}
