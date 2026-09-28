import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { arrowheadPath, arrowheadSize, buildEdgeGeometry, dashArray, flowDashArray, flowPeriod } from '@/utils/edges'
import { anchorPoint, visualRectOf } from '@/utils/geometry'
import type { Anchor, Connection, Element, Group, Point, Rect } from '@/types'

export interface DraftConnection {
  sourceElementId: string
  sourceAnchor: Anchor
  from: Point
  to: Point
  targetElementId: string | null
  targetAnchor: Anchor | null
}

export interface ConnectionLayerProps {
  cards: Map<string, Element>
  groups: Map<string, Group>
  connections: Connection[]
  selectedIds: string[]
  dimmedCardIds: Set<string>
  draft: DraftConnection | null
  onSelect: (connectionId: string, additive: boolean) => void
  onContextMenu: (event: React.MouseEvent<SVGGElement>, connectionId: string) => void
  onLabelChange: (connectionId: string, label: string) => void
}

const SELECT_COLOR = '#6366F1'

function ConnectionLayerImpl({
  cards,
  groups,
  connections,
  selectedIds,
  dimmedCardIds,
  draft,
  onSelect,
  onContextMenu,
  onLabelChange,
}: ConnectionLayerProps) {
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingLabelId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingLabelId])

  const resolveRect = (
    endpoint: { kind: 'element' | 'group'; id: string },
  ): Rect | null => {
    if (endpoint.kind === 'element') {
      const Element = cards.get(endpoint.id)
      return Element ? visualRectOf(Element) : null
    }
    const group = groups.get(endpoint.id)
    return group ? { x: group.x, y: group.y, width: group.width, height: group.height } : null
  }

  const endpointId = (endpoint: { kind: 'element' | 'group'; id: string }): string =>
    endpoint.id

  const rendered = connections.flatMap((connection) => {
    const sourceRect = resolveRect(connection.source)
    const targetRect = resolveRect(connection.target)
    // Connections reference cards/groups by id, so an edge whose target is
    // gone is simply skipped rather than rendered at a stale position.
    if (!sourceRect || !targetRect) return []

    const geometry = buildEdgeGeometry({
      source: sourceRect,
      target: targetRect,
      sourceAnchor: connection.sourceAnchor,
      targetAnchor: connection.targetAnchor,
      routing: connection.style.routing,
      arrowStart: connection.style.arrowStart,
      arrowEnd: connection.style.arrowEnd,
      width: connection.style.width,
    })

    const selected = selectedIds.includes(connection.id)
    const dimmed =
      dimmedCardIds.has(endpointId(connection.source)) ||
      dimmedCardIds.has(endpointId(connection.target))
    const width = connection.style.width
    const size = arrowheadSize(width)
    const dash = dashArray(connection.style.lineStyle, width)
    const headStart = arrowheadPath(
      geometry.start,
      { x: -geometry.startDir.x, y: -geometry.startDir.y },
      connection.style.arrowStart,
      size,
    )
    const headEnd = arrowheadPath(geometry.end, geometry.endDir, connection.style.arrowEnd, size)

    return [
      {
        connection,
        geometry,
        selected,
        dimmed,
        dash,
        headStart,
        headEnd,
        size,
      },
    ]
  })

  return (
    <>
      <svg className="cc-edges" aria-hidden="true">
        {rendered.map(({ connection, geometry, selected, dimmed, dash, headStart, headEnd }) => {
          const { style } = connection
          const common = {
            fill: 'none' as const,
            strokeLinecap: (style.lineStyle === 'dotted' ? 'round' : 'butt') as 'round' | 'butt',
          }
          return (
            <g
              key={connection.id}
              className="cc-edge-selectable"
              opacity={dimmed ? 0.18 : 1}
              style={{ transition: 'opacity 150ms ease' }}
              data-connection-id={connection.id}
            >
              <path
                className="cc-hit"
                d={geometry.path}
                onPointerDown={(event: ReactPointerEvent<SVGPathElement>) => {
                  event.stopPropagation()
                  onSelect(connection.id, event.shiftKey)
                }}
                onContextMenu={(event) => onContextMenu(event, connection.id)}
              />
              {selected ? (
                <path
                  d={geometry.path}
                  stroke={SELECT_COLOR}
                  strokeWidth={style.width + 7}
                  strokeOpacity={0.28}
                  strokeLinecap="round"
                  fill="none"
                />
              ) : null}
              <path
                className="cc-edge-line"
                d={geometry.path}
                stroke={style.color}
                strokeWidth={style.width}
                strokeDasharray={dash ?? undefined}
                {...common}
              />
              {style.animated ? (
                <path
                  className="cc-flow"
                  d={geometry.path}
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth={Math.max(style.width - 0.5, 1)}
                  strokeDasharray={style.lineStyle === 'solid' ? flowDashArray(style.width) : dash ?? undefined}
                  fill="none"
                  style={
                    {
                      '--cc-period': `${flowPeriod(style.width)}px`,
                      animationDuration: style.lineStyle === 'solid' ? '1.5s' : '1.1s',
                    } as CSSProperties
                  }
                />
              ) : null}
              {headStart ? (
                <path
                  d={headStart.d}
                  fill={headStart.filled ? style.color : 'none'}
                  stroke={headStart.filled ? 'none' : style.color}
                  strokeWidth={headStart.filled ? 0 : Math.max(style.width, 1.5)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {headEnd ? (
                <path
                  d={headEnd.d}
                  fill={headEnd.filled ? style.color : 'none'}
                  stroke={headEnd.filled ? 'none' : style.color}
                  strokeWidth={headEnd.filled ? 0 : Math.max(style.width, 1.5)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </g>
          )
        })}

        {draft ? <DraftEdge draft={draft} cards={cards} /> : null}
      </svg>

      <div className="cc-edge-layer">
        {rendered.map(({ connection, geometry, selected, dimmed }) => {
          const text = connection.label || connection.relationshipType
          if (!text && editingLabelId !== connection.id) return null
          return (
            <div
              key={`label-${connection.id}`}
              className="cc-edge-label"
              data-selected={selected ? 'true' : undefined}
              style={
                {
                  left: geometry.midpoint.x,
                  top: geometry.midpoint.y,
                  opacity: dimmed ? 0.2 : 1,
                  '--label-border': selected ? SELECT_COLOR : `${connection.style.color}55`,
                  '--label-bg': '#ffffff',
                  '--label-fg': connection.style.color,
                } as CSSProperties
              }
              title={`${connection.relationshipType}${connection.label ? ` — ${connection.label}` : ''}`}
              onPointerDown={(event) => {
                event.stopPropagation()
                onSelect(connection.id, event.shiftKey)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                setEditingLabelId(connection.id)
              }}
            >
              {editingLabelId === connection.id ? (
                <input
                  ref={inputRef}
                  defaultValue={connection.label}
                  className="w-full bg-transparent text-[11px] outline-none"
                  style={{ color: connection.style.color }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    onLabelChange(connection.id, event.target.value)
                    setEditingLabelId(null)
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
                  }}
                />
              ) : (
                <span className="truncate">{text || 'label'}</span>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function DraftEdge({ draft, cards }: { draft: DraftConnection; cards: Map<string, Element> }) {
  const source = cards.get(draft.sourceElementId)
  if (!source) return null
  const target = draft.targetElementId ? cards.get(draft.targetElementId) : null

  const from = anchorPoint(visualRectOf(source), draft.sourceAnchor)
  const to = target && draft.targetAnchor ? anchorPoint(visualRectOf(target), draft.targetAnchor) : draft.to

  const head = arrowheadPath(to, { x: to.x - from.x, y: to.y - from.y }, 'triangle', 12)
  const valid = Boolean(target)

  return (
    <g pointerEvents="none">
      <path
        d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
        stroke={valid ? '#6366F1' : '#94A3B8'}
        strokeWidth={2}
        strokeDasharray="6 5"
        fill="none"
      />
      {head ? (
        <path d={head.d} fill={valid ? '#6366F1' : '#94A3B8'} opacity={valid ? 1 : 0.6} />
      ) : null}
    </g>
  )
}

export const ConnectionLayer = memo(ConnectionLayerImpl)
