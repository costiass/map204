import { memo, useCallback, useMemo } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { IconChevron, IconMore } from '@/components/Icons'
import { CardEmbedView } from '@/components/CardEmbedView'
import { FlashDeck } from '@/components/FlashCard'
import { DEFAULT_NOTE_STYLE } from '@/elements/defaults'
import { useCanvasStore } from '@/store/useCanvasStore'
import { ANCHORS, COLLAPSED_HEADER_HEIGHT, type Anchor, type Element, type Point } from '@/types'
import { renderMarkdown } from '@/utils/markdown'

/**
 * One thing on a page, of any kind.
 *
 * This is the component the common base paid for. Select, drag, resize,
 * connect, collapse, the context menu and the title bar are all here, once, and
 * every kind gets them by existing. A new kind is a `body` for it below and
 * nothing else — which is the whole argument for elements over cards.
 *
 * Only the *body* varies by kind. The chrome does not, because a video and a
 * note are equally draggable and equally resizable, and making that true by
 * writing it twice is how the two drift.
 */
export interface ElementNodeProps {
  element: Element
  selected: boolean
  dimmed: boolean
  /** Ringed, because a presentation step is pointing at this one. */
  spotlight?: boolean
  dragTarget: boolean
  /** Live drag offset applied on top of the stored world position. */
  offset: Point | null
  /** Live resize override. */
  size: { width: number; height: number } | null
  childTitles: string[]
  onElementPointerDown: (event: ReactPointerEvent<HTMLElement>, elementId: string) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>, elementId: string) => void
  onHandlePointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    elementId: string,
    side: Anchor,
  ) => void
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, elementId: string) => void
}

function ElementNodeImpl({
  element,
  selected,
  dimmed,
  spotlight = false,
  dragTarget,
  offset,
  size,
  childTitles,
  onElementPointerDown,
  onResizePointerDown,
  onHandlePointerDown,
  onContextMenu,
}: ElementNodeProps) {
  const updateElement = useCanvasStore((s) => s.updateElement)
  const flushCommit = useCanvasStore((s) => s.flushCommit)
  const toggleElementCollapsed = useCanvasStore((s) => s.toggleElementCollapsed)
  const setContextMenu = useCanvasStore((s) => s.setContextMenu)
  const setInspectorTab = useCanvasStore((s) => s.setInspectorTab)

  const width = size?.width ?? element.width
  const height = size?.height ?? element.height
  const x = element.x + (offset?.x ?? 0)
  const y = element.y + (offset?.y ?? 0)

  // Only a note carries a style. The others get the default, so a video is
  // still a white card with a border rather than an unstyled div — the fallback
  // is what makes the common chrome look deliberate on every kind.
  const noteStyle = element.kind === 'note' ? element.style : DEFAULT_NOTE_STYLE

  const style = {
    left: x,
    top: y,
    width,
    height: element.collapsed ? COLLAPSED_HEADER_HEIGHT : height,
    zIndex: element.zIndex,
    '--cc-bg': noteStyle.backgroundColor,
    '--cc-accent': noteStyle.accentColor,
    '--cc-fg': noteStyle.textColor,
    '--cc-border': noteStyle.borderColor,
    '--cc-border-width': `${noteStyle.borderWidth}px`,
    '--cc-radius': `${noteStyle.borderRadius}px`,
  } as CSSProperties

  const stop = (event: React.SyntheticEvent) => event.stopPropagation()

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.currentTarget.blur()
    }
  }

  // Read from the store as state, not `getState()` inside the render: an element
  // already on the canvas has to *re-render* when read-only mode starts, and a
  // one-off read would leave it editable until something else happened to
  // repaint it.
  const readOnlyReason = useCanvasStore((s) => s.readOnlyReason)
  const editable = readOnlyReason === null

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setContextMenu({
      x: rect.left,
      y: rect.bottom + 6,
      cardId: element.id,
      connectionId: null,
      groupId: null,
    })
  }

  /** The four edge handles and the resize grip — the same on every kind. */
  const handles = (
    <>
      {ANCHORS.map((side) => (
        <span
          key={side}
          className="cc-handle"
          data-side={side}
          title={`Drag to connect from the ${side}`}
          onPointerDown={(event) => onHandlePointerDown(event, element.id, side)}
        />
      ))}
      <span
        className="cc-resize"
        title="Resize"
        onPointerDown={(event) => onResizePointerDown(event, element.id)}
      />
    </>
  )

  /* ---------------------------------------------------------------- */
  /* A flash deck is a different shape of thing                         */
  /* ---------------------------------------------------------------- */

  // A deck gets no header and no title input. The front *is* the question, so a
  // title field above it would say the same thing twice and make the deck look
  // like a note with a question on it. The controls move onto the face itself,
  // where they sit on the card rather than above it.
  if (element.kind === 'flash' && !element.collapsed) {
    return (
      <div
        className="cc-card"
        style={style}
        data-card-id={element.id}
        data-kind={element.kind}
        data-selected={selected ? 'true' : undefined}
        data-dimmed={dimmed ? 'true' : undefined}
        data-spotlight={spotlight ? 'true' : undefined}
        data-drag-target={dragTarget ? 'true' : undefined}
        data-shadow={noteStyle.shadow ? 'true' : 'false'}
        onPointerDown={(event) => onElementPointerDown(event, element.id)}
        onContextMenu={(event) => onContextMenu(event, element.id)}
      >
        <span className="cc-card__accent" />

        <FlashDeck
          element={element}
          editable={editable}
          onDoubleClick={() => setInspectorTab('content')}
        />

        <div className="absolute right-1 top-1 flex gap-0.5">
          <button
            type="button"
            className="cc-card__btn"
            title="Collapse element"
            data-no-drag=""
            onPointerDown={stop}
            onClick={() => toggleElementCollapsed([element.id])}
          >
            <IconChevron
              size={14}
              style={{ transform: 'rotate(-90deg)', transition: 'transform 140ms ease' }}
            />
          </button>
          <button
            type="button"
            className="cc-card__btn"
            title="Element menu"
            data-no-drag=""
            onPointerDown={stop}
            onClick={openMenu}
          >
            <IconMore size={14} />
          </button>
        </div>

        {handles}
      </div>
    )
  }

  return (
    <div
      className="cc-card"
      style={style}
      data-card-id={element.id}
      data-kind={element.kind}
      data-selected={selected ? 'true' : undefined}
      data-dimmed={dimmed ? 'true' : undefined}
      data-spotlight={spotlight ? 'true' : undefined}
      data-collapsed={element.collapsed ? 'true' : undefined}
      data-drag-target={dragTarget ? 'true' : undefined}
      data-shadow={noteStyle.shadow ? 'true' : 'false'}
      onPointerDown={(event) => onElementPointerDown(event, element.id)}
      onContextMenu={(event) => onContextMenu(event, element.id)}
    >
      <span className="cc-card__accent" />

      <header className="cc-card__header">
        <input
          className="cc-card__title"
          value={element.title}
          placeholder="Untitled"
          spellCheck={false}
          aria-label="Element title"
          // Selects the element, but lets the caret move so the title stays
          // editable.
          data-no-drag=""
          onKeyDown={handleTitleKeyDown}
          onChange={(event) => updateElement(element.id, { title: event.target.value }, { silent: true })}
          onBlur={() => flushCommit()}
        />
        <button
          type="button"
          className="cc-card__btn"
          title={element.collapsed ? 'Expand element' : 'Collapse element'}
          onPointerDown={stop}
          onClick={() => toggleElementCollapsed([element.id])}
        >
          <IconChevron
            size={14}
            style={{
              transform: element.collapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 140ms ease',
            }}
          />
        </button>
        <button
          type="button"
          className="cc-card__btn"
          title="Element menu"
          onPointerDown={stop}
          onClick={openMenu}
        >
          <IconMore size={14} />
        </button>
      </header>

      {!element.collapsed ? (
        <div className="cc-card__scroll cc-scroll">
          <ElementBody element={element} childTitles={childTitles} />
        </div>
      ) : null}

      {handles}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The body, which is the only part that varies by kind                  */
/* ------------------------------------------------------------------ */

function ElementBody({ element, childTitles }: { element: Element; childTitles: string[] }) {
  switch (element.kind) {
    case 'note':
      return <NoteBody element={element} childTitles={childTitles} />
    case 'video':
    case 'pdf':
      return (
        <>
          {/* A video or a PDF leads with what it points at. */}
          <div className="mb-2">
            <CardEmbedView element={element} />
          </div>
          {/* Only a PDF has a note. A video is the video; there is nothing to say
              about it underneath. */}
          {element.kind === 'pdf' && element.note.trim().length > 0 ? (
            <p className="cc-note-line">{element.note}</p>
          ) : null}
        </>
      )
    case 'table':
      return <TableBody element={element} />
    default:
      // `link` has no renderer yet: the registry marks it unsupported, so the
      // only way to reach this is a hand-edited file, and it says so rather than
      // rendering as a blank card.
      return (
        <p className="cc-card__body opacity-60">
          {element.kind === 'link'
            ? 'A link element is not implemented yet.'
            : 'Nothing to show.'}
        </p>
      )
  }
}

function NoteBody({
  element,
  childTitles,
}: {
  element: Extract<Element, { kind: 'note' }>
  childTitles: string[]
}) {
  const updateChecklistItem = useCanvasStore((s) => s.updateChecklistItem)
  const addChecklistItem = useCanvasStore((s) => s.addChecklistItem)
  const setInspectorTab = useCanvasStore((s) => s.setInspectorTab)

  // The body is a Markdown page; the card renders only a preview of it.
  const bodyHtml = useMemo(() => renderMarkdown(element.body), [element.body])

  const addItem = useCallback(() => {
    addChecklistItem(element.id)
  }, [addChecklistItem, element.id])

  return (
    <>
      {element.image.src ? (
        <img
          className="cc-card__image"
          src={element.image.src}
          alt={element.image.alt}
          draggable={false}
        />
      ) : null}

      <div
        className="cc-card__body cc-markdown"
        data-empty={element.body.trim().length === 0 ? 'true' : undefined}
        onDoubleClick={(event) => {
          // Double-click anywhere on the body jumps to the Markdown editor.
          event.stopPropagation()
          setInspectorTab('content')
        }}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />

      {element.checklist.length > 0 ? (
        <div className="mt-2">
          {element.checklist.map((item) => (
            <label
              key={item.id}
              className="cc-check"
              data-done={item.done ? 'true' : undefined}
              data-no-drag=""
            >
              <input
                type="checkbox"
                checked={item.done}
                onChange={(event) =>
                  updateChecklistItem(element.id, item.id, { done: event.target.checked })
                }
              />
              <span>{item.text || 'New step'}</span>
            </label>
          ))}
          <button
            type="button"
            className="mt-0.5 cursor-pointer border-0 bg-transparent p-0 text-[11px] font-semibold opacity-60 hover:opacity-100"
            style={{ color: 'inherit' }}
            data-no-drag=""
            onClick={addItem}
          >
            + add step
          </button>
        </div>
      ) : null}

      {element.tags.length > 0 ? (
        <div className="cc-card__footer">
          {element.tags.map((tag) => (
            <span key={tag} className="cc-tag">
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      {childTitles.length > 0 ? (
        <div className="cc-children">
          <strong>Inside</strong>
          <ul className="ml-4 list-disc">
            {childTitles.map((title, i) => (
              <li key={`${i}-${title}`}>{title}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}

function TableBody({ element }: { element: Extract<Element, { kind: 'table' }> }) {
  const setTableCell = useCanvasStore((s) => s.setTableCell)
  const readOnlyReason = useCanvasStore((s) => s.readOnlyReason)

  return (
    <table className="cc-table">
      <thead>
        <tr>
          {element.columns.map((column) => (
            <th key={column.id} style={{ width: `${column.width}%` }}>
              {column.title || 'Column'}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: element.rowCount }, (_, row) => (
          <tr key={row}>
            {element.columns.map((column, columnIndex) => {
              // Column-major storage: `cells[column * rowCount + row]`. The
              // indexing lives in one place — `elementOps.tableCell` — so this is
              // a read of it rather than a second copy of the arithmetic.
              const value = element.cells[columnIndex * element.rowCount + row] ?? ''
              return (
                <td key={column.id}>
                  <input
                    value={value}
                    readOnly={readOnlyReason !== null}
                    aria-label={`Row ${row + 1}, ${column.title || `column ${columnIndex + 1}`}`}
                    onChange={(event) =>
                      setTableCell(element.id, row, columnIndex, event.target.value)
                    }
                  />
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export const ElementNode = memo(ElementNodeImpl)
