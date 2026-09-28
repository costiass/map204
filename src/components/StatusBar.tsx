import { Loader2 } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'

/**
 * A status line along the bottom of the canvas.
 *
 * Long operations — importing a file, saving, reconnecting — have to put their
 * progress somewhere that does not move and does not cover the work. Toasts were
 * doing that job, but a toast is a message that appears and goes away; a status
 * line is a *state*, so it cannot be misread as having finished when it has not.
 *
 * It is bottom-centre because that is where the eye already goes for transient
 * information, and it takes pointer events only on the text itself, so it never
 * blocks a card underneath.
 */
export function StatusBar() {
  const status = useCanvasStore((s) => s.status)

  if (!status) return null

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[94] -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div className="cc-panel pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-xs shadow-lg">
        {status.busy ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-brand" aria-hidden="true" />
        ) : null}
        <span className="text-ink">{status.message}</span>
        {status.detail ? <span className="text-muted">{status.detail}</span> : null}
      </div>
    </div>
  )
}
