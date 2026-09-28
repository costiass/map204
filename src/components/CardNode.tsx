import { memo, useCallback, useMemo } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { IconChevron, IconMore } from '@/components/Icons'
import { CardEmbedView } from '@/components/CardEmbedView'
import { FlashCard } from '@/components/FlashCard'
import { useCanvasStore } from '@/store/useCanvasStore'
import { ANCHORS, COLLAPSED_HEADER_HEIGHT, type Anchor, type Card, type Point } from '@/types'
import { renderMarkdown } from '@/utils/markdown'

export interface CardNodeProps {
  card: Card
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
  onCardPointerDown: (event: ReactPointerEvent<HTMLElement>, cardId: string) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>, cardId: string) => void
  onHandlePointerDown: (event: ReactPointerEvent<HTMLElement>, cardId: string, side: Anchor) => void
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, cardId: string) => void
}

function CardNodeImpl({
  card,
  selected,
  dimmed,
  spotlight = false,
  dragTarget,
  offset,
  size,
  childTitles,
  onCardPointerDown,
  onResizePointerDown,
  onHandlePointerDown,
  onContextMenu,
}: CardNodeProps) {
  const updateCard = useCanvasStore((s) => s.updateCard)
  const flushCommit = useCanvasStore((s) => s.flushCommit)
  const toggleCollapsed = useCanvasStore((s) => s.toggleCollapsed)
  const setContextMenu = useCanvasStore((s) => s.setContextMenu)
  const setInspectorTab = useCanvasStore((s) => s.setInspectorTab)
  const updateChecklistItem = useCanvasStore((s) => s.updateChecklistItem)
  const addChecklistItem = useCanvasStore((s) => s.addChecklistItem)

  const width = size?.width ?? card.position.width
  const height = size?.height ?? card.position.height
  const x = card.position.x + (offset?.x ?? 0)
  const y = card.position.y + (offset?.y ?? 0)

  // The card body is a Markdown page; the card itself only renders a preview.
  const bodyHtml = useMemo(() => renderMarkdown(card.content), [card.content])

  const style = {
    left: x,
    top: y,
    width,
    height: card.collapsed ? COLLAPSED_HEADER_HEIGHT : height,
    zIndex: card.position.zIndex,
    '--cc-bg': card.style.backgroundColor,
    '--cc-accent': card.style.accentColor,
    '--cc-fg': card.style.textColor,
    '--cc-border': card.style.borderColor,
    '--cc-border-width': `${card.style.borderWidth}px`,
    '--cc-radius': `${card.style.borderRadius}px`,
  } as CSSProperties

  const stop = (event: React.SyntheticEvent) => event.stopPropagation()

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.currentTarget.blur()
    }
  }

  const addItem = useCallback(() => {
    addChecklistItem(card.id)
  }, [addChecklistItem, card.id])

  // Read from the store as state, not `getState()` inside the render: a card
  // already on the canvas has to *re-render* when read-only mode starts, and a
  // one-off read would leave it clickable until something else happened to
  // repaint it.
  const readOnlyReason = useCanvasStore((s) => s.readOnlyReason)
  const editable = readOnlyReason === null

  /* ---------------------------------------------------------------- */
  /* A flash card is a different shape of thing                         */
  /* ---------------------------------------------------------------- */

  // A flash card gets no header, and no title input. The front *is* the title,
  // so a title field above it would say the same thing twice and make the card
  // look like a note with a question on it. The controls move onto the face
  // itself, where they sit on top of the card rather than above it.
  if (card.type === 'flash' && !card.collapsed) {
    return (
      <div
        className="cc-card"
        style={style}
        data-card-id={card.id}
        data-selected={selected ? 'true' : undefined}
        data-dimmed={dimmed ? 'true' : undefined}
        data-spotlight={spotlight ? 'true' : undefined}
        data-drag-target={dragTarget ? 'true' : undefined}
        data-shadow={card.style.shadow ? 'true' : 'false'}
        onPointerDown={(event) => onCardPointerDown(event, card.id)}
        onContextMenu={(event) => onContextMenu(event, card.id)}
      >
        <span className="cc-card__accent" />

        <FlashCard
          card={card}
          editable={editable}
          onDoubleClick={() => setInspectorTab('content')}
        />

        <div className="absolute right-1 top-1 flex gap-0.5">
          <button
            type="button"
            className="cc-card__btn"
            title="Collapse card"
            data-no-drag=""
            onPointerDown={stop}
            onClick={() => toggleCollapsed([card.id])}
          >
            <IconChevron
              size={14}
              style={{ transform: 'rotate(-90deg)', transition: 'transform 140ms ease' }}
            />
          </button>
          <button
            type="button"
            className="cc-card__btn"
            title="Card menu"
            data-no-drag=""
            onPointerDown={stop}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setContextMenu({
                x: rect.left,
                y: rect.bottom + 6,
                cardId: card.id,
                connectionId: null,
                groupId: null,
              })
            }}
          >
            <IconMore size={14} />
          </button>
        </div>

        {ANCHORS.map((side) => (
          <span
            key={side}
            className="cc-handle"
            data-side={side}
            title={`Drag to connect from the ${side}`}
            onPointerDown={(event) => onHandlePointerDown(event, card.id, side)}
          />
        ))}

        <span
          className="cc-resize"
          title="Resize"
          onPointerDown={(event) => onResizePointerDown(event, card.id)}
        />
      </div>
    )
  }

  return (
    <div
      className="cc-card"
      style={style}
      data-card-id={card.id}
      data-selected={selected ? 'true' : undefined}
      data-dimmed={dimmed ? 'true' : undefined}
        data-spotlight={spotlight ? 'true' : undefined}
      data-collapsed={card.collapsed ? 'true' : undefined}
      data-drag-target={dragTarget ? 'true' : undefined}
      data-shadow={card.style.shadow ? 'true' : 'false'}
      onPointerDown={(event) => onCardPointerDown(event, card.id)}
      onContextMenu={(event) => onContextMenu(event, card.id)}
    >
      <span className="cc-card__accent" />

      <header className="cc-card__header">
        <input
          className="cc-card__title"
          value={card.title}
          placeholder="Untitled card"
          spellCheck={false}
          aria-label="Card title"
          // Selects the card, but lets the caret move so the title stays editable.
          data-no-drag=""
          onKeyDown={handleTitleKeyDown}
          onChange={(event) => updateCard(card.id, { title: event.target.value }, { silent: true })}
          onBlur={() => flushCommit()}
        />
        <button
          type="button"
          className="cc-card__btn"
          title={card.collapsed ? 'Expand card' : 'Collapse card'}
          onPointerDown={stop}
          onClick={() => toggleCollapsed([card.id])}
        >
          <IconChevron
            size={14}
            style={{ transform: card.collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 140ms ease' }}
          />
        </button>
        <button
          type="button"
          className="cc-card__btn"
          title="Card menu"
          onPointerDown={stop}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setContextMenu({
              x: rect.left,
              y: rect.bottom + 6,
              cardId: card.id,
              connectionId: null,
              groupId: null,
            })
          }}
        >
          <IconMore size={14} />
        </button>
      </header>

      {!card.collapsed ? (
        <div className="cc-card__scroll cc-scroll">
          {card.image.src ? (
            <img className="cc-card__image" src={card.image.src} alt={card.image.alt} draggable={false} />
          ) : null}

          {/* A video or PDF card leads with what it points at. The Markdown body
              still renders below it, but only when there is one â€” an empty
              "Nothing here yet" placeholder under a playing video is noise. */}
          {card.type !== 'note' ? (
            <div className="mb-2">
              <CardEmbedView card={card} />
            </div>
          ) : null}

          {card.content.trim().length > 0 || card.type === 'note' ? (
            <div
              className="cc-card__body cc-markdown"
              data-empty={card.content.trim().length === 0 ? 'true' : undefined}
              onDoubleClick={(event) => {
                // Double-click anywhere on the body jumps to the Markdown editor.
                event.stopPropagation()
                setInspectorTab('content')
              }}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : null}

          {card.checklist.length > 0 ? (
            <div className="mt-2">
              {card.checklist.map((item) => (
                <label key={item.id} className="cc-check" data-done={item.done ? 'true' : undefined} data-no-drag="">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(event) => updateChecklistItem(card.id, item.id, { done: event.target.checked })}
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

          {card.tags.length > 0 || childTitles.length > 0 ? (
            <div className="cc-card__footer">
              {card.tags.map((tag) => (
                <span key={tag} className="cc-tag">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}

          {childTitles.length > 0 ? (
            <div className="cc-children">
              <strong>Child cards</strong>
              <ul className="ml-4 list-disc">
                {childTitles.map((title) => (
                  <li key={title}>{title}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {ANCHORS.map((side) => (
        <span
          key={side}
          className="cc-handle"
          data-side={side}
          title={`Drag to connect from the ${side}`}
          onPointerDown={(event) => onHandlePointerDown(event, card.id, side)}
        />
      ))}

      <span
        className="cc-resize"
        title="Resize"
        onPointerDown={(event) => onResizePointerDown(event, card.id)}
      />
    </div>
  )
}

export const CardNode = memo(CardNodeImpl)
