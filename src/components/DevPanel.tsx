import { useCallback, useEffect, useState } from 'react'

import {
  getSettingsDiagnostics,
  readSettingsFromServer,
  subscribeSettingsDiagnostics,
  type SettingsDiagnostics,
} from '@/store/documentSettings'
import { useCanvasStore } from '@/store/useCanvasStore'

/**
 * A read-only window onto the reader's settings file. Ctrl+Shift.
 *
 * ## Why it exists
 *
 * "My camera is not being saved" has four answers, and none of them can be told
 * apart by looking at the database:
 *
 *   * nothing was ever queued — no account, or an unsaved map, so there is no file
 *   * a write is in flight
 *   * a write failed, and is being retried
 *   * a write succeeded
 *
 * The first one produces no error, no request, and nothing to find in the logs. It
 * is the hardest kind of failure to see and the easiest to fix, once you can see it.
 *
 * ## What it shows
 *
 * The queued value *beside* the value the server returned, and the gap between them.
 * A write that succeeded and a write that never left the browser look identical from
 * the database; putting the two next to each other is what separates them. When they
 * disagree, the reason is on the line above: queued, in flight, or the last error.
 *
 * Read-only. It changes nothing, and there is no control here that can write -- a
 * debugging tool that can alter the thing it is measuring reports something other
 * than what is happening.
 */
export function DevPanel({ onClose }: { onClose: () => void }) {
  const [diag, setDiag] = useState<SettingsDiagnostics>(() => getSettingsDiagnostics())
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const activePageId = useCanvasStore((s) => s.activePageId)

  // Re-render on every queue state change, and once a second for the age readout --
  // a "2s ago" that only updates when something else happens is not an age.
  useEffect(() => subscribeSettingsDiagnostics(() => setDiag(getSettingsDiagnostics())), [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await readSettingsFromServer()
    } finally {
      setRefreshing(false)
    }
  }, [])

  const { state } = diag

  // The one thing the user is looking for, as a single word. Ordered so that the
  // worst explanation is never hidden behind a better-looking one: a pending write
  // next to a failed one is still a failure.
  const verdict = (() => {
    if (diag.blockedBecause) return { tone: 'bad' as const, text: `not saving: ${diag.blockedBecause}` }
    if (state.lastError) return { tone: 'bad' as const, text: `last write failed: ${state.lastError}` }
    if (state.inFlight) return { tone: 'busy' as const, text: 'writing to the server…' }
    if (state.queued) return { tone: 'busy' as const, text: 'waiting to write (400ms)' }
    if (state.lastSuccessAgeMs === null) return { tone: 'idle' as const, text: 'nothing to save yet' }
    return { tone: 'good' as const, text: `saved ${ago(state.lastSuccessAgeMs, now)}` }
  })()

  return (
    <div className="cc-panel fixed bottom-3 right-3 z-[96] w-[26rem] max-w-[calc(100vw-1.5rem)] overflow-hidden shadow-2xl">
      <header className="flex items-center gap-2 border-b border-line bg-surface-sunken px-3 py-2">
        <span className="cc-label flex-1">Developer · reader settings</span>
        <button type="button" className="cc-btn" onClick={onClose} title="Close (Ctrl+Shift)">
          ✕
        </button>
      </header>

      {/* The answer, in one line, with a dot that cannot be mistaken. */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span
          aria-hidden
          // The class, not an inline animation, so `prefers-reduced-motion` can
          // reach it. The pulse is emphasis; the colour is the signal, and a
          // reduced-motion reader keeps the colour.
          className={`cc-saving-dot h-2.5 w-2.5 shrink-0 rounded-full ${
            verdict.tone === 'busy' ? '' : 'cc-saving-dot-still'
          }`}
          style={{
            background:
              verdict.tone === 'good'
                ? 'var(--color-brand)'
                : verdict.tone === 'busy'
                  ? '#F59E0B'
                  : '#DC2626',
          }}
        />
        <span className="text-[12px] text-ink">{verdict.text}</span>
      </div>

      <div className="cc-scroll max-h-[60vh] overflow-y-auto px-3 py-2.5 text-[11px] text-slate-600">
        <dl className="space-y-1">
          <Row k="Account" v={diag.userId ? diag.userId.slice(0, 8) : '— not signed in'} />
          <Row k="Workspace" v={diag.documentId ?? '— none open'} />
          <Row k="Page" v={activePageId ?? '—'} />
          <Row k="Sink" v={diag.sinkInstalled ? 'installed' : 'NOT INSTALLED'} />
          <Row k="Writes" v={String(state.writes)} />
          <Row k="Attempts on current" v={String(state.attempts)} />
        </dl>

        {diag.blockedBecause ? (
          <p className="mt-2 rounded-md border border-danger-soft bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
            Nothing is being queued, so nothing is being written. No request is made and
            nothing is logged — this is why it looks like the save is broken when it
            never started.
          </p>
        ) : null}

        {state.lastError ? (
          <p className="mt-2 rounded-md border border-danger-soft bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
            <strong className="block">The last write failed</strong>
            <code className="mt-0.5 block break-words">{state.lastError}</code>
            <span className="mt-1 block opacity-80">
              The value is kept and retried, twice. If this is a permissions or network
              error it will not fix itself.
            </span>
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="cc-btn"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Reading…' : 'Read from server'}
          </button>
          {diag.fromServerAt ? (
            <span className="text-[10.5px] text-slate-400">
              read {ago(now - diag.fromServerAt, now)} ago
            </span>
          ) : (
            <span className="text-[10.5px] text-slate-400">not read yet</span>
          )}
        </div>

        <p className="mt-1.5 text-[10.5px] leading-snug text-slate-400">
          Pan or zoom the canvas and watch the dot. A change is written 400ms after
          you stop moving, and immediately when the tab is hidden.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Json
            title="Queued here"
            value={diag.pending}
            empty="nothing queued"
          />
          <Json
            title="On the server"
            value={diag.fromServer}
            empty={diag.fromServerAt ? 'no row' : 'not read yet'}
          />
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="shrink-0 text-slate-400">{k}</dt>
      <dd className="truncate font-mono text-[10.5px]" title={v}>
        {v}
      </dd>
    </div>
  )
}

function Json({
  title,
  value,
  empty,
}: {
  title: string
  value: unknown
  empty: string
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {title}
      </p>
      <pre className="cc-scroll max-h-40 overflow-auto rounded-md border border-line bg-surface-sunken p-1.5 text-[10px] leading-snug text-slate-600">
        {value == null ? <span className="text-slate-400">{empty}</span> : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function ago(ms: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 1) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}
