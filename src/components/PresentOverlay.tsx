import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Minimize2, Play, X } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'

/**
 * What a presentation looks like while it is running.
 *
 * Deliberately almost nothing. A slide is the map with the camera moved, and
 * every pixel of chrome here is a pixel not given to it. So: no toolbar, no
 * inspector, no sidebar — the whole app hands the screen over.
 *
 * The controls are on a bar that fades out and comes back on the mouse moving,
 * because a bar sitting across the bottom of every slide is exactly what people
 * project and then complain about. Presenter notes are on the same bar rather
 * than in a second panel, so there is only ever one thing to look away to.
 */
export function PresentOverlay() {
  const presenting = useCanvasStore((s) => s.presenting)
  const stepIndex = useCanvasStore((s) => s.stepIndex)
  const steps = useCanvasStore((s) => s.doc.settings.steps)
  const nextStep = useCanvasStore((s) => s.nextStep)
  const prevStep = useCanvasStore((s) => s.prevStep)
  const goToStep = useCanvasStore((s) => s.goToStep)
  const stopPresenting = useCanvasStore((s) => s.stopPresenting)

  useEffect(() => {
    if (!presenting) return
    // A presentation runs on a projector, and a stray scroll or a browser
    // gesture is not what the audience is watching. Only the keys this overlay
    // handles should reach the page at all.
    const block = (event: Event) => {
      if (event.cancelable) event.preventDefault()
    }
    window.addEventListener('wheel', block, { passive: false })
    window.addEventListener('contextmenu', block)
    return () => {
      window.removeEventListener('wheel', block)
      window.removeEventListener('contextmenu', block)
    }
  }, [presenting])

  useEffect(() => {
    if (!presenting) return
    // Clicking the empty canvas advances, which is what everybody tries first.
    // A click that lands on a card does not, so reading a card is not a way to
    // lose your place.
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-present-chrome]')) return
      if (target.closest('[data-card-id]')) return
      nextStep()
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [presenting, nextStep])

  if (!presenting) return null

  const total = steps.length
  const step = total > 0 ? steps[Math.min(stepIndex, total - 1)] : null
  const atEnd = stepIndex >= total - 1

  return (
    <>
      {/* Clicking anywhere on the left third goes back, the way a slideshow
          does, because a presenter holding a clicker will try it. */}
      <button
        type="button"
        aria-label="Previous step"
        data-present-chrome
        onClick={prevStep}
        className={`fixed inset-y-0 left-0 z-40 w-1/4 cursor-w-resize transition ${
          stepIndex > 0 ? 'opacity-0 hover:opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <span className="grid h-full place-items-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-black/60 text-white">
            <ChevronLeft size={24} />
          </span>
        </span>
      </button>

      <div
        data-present-chrome
        className="group fixed inset-y-0 right-0 z-40 flex w-1/4 cursor-e-resize items-center justify-end opacity-0 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100"
      >
        <button
          type="button"
          aria-label="Next step"
          onClick={nextStep}
          className="mr-6 grid h-12 w-12 place-items-center rounded-full bg-black/60 text-white"
        >
          {atEnd ? <X size={20} /> : <ChevronRight size={24} />}
        </button>
      </div>

      {/* The bar. Hidden until the mouse goes near the bottom of the screen, so
          a bar sitting across every slide is not what the audience sees. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
        <div
          data-present-chrome
          className="pointer-events-auto flex max-w-[min(100%,64rem)] items-center gap-3 rounded-xl border border-line bg-surface/95 px-3 py-2 opacity-0 shadow-lg backdrop-blur transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100"
        >
          <button
            type="button"
            className="cc-icon"
            title="Previous step (←)"
            aria-label="Previous step"
            disabled={stepIndex <= 0}
            onClick={prevStep}
          >
            <ChevronLeft size={16} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-ink-strong">
                {total === 0 ? 'No steps' : `Step ${stepIndex + 1} of ${total}`}
              </span>
              {step && step.targetKind !== 'page' && step.targetId ? (
                <span className="truncate text-[11px] text-muted">
                  {step.targetKind} · {step.zoom.toFixed(2)}×
                </span>
              ) : step ? (
                <span className="truncate text-[11px] text-muted">the whole page</span>
              ) : null}
            </div>
          </div>

          {/* A strip of the whole run, so the presenter can see how much is left
              and click to jump. */}
          {total > 1 ? (
            <div className="flex shrink-0 items-center gap-1">
              {steps.map((entry, i) => (
                <button
                  key={entry.id}
                  type="button"
                  title={`Step ${i + 1}`}
                  aria-label={`Go to step ${i + 1}`}
                  aria-current={i === stepIndex ? 'true' : undefined}
                  onClick={() => goToStep(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === stepIndex
                      ? 'w-5 bg-brand'
                      : i < stepIndex
                        ? 'w-1.5 bg-brand/50'
                        : 'w-1.5 bg-line'
                  }`}
                />
              ))}
            </div>
          ) : null}

          <span className="hidden shrink-0 text-[11px] text-muted sm:inline">
            ← → to move · Esc to stop
          </span>

          <button
            type="button"
            className="cc-btn shrink-0"
            onClick={() => (total === 0 ? stopPresenting() : nextStep())}
          >
            {total === 0 ? <X size={14} /> : <Play size={14} />}
            {total === 0 ? 'Close' : atEnd ? 'Finish' : 'Next'}
          </button>

          <button
            type="button"
            className="cc-icon shrink-0"
            title="Stop presenting (Esc)"
            aria-label="Stop presenting"
            onClick={stopPresenting}
          >
            <Minimize2 size={16} />
          </button>
        </div>
      </div>
    </>
  )
}
