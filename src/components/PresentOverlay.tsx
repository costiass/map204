import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Keyboard, Minimize2, Play, X } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'

/**
 * The bar that empties while a timed step counts down.
 *
 * Driven by CSS rather than a re-rendering timer, because the thing it shows is
 * a duration, and a component that re-renders twenty times a second to draw a
 * shrinking rectangle is a lot of work for something CSS can do on its own.
 * The `key` on the element restarts the animation when the step changes.
 */
function AutoCountdown({ ms }: { ms: number }) {
  return (
    <span
      className="relative h-1 w-16 shrink-0 overflow-hidden rounded-full bg-line"
      title={`Moves on in ${(ms / 1000).toFixed(1)}s`}
    >
      <span
        className="cc-countdown absolute inset-y-0 left-0 w-full origin-left rounded-full bg-brand"
        style={{ animation: `cc-countdown ${ms}ms linear forwards` }}
      />
    </span>
  )
}

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

  const total = steps.length
  const step = total > 0 ? steps[Math.min(stepIndex, total - 1)] : null
  const autoAdvance = step?.trigger === 'timed' ? step.autoAdvanceMs : 0

  useEffect(() => {
    if (!presenting) return
    // While a presentation is running, *nothing* pans or zooms. The camera
    // belongs to the step, and a wheel or a stray drag taking it somewhere else
    // mid-sentence is the one thing that cannot be undone in front of an
    // audience.
    //
    // This is deliberately absolute. Blocking it in the pointer handlers instead
    // would leave a dozen paths — the wheel, a trackpad scroll, a pinch, a
    // middle-drag — each of which has to be found and closed separately, and any
    // one of them missed is a map that wanders off while you talk. One capture
    // listener above all of it closes every path at once.
    const block = (event: Event) => {
      if (event.cancelable) event.preventDefault()
    }
    const opts = { passive: false, capture: true }
    window.addEventListener('wheel', block, opts)
    window.addEventListener('gesturestart', block, opts)
    window.addEventListener('contextmenu', block, opts)
    return () => {
      window.removeEventListener('wheel', block, opts)
      window.removeEventListener('gesturestart', block, opts)
      window.removeEventListener('contextmenu', block, opts)
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

  /* --- the chrome --------------------------------------------------- */

  // Revealed on any pointer movement, and hidden again a couple of seconds after
  // the last one. `hover` alone was not enough: a presenter who moves the mouse
  // to the button and then stops has to move it *again* to get it back, and the
  // obvious thing to do with a mouse that does nothing is to try the keyboard —
  // which then fires a step change as well, so the presentation skips.
  const [chromeVisible, setChromeVisible] = useState(false)
  useEffect(() => {
    if (!presenting) {
      setChromeVisible(false)
      return
    }
    let hideTimer = 0
    const reveal = () => {
      setChromeVisible(true)
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => setChromeVisible(false), 2600)
    }
    reveal()
    window.addEventListener('pointermove', reveal)
    return () => {
      window.clearTimeout(hideTimer)
      window.removeEventListener('pointermove', reveal)
    }
  }, [presenting])

  // Off by default, since it is four words nobody reads twice.
  const [showKeys, setShowKeys] = useState(false)

  /* --- the timer ---------------------------------------------------- */

  // Re-arming on `autoAdvance` rather than on the step's id is deliberate: a
  // presenter who opens the inspector and changes the delay mid-step should see
  // the change take effect on the step they are looking at, not on the next one.
  // It also means jumping straight to a step arms its timer from that moment,
  // rather than inheriting however long was left of the step it replaced.
  useEffect(() => {
    if (!presenting || autoAdvance <= 0) return
    const timer = window.setTimeout(() => {
      // Re-read rather than closing over `nextStep`: the run may have finished
      // in the meantime, and calling a stale advance on a stopped presentation
      // would move the camera for a presentation that is no longer running.
      if (useCanvasStore.getState().presenting) nextStep()
    }, autoAdvance)
    return () => window.clearTimeout(timer)
  }, [presenting, autoAdvance, stepIndex, nextStep])

  if (!presenting) return null

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
        className={`fixed inset-y-0 left-0 z-40 w-1/4 cursor-w-resize transition-opacity duration-200 ${
          stepIndex > 0 && chromeVisible ? 'opacity-0 hover:opacity-100' : 'pointer-events-none opacity-0'
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
        className={`fixed inset-y-0 right-0 z-40 flex w-1/4 cursor-e-resize items-center justify-end transition-opacity duration-200 ${
          chromeVisible ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : 'pointer-events-none opacity-0'
        }`}
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

      {/* The bar. Hidden until the mouse moves, and hidden again a few seconds
          after it stops — so a bar sitting across every slide is not what the
          audience is looking at, and a presenter who has put the mouse down does
          not have to pick it up again to find the next button. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
        <div
          data-present-chrome
          className={`flex max-w-[min(100%,64rem)] items-center gap-3 rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-lg backdrop-blur transition-opacity duration-300 ${
            chromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
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

          {/* Only shown while it is counting, and only for a timed step: a
              bar labelled "manual" or "hold" would be telling the presenter
              something they already decided. */}
          {autoAdvance > 0 ? (
            <AutoCountdown ms={autoAdvance} key={`${stepIndex}-${autoAdvance}`} />
          ) : null}

          {/* The keyboard, spelled out. Hidden by default because it is four
              words nobody reads twice — but a presenter who has lost the map of
              the controls should not have to leave the presentation to find it. */}
          {showKeys ? (
            <span className="shrink-0 text-[11px] text-muted">
              Left and right arrows to move &middot; 1 to 9 to jump &middot; Esc to stop
            </span>
          ) : (
            <button
              type="button"
              className="cc-icon shrink-0"
              title="Show the presentation shortcuts (?)"
              aria-label="Show the presentation shortcuts"
              onClick={() => setShowKeys(true)}
            >
              <Keyboard size={15} />
            </button>
          )}

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
