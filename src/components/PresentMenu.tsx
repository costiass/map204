import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, Play, Plus, Trash2 } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'
import { MIN_ZOOM } from '@/types'

/**
 * Building a presentation, and starting one.
 *
 * A step's zoom is not typed as a number. It is *captured from the camera* â€” you
 * frame a card the way you want it seen, add a step, and the zoom is whatever
 * the canvas was doing. Typing "1.4" tells you nothing about whether the card
 * fits; framing it first does, and it is the same thing the presenter will see.
 *
 * Every step can be re-captured the same way, so tuning a presentation never
 * means leaving it to find a number.
 */

let notifyPresentMenu: (() => void) | null = null

/** Open the presentation menu from the keyboard. */
export function openPresentMenu(): void {
  notifyPresentMenu?.()
}

export function PresentMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const steps = useCanvasStore((s) => s.doc.settings.steps)
  const selectedCardIds = useCanvasStore((s) => s.selectedCardIds)
  const selectedGroupId = useCanvasStore((s) => s.selectedGroupId)
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const addStep = useCanvasStore((s) => s.addStep)
  const removeStep = useCanvasStore((s) => s.removeStep)
  const moveStep = useCanvasStore((s) => s.moveStep)
  const updateStep = useCanvasStore((s) => s.updateStep)
  const startPresenting = useCanvasStore((s) => s.startPresenting)
  const readOnlyReason = useCanvasStore((s) => s.readOnlyReason)

  useEffect(() => {
    notifyPresentMenu = () => setOpen((value) => !value)
    return () => {
      notifyPresentMenu = null
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A viewer can be *shown* a presentation by whoever is presenting, but they
  // cannot write steps into the document they are only allowed to read.
  if (readOnlyReason === 'viewing') return null

  const zoom = page?.viewport.zoom ?? 1
  const cards = page?.cards ?? []
  const groups = page?.groups ?? []

  /** The zoom a new step gets: the camera as it is right now. */
  const captured = Math.max(MIN_ZOOM, Math.min(2, zoom))

  const titleOf = (targetId: string | null, kind: 'card' | 'group' | 'page') => {
    if (kind === 'page' || !targetId) return 'The whole page'
    if (kind === 'card') return cards.find((c) => c.id === targetId)?.title || 'A deleted card'
    return groups.find((g) => g.id === targetId)?.title || 'A deleted group'
  }

  const addFor = (targetId: string | null, kind: 'card' | 'group' | 'page') => {
    addStep({ targetId, targetKind: kind, zoom: captured, durationMs: 450 })
  }

  const addForSelection = () => {
    // One step per selected card, in the order they were selected, so selecting
    // five cards and pressing this gives five steps rather than one.
    const chosen = selectedCardIds.filter((id) => cards.some((c) => c.id === id))
    if (chosen.length === 0 && selectedGroupId) {
      addFor(selectedGroupId, 'group')
      return
    }
    for (const id of chosen) addFor(id, 'card')
  }

  const addForEverything = () => {
    // Useful the first time, and never useful again once a presentation exists,
    // because it would append a second full run to the first.
    if (steps.length > 0) return
    addFor(null, 'page')
    for (const card of cards) addFor(card.id, 'card')
  }

  const canStart = steps.length > 0
  const canAddSelection =
    selectedCardIds.some((id) => cards.some((c) => c.id === id)) || selectedGroupId !== null

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className="cc-btn"
        title="Present (P)"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Play size={14} />
        <span className="hidden lg:inline">Present</span>
      </button>

      {open ? (
        <div data-anchored="true" className="cc-menu absolute right-0 top-10 z-50 max-h-[70vh] w-72 overflow-y-auto">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => {
              setOpen(false)
              startPresenting()
            }}
          >
            <Play size={15} className="opacity-70" />
            Start presenting
            {canStart ? <span className="ml-auto text-[11px] text-muted">{steps.length} steps</span> : null}
          </button>

          <hr />

          <button
            type="button"
            disabled={!canAddSelection}
            onClick={() => {
              addForSelection()
            }}
            title={canAddSelection ? undefined : 'Select a card or a group first'}
          >
            <Plus size={15} className="opacity-70" />
            Add step for selection
            <span className="ml-auto text-[11px] text-muted">@{captured.toFixed(2)}Ã—</span>
          </button>

          <button type="button" onClick={() => addFor(null, 'page')}>
            <Plus size={15} className="opacity-70" />
            Add step for the whole page
          </button>

          {steps.length === 0 ? (
            <button
              type="button"
              onClick={addForEverything}
              disabled={cards.length === 0}
            >
              <Plus size={15} className="opacity-70" />
              Start from every card
            </button>
          ) : null}

          {steps.length > 0 ? (
            <>
              <hr />
              <p className="cc-menu-label">Steps</p>
              {steps.map((step, index) => (
                <div key={step.id} className="cc-menu-row">
                  <button
                    type="button"
                    className="min-w-0 flex-1"
                    onClick={() => {
                      setOpen(false)
                      startPresenting(step.id)
                    }}
                    title="Present from here"
                  >
                    <span className="block truncate text-[12px] font-medium">
                      {index + 1}. {titleOf(step.targetId, step.targetKind)}
                    </span>
                    <span className="block text-[10.5px] opacity-55">
                      {step.targetKind === 'page' ? 'whole page' : step.targetKind} Â·{' '}
                      {step.zoom.toFixed(2)}Ã— Â· {step.durationMs}ms
                    </span>
                  </button>

                  {/* Re-capture: frame the card the way you want it, then take the
                      zoom from wherever the canvas is now. */}
                  <button
                    type="button"
                    title="Take this step's zoom from the current view"
                    aria-label="Re-capture zoom from the current view"
                    onClick={() => updateStep(step.id, { zoom: captured })}
                  >
                    <ChevronUp size={13} className="opacity-60" />
                  </button>
                  <button
                    type="button"
                    disabled={index === 0}
                    title="Move up"
                    aria-label="Move step up"
                    onClick={() => moveStep(step.id, -1)}
                  >
                    <ChevronUp size={13} className="rotate-180 opacity-60" />
                  </button>
                  <button
                    type="button"
                    disabled={index === steps.length - 1}
                    title="Move down"
                    aria-label="Move step down"
                    onClick={() => moveStep(step.id, 1)}
                  >
                    <ChevronDown size={13} className="opacity-60" />
                  </button>
                  <button
                    type="button"
                    title="Remove this step"
                    aria-label="Remove step"
                    onClick={() => removeStep(step.id)}
                  >
                    <Trash2 size={13} className="opacity-60 hover:opacity-100" />
                  </button>
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
