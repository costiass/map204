import { useMemo } from 'react'

import { IconX } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
import type { Connection } from '@/types'
import { cardRect, centerOn, rectCenter } from '@/utils/geometry'

interface NodeData {
  id: string
  title: string
  color: string
  kind: 'card' | 'group'
  connection: Connection | null
  direction: 'in' | 'out'
  groupId?: string
}

interface GroupBox {
  groupId: string
  color: string
  title: string
  nodes: NodeData[]
}

/**
 * Tree view of connections: incoming on the left, outgoing on the right.
 * Cards belonging to the same group are wrapped in a shared box with padding.
 */
export function ConnectionTree() {
  const selectedCardIds = useCanvasStore((s) => s.selectedCardIds)
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const selectCards = useCanvasStore((s) => s.selectCards)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const viewportSize = useCanvasStore((s) => s.viewportSize)
  const clearSelection = useCanvasStore((s) => s.clearSelection)

  const cardId = selectedCardIds.length === 1 ? selectedCardIds[0] : null

  // Build a map of cardId -> group for cards that belong to a group.
  const cardGroupMap = useMemo(() => {
    if (!page) return new Map<string, { groupId: string; color: string; title: string }>()
    const map = new Map<string, { groupId: string; color: string; title: string }>()
    for (const group of page.groups) {
      for (const memberCardId of group.memberCardIds) {
        map.set(memberCardId, { groupId: group.id, color: group.color, title: group.title })
      }
    }
    return map
  }, [page])

  const { incoming, outgoing } = useMemo(() => {
    if (!cardId || !page) return { incoming: [], outgoing: [] }
    const card = page.cards.find((c) => c.id === cardId)
    if (!card) return { incoming: [], outgoing: [] }

    const connections = page.connections.filter(
      (conn) =>
        (conn.source.kind === 'card' && conn.source.id === cardId) ||
        (conn.target.kind === 'card' && conn.target.id === cardId),
    )

    const incomingNodes: NodeData[] = []
    const outgoingNodes: NodeData[] = []
    const seen = new Set<string>()

    for (const conn of connections) {
      const isSource = conn.source.kind === 'card' && conn.source.id === cardId
      const endpoint = isSource ? conn.target : conn.source
      const key = `${endpoint.kind}-${endpoint.id}`
      if (seen.has(key)) continue
      seen.add(key)

      let node: NodeData | null = null
      if (endpoint.kind === 'card') {
        const c = page.cards.find((card) => card.id === endpoint.id)
        if (c) {
          const groupInfo = cardGroupMap.get(c.id)
          node = {
            id: c.id,
            title: c.title || 'Untitled',
            color: c.style.accentColor,
            kind: 'card',
            connection: conn,
            direction: isSource ? 'out' : 'in',
            groupId: groupInfo?.groupId,
          }
        }
      } else {
        const g = page.groups.find((group) => group.id === endpoint.id)
        if (g) {
          node = {
            id: g.id,
            title: g.title || 'Untitled group',
            color: g.color,
            kind: 'group',
            connection: conn,
            direction: isSource ? 'out' : 'in',
          }
        }
      }
      if (node) {
        if (isSource) outgoingNodes.push(node)
        else incomingNodes.push(node)
      }
    }

    return { incoming: incomingNodes, outgoing: outgoingNodes }
  }, [cardId, page, cardGroupMap])

  if (!cardId || (incoming.length === 0 && outgoing.length === 0)) return null

  const jumpToCard = (node: NodeData) => {
    if (!page || node.kind !== 'card') return
    const target = page.cards.find((c) => c.id === node.id)
    if (!target) return
    selectCards([node.id])
    const zoom = Math.min(Math.max(page.viewport.zoom, 0.7), 1.2)
    setViewport(centerOn(rectCenter(cardRect(target)), viewportSize, zoom))
  }

  const lineStyle = (style: string) => {
    if (style === 'dashed') return 'border-dashed'
    if (style === 'dotted') return 'border-dotted'
    return 'border-solid'
  }

  /**
   * Group nodes by their groupId. Nodes without a groupId are returned as-is.
   * Returns an array of items: either a single NodeData or a GroupBox.
   */
  const groupNodes = (nodes: NodeData[]): Array<NodeData | GroupBox> => {
    const groups = new Map<string, GroupBox>()
    const result: Array<NodeData | GroupBox> = []

    for (const node of nodes) {
      if (node.groupId && node.kind === 'card') {
        const groupInfo = cardGroupMap.get(node.id)
        if (groupInfo) {
          let box = groups.get(node.groupId)
          if (!box) {
            box = {
              groupId: node.groupId,
              color: groupInfo.color,
              title: groupInfo.title,
              nodes: [],
            }
            groups.set(node.groupId, box)
            result.push(box)
          }
          box.nodes.push(node)
          continue
        }
      }
      result.push(node)
    }
    return result
  }

  const renderNode = (node: NodeData) => {
    const conn = node.connection
    return (
      <div key={`${node.kind}-${node.id}`} className="flex items-center gap-2 py-0.5">
        {/* Line with link style */}
        <span
          className={`inline-block w-4 shrink-0 border-t-2 ${lineStyle(conn?.style.lineStyle ?? 'solid')}`}
          style={{ borderColor: conn?.style.color ?? '#6366F1' }}
        />
        {/* Button styled like card preview in inspector */}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-left text-xs hover:opacity-80 dark:border-slate-700"
          style={{
            background: 'color-mix(in srgb, var(--color-slate-400) 8%, white)',
          }}
          onClick={() => jumpToCard(node)}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: node.color }}
          />
          <span className="min-w-0 flex-1 truncate text-slate-900 dark:text-slate-100">
            {node.title}
          </span>
          <span className="shrink-0 text-[10px] text-slate-400">
            {node.kind === 'card' ? 'card' : 'group'}
          </span>
        </button>
        {/* Direction arrow */}
        <span className="shrink-0 text-[10px] text-slate-400">
          {node.direction === 'in' ? '←' : '→'}
        </span>
      </div>
    )
  }

  const renderBox = (box: GroupBox) => (
    <div
      key={box.groupId}
      className="rounded-lg border p-1.5"
      style={{
        borderColor: box.color,
        background: `color-mix(in srgb, ${box.color} 6%, transparent)`,
      }}
    >
      <div
        className="mb-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: box.color }}
      >
        {box.title}
      </div>
      {box.nodes.map(renderNode)}
    </div>
  )

  const renderItem = (item: NodeData | GroupBox) => {
    if ('groupId' in item && 'nodes' in item) {
      return renderBox(item as GroupBox)
    }
    return renderNode(item as NodeData)
  }

  return (
    <div className="cc-panel absolute bottom-3 left-3 z-40 w-72 overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Tree
        </span>
        <button
          type="button"
          className="cursor-pointer rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={clearSelection}
          title="Close"
        >
          <IconX size={12} />
        </button>
      </div>
      <div className="cc-scroll max-h-56 overflow-y-auto px-2 py-1">
        {incoming.length > 0 && (
          <div className="mb-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Incoming
            </div>
            {groupNodes(incoming).map(renderItem)}
          </div>
        )}
        {outgoing.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Outgoing
            </div>
            {groupNodes(outgoing).map(renderItem)}
          </div>
        )}
      </div>
    </div>
  )
}
