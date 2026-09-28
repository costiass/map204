import { useState } from 'react'
import { CheckSquare, Maximize } from 'lucide-react'

import {
  IconBringFront,
  IconCollapse,
  IconCopy,
  IconDownload,
  IconLink,
  IconPalette,
  IconSendBack,
  IconTrash,
  IconUpload,
} from '@/components/Icons'
import { openInsertCard } from '@/components/InsertCardDialog'
import { useCanvasStore } from '@/store/useCanvasStore'
import { CARD_ACCENTS, CARD_BACKGROUNDS, type CardType } from '@/types'
import { insertableKinds, needsSource } from '@/elements/registry'

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
              <IconLink size={14} /> Connect to…
            </button>
            <button type="button" onClick={() => setShowColors((v) => !v)}>
              <IconPalette size={14} /> Colour…
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
              {group.memberCardIds.length} card{group.memberCardIds.length === 1 ? '' : 's'} · {group.memberGroupIds.length} group{group.memberGroupIds.length === 1 ? '' : 's'}
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
              {connection.label ? ` · ${connection.label}` : ''}
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
            {/* Every kind, not just "new card". A right-click menu is the
                fastest route to a card, and forcing anybody who wants a video
                card to find the toolbar first is a step in the way for no
                reason — the two routes are the same work, so they should offer
                the same choices.

                "Here" means where the pointer is, so each of these places the
                card under the cursor. */}
            <p className="cc-menu-label">Insert</p>
            {insertableKinds().map((kind) => {
              const KindIcon = kind.icon
              return (
                <button
                  key={kind.id}
                  type="button"
                  title={kind.blurb}
                  onClick={() => {
                    if (needsSource(kind.id)) {
                      // It points at something, so there is nothing to create
                      // until somebody says to what. The dialog opens with the
                      // kind already chosen.
                      close()
                      openInsertCard(menu.x, menu.y, kind.id as CardType)
                      return
                    }
                    addCard(
                      { type: kind.id as CardType },
                      { atScreen: { x: menu.x, y: menu.y } },
                    )
                    close()
                  }}
                >
                  <KindIcon size={14} className="shrink-0 opacity-70" />
                  {kind.label}
                </button>
              )
            })}
            <button type="button" onClick={() => { addGroup(); close() }}>
              <span className="grid h-[14px] w-[14px] shrink-0 place-items-center rounded border border-current opacity-70" />
              Group
            </button>

            <hr />
            <p className="cc-menu-label">The page</p>
            <button type="button" onClick={() => { selectAllCards(); close() }}>
              <CheckSquare size={14} className="shrink-0 opacity-70" /> Select all cards
            </button>
            <button type="button" onClick={() => { requestFitView(); close() }}>
              <Maximize size={14} className="shrink-0 opacity-70" /> Fit view
            </button>
            <hr />
            <button type="button" onClick={() => { setDialog('import'); close() }}>
              <IconUpload size={14} className="shrink-0 opacity-70" /> Import JSON…
            </button>
            <button type="button" onClick={() => { setDialog('export'); close() }}>
              <IconDownload size={14} className="shrink-0 opacity-70" /> Export JSON…
            </button>
          </>
        ) : null}
      </div>
    </>
  )
}
