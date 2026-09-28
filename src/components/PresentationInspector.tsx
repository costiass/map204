import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  Layers,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'
import type { PresentationStep, StepFocus, StepTransition, StepTrigger } from '@/types'

/**
 * Editing a presentation, one step at a time.
 *
 * The step list is on the left and the chosen step's settings are on the right,
 * because the thing being configured *is* a step and hiding which one is
 * currently being changed is how settings get applied to the wrong thing. Click
 * a step, and the panel on the right is unambiguously about it.
 *
 * Every control writes through the store immediately. There is no Save button,
 * because there is nothing to save: a step is part of the document and the
 * document is written continuously, like every other edit in the app. A separate
 * save would be a second place for a change to be forgotten.
 */
export function PresentationInspector({ onClose }: { onClose: () => void }) {
  const steps = useCanvasStore((s) => s.doc.settings.steps)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const cards = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId)?.elements ?? [])
  const groups = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId)?.groups ?? [])

  // Default to the first step, so the panel is never showing "pick one" the
  // moment it opens — there is a presentation to configure, not a list to browse.
  const activeId = selectedId && steps.some((s) => s.id === selectedId) ? selectedId : (steps[0]?.id ?? null)
  const step = steps.find((s) => s.id === activeId) ?? null

  const updateStep = useCanvasStore((s) => s.updateStep)
  const removeStep = useCanvasStore((s) => s.removeStep)
  const moveStep = useCanvasStore((s) => s.moveStep)
  const addStep = useCanvasStore((s) => s.addStep)
  const startPresenting = useCanvasStore((s) => s.startPresenting)
  const requestFitView = useCanvasStore((s) => s.requestFitView)
  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds)
  const selectedGroupId = useCanvasStore((s) => s.selectedGroupId)

  const titleOf = (target: PresentationStep) => {
    if (target.targetKind === 'page' || !target.targetId) return 'The whole page'
    if (target.targetKind === 'element') {
      return cards.find((c) => c.id === target.targetId)?.title || 'A card that was deleted'
    }
    return groups.find((g) => g.id === target.targetId)?.title || 'A group that was deleted'
  }

  const addForSelection = () => {
    const chosen = selectedElementIds.filter((id) => cards.some((c) => c.id === id))
    if (chosen.length === 0) {
      if (selectedGroupId) {
        setSelectedId(addStep({ targetId: selectedGroupId, targetKind: 'group' }))
      } else {
        setSelectedId(addStep({ targetKind: 'page' }))
      }
      return
    }
    // The first one is opened for editing; the rest are made in the order they
    // were selected, which is the order the presenter put them in.
    const ids = chosen.map((id) => addStep({ targetId: id, targetKind: 'element' }))
    setSelectedId(ids[0] ?? null)
  }

  return (
    <aside className="flex w-full max-w-md flex-none flex-col border-l border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Layers size={15} className="text-brand" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-ink-strong">Presentation</h2>
        <button
          type="button"
          className="cc-icon"
          title="Close"
          aria-label="Close the presentation inspector"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* --- the run ------------------------------------------------- */}
        <div className="flex w-44 flex-none flex-col border-r border-line">
          <div className="cc-scroll flex-1 overflow-y-auto p-1.5">
            {steps.length === 0 ? (
              <p className="px-2 py-3 text-[11.5px] leading-snug text-muted">
                No steps yet. Select a card on the canvas and add one — the zoom is taken from
                wherever your view is now.
              </p>
            ) : null}

            {steps.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                aria-current={entry.id === activeId ? 'true' : undefined}
                className={`mb-1 block w-full rounded-lg border px-2 py-1.5 text-left transition ${
                  entry.id === activeId
                    ? 'border-brand bg-brand-soft'
                    : 'border-transparent hover:bg-surface-sunken'
                }`}
              >
                <span className="block truncate text-[12px] font-medium text-ink-strong">
                  {index + 1}. {titleOf(entry)}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted">
                  <span>{entry.zoom.toFixed(2)}×</span>
                  <span>·</span>
                  <span>{entry.transition}</span>
                  <span>·</span>
                  <span>{TRIGGER_LABELS[entry.trigger]}</span>
                  {entry.focus !== 'none' ? (
                    <>
                      <span>·</span>
                      <span>{entry.focus}</span>
                    </>
                  ) : null}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-none gap-1 border-t border-line p-1.5">
            <button type="button" className="cc-btn flex-1" onClick={addForSelection}>
              <Plus size={13} /> Step
            </button>
            <button
              type="button"
              className="cc-icon shrink-0"
              title="Show the whole map"
              aria-label="Show the whole map"
              onClick={requestFitView}
            >
              <Eye size={15} />
            </button>
          </div>
        </div>

        {/* --- the chosen step ------------------------------------------ */}
        {step ? (
          <div className="cc-scroll min-w-0 flex-1 overflow-y-auto p-3">
            <p className="cc-label">Points at</p>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-ink-strong">
              {titleOf(step)}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">
              {step.targetKind === 'element'
                ? 'A card. Pick a different one by selecting it on the canvas and adding a step.'
                : step.targetKind === 'group'
                  ? 'A group — the natural way to frame a section of a map.'
                  : 'Nothing in particular: an establishing shot of the page.'}
            </p>

            <hr className="my-3 border-line" />

            <Field label="Transition" hint={TRANSITION_HINTS[step.transition]}>
              <Choice<StepTransition>
                value={step.transition}
                options={[
                  ['ease', 'Ease'],
                  ['drift', 'Drift'],
                  ['linear', 'Linear'],
                  ['instant', 'Instant'],
                ]}
                onChange={(transition) => updateStep(step.id, { transition })}
              />
            </Field>

            {step.transition !== 'instant' ? (
              <Field
                label="Move over"
                hint={`The camera takes ${(step.durationMs / 1000).toFixed(2)}s to arrive. Longer reads as a deliberate move.`}
              >
                <Slider
                  min={0}
                  max={3000}
                  step={50}
                  value={step.durationMs}
                  format={(value) => (value === 0 ? 'instant' : `${(value / 1000).toFixed(2)}s`)}
                  onCommit={(durationMs) => updateStep(step.id, { durationMs })}
                />
              </Field>
            ) : null}

            <hr className="my-3 border-line" />

            <Field label="Trigger" hint={TRIGGER_HINTS[step.trigger]}>
              <Choice<StepTrigger>
                value={step.trigger}
                options={[
                  ['manual', 'You decide'],
                  ['timed', 'Auto'],
                  ['hold', 'Hold'],
                ]}
                onChange={(trigger) =>
                  updateStep(step.id, { trigger, autoAdvanceMs: trigger === 'timed' ? 4000 : 0 })
                }
              />
            </Field>

            {step.trigger === 'timed' ? (
              <Field
                label="Auto change after"
                hint="The floor is one second: a step that flashes past is not a step."
              >
                <Slider
                  min={1000}
                  max={30000}
                  step={500}
                  value={step.autoAdvanceMs}
                  format={(value) => `${(value / 1000).toFixed(1)}s`}
                  onCommit={(autoAdvanceMs) => updateStep(step.id, { autoAdvanceMs })}
                />
              </Field>
            ) : null}

            <hr className="my-3 border-line" />

            <Field
              label="Everything else"
              hint={FOCUS_HINTS[step.focus]}
            >
              <Choice<StepFocus>
                value={step.focus}
                options={[
                  ['none', 'Leave alone'],
                  ['dim', 'Dim'],
                  ['spotlight', 'Spotlight'],
                ]}
                onChange={(focus) => updateStep(step.id, { focus })}
              />
            </Field>

            <Field
              label="Zoom"
              hint={
                step.targetKind === 'page'
                  ? 'How close the camera comes to the page.'
                  : 'Capped at what the target actually fits, so a step never crops it. Re-capture it from the Present menu with the card framed the way you want.'
              }
            >
              <Slider
                min={0.2}
                max={2}
                step={0.05}
                value={step.zoom}
                format={(value) => `${value.toFixed(2)}×`}
                onCommit={(zoom) => updateStep(step.id, { zoom })}
              />
            </Field>

            <hr className="my-3 border-line" />

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="cc-btn flex-1"
                data-variant="primary"
                onClick={() => startPresenting(step.id)}
              >
                <Play size={13} /> Present from here
              </button>
              <button
                type="button"
                className="cc-icon shrink-0"
                title="Move this step earlier"
                aria-label="Move this step earlier"
                disabled={steps[0]?.id === step.id}
                onClick={() => moveStep(step.id, -1)}
              >
                <ChevronUp size={15} />
              </button>
              <button
                type="button"
                className="cc-icon shrink-0"
                title="Move this step later"
                aria-label="Move this step later"
                disabled={steps[steps.length - 1]?.id === step.id}
                onClick={() => moveStep(step.id, 1)}
              >
                <ChevronDown size={15} />
              </button>
              <button
                type="button"
                className="cc-icon shrink-0"
                title="Delete this step"
                aria-label="Delete this step"
                onClick={() => {
                  removeStep(step.id)
                  setSelectedId(null)
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-center p-4 text-center text-[11.5px] text-muted">
            <span>
              <Clock size={18} className="mx-auto mb-1 opacity-50" />
              Pick a step on the left, or add one from your selection.
            </span>
          </div>
        )}
      </div>
    </aside>
  )
}

const TRANSITION_HINTS: Record<StepTransition, string> = {
  ease: 'In and out. Reads as a deliberate move rather than a jump.',
  drift: 'Ease, with a small overshoot and a settle. Reads as a hand carrying the view.',
  linear: 'Constant speed. Use it when the timing of the arrival is the point.',
  instant: 'No camera move. For a step about something already on screen.',
}

const TRIGGER_HINTS: Record<StepTrigger, string> = {
  manual: 'You move on. The right default for a talk somebody else is also speaking over.',
  timed: 'It moves on by itself, for a step read aloud at a known pace.',
  hold: 'Nothing moves it on, not even the arrow keys. For a step a discussion happens over.',
}

const FOCUS_HINTS: Record<StepFocus, string> = {
  none: 'The rest of the map stays as bright as the target.',
  dim: 'Everything except the target goes dim.',
  spotlight: 'Everything else dims, and the target is ringed.',
}

const TRIGGER_LABELS: Record<StepTrigger, string> = {
  manual: 'manual',
  timed: 'auto',
  hold: 'hold',
}

/* ------------------------------------------------------------------ */
/* controls                                                            */
/* ------------------------------------------------------------------ */

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="cc-label">{label}</p>
      <div className="mt-1">{children}</div>
      <p className="mt-1 text-[10.5px] leading-snug text-muted">{hint}</p>
    </div>
  )
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={id === value}
          className={`rounded-md border px-1.5 py-1.5 text-[11px] transition ${
            id === value
              ? 'border-brand bg-brand-soft font-semibold text-brand-ink'
              : 'border-line hover:bg-surface-sunken'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * A value with a range, committed on release rather than on every pixel.
 *
 * Dragging a slider writes a step on every frame, and each write is a history
 * entry and eventually a database row. Committing on release means one write
 * per drag — and the number is still readable live because the label is local.
 */
function Slider({
  min,
  max,
  step,
  value,
  format,
  onCommit,
}: {
  min: number
  max: number
  step: number
  value: number
  format: (value: number) => string
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value

  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-label={format(value)}
        onChange={(event) => setDraft(Number(event.currentTarget.value))}
        onPointerUp={() => {
          if (draft !== null) onCommit(draft)
          setDraft(null)
        }}
        onKeyUp={() => {
          if (draft !== null) onCommit(draft)
          setDraft(null)
        }}
        onBlur={() => {
          if (draft !== null) onCommit(draft)
          setDraft(null)
        }}
        className="min-w-0 flex-1"
      />
      <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-ink-strong">
        {format(shown)}
      </span>
    </div>
  )
}
