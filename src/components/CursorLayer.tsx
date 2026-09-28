import { useEffect, useRef } from 'react'
import { MousePointer2 } from 'lucide-react'

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
 * This renders as a sibling of the transformed `.cc-world`, not inside it. The
 * world element already applies the pan and zoom, so placing screen-space
 * coordinates inside it would scale them twice; and because `.cc-world` is
 * sized by its children rather than filling the canvas, an absolutely
 * positioned overlay inside it has no area to sit in at all. Both faults are
 * invisible in the code and produce a layer that renders nothing.
 *
 * It takes no pointer events, so it never interferes with dragging or selecting.
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
    if (!cursor) return
    if (spacePressed) return // the user is panning; do not fight them

    // Act only when the pointer has really moved. Without this, the viewport
    // change we make re-triggers the effect and keeps nudging the canvas.
    const previous = lastFollowed.current
    if (previous && previous.x === cursor.x && previous.y === cursor.y) return
    lastFollowed.current = cursor

    // Following somebody who is on another page means going to that page, not
    // centring on coordinates that mean nothing here. Every page is its own
    // coordinate space, so the same numbers describe different cards.
    if (cursorPageId !== activePageId) {
      if (cursorPageId && useCanvasStore.getState().doc.pages.some((p) => p.id === cursorPageId)) {
        useCanvasStore.getState().setActivePage(cursorPageId)
      }
      return
    }

    const store = useCanvasStore.getState()
    const page = store.doc.pages.find((p) => p.id === activePageId)
    if (!page) return

    store.setViewport(centerOn(cursor, store.viewportSize, page.viewport.zoom))
  }, [cursor, cursorPageId, activePageId, spacePressed])

  // A pointer is only meaningful on the page its owner is looking at. Somebody
  // browsing another page still appears in the avatar cluster and beside that
  // page in the sidebar, just not on this canvas.
  const visible = entries.filter(
    (entry) => entry.cursor && entry.pageId === activePageId,
  )

  if (visible.length === 0) return null

  // A gentle size cue, and no more than that.
  //
  // This layer sits *outside* the transformed `.cc-world`, so a pointer is not
  // scaled by the zoom at all and stays a constant size — which is right, and is
  // what most collaborative editors do. An earlier version compensated with
  // `scale(1 / zoom)`, which was a leftover from when the layer was inside the
  // transform; at 10% zoom that made a pointer ten times *larger*.
  //
  // A small reduction when zoomed out is still worth having: it reads as depth
  // rather than as a bug, and keeps a pointer from looking heavier than the card
  // it is pointing at. The exponent is low on purpose, so the range is narrow —
  // this is a hint, not a second zoom control.
  const pointerScale = Math.min(1, Math.max(0.78, viewport.zoom ** 0.2))

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[9997] overflow-hidden"
      aria-hidden="true"
    >
      {visible.map((entry) => {
        const point = worldToScreen(entry.cursor as Point, viewport)
        return (
          <div
            key={entry.userId}
            className="absolute left-0 top-0 origin-top-left transition-transform duration-75 ease-out"
            style={{
              transform: `translate3d(${point.x}px, ${point.y}px, 0) scale(${pointerScale})`,
            }}
          >
            {/* The lucide pointer, filled in that person's colour and outlined
                in white so it stays legible over a card of any shade. */}
            <MousePointer2
              size={20}
              className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
              style={{ color: entry.color, fill: entry.color, stroke: '#ffffff' }}
              strokeWidth={1.75}
            />

            {/* Name chip, tucked under the point of the pointer. */}
            <span
              className="absolute left-4 top-5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold text-white shadow-sm"
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
