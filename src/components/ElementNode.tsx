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
  /** Is this element one of the ones currently being dragged? */
  dragging?: boolean
  /** Live drag offset applied on top of the stored world position. */
  offset: Point | null
  /** Live resize override. */
  size: { width: number; height: number } | null
  childTitles: string[]
  onElementPointerDown: (event: ReactPointerEvent<HTMLElement>, elementId: string) => void
  /**
   * The title bar's handler, which drags and does not select.
   *
   * Separate from the body handler on purpose. The body says "press to select",
   * the title says "press and move" -- and running both through one handler is
   * what made every reposition open the inspector.
   */
  onElementTitlePointerDown?: (event: ReactPointerEvent<HTMLElement>, elementId: string) => void
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
  dragging = false,
  offset,
  size,
  childTitles,
  onElementPointerDown,
  onElementTitlePointerDown,
  onResizePointerDown,
  onHandlePointerDown,
  onContextMenu,
}: ElementNodeProps) {
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

  /*
   * One shell for every kind.
   *
   * A flash deck used to be a special case with its own outer element, no header
   * and no title — so a deck was not a card. It could not be dragged by a title,
   * its collapse chevron sat somewhere else, and its controls floated over the
   * face. A deck is now a card with a deck inside it, which is what it is.
   *
   * The two gestures, and where they live:
   *
   *   - the *header* drags. `data-no-drag` is deliberately absent, so the
   *     pointerdown reaches the element and starts a drag. The title is read
   *     rather than edited, because an editable title put two gestures in the
   *     same twenty pixels and which one you got depended on how far your hand
   *     moved before the caret appeared.
   *   - the *body* opens the inspector. `data-no-drag` is set, so a press there
   *     selects without starting a drag, and a click opens the panel.
   */
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
      data-dragging={dragging ? 'true' : undefined}
      data-shadow={noteStyle.shadow ? 'true' : 'false'}
      onContextMenu={(event) => onContextMenu(event, element.id)}
    >
      <span className="cc-card__accent" />

      <header
        className="cc-card__header"
        title={element.title || 'Untitled'}
        onPointerDown={(event) => {
          // `onElementTitlePointerDown` if the canvas gave us one, so the title
          // drags without selecting. The fallback is the body handler, which does
          // select -- a canvas that did not supply the drag-only handler would
          // otherwise have a title bar that cannot move the element at all, which
          // is worse than the old behaviour rather than better.
          const handler = onElementTitlePointerDown ?? onElementPointerDown
          handler(event, element.id)
        }}
      >
        <span className="cc-card__title">{element.title || 'Untitled'}</span>
        <button
          type="button"
          className="cc-card__btn"
          title={element.collapsed ? 'Expand element' : 'Collapse element'}
          aria-label={element.collapsed ? 'Expand element' : 'Collapse element'}
          aria-expanded={!element.collapsed}
          data-no-drag=""
          onPointerDown={stop}
          onClick={() => toggleElementCollapsed([element.id])}
        >
          {/*
            The chevron points the way the *click* goes, not the way the element is
            currently folded. Collapsed, it points down to unfold; expanded, it
            points up to fold. The old version rotated the other way, so a
            collapsed card showed a down-chevron as though pressing it would
            collapse it again.
          */}
          <IconChevron
            size={14}
            style={{
              transform: element.collapsed ? 'none' : 'rotate(180deg)',
              transition: 'transform 140ms ease',
            }}
          />
        </button>
        <button
          type="button"
          className="cc-card__btn"
          title="Element menu"
          aria-label="Element menu"
          data-no-drag=""
          onPointerDown={stop}
          onClick={openMenu}
        >
          <IconMore size={14} />
        </button>
      </header>

      {!element.collapsed ? (
        /*
          `data-no-drag` on the body is the other half of the gesture split: a
          press here selects the element and stops, so a click can open the
          inspector without the pointer having moved enough to be a drag.

          The deck is the exception and opts back in, because its whole face is a
          control — a press turns the card over. It tracks pointer travel itself
          and starts a drag only once the pointer has actually travelled, which is
          why it does not need the marker.
        */
        <div
          className="cc-card__scroll cc-scroll"
          data-no-drag={element.kind === 'flash' ? undefined : ''}
          onPointerDown={
            element.kind === 'flash'
              ? undefined
              : (event) => onElementPointerDown(event, element.id)
          }
          onDoubleClick={element.kind === 'flash' ? undefined : () => setInspectorTab('content')}
        >
          <ElementBody element={element} childTitles={childTitles} editable={editable} />
        </div>
      ) : null}

      {handles}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The body, which is the only part that varies by kind                  */
/* ------------------------------------------------------------------ */

function ElementBody({
  element,
  childTitles,
  editable,
}: {
  element: Element
  childTitles: string[]
  /** False in read-only and presentation, where a click is not a flip or a type. */
  editable: boolean
}) {
  switch (element.kind) {
    case 'note':
      return <NoteBody element={element} childTitles={childTitles} />
    case 'flash':
      /*
        The deck, inside the card.

        A deck is a card with a card inside it: the header above it is the same
        header every other kind has, and the face below is the only part that
        differs. That is what makes it draggable by its title, collapsible, and
        openable in the inspector without any of those being special-cased.
      */
      return <FlashDeck element={element} editable={editable} />
    case 'video':
    case 'pdf':
      return (
        <>
          {/*
            A video or a PDF leads with what it points at.

            No wrapper margin for a *video*: the frame is the element, edge to
            edge, and a margin is the padding that made it look like a video
            sitting inside a card. A PDF keeps a little space, because it is a
            document sitting on a card rather than being one.
          */}
          <div className={element.kind === 'video' ? '' : 'mb-2'}>
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

  /*
   * The three display flags ride on the element as data attributes rather than as
   * props through three layers of nesting. A `<table>` cannot take a class per
   * cell without one per cell, and conditional Tailwind classes on a `<td>` are
   * the sort of thing that silently stops applying when a class name is refactored.
   * The stylesheet reads `data-borders` on the table and the cells inherit.
   */
  const headerRow = element.header ? 1 : 0

  return (
    <div className="cc-table-wrap" data-scrollable={element.editing ? 'true' : 'false'}>
      <table className="cc-table" data-borders={element.borders ? 'true' : 'false'} data-stripes={element.stripes ? 'true' : 'false'}>
        {element.header ? (
          <thead>
            <tr>
              {element.columns.map((column, columnIndex) => (
                <th key={column.id} scope="col" style={{ width: `${column.width}%` }}>
                  {column.title || `Column ${columnIndex + 1}`}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}

        <tbody>
          {Array.from({ length: element.rowCount }, (_, row) => (
            <tr key={row} data-striped={element.stripes && row % 2 === 1 ? 'true' : undefined}>
              {element.columns.map((column, columnIndex) => {
                // Column-major storage: `cells[column * rowCount + row]`. The
                // indexing lives in one place — `elementOps.tableCell` — so this is
                // a read of it rather than a second copy of the arithmetic.
                const value = element.cells[columnIndex * element.rowCount + row] ?? ''
                return (
                  <td key={column.id}>
                    {/*
                      An `<input>`, not a `<div contentEditable>`. A real input is
                      keyboard reachable, works with a screen reader, and gives the
                      browser's own text editing for free. Its width is `100%` with
                      the cell clipped, so a long value scrolls inside its own cell
                      rather than widening the column and the table with it.
                    */}
                    <input
                      value={value}
                      readOnly={readOnlyReason !== null}
                      aria-label={`Row ${row + headerRow}, ${column.title || `column ${columnIndex + 1}`}`}
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
    </div>
  )
}

export const ElementNode = memo(ElementNodeImpl)
