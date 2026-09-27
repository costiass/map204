import {
  COLLAPSED_HEADER_HEIGHT,
  DEFAULT_GRID_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  type Anchor,
  type Point,
  type Rect,
  type Viewport,
} from '@/types'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM)
}

export function snap(value: number, gridSize = DEFAULT_GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize
}

export function cardRect(card: { position: Rect }): Rect {
  const { x, y, width, height } = card.position
  return { x, y, width, height }
}

/**
 * Visual rect of a card — when collapsed, uses the collapsed header height
 * so connection endpoints point to the visible middle of the collapsed card.
 */
export function visualCardRect(card: { position: Rect; collapsed?: boolean }): Rect {
  const { x, y, width, height } = card.position
  if (card.collapsed) {
    return { x, y, width, height: COLLAPSED_HEADER_HEIGHT }
  }
  return { x, y, width, height }
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export function rectRight(rect: Rect): number {
  return rect.x + rect.width
}

export function rectBottom(rect: Rect): number {
  return rect.y + rect.height
}

/** Outward unit normal for an anchor side. */
export function anchorNormal(anchor: Anchor): Point {
  switch (anchor) {
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
  }
}

/** World-space point on a card border for the given side. */
export function anchorPoint(rect: Rect, anchor: Anchor): Point {
  switch (anchor) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y }
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height }
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 }
    case 'right':
      return { x: rectRight(rect), y: rect.y + rect.height / 2 }
  }
}

/** Which side of `rect` a world point is closest to. */
export function nearestAnchor(rect: Rect, point: Point): Anchor {
  const distances: Array<[Anchor, number]> = [
    ['left', Math.abs(point.x - rect.x)],
    ['right', Math.abs(point.x - rectRight(rect))],
    ['top', Math.abs(point.y - rect.y)],
    ['bottom', Math.abs(point.y - rectBottom(rect))],
  ]
  distances.sort((a, b) => a[1] - b[1])
  return distances[0][0]
}

/**
 * Choose sensible sides for an edge when the user has not pinned them:
 * the dominant axis between the two cards decides the exit/entry sides.
 * For collapsed cards (short height), always use left/right anchors so
 * connection dots stay on the side, not at the bottom corners.
 */
export function autoAnchors(source: Rect, target: Rect): { source: Anchor; target: Anchor } {
  const a = rectCenter(source)
  const b = rectCenter(target)
  const dx = b.x - a.x
  const dy = b.y - a.y

  // If either card is short (collapsed), prefer left/right anchors.
  const shortThreshold = 80
  if (source.height < shortThreshold || target.height < shortThreshold) {
    return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' }
  }

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' }
  }
  return dy >= 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' }
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  }
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  }
}

/** Converts a screen-space delta into world-space (zoom-aware) units. */
export function screenDeltaToWorld(dx: number, dy: number, zoom: number): Point {
  return { x: dx / zoom, y: dy / zoom }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y)
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export interface ViewportSize {
  width: number
  height: number
  offsetX?: number
  offsetY?: number
}

/** Viewport that frames every rect with a comfortable margin. */
export function fitViewport(bounds: Rect | null, size: ViewportSize, padding = 80): Viewport {
  if (!bounds || size.width <= 0 || size.height <= 0) {
    return { x: 0, y: 0, zoom: 1 }
  }
  const available = {
    width: Math.max(80, size.width - padding * 2),
    height: Math.max(80, size.height - padding * 2),
  }
  const zoom = clampZoom(
    Math.min(available.width / Math.max(1, bounds.width), available.height / Math.max(1, bounds.height), 1),
  )
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return {
    x: size.width / 2 - centerX * zoom,
    y: size.height / 2 - centerY * zoom,
    zoom,
  }
}

export function zoomAtPoint(viewport: Viewport, screenPoint: Point, nextZoom: number): Viewport {
  const zoom = clampZoom(nextZoom)
  // Keep the world point under the cursor pinned to the same screen position.
  const world = screenToWorld(screenPoint, viewport)
  return {
    x: screenPoint.x - world.x * zoom,
    y: screenPoint.y - world.y * zoom,
    zoom,
  }
}

/** Viewport that places a world point in the middle of the canvas. */
export function centerOn(point: Point, size: ViewportSize, zoom: number): Viewport {
  const z = clampZoom(zoom)
  // Account for the canvas offset from the viewport origin (e.g., below a toolbar).
  const offsetX = size.offsetX ?? 0
  const offsetY = size.offsetY ?? 0
  return {
    x: offsetX + size.width / 2 - point.x * z,
    y: offsetY + size.height / 2 - point.y * z,
    zoom: z,
  }
}
