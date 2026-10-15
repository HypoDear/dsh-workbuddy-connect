/**
 * Per-model credit badge beside the Composer's model selector.
 *
 * The seat shows the signed-in account's remaining WorkBuddy balance as one
 * tiny annotation next to the selected model, read from the plugin's own status
 * route:
 *
 * - a **credit badge** (#99): the remaining balance, set smaller and dimmer than
 *   the surrounding chrome so it reads as an annotation on the icon. Hidden
 *   whenever the document has no honest answer (signed-out, error, missing
 *   `credits`); zero is a real balance and is shown, `unlimited` renders as ∞
 *   rather than as 0.
 * - a **↻ beside the badge** is the only re-read after the mount fetch: there
 *   is no interval and no focus polling, because every status GET also queries
 *   billing upstream and the balance should not refresh behind the user's back.
 *   A failed manual read hides the balance rather than passing the old one off
 *   as current.
 *
 * Reasoning-effort detection used to live in this same seat. It was removed:
 * the plugin now sends one fixed effort for every reasoning model (see
 * `FIXED_REASONING_EFFORT` in `adapter.ts`), so there is nothing left to detect
 * and no per-model entry to render. The module and symbol names keep their
 * historical `probe` spelling because the route path they build on does too.
 *
 * @module dsh-workbuddy-connect/client/probe-control
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { CARD_VARIANTS, type WorkBuddyCardVariant, type WorkBuddyPluginCardInjected } from './WorkBuddyPluginCard.tsx'
import { isWorkBuddyWebStatus } from './status-document.ts'
import type { WorkBuddyWebStatus } from '../status-paths.ts'

/** Injected props; `directory` resolves the session's current model selection. */
export interface WorkBuddyProbeControlProps extends WorkBuddyPluginCardInjected {
  directory: ModelDirectory['store']
}

/**
 * The card (and therefore the routes) a selected provider belongs to.
 *
 * The control serves both WorkBuddy providers from one seat, so the provider id
 * is what selects the status and probe endpoints. Returning `undefined` for any
 * other provider is what keeps the icon off every non-WorkBuddy model.
 */
export function cardVariantFor(provider: string): WorkBuddyCardVariant | undefined {
  return CARD_VARIANTS.find(card => card.id === provider)
}

// The host slot's baseline sits a touch high and leaves a full inter-control gap
// before the model picker. Nudge only this annotation down and inward so it
// reads as part of the selected model rather than a separate toolbar item.
const wrapperStyle: CSSProperties = {
  display: 'inline-flex',
  position: 'relative',
  alignItems: 'center',
  transform: 'translateY(2px)',
  marginRight: -8,
}
/**
 * The inline label. Smaller and dimmer than the surrounding chrome on purpose:
 * it names the feature, so it should read as an annotation attached to the icon
 * rather than compete with the adjacent model selector.
 */
/**
 * The credit badge (#99). The same annotation register as {@link labelStyle} —
 * small and dim, on the model name's side of the seat — so a changing balance
 * reads as a note on the selection, not composer chrome of its own.
 */
const creditStyle: CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-tertiary)',
  whiteSpace: 'nowrap',
  padding: '0 4px',
}

/**
 * The badge's ↻ (#99): the only re-read after the mount fetch. An icon-only
 * button in the same dim register, so it reads as part of the annotation
 * rather than a fourth composer control.
 */
const refreshStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** Tooltip bubble: the Fast Mode shape (nowrap, one line, above the control). */
/** Confirmation bubble: same anchor, but interactive and allowed to wrap. */
/**
 * Primary action inside the confirmation bubble.
 *
 * The fill and its text colour must come as a pair: `brand-primary` resolves to
 * a light accent in this theme, so hardcoding `color: #fff` on top of it renders
 * white-on-white. `button-primary-fill` + `label-primary-foreground` is the
 * theme's own pair for exactly this, and is what `dsh-codex-connect` uses for
 * the same job.
 */
/**
 * Result note: a single line + a dismiss button, anchored to the control's
 * right side. Smaller than the confirmation bubble because it carries an
 * *outcome*, not a *decision* — the work is done, the user only has to read
 * and dismiss.
 */
/**
 * The note's dismiss action. Outlined rather than bare text: inside an already
 * bordered bubble, an unbordered word does not read as something you can click.
 * Matches the outlined pill convention the plugin's other secondary actions use.
 */
/**
 * The credit badge's one line, or `undefined` whenever there is no honest
 * answer to show (#99).
 *
 * Every non-answer collapses to hidden: a signed-out or errored document, a
 * missing `credits` section (which is also all a `creditsError` leaves behind),
 * or a total that is not a finite number — the status guard deliberately does
 * not validate optional fields, so this narrows before reading. Zero is a real
 * balance and is shown; `unlimited` renders as ∞, never as 0.
 */
function creditBadge(
  status: WorkBuddyWebStatus | undefined,
  card: WorkBuddyCardVariant,
  t: WorkBuddyPluginCardInjected['t'],
): string | undefined {
  if (status === undefined || status.status !== 'signed-in') return undefined
  // A document that names a credit error has no trustworthy balance — even in
  // the malformed case where it also carries a `credits` section.
  if (status.creditsError !== undefined) return undefined
  const credits = status.credits
  if (credits === undefined) return undefined
  const total = credits.unlimited === true
    ? '∞'
    : typeof credits.total === 'number' && Number.isFinite(credits.total)
      ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(credits.total)
      : undefined
  if (total === undefined) return undefined
  return t('composerCredit', { prefix: card.creditPrefix, total })
}

/** Model-independent shell: resolves the selection, then delegates per model. */
export function WorkBuddyProbeControl({ directory, t }: WorkBuddyProbeControlProps) {
  const subscribe = useCallback((listener: () => void) => directory.subscribe(listener), [directory])
  const snapshot = useCallback(() => directory.getSnapshot(), [directory])
  // The host's `ModelDirectoryState.current` is `ModelSelection | null` — null,
  // never undefined, while the session's projection or the shared catalog is
  // still loading (#125). The prop's type resolves to `any` here (the host's
  // `SnapshotStore` module is not installed and `skipLibCheck` skips its
  // re-export), so the runtime union is asserted once to keep the handling
  // below checked.
  const selection = useSyncExternalStore(subscribe, snapshot, snapshot).current as
    { provider: string, model: string } | null | undefined
  // A not-ready selection (`null`/`undefined`) renders nothing but KEEPS the
  // component mounted and subscribed: the directory store replaces its
  // snapshot once the session's projection lands, `useSyncExternalStore`
  // re-renders, and the seat appears. The old code guarded only `undefined`
  // (a value this store never produces) and dereferenced `selection.provider`
  // off `null`, which the slot runtime's per-entry error boundary turns into
  // the badge and the ↻ disappearing together until a full reload — the exact
  // report of #125 / #132.
  //
  // Deliberately NO remembered seat across the not-ready window: which
  // account's balance may show is a property of THIS session's selection, and
  // while it is unknown (another session's composer may be switching to a
  // non-WorkBuddy provider right now) showing the last WorkBuddy variant
  // anywhere would present — and bill-query — the wrong provider's account.
  // The blank window is brief by construction; a resolved WorkBuddy selection
  // restores the seat through the store notification above.
  if (selection == null) return null
  const card = cardVariantFor(selection.provider)
  // `card` identifies both the variant and its routes, so a selection under
  // either provider resolves to exactly one card's status pair: the control can
  // never read one variant's account while showing the other's. A foreign
  // provider hides the seat; a WorkBuddy one mounts it fresh.
  // A new selection gets fresh state; a late response cannot target the new model.
  return card === undefined
    ? null
    : <ModelProbe key={`${card.id}:${selection.model}`} model={selection.model} card={card} t={t} />
}

function ModelProbe({ model, card, t }: {
  model: string
  card: WorkBuddyCardVariant
} & WorkBuddyPluginCardInjected) {
  const [status, setStatus] = useState<WorkBuddyWebStatus>()
  /**
   * A manual credit read failed (#99). The balance hides until a later read
   * succeeds, so the old number can never pose as current; the probe state is
   * untouched — the two features merely share one document.
   */
  const [creditFailed, setCreditFailed] = useState(false)
  /** Whether a manual credit refresh is in flight, for the ↻'s busy state. */
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef(false)
  const refreshingRef = useRef(false)
  const mounted = useRef(false)
  const readSeq = useRef(0)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const seq = ++readSeq.current
    const response = await fetch(card.statusPath, {
      credentials: 'same-origin',
      // The balance must not come from any intermediate cache: a manual ↻ is
      // asking for exactly one fresh billing read.
      cache: 'no-store',
      headers: { accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    /*
     * A 200 does not promise a status document: the body may be empty, literal
     * `null`, or a non-JSON page. Storing that unchecked would put a value in
     * state that `resultFor` dereferences on the next render, so it is validated
     * here with the same predicate the settings card uses. A rejection is left to
     * the callers below, which already degrade quietly.
     */
    const value: unknown = await response.json().catch(() => undefined)
    if (!isWorkBuddyWebStatus(value)) throw new Error(t('statusResponseInvalid'))
    if (mounted.current && !signal?.aborted && seq === readSeq.current) {
      setStatus(value)
      setCreditFailed(false)
    }
  }, [card.statusPath, t])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    // One read on mount is all the automatic refreshing there is: every status
    // GET also queries billing upstream, so the balance must not re-read
    // behind the user's back. Later reads are the ↻ click and the trailing
    // read after a probe this control started (which the user also clicked).
    void refresh(controller.signal).catch(() => { /* the icon still works without state */ })
    return () => {
      mounted.current = false
      controller.abort()
    }
  }, [refresh])

  /**
   * The ↻'s action (#99): one manual re-read through the same status route.
   *
   * The guard is a ref, not the state: two clicks inside one act batch both
   * see the same stale `refreshing` closure, and only a synchronous check can
   * keep the second click from sending a second billing read.
   *
   * A failure hides the balance (see `creditFailed`) instead of leaving the old
   * number on screen as though it were fresh — but only when the failed read is
   * still the newest one (`refresh` bumped `readSeq` for it, and nothing newer
   * has started since). An out-of-date manual failure racing a successful
   * probe's trailing read must not hide the fresh balance that just arrived:
   * `readSeq` is what decides, and `refresh` itself already clears the flag on
   * any newer successful write.
   */
  const checkNow = async (): Promise<void> => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    // The seq this manual read took; `refresh` bumps `readSeq` before awaiting.
    const seqAtStart = readSeq.current + 1
    try {
      await refresh()
    } catch {
      // Only hide the balance when this failure is still about the newest read.
      if (mounted.current && readSeq.current === seqAtStart) setCreditFailed(true)
    } finally {
      refreshingRef.current = false
      if (mounted.current) setRefreshing(false)
    }
  }

  // The badge is available exactly when the document answered a balance. A
  // failed manual read hides it (never the old number posing as fresh); the ↻
  // stays as the retry and is the seat's one re-read affordance whatever the
  // document says, which is also how the control recovers from an unreadable
  // first read.
  const credit = creditFailed ? undefined : creditBadge(status, card, t)

  return (
    <span style={wrapperStyle}>
      {credit === undefined ? null : <span style={creditStyle}>{credit}</span>}

      <button
        type="button"
        style={{ ...refreshStyle, opacity: refreshing ? 0.6 : 1, cursor: refreshing ? 'default' : 'pointer' }}
        title={t('composerCreditRefresh')}
        aria-label={t('composerCreditRefresh')}
        aria-busy={refreshing}
        disabled={refreshing}
        onClick={() => { void checkNow() }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v4h-4" />
        </svg>
      </button>

    </span>
  )
}
