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
  type Element,
} from '@/types'

/**
 * The Settings tab, and it is the *same* tab for every kind.
 *
 * Colours, border, shadow, size, position, z-order, group, and the document's
 * defaults — none of which is a note's business specifically. A style and a set
 * of tags are on the base precisely so this panel could stop being note-only, and
 * it now takes an `Element` rather than a `NoteElement`.
 *
 * A video's frame can be recoloured, a flash deck's border changed, a table
 * given a radius. That is not a nicety: an element you cannot restyle is an
 * element that looks like it was not made by whoever made the other ones.
 */
export function ElementSettingsTab({ element }: { element: Element }) {
  const updateElement = useCanvasStore((s) => s.updateElement)
  const updateElementStyle = useCanvasStore((s) => s.updateElementStyle)
  const applyElementZOrder = useCanvasStore((s) => s.applyElementZOrder)
  const toggleElementCollapsed = useCanvasStore((s) => s.toggleElementCollapsed)
  const addElementToGroup = useCanvasStore((s) => s.addElementToGroup)
  const removeElementFromGroup = useCanvasStore((s) => s.removeElementFromGroup)
  const duplicateElements = useCanvasStore((s) => s.duplicateElements)
  const deleteElements = useCanvasStore((s) => s.deleteElements)

  const pages = useCanvasStore((s) => s.doc.pages)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const defaultStyle = useCanvasStore((s) => s.doc.settings.defaultNoteStyle)
  const gridSize = useCanvasStore((s) => s.gridSize)
  const snapToGrid = useCanvasStore((s) => s.snapToGrid)

  // Every group on the page, with the members it already holds, so the dropdown
  // can show both what there is to join and what this note is already in.
  const groupOptions = (pages.find((page) => page.id === activePageId)?.groups ?? []).map(
    (group) => ({ group, ids: group.memberIds }),
  )

  const isDefault =
    defaultStyle.backgroundColor === element.style.backgroundColor &&
    defaultStyle.accentColor === element.style.accentColor &&
    defaultStyle.textColor === element.style.textColor &&
    defaultStyle.borderColor === element.style.borderColor &&
    defaultStyle.borderWidth === element.style.borderWidth &&
    defaultStyle.borderRadius === element.style.borderRadius &&
    defaultStyle.shadow === element.style.shadow
  void isDefault

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      {/* No link section. In version 1 a card could carry an optional `embed`,
          and this panel edited it — which meant a *note* could point at a
          YouTube video and a *video card* could point somewhere else. In
          version 2 a video and a PDF are kinds with their own source fields, and
          a note has no link at all. Nothing to edit, so nothing is shown. */}

      <Section title="Colours">
        <div className="space-y-2.5">
          <ColorPicker
            label="Background"
            value={element.style.backgroundColor}
            colors={CARD_BACKGROUNDS}
            onChange={(backgroundColor) => updateElementStyle(element.id, { backgroundColor })}
          />
          <ColorPicker
            label="Accent strip"
            value={element.style.accentColor}
            colors={CARD_ACCENTS}
            onChange={(accentColor) => updateElementStyle(element.id, { accentColor })}
          />
          <ColorPicker
            label="Text"
            value={element.style.textColor}
            colors={TEXT_COLORS}
            onChange={(textColor) => updateElementStyle(element.id, { textColor })}
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
                value={/^#[0-9a-f]{6}$/i.test(element.style.borderColor) ? element.style.borderColor : '#e5e7eb'}
                onChange={(event) => updateElementStyle(element.id, { borderColor: event.target.value.toUpperCase() })}
              />
              <span className="cc-kbd">{element.style.borderColor}</span>
            </span>
          </label>
          <NumberField
            label="Border width (px)"
            value={element.style.borderWidth}
            min={MIN_CARD_BORDER_WIDTH}
            max={MAX_CARD_BORDER_WIDTH}
            onCommit={(borderWidth) => updateElementStyle(element.id, { borderWidth })}
          />
        </div>
        <div className="mt-2">
          <SliderField
            label="Corner radius"
            suffix="px"
            value={element.style.borderRadius}
            min={0}
            max={32}
            onChange={(borderRadius) => updateElementStyle(element.id, { borderRadius }, { silent: true })}
            onCommit={(borderRadius) => updateElementStyle(element.id, { borderRadius })}
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="accent-indigo-500"
            checked={element.style.shadow}
            onChange={(event) => updateElementStyle(element.id, { shadow: event.target.checked })}
          />
          Drop shadow
        </label>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="accent-indigo-500"
            checked={element.collapsed}
            onChange={() => toggleElementCollapsed([element.id])}
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
          style={{ background: element.style.backgroundColor, borderColor: element.style.borderColor }}
        >
          <span
            className="h-4 w-1.5 shrink-0 rounded-full"
            style={{ background: element.style.accentColor }}
          />
          <span className="text-[11px]" style={{ color: element.style.textColor }}>
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
            value={element.x}
            onCommit={(x) => updateElement(element.id, { x })}
          />
          <NumberField
            label="Y"
            value={element.y}
            onCommit={(y) => updateElement(element.id, { y })}
          />
          <NumberField
            label="Width"
            value={element.width}
            min={MIN_CARD_WIDTH}
            max={MAX_CARD_WIDTH}
            onCommit={(width) => updateElement(element.id, { width })}
          />
          <NumberField
            label="Height"
            value={element.height}
            min={MIN_CARD_HEIGHT}
            max={MAX_CARD_HEIGHT}
            onCommit={(height) => updateElement(element.id, { height })}
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
            value={element.zIndex}
            onCommit={(zIndex) => updateElement(element.id, { zIndex })}
          />
          {/* A group, rather than the old "parent card" dropdown.

              Version 1 had two ways to say "this is inside that": the bounds of a
              group, and a `parentId` on the element. They could disagree — a card
              parented to something it sat nowhere near. A group is one mechanism
              with one answer, and this dropdown is how a person puts a note in
              one. */}
          <label className="block">
            <span className="cc-label">In group</span>
            <select
              className="cc-input"
              value={groupOptions.find((g) => g.ids.includes(element.id))?.group.id ?? ''}
              onChange={(event) => {
                const next = event.target.value
                // A note can be in one group at a time, so moving it out of the
                // one it is in is a step, not a second thing to choose.
                for (const group of groupOptions) {
                  if (group.group.id === next) addElementToGroup(group.group.id, element.id)
                  else removeElementFromGroup(group.group.id, element.id)
                }
              }}
            >
              <option value="">— none —</option>
              {groupOptions.map((group) => (
                <option key={group.group.id} value={group.group.id}>
                  {group.group.title || 'Untitled group'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className="cc-btn" onClick={() => applyElementZOrder([element.id], 'front')}>
            Bring to front
          </button>
          <button type="button" className="cc-btn" onClick={() => applyElementZOrder([element.id], 'back')}>
            Send to back
          </button>
          <button type="button" className="cc-btn" onClick={() => duplicateElements([element.id])}>
            <IconCopy size={13} /> Duplicate
          </button>
          <button
            type="button"
            className="cc-btn"
            onClick={() => toggleElementCollapsed([element.id])}
          >
            <IconCollapse size={13} /> {element.collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </Section>

      <Section title="Meta">
        <dl className="space-y-1 text-[11px] text-slate-500">
          <div className="flex justify-between gap-2">
            <dt>Card ID</dt>
            <dd className="truncate font-mono text-[10px]">{element.id}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Updated</dt>
            <dd>{new Date(element.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="cc-btn mt-2"
          data-variant="danger"
          onClick={() => deleteElements([element.id])}
        >
          <IconTrash size={13} /> Delete element
        </button>
      </Section>
    </div>
  )
}
