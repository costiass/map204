import { useMemo, useState } from 'react'
import { ChevronRight, ListTree, X } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'
import type { PresentationStep } from '@/types'

/**
 * The outline, while presenting.
 *
 * The one panel that is allowed during a presentation, because it is the only one
 * that helps rather than edits. It shows where each step points, and moving the
 * camera to one is navigation — so it is available, while the inspector, the
 * toolbar and the sidebar are not.
 *
 * Why an outline and not the step inspector: while you are talking, the question
 * is "what comes next" and "what did I just skip". The inspector answers "what
 * does this step's trigger do", which is a question you have while *building* and
 * never while presenting. So the panel here is ordered the way a talk is, and
 * nothing in it can be typed into.
 */
export function PresentationTree({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false)

  const steps = useCanvasStore((s) => s.doc.settings.steps)
  const stepIndex = useCanvasStore((s) => s.stepIndex)
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const goToStep = useCanvasStore((s) => s.goToStep)

  /**
   * What each step is called, in the order they run.
   *
   * A step can point at a card, a group, or nothing at all — and the last of
   * those is not an error, it is an establishing shot of the page. So this is
   * resolved to a *name* rather than an id, and a step whose card has since been
   * deleted says so instead of showing a blank row.
   */
  const rows = useMemo(() => {
    if (!page) return []
    return steps.map((step: PresentationStep, index: number) => ({
      step,
      index,
      label: nameOfStep(step, page),
      missing: isMissing(step, page),
    }))
  }, [steps, page])

  /**
   * Go to a step without replaying its animation.
   *
   * `goToStep` runs the step's camera transition, which is right when the
   * presenter presses the arrow key and wrong here: they are reading the list,
   * not watching the map, so a half-second camera move is a half-second of the
   * list disappearing from under their eye. `instant` asks for the destination
   * rather than the journey.
   */
  const jumpTo = (step: PresentationStep) => {
    goToStep(steps.indexOf(step), { instant: true })
  }

  return (
    <aside
      className={`absolute inset-y-0 right-0 z-40 flex flex-col border-l border-line bg-surface/95 backdrop-blur transition-transform duration-200 ${
        open ? 'w-72 translate-x-0' : 'w-11 translate-x-0'
      }`}
      aria-label="Presentation outline"
    >
      <div className="flex items-center gap-1 border-b border-line px-2 py-2">
        <button
          type="button"
          className="cc-icon shrink-0"
          title={open ? 'Hide the outline' : 'Show the outline'}
          aria-label={open ? 'Hide the outline' : 'Show the outline'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronRight size={16} className="rotate-180" /> : <ListTree size={16} />}
        </button>
        {open ? (
          <>
            <h2 className="min-w-0 flex-1 truncate text-xs font-bold text-ink-strong">Outline</h2>
            <button
              type="button"
              className="cc-icon shrink-0"
              title="Stop presenting"
              aria-label="Stop presenting"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </>
        ) : null}
      </div>

      {open ? (
        <div className="cc-scroll flex-1 overflow-y-auto p-1.5">
          {rows.length === 0 ? (
            <p className="px-2 py-3 text-[11.5px] leading-snug text-muted">
              No steps. This presentation shows the whole page.
            </p>
          ) : null}

          {rows.map(({ step, index, label, missing }) => (
            <button
              key={step.id}
              type="button"
              onClick={() => jumpTo(step)}
              aria-current={index === stepIndex ? 'true' : undefined}
              className={`mb-1 block w-full rounded-lg border px-2 py-1.5 text-left transition ${
                index === stepIndex
                  ? 'border-brand bg-brand-soft'
                  : 'border-transparent hover:bg-surface-sunken'
              }`}
            >
              <span className="block truncate text-[12px] font-medium text-ink-strong">
                {index + 1}. {label}
              </span>
              <span className="mt-0.5 block text-[10.5px] text-muted">
                {missing ? 'its target was deleted' : step.transition}
                {step.trigger === 'timed'
                  ? ` · ${(step.autoAdvanceMs / 1000).toFixed(1)}s`
                  : step.trigger === 'hold'
                    ? ' · held'
                    : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  )
}

/** What a step is called, in the list. */
function nameOfStep(
  step: PresentationStep,
  page: { cards: Array<{ id: string; title: string }>; groups: Array<{ id: string; title: string }> },
): string {
  if (step.targetKind === 'page' || !step.targetId) return 'The whole page'
  if (step.targetKind === 'card') {
    return page.cards.find((c) => c.id === step.targetId)?.title || 'A deleted card'
  }
  return page.groups.find((g) => g.id === step.targetId)?.title || 'A deleted group'
}

/** Is the thing this step pointed at still on the page? */
function isMissing(
  step: PresentationStep,
  page: { cards: Array<{ id: string }>; groups: Array<{ id: string }> },
): boolean {
  if (step.targetKind === 'page' || !step.targetId) return false
  const list = step.targetKind === 'card' ? page.cards : page.groups
  return !list.some((entry) => entry.id === step.targetId)
}
