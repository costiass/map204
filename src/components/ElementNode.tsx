import { memo, useCallback, useMemo } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { IconChevron, IconMore } from '@/components/Icons'
import { CardEmbedView } from '@/components/CardEmbedView'
import { FlashDeck } from '@/components/FlashCard'
import { DEFAULT_NOTE_STYLE, DEFAULT_STYLE_BY_KIND } from '@/elements/defaults'
import { useCanvasStore } from '@/store/useCanvasStore'
import { ANCHORS, COLLAPSED_HEADER_HEIGHT, type Anchor, type Element, type Point } from '@/types'
import { safeEmbedUrl } from '@/utils/embeds'
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

  /*
   * The element's own style, for every kind.
   *
   * This used to read:
   *
   *   const noteStyle = element.kind === 'note' ? element.style : DEFAULT_NOTE_STYLE
   *
   * which meant every element that was not a note threw its style away at render
   * time and drew the note's default instead. The Settings panel is shared by all
   * kinds and offered a colour picker for a video, a table, a deck and a PDF — and
   * the colour was accepted, saved, and then ignored. The chrome looked deliberate
   * on every kind, which is what the comment claimed and what it was for, and that
   * is the only thing it ever achieved: the one visual constant worth keeping is
   * the fallback for an element with *no* style at all, which is a different case.
   *
   * `DEFAULT_STYLE_BY_KIND` keeps the per-kind defaults the creation code uses — a
   * video still starts black, a PDF still starts as paper. Those are defaults, and
   * they are applied when the element is made, not hidden from it afterwards.
   */
  const elementStyle = element.style ?? DEFAULT_STYLE_BY_KIND[element.kind] ?? DEFAULT_NOTE_STYLE

  const style = {
    left: x,
    top: y,
    width,
    height: element.collapsed ? COLLAPSED_HEADER_HEIGHT : height,
    zIndex: element.zIndex,
    '--cc-bg': elementStyle.backgroundColor,
    '--cc-accent': elementStyle.accentColor,
    '--cc-fg': elementStyle.textColor,
    '--cc-border': elementStyle.borderColor,
    '--cc-border-width': `${elementStyle.borderWidth}px`,
    '--cc-radius': `${elementStyle.borderRadius}px`,
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

  /**
   * The four edge handles and the resize grip — the same on every kind.
   *
   * Rendered only when the canvas can be written to. Not disabled, *absent*: a
   * resize grip a viewer cannot use is a lie about what the element is, and it sits
   * right on the corner people click when they are looking rather than editing. The
   * same goes for the connection anchors.
   */
  const handles = editable ? (
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
  ) : null

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
      // Drives the cursor: a read-only element must not look draggable. The
      // handlers are already gone, so this is about not promising something the
      // canvas will refuse.
      data-editable={editable ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : undefined}
      data-shadow={elementStyle.shadow ? 'true' : 'false'}
      onContextMenu={editable ? (event) => onContextMenu(event, element.id) : undefined}
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
        {/*
          Collapse and menu, for a canvas that can be written to.

          Both are writes -- collapsing changes the element and is saved, and the
          menu is the front door to rename, duplicate and delete. A viewer must not
          have either, so they are not rendered rather than disabled: a chevron that
          cannot collapse anything still says "this collapses".

          A viewer does get the *title bar itself*, because it is what a reader
          looks at. Only the controls in it go.
        */}
        {editable ? (
          <>
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
                The chevron points the way the *click* goes, not the way the element
                is currently folded. Collapsed, it points down to unfold; expanded,
                it points up to fold. The old version rotated the other way, so a
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
          </>
        ) : null}
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
          // A viewer gets no `data-no-drag` and no handlers at all. Not because the
          // canvas would refuse the drag -- `handleCardPointerDown` already checks
          // `canEdit()` -- but because selection is itself a write: it opens the
          // inspector, and the inspector is an editing surface.
          //
          // What is deliberately *not* blocked is scrolling. A long note on a map
          // somebody was invited to read has to be readable, and a viewer who
          // cannot scroll a card cannot use the thing they were invited to use.
          data-no-drag={element.kind === 'flash' || !editable ? undefined : ''}
          onPointerDown={
            !editable || element.kind === 'flash'
              ? undefined
              : (event) => onElementPointerDown(event, element.id)
          }
          onDoubleClick={
            !editable || element.kind === 'flash' ? undefined : () => setInspectorTab('content')
          }
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
      if (element.kind === 'link') return <LinkBody element={element} />

      return <p className="cc-card__body opacity-60">Nothing to show.</p>
  }
}

/**
 * A link, which used to render the words "not implemented yet".
 *
 * `LinkElement` has carried `url`, `display` and `show` since version 2, and the
 * renderer never read any of them -- so the element drew a placeholder and the
 * inspector had nothing to edit. Both halves were missing, which is why it looked
 * like an unfinished feature rather than a broken one: there was nothing to click
 * and nothing happened if you did.
 *
 * The three `display` modes are the ones `RefDisplay` declares, which the PDF
 * element shares, so a link and a document from the same source read the same way:
 *
 *   chip     a tag showing where it goes, for a row of references
 *   preview  the address in full, for a link that is also the content
 *   open     the text alone, for a page of prose with links in it
 */
function LinkBody({ element }: { element: Extract<Element, { kind: 'link' }> }) {
  const safe = safeEmbedUrl(element.url)
  const label = element.title.trim() || (safe ? hostOf(element.url) : 'A link')

  if (!element.url.trim()) {
    return <p className="cc-card__body opacity-60">No address yet. Add one in Source.</p>
  }
  if (!safe) {
    return (
      <p className="cc-card__body opacity-60">
        That address is not http(s), so it will not be linked.
      </p>
    )
  }

  // `show` decides what a chip says, and only a chip: the other two modes show the
  // address or the title regardless, because that is the whole of what they are.
  const chipText =
    element.show === 'full' ? element.url : element.show === 'none' ? '' : hostOf(element.url)

  if (element.display === 'open') {
    return (
      <p className="cc-card__body">
        <a
          href={safe}
          target="_blank"
          rel="noreferrer noopener"
          className="underline break-all"
          // The accent is already a CSS variable on the element's wrapper, set from
          // this element's own style. Using it here rather than reading the style a
          // second time means the link cannot disagree with the strip beside it.
          style={{ color: 'var(--cc-accent)' }}
        >
          {element.url}
        </a>
      </p>
    )
  }

  if (element.display === 'preview') {
    return (
      <p className="cc-card__body truncate">
        <a
          href={safe}
          target="_blank"
          rel="noreferrer noopener"
          title={element.url}
          style={{ color: 'var(--cc-accent)' }}
        >
          {element.url}
        </a>
      </p>
    )
  }

  return (
    <p className="cc-card__body flex items-center gap-1.5">
      <a
        href={safe}
        target="_blank"
        rel="noreferrer noopener"
        // The existing tag pill rather than a new class. It already reads as a small
        // accent-tinted chip, it already has a dark variant, and a second one for the
        // same idea would drift from it.
        className="cc-tag"
        title={element.url}
      >
        {chipText || ' '}
      </a>
      <span className="truncate opacity-70">{label}</span>
    </p>
  )
}

/** The host of a URL, for a chip that has to be short. Falls back to the address. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
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
