import { ColorPicker } from '@/components/ColorPicker'
import { IconBringFront, IconCopy, IconSendBack, IconTrash } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
import { CARD_ACCENTS, CARD_BACKGROUNDS } from '@/types'
import { snap } from '@/utils/geometry'

/** Bulk actions shown when more than one card is selected. */
export function MultiSelectEditor({ cardIds }: { cardIds: string[] }) {
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const updateCardStyle = useCanvasStore((s) => s.updateCardStyle)
  const applyZOrder = useCanvasStore((s) => s.applyZOrder)
  const duplicateCards = useCanvasStore((s) => s.duplicateCards)
  const deleteCards = useCanvasStore((s) => s.deleteCards)
  const toggleCollapsed = useCanvasStore((s) => s.toggleCollapsed)
  const commitCardPositions = useCanvasStore((s) => s.commitCardPositions)

  if (!page) return null
  const cards = page.cards.filter((card) => cardIds.includes(card.id))
  if (cards.length === 0) return null

  const bounds = {
    left: Math.min(...cards.map((card) => card.position.x)),
    top: Math.min(...cards.map((card) => card.position.y)),
    right: Math.max(...cards.map((card) => card.position.x + card.position.width)),
    bottom: Math.max(...cards.map((card) => card.position.y + card.position.height)),
  }

  const align = (edge: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => {
    const entries = cards.map((card) => {
      const { x, y, width, height } = card.position
      if (edge === 'left') return { id: card.id, x: snap(bounds.left), y }
      if (edge === 'right') return { id: card.id, x: snap(bounds.right - width), y }
      if (edge === 'centerX') return { id: card.id, x: snap(bounds.left + (bounds.right - bounds.left - width) / 2), y }
      if (edge === 'top') return { id: card.id, x, y: snap(bounds.top) }
      if (edge === 'bottom') return { id: card.id, x, y: snap(bounds.bottom - height) }
      return { id: card.id, x, y: snap(bounds.top + (bounds.bottom - bounds.top - height) / 2) }
    })
    commitCardPositions(entries)
  }

  const distribute = (axis: 'x' | 'y') => {
    if (cards.length < 3) return
    const ordered = [...cards].sort((a, b) => a.position[axis] - b.position[axis])
    const start = axis === 'x' ? bounds.left : bounds.top
    const end = axis === 'x' ? bounds.right : bounds.bottom
    const totalSize = ordered.reduce((sum, card) => sum + card.position[axis], 0)
    const gap = (end - start - totalSize) / (ordered.length - 1)
    let cursor = start
    const entries = ordered.map((card) => {
      const next = { ...card.position }
      if (axis === 'x') next.x = Math.round(cursor)
      else next.y = Math.round(cursor)
      cursor += card.position[axis] + gap
      return { id: card.id, x: next.x, y: next.y }
    })
    commitCardPositions(entries)
  }

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      <section className="border-b border-line px-3 py-3">
        <h2 className="text-sm font-bold">{cards.length} cards selected</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Bulk edits apply to every selected card.
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
        <ColorPicker
          label="Background"
          value={cards[0].style.backgroundColor}
          colors={CARD_BACKGROUNDS}
          onChange={(backgroundColor) => {
            for (const card of cards) updateCardStyle(card.id, { backgroundColor })
          }}
        />
        <ColorPicker
          label="Accent strip"
          value={cards[0].style.accentColor}
          colors={CARD_ACCENTS}
          onChange={(accentColor) => {
            for (const card of cards) updateCardStyle(card.id, { accentColor })
          }}
        />
      </section>

      <section className="space-y-1.5 px-3 py-3">
        <button
          type="button"
          className="cc-btn w-full"
          onClick={() => applyZOrder(cardIds, 'front')}
        >
          <IconBringFront size={14} /> Bring to front
        </button>
        <button type="button" className="cc-btn w-full" onClick={() => applyZOrder(cardIds, 'back')}>
          <IconSendBack size={14} /> Send to back
        </button>
        <button type="button" className="cc-btn w-full" onClick={() => toggleCollapsed(cardIds)}>
          Toggle collapsed
        </button>
        <button type="button" className="cc-btn w-full" onClick={() => duplicateCards(cardIds)}>
          <IconCopy size={14} /> Duplicate all
        </button>
        <button
          type="button"
          className="cc-btn w-full"
          data-variant="danger"
          onClick={() => deleteCards(cardIds)}
        >
          <IconTrash size={14} /> Delete selected
        </button>
      </section>
    </div>
  )
}
