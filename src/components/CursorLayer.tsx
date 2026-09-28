import { useEffect, useRef } from 'react'

import { firstNameOf, usePresence } from '@/store/presence'
import { useCanvasStore } from '@/store/useCanvasStore'
import { centerOn, worldToScreen } from '@/utils/geometry'
import type { Point } from '@/types'

/**
 * Other people's pointers.
 *
 * Positions arrive in **world** coordinates, so each one is placed with this
 * client's own viewport — a cursor sits over the same card for everyone, even
 * when they have panned or zoomed differently.
 *
 * The layer sits above the cards and takes no pointer events, so it never
 * interferes with dragging or selecting.
 */
export function CursorLayer() {
  const entries = usePresence((s) => s.entries)
  const followingId = usePresence((s) => s.followingId)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const viewport = useCanvasStore((s) => {
    const page = s.doc.pages.find((p) => p.id === s.activePageId)
    return page?.viewport ?? { x: 0, y: 0, zoom: 1 }
  })
  const spacePressed = useCanvasStore((s) => s.spacePressed)

  // The followed person's latest position, read without re-rendering on every
  // unrelated store change.
  const following = entries.find((entry) => entry.userId === followingId)
  const cursor = following?.cursor ?? null
  const cursorPageId = following?.pageId ?? null
  const lastFollowed = useRef<Point | null>(null)

  useEffect(() => {
    lastFollowed.current = null
  }, [followingId])

  useEffect(() => {
    if (!cursor || cursorPageId !== activePageId) return
    if (spacePressed) return // the user is panning; do not fight them

    // Act only when the pointer has really moved. Without this, the viewport
    // change we make re-triggers the effect and keeps nudging the canvas.
    const previous = lastFollowed.current
    if (previous && previous.x === cursor.x && previous.y === cursor.y) return
    lastFollowed.current = cursor

    const store = useCanvasStore.getState()
    const page = store.doc.pages.find((p) => p.id === activePageId)
    if (!page) return

    store.setViewport(centerOn(cursor, store.viewportSize, page.viewport.zoom))
  }, [cursor, cursorPageId, activePageId, spacePressed])

  const visible = entries.filter(
    (entry) => entry.cursor && entry.pageId === activePageId,
  )

  if (visible.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {visible.map((entry) => {
        const point = worldToScreen(entry.cursor as Point, viewport)
        return (
          <div
            key={entry.userId}
            className="absolute left-0 top-0 transition-transform duration-75 ease-out"
            style={{ transform: `translate3d(${point.x}px, ${point.y}px, 0)` }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-sm">
              <path
                d="M2 1.5 L2 14 L5.6 10.6 L8 15.4 L10.4 14.2 L8 9.5 L12.8 9.3 Z"
                fill={entry.color}
                stroke="#ffffff"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="absolute left-3 top-4 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold text-white shadow-sm"
              style={{ background: entry.color }}
            >
              {firstNameOf(entry.name)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
