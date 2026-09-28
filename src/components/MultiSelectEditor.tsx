import { ColorPicker } from '@/components/ColorPicker'
import { IconBringFront, IconCopy, IconSendBack, IconTrash } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
import { CARD_ACCENTS, CARD_BACKGROUNDS } from '@/types'
import { snap } from '@/utils/geometry'

/** Bulk actions shown when more than one element is selected. */
export function MultiSelectEditor({ cardIds }: { cardIds: string[] }) {
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const updateElementStyle = useCanvasStore((s) => s.updateElementStyle)
  const applyElementZOrder = useCanvasStore((s) => s.applyElementZOrder)
  const duplicateElements = useCanvasStore((s) => s.duplicateElements)
  const deleteElements = useCanvasStore((s) => s.deleteElements)
  const toggleElementCollapsed = useCanvasStore((s) => s.toggleElementCollapsed)
  const moveElements = useCanvasStore((s) => s.moveElements)

  if (!page) return null
  const selected = page.elements.filter((element) => cardIds.includes(element.id))
  if (selected.length === 0) return null

  // A note is the only kind with a style, so the recolour section works on
  // these rather than on everything that happens to be selected.
  const notes = selected.filter(
    (element): element is typeof selected[number] & { kind: 'note' } => element.kind === 'note',
  )

  // The box the whole selection occupies. Aligning and distributing are both
  // relative to this, so it is computed once rather than per button.
  const bounds = {
    left: Math.min(...selected.map((element) => element.x)),
    top: Math.min(...selected.map((element) => element.y)),
    right: Math.max(...selected.map((element) => element.x + element.width)),
    bottom: Math.max(...selected.map((element) => element.y + element.height)),
  }

  const align = (edge: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => {
    const entries = selected.map((element) => {
      const { x, y, width, height } = element
      if (edge === 'left') return { id: element.id, x: snap(bounds.left), y }
      if (edge === 'right') return { id: element.id, x: snap(bounds.right - width), y }
      if (edge === 'centerX') {
        return { id: element.id, x: snap(bounds.left + (bounds.right - bounds.left - width) / 2), y }
      }
      if (edge === 'top') return { id: element.id, x, y: snap(bounds.top) }
      if (edge === 'bottom') return { id: element.id, x, y: snap(bounds.bottom - height) }
      return { id: element.id, x, y: snap(bounds.top + (bounds.bottom - bounds.top - height) / 2) }
    })
    moveElements(entries)
  }

  /**
   * Space the selection out evenly along one axis.
   *
   * The gap is measured between *edges*, not between positions, so elements of
   * different sizes end up the same distance apart rather than the same distance
   * between their left edges — which looks aligned on one row and ragged on the
   * next.
   */
  const distribute = (axis: 'x' | 'y') => {
    if (selected.length < 3) return
    const size = (element: typeof selected[number]) => (axis === 'x' ? element.width : element.height)
    const along = (element: typeof selected[number]) => (axis === 'x' ? element.x : element.y)

    const ordered = [...selected].sort((a, b) => along(a) - along(b))
    const start = axis === 'x' ? bounds.left : bounds.top
    const end = axis === 'x' ? bounds.right : bounds.bottom
    const totalSize = ordered.reduce((sum, element) => sum + size(element), 0)
    const gap = (end - start - totalSize) / (ordered.length - 1)

    let cursor = start
    const entries = ordered.map((element) => {
      const position = Math.round(cursor)
      cursor += size(element) + gap
      return { id: element.id, x: axis === 'x' ? position : element.x, y: axis === 'x' ? element.y : position }
    })
    moveElements(entries)
  }

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      <section className="border-b border-line px-3 py-3">
        <h2 className="text-sm font-bold">
          {selected.length} element{selected.length === 1 ? '' : 's'} selected
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Bulk edits apply to every selected element.
        </p>
      </section>

      <section className="border-b border-line px-3 py-3">
        <h3 className="cc-label">Align</h3>
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              ['left', 'Left'],
              ['centerX', 'Centre H'],
              ['right', 'Right'],
              ['top', 'Top'],
              ['centerY', 'Centre V'],
              ['bottom', 'Bottom'],
            ] as const
          ).map(([edge, label]) => (
            <button key={edge} type="button" className="cc-btn" onClick={() => align(edge)}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button type="button" className="cc-btn" onClick={() => distribute('x')}>
            Distribute H
          </button>
          <button type="button" className="cc-btn" onClick={() => distribute('y')}>
            Distribute V
          </button>
        </div>
      </section>

      <section className="space-y-2.5 border-b border-line px-3 py-3">
        <h3 className="cc-label">Recolour all</h3>
        {/* Only notes have a colour. A selection of videos and tables shows this
            with a note saying so, rather than buttons that silently do nothing to
            most of what is selected — which reads as the app being broken rather
            than as there being nothing to recolour. */}
        {notes.length === 0 ? (
          <p className="text-[11px] text-slate-400">
            Only notes have a colour. Select one to change how it looks.
          </p>
        ) : (
          <>
            <ColorPicker
              label="Background"
              value={notes[0].style.backgroundColor}
              colors={CARD_BACKGROUNDS}
              onChange={(backgroundColor) => {
                for (const note of notes) updateElementStyle(note.id, { backgroundColor })
              }}
            />
            <ColorPicker
              label="Accent strip"
              value={notes[0].style.accentColor}
              colors={CARD_ACCENTS}
              onChange={(accentColor) => {
                for (const note of notes) updateElementStyle(note.id, { accentColor })
              }}
            />
            {notes.length < selected.length ? (
              <p className="text-[11px] text-slate-400">
                {selected.length - notes.length} of {selected.length} selected are not notes
                and are left alone.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="space-y-1.5 px-3 py-3">
        <button
          type="button"
          className="cc-btn w-full"
          onClick={() => applyElementZOrder(cardIds, 'front')}
        >
          <IconBringFront size={14} /> Bring to front
        </button>
        <button type="button" className="cc-btn w-full" onClick={() => applyElementZOrder(cardIds, 'back')}>
          <IconSendBack size={14} /> Send to back
        </button>
        <button type="button" className="cc-btn w-full" onClick={() => toggleElementCollapsed(cardIds)}>
          Toggle collapsed
        </button>
        <button type="button" className="cc-btn w-full" onClick={() => duplicateElements(cardIds)}>
          <IconCopy size={14} /> Duplicate all
        </button>
        <button
          type="button"
          className="cc-btn w-full"
          data-variant="danger"
          onClick={() => deleteElements(cardIds)}
        >
          <IconTrash size={14} /> Delete selected
        </button>
      </section>
    </div>
  )
}
