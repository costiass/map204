import { IconFit, IconPlus } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'

export function EmptyState({ onFit }: { onFit: () => void }) {
  const addCard = useCanvasStore((s) => s.addCard)
  const cards = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId)?.cards.length ?? 0)

  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="pointer-events-auto max-w-sm text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white shadow-md">
          <IconPlus size={22} className="text-brand" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800">
          {cards === 0 ? 'This page is empty' : 'Nothing to show'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Press <span className="cc-kbd">N</span> or double-click the canvas to drop a card. Drag a card by its
          header, and drag from a dot on a card edge to connect two cards.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" className="cc-btn" data-variant="primary" onClick={() => addCard()}>
            <IconPlus size={14} /> New card
          </button>
          <button type="button" className="cc-btn" onClick={onFit}>
            <IconFit size={14} /> Fit view
          </button>
        </div>
      </div>
    </div>
  )
}
