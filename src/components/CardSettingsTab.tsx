import { NumberField, Section, SliderField } from '@/components/EditorParts'
import { ColorPicker } from '@/components/ColorPicker'
import { IconCollapse, IconCopy, IconTrash } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
import {
  CARD_ACCENTS,
  CARD_BACKGROUNDS,
  MAX_CARD_BORDER_WIDTH,
  MAX_CARD_HEIGHT,
  MAX_CARD_WIDTH,
  MIN_CARD_BORDER_WIDTH,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  TEXT_COLORS,
  type Card,
} from '@/types'

/**
 * The Settings tab: everything about how the card looks and sits on the page —
 * colours, border, shadow, size, position, z-order, and the card's defaults.
 */
export function CardSettingsTab({ card }: { card: Card }) {
  const updateCard = useCanvasStore((s) => s.updateCard)
  const updateCardStyle = useCanvasStore((s) => s.updateCardStyle)
  const applyZOrder = useCanvasStore((s) => s.applyZOrder)
  const toggleCollapsed = useCanvasStore((s) => s.toggleCollapsed)
  const setCardParent = useCanvasStore((s) => s.setCardParent)
  const duplicateCards = useCanvasStore((s) => s.duplicateCards)
  const deleteCards = useCanvasStore((s) => s.deleteCards)

  const pages = useCanvasStore((s) => s.doc.pages)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const defaultStyle = useCanvasStore((s) => s.doc.settings.defaultCardStyle)
  const gridSize = useCanvasStore((s) => s.gridSize)
  const snapToGrid = useCanvasStore((s) => s.snapToGrid)

  const siblings = (pages.find((page) => page.id === activePageId)?.cards ?? []).filter(
    (other) => other.id !== card.id,
  )

  const isDefault =
    defaultStyle.backgroundColor === card.style.backgroundColor &&
    defaultStyle.accentColor === card.style.accentColor &&
    defaultStyle.textColor === card.style.textColor &&
    defaultStyle.borderColor === card.style.borderColor &&
    defaultStyle.borderWidth === card.style.borderWidth &&
    defaultStyle.borderRadius === card.style.borderRadius &&
    defaultStyle.shadow === card.style.shadow
  void isDefault

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      <Section title="Colours">
        <div className="space-y-2.5">
          <ColorPicker
            label="Background"
            value={card.style.backgroundColor}
            colors={CARD_BACKGROUNDS}
            onChange={(backgroundColor) => updateCardStyle(card.id, { backgroundColor })}
          />
          <ColorPicker
            label="Accent strip"
            value={card.style.accentColor}
            colors={CARD_ACCENTS}
            onChange={(accentColor) => updateCardStyle(card.id, { accentColor })}
          />
          <ColorPicker
            label="Text"
            value={card.style.textColor}
            colors={TEXT_COLORS}
            onChange={(textColor) => updateCardStyle(card.id, { textColor })}
          />
        </div>
      </Section>

      <Section title="Border & shape">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="cc-label">Border colour</span>
            <span className="flex items-center gap-1.5">
              <input
                type="color"
                className="h-8 w-8 cursor-pointer rounded border border-line bg-white p-0.5"
                value={/^#[0-9a-f]{6}$/i.test(card.style.borderColor) ? card.style.borderColor : '#e5e7eb'}
                onChange={(event) => updateCardStyle(card.id, { borderColor: event.target.value.toUpperCase() })}
              />
              <span className="cc-kbd">{card.style.borderColor}</span>
            </span>
          </label>
          <NumberField
            label="Border width (px)"
            value={card.style.borderWidth}
            min={MIN_CARD_BORDER_WIDTH}
            max={MAX_CARD_BORDER_WIDTH}
            onCommit={(borderWidth) => updateCardStyle(card.id, { borderWidth })}
          />
        </div>
        <div className="mt-2">
          <SliderField
            label="Corner radius"
            suffix="px"
            value={card.style.borderRadius}
            min={0}
            max={32}
            onChange={(borderRadius) => updateCardStyle(card.id, { borderRadius }, { silent: true })}
            onCommit={(borderRadius) => updateCardStyle(card.id, { borderRadius })}
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="accent-indigo-500"
            checked={card.style.shadow}
            onChange={(event) => updateCardStyle(card.id, { shadow: event.target.checked })}
          />
          Drop shadow
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="accent-indigo-500"
            checked={card.collapsed}
            onChange={() => toggleCollapsed([card.id])}
          />
          Collapsed (links stay where they are)
        </label>
      </Section>

      <Section title="Defaults">
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          New cards start with this look. Right-click any card for the same shortcut.
        </p>
        <div
          className="mt-2 flex items-center gap-2 rounded-lg border border-line px-2 py-1.5"
          style={{ background: card.style.backgroundColor, borderColor: card.style.borderColor }}
        >
          <span
            className="h-4 w-1.5 shrink-0 rounded-full"
            style={{ background: card.style.accentColor }}
          />
          <span className="text-[11px]" style={{ color: card.style.textColor }}>
            Preview
          </span>
          {isDefault ? (
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-slate-400">
              current default
            </span>
          ) : null}
        </div>
      </Section>

      <Section title="Layout">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={card.position.x}
            onCommit={(x) => updateCard(card.id, { position: { ...card.position, x } })}
          />
          <NumberField
            label="Y"
            value={card.position.y}
            onCommit={(y) => updateCard(card.id, { position: { ...card.position, y } })}
          />
          <NumberField
            label="Width"
            value={card.position.width}
            min={MIN_CARD_WIDTH}
            max={MAX_CARD_WIDTH}
            onCommit={(width) => updateCard(card.id, { position: { ...card.position, width } })}
          />
          <NumberField
            label="Height"
            value={card.position.height}
            min={MIN_CARD_HEIGHT}
            max={MAX_CARD_HEIGHT}
            onCommit={(height) => updateCard(card.id, { position: { ...card.position, height } })}
          />
        </div>
        <p className="mt-1.5 text-[10.5px] text-slate-400">
          {snapToGrid
            ? `Dragging and resizing snap to the ${gridSize}px grid.`
            : 'Grid snapping is off — turn it on with the magnet in the toolbar.'}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NumberField
            label="Z-index"
            value={card.position.zIndex}
            onCommit={(zIndex) => updateCard(card.id, { position: { ...card.position, zIndex } })}
          />
          <label className="block">
            <span className="cc-label">Parent card</span>
            <select
              className="cc-input"
              value={card.parentId ?? ''}
              onChange={(event) => setCardParent(card.id, event.target.value || null)}
            >
              <option value="">— none —</option>
              {siblings.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.title || 'Untitled card'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className="cc-btn" onClick={() => applyZOrder([card.id], 'front')}>
            Bring to front
          </button>
          <button type="button" className="cc-btn" onClick={() => applyZOrder([card.id], 'back')}>
            Send to back
          </button>
          <button type="button" className="cc-btn" onClick={() => duplicateCards([card.id])}>
            <IconCopy size={13} /> Duplicate
          </button>
          <button
            type="button"
            className="cc-btn"
            onClick={() => toggleCollapsed([card.id])}
          >
            <IconCollapse size={13} /> {card.collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </Section>

      <Section title="Meta">
        <dl className="space-y-1 text-[11px] text-slate-500">
          <div className="flex justify-between gap-2">
            <dt>Card ID</dt>
            <dd className="truncate font-mono text-[10px]">{card.id}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Updated</dt>
            <dd>{new Date(card.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="cc-btn mt-2"
          data-variant="danger"
          onClick={() => deleteCards([card.id])}
        >
          <IconTrash size={13} /> Delete card
        </button>
      </Section>
    </div>
  )
}
