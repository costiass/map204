import { useState } from 'react'
import { StickyNote } from 'lucide-react'

import {
  IconBringFront,
  IconCollapse,
  IconCopy,
  IconLink,
  IconPalette,
  IconSendBack,
  IconTrash,
} from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
import { CARD_ACCENTS, CARD_BACKGROUNDS } from '@/types'
import { openInsertCard } from '@/components/InsertCardDialog'

export function ContextMenu() {
  const menu = useCanvasStore((s) => s.contextMenu)
  const card = useCanvasStore((s) => {
    if (!s.contextMenu?.cardId) return undefined
    return s.doc.pages.find((p) => p.id === s.activePageId)?.cards.find((c) => c.id === s.contextMenu?.cardId)
  })
  const group = useCanvasStore((s) => {
    if (!s.contextMenu?.groupId) return undefined
    return s.doc.pages.find((p) => p.id === s.activePageId)?.groups.find((g) => g.id === s.contextMenu?.groupId)
  })
  const connection = useCanvasStore((s) => {
    if (!s.contextMenu?.connectionId) return undefined
    return s.doc.pages
      .find((p) => p.id === s.activePageId)
      ?.connections.find((c) => c.id === s.contextMenu?.connectionId)
  })
  const selectedCardIds = useCanvasStore((s) => s.selectedCardIds)
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const setContextMenu = useCanvasStore((s) => s.setContextMenu)
  const close = () => setContextMenu(null)

  const addCard = useCanvasStore((s) => s.addCard)
  const addGroup = useCanvasStore((s) => s.addGroup)
  const selectAllCards = useCanvasStore((s) => s.selectAllCards)
  const requestFitView = useCanvasStore((s) => s.requestFitView)
  const setDialog = useCanvasStore((s) => s.setDialog)
  const updateCardStyle = useCanvasStore((s) => s.updateCardStyle)
  const setDefaultCardStyle = useCanvasStore((s) => s.setDefaultCardStyle)
  const setDefaultConnectionPreset = useCanvasStore((s) => s.setDefaultConnectionPreset)
  const pushToast = useCanvasStore((s) => s.pushToast)
  const applyZOrder = useCanvasStore((s) => s.applyZOrder)
  const duplicateCards = useCanvasStore((s) => s.duplicateCards)
  const deleteCards = useCanvasStore((s) => s.deleteCards)
  const toggleCollapsed = useCanvasStore((s) => s.toggleCollapsed)
  const deleteConnections = useCanvasStore((s) => s.deleteConnections)
  const updateConnectionStyle = useCanvasStore((s) => s.updateConnectionStyle)
  const deleteGroups = useCanvasStore((s) => s.deleteGroups)
  const [showColors, setShowColors] = useState(false)

  if (!menu) return null

  // Keep the menu inside the viewport.
  const left = Math.min(menu.x, window.innerWidth - 232)
  const top = Math.min(menu.y, window.innerHeight - 340)

  const targetIds = menu.cardId
    ? selectedCardIds.includes(menu.cardId)
      ? selectedCardIds
      : [menu.cardId]
    : []

  return (
    <>
      <div className="fixed inset-0 z-[79]" onPointerDown={close} onContextMenu={(event) => { event.preventDefault(); close() }} />
      <div className="cc-menu" style={{ left, top }} onPointerDown={(event) => event.stopPropagation()}>
        {card ? (
          <>
            <button type="button" onClick={() => { duplicateCards(targetIds); close() }}>
              <IconCopy size={14} /> Duplicate {targetIds.length > 1 ? `${targetIds.length} cards` : 'card'}
            </button>
            <button type="button" onClick={() => { applyZOrder(targetIds, 'front'); close() }}>
              <IconBringFront size={14} /> Bring to front
            </button>
            <button type="button" onClick={() => { applyZOrder(targetIds, 'back'); close() }}>
              <IconSendBack size={14} /> Send to back
            </button>
            <button type="button" onClick={() => { toggleCollapsed(targetIds); close() }}>
              <IconCollapse size={14} /> {card.collapsed ? 'Expand' : 'Collapse'}
            </button>
            <button
              type="button"
              onClick={() => {
                const source = targetIds[0]
                const other = page?.cards.find((c) => !targetIds.includes(c.id))
                if (other) {
                  useCanvasStore.getState().addConnection({
                    source: { kind: 'card', id: source },
                    target: { kind: 'card', id: other.id },
                  })
                } else {
                  useCanvasStore.getState().pushToast('Add another card first, then drag between card edges.', 'info')
                }
                close()
              }}
            >
              <IconLink size={14} /> Connect toÃ¢â‚¬Â¦
            </button>
            <button type="button" onClick={() => setShowColors((v) => !v)}>
              <IconPalette size={14} /> ColourÃ¢â‚¬Â¦
            </button>            {showColors ? (
              <div className="px-1 pb-1">
                <span className="cc-label">Background</span>
                <div className="cc-swatches">
                  {CARD_BACKGROUNDS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="cc-swatch"
                      style={{ background: color }}
                      onClick={() => {
                        for (const id of targetIds) updateCardStyle(id, { backgroundColor: color })
                        close()
                      }}
                    />
                  ))}
                </div>
                <span className="cc-label mt-2">Accent</span>
                <div className="cc-swatches">
                  {CARD_ACCENTS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="cc-swatch"
                      style={{ background: color }}
                      onClick={() => {
                        for (const id of targetIds) updateCardStyle(id, { accentColor: color })
                        close()
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <hr />
            <button
              type="button"
              onClick={() => {
                setDefaultCardStyle(card.style)
                pushToast('New cards will use this style.', 'success')
                close()
              }}
            >
              <IconPalette size={14} /> Set as default card style
            </button>
            <button
              type="button"
              data-danger="true"
              onClick={() => {
                deleteCards(targetIds)
                close()
              }}
            >
              <IconTrash size={14} /> Delete {targetIds.length > 1 ? `${targetIds.length} cards` : 'card'}
            </button>
          </>
        ) : null}

        {group ? (
          <>
            <div className="px-2 py-1 text-[11px] text-slate-500">
              {group.memberCardIds.length} card{group.memberCardIds.length === 1 ? '' : 's'} Ã‚Â· {group.memberGroupIds.length} group{group.memberGroupIds.length === 1 ? '' : 's'}
            </div>
            <button
              type="button"
              data-danger="true"
              onClick={() => {
                deleteGroups([group.id])
                close()
              }}
            >
              <IconTrash size={14} /> Delete group
            </button>
          </>
        ) : null}

        {connection ? (
          <>
            <div className="px-2 py-1 text-[11px] text-slate-500">
              {connection.relationshipType}
              {connection.label ? ` Ã‚Â· ${connection.label}` : ''}
            </div>
            <div className="cc-swatches px-1 pb-1">
              {['#6366F1', '#0EA5E9', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#64748B', '#111827'].map(
                (color) => (
                  <button
                    key={color}
                    type="button"
                    className="cc-swatch"
                    style={{ background: color }}
                    onClick={() => {
                      updateConnectionStyle(connection.id, { color })
                      close()
                    }}
                  />
                ),
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                updateConnectionStyle(connection.id, { animated: !connection.style.animated })
                close()
              }}
            >
              {connection.style.animated ? 'Stop animation' : 'Animate line'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDefaultConnectionPreset({
                  style: connection.style,
                  relationshipType: connection.relationshipType,
                })
                pushToast('New links will look and read like this one.', 'success')
                close()
              }}
            >
              <IconPalette size={14} /> Set as default for new links
            </button>
            <button
              type="button"
              data-danger="true"
              onClick={() => {
                deleteConnections([connection.id])
                close()
              }}
            >
              <IconTrash size={14} /> Delete connection
            </button>
          </>
        ) : null}

        {!card && !connection && !group ? (
          <>
            <button type="button" onClick={() => { addGroup(); close() }}>
              <span className="cc-kbd">G</span> New group here
            </button>
            <button type="button" onClick={() => { addCard(); close() }}>
              <span className="cc-kbd">C</span> New card here
            </button>
            <hr />
            <button
              type="button"
              onClick={() => {
                close()
                openInsertCard(menu.x, menu.y)
              }}
            >
              <StickyNote size={14} className="opacity-70" /> Insert a cardÃ¢â‚¬Â¦
            </button>
            <button type="button" onClick={() => { selectAllCards(); close() }}>
              <span className="cc-kbd">Ã¢Å’ËœA</span> Select all cards
            </button>
            <button type="button" onClick={() => { requestFitView(); close() }}>
              <span className="cc-kbd">F</span> Fit view
            </button>
            <hr />
            <button type="button" onClick={() => { setDialog('import'); close() }}>
              Import JSONÃ¢â‚¬Â¦
            </button>
            <button type="button" onClick={() => { setDialog('export'); close() }}>
              Export JSONÃ¢â‚¬Â¦
            </button>
          </>
        ) : null}
      </div>
    </>
  )
}
