import { anchorNormal, anchorPoint, autoAnchors, rectCenter } from '@/utils/geometry'
import { type Anchor, type ArrowStyle, type Point, type Rect, type Routing } from '@/types'

/**
 * Edge geometry.
 *
 * Connections store only card ids + anchors. Every path is recomputed from the
 * live card rectangles on each render, which is what keeps an edge glued to its
 * cards while they are dragged or resized.
 *
 * Two intermediate representations are used:
 *  - `poly`   : an orthogonal/2-point polyline (straight + stepped)
 *  - `bezier` : a single cubic segment (curved)
 *
 * A "shape" is built at the card borders and may then be trimmed so the stroke
 * never pokes through an arrowhead.
 */

type Bezier = { p0: Point; c1: Point; c2: Point; p1: Point }
type Shape =
  | { kind: 'poly'; points: Point[] }
  | { kind: 'bezier'; curve: Bezier }

export interface EdgeGeometry {
  /** SVG path data in world coordinates. */
  path: string
  /** Where the label chip and the selection handle sit. */
  midpoint: Point
  /** Where the edge meets the source card. */
  start: Point
  /** Where the edge meets the target card. */
  end: Point
  /** Unit vector leaving the source card. */
  startDir: Point
  /** Unit vector leaving the target card. */
  endDir: Point
}

const STEP_STUB = 26
const FILLET = 10
const EPS = 0.25

function near(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
}

function add(p: Point, d: Point, scale = 1): Point {
  return { x: p.x + d.x * scale, y: p.y + d.y * scale }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y)
  if (len < 1e-6) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

function perpendicular(v: Point): Point {
  return { x: -v.y, y: v.x }
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** Removes duplicate and collinear points from a polyline. */
function cleanPolyline(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    if (out.length === 0 || !near(out[out.length - 1], p)) out.push(p)
  }
  const result: Point[] = []
  for (let i = 0; i < out.length; i++) {
    if (i === 0 || i === out.length - 1) {
      result.push(out[i])
      continue
    }
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(cross) > EPS) result.push(b)
  }
  return result
}

function pointToward(from: Point, toward: Point, amount: number): Point {
  const dir = normalize({ x: toward.x - from.x, y: toward.y - from.y })
  return add(from, dir, amount)
}

/** Builds a path with rounded corners, but only for real corners. */
function polylineToPath(points: Point[], radius = FILLET): string {
  if (points.length < 2) return ''
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const inLen = dist(prev, cur)
    const outLen = dist(cur, next)
    if (inLen < EPS || outLen < EPS) continue
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const a = pointToward(cur, prev, r)
    const b = pointToward(cur, next, r)
    d += ` L ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(b.x)} ${fmt(b.y)}`
  }
  const last = points[points.length - 1]
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`
  return d
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function bezierPoint(c: Bezier, t: number): Point {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const d = 3 * u * t * t
  const e = t * t * t
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p1.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p1.y,
  }
}

function bezierTangent(c: Bezier, t: number): Point {
  const u = 1 - t
  const x = 3 * u * u * (c.c1.x - c.p0.x) + 6 * u * t * (c.c2.x - c.c1.x) + 3 * t * t * (c.p1.x - c.c2.x)
  const y = 3 * u * u * (c.c1.y - c.p0.y) + 6 * u * t * (c.c2.y - c.c1.y) + 3 * t * t * (c.p1.y - c.c2.y)
  return { x, y }
}

function splitBezier(c: Bezier, t: number): [Bezier, Bezier] {
  const p01 = lerp(c.p0, c.c1, t)
  const p12 = lerp(c.c1, c.c2, t)
  const p23 = lerp(c.c2, c.p1, t)
  const p012 = lerp(p01, p12, t)
  const p123 = lerp(p12, p23, t)
  const mid = lerp(p012, p123, t)
  return [
    { p0: c.p0, c1: p01, c2: p012, p1: mid },
    { p0: mid, c1: p123, c2: p23, p1: c.p1 },
  ]
}

/* ------------------------------------------------------------------ */
/* Shape construction                                                 */
/* ------------------------------------------------------------------ */

function straightShape(p0: Point, p1: Point): Shape {
  return { kind: 'poly', points: [p0, p1] }
}

function steppedShape(p0: Point, n0: Point, p1: Point, n1: Point): Shape {
  const a = add(p0, n0, STEP_STUB)
  const b = add(p1, n1, -STEP_STUB)
  const h0 = n0.x !== 0
  const h1 = n1.x !== 0
  let points: Point[]
  if (h0 && h1) {
    const mid = (a.x + b.x) / 2
    points = [p0, a, { x: mid, y: a.y }, { x: mid, y: b.y }, b, p1]
  } else if (!h0 && !h1) {
    const mid = (a.y + b.y) / 2
    points = [p0, a, { x: a.x, y: mid }, { x: b.x, y: mid }, b, p1]
  } else {
    points = [p0, a, { x: a.x, y: b.y }, b, p1]
  }
  return { kind: 'poly', points: cleanPolyline(points) }
}

function curvedShape(p0: Point, n0: Point, p1: Point, n1: Point): Shape {
  const span = dist(p0, p1)
  const facing = n0.x * n1.x + n0.y * n1.y < -0.5
  const sameSide = n0.x * n1.x + n0.y * n1.y > 0.5

  if (facing) {
    const offset = Math.min(Math.max(span * 0.45, 40), 220)
    return {
      kind: 'bezier',
      curve: { p0, c1: add(p0, n0, offset), c2: add(p1, n1, offset), p1 },
    }
  }

  if (sameSide) {
    // Both cards leave from the same side: swing out and loop back around.
    const offset = Math.min(Math.max(span * 0.4, 60), 200)
    const side = perpendicular(n0)
    const swing = offset * 0.75
    return {
      kind: 'bezier',
      curve: {
        p0,
        c1: add(add(p0, n0, offset), side, swing),
        c2: add(add(p1, n1, offset), side, swing),
        p1,
      },
    }
  }

  const offset = Math.min(Math.max(span * 0.5, 40), 200)
  return { kind: 'bezier', curve: { p0, c1: add(p0, n0, offset), c2: add(p1, n1, offset), p1 } }
}

/* ------------------------------------------------------------------ */
/* Trimming & sampling                                                */
/* ------------------------------------------------------------------ */

function trimPolyline(points: Point[], startTrim: number, endTrim: number): Point[] {
  const total = points.reduce((sum, p, i) => (i === 0 ? 0 : sum + dist(points[i - 1], p)), 0)
  if (startTrim + endTrim >= total || total < EPS) return points

  const out: Point[] = []
  let travelled = 0
  let index = 0

  // Walk to the start offset.
  while (index < points.length - 1) {
    const seg = dist(points[index], points[index + 1])
    if (travelled + seg >= startTrim) {
      out.push(pointToward(points[index], points[index + 1], startTrim - travelled))
      break
    }
    travelled += seg
    index += 1
  }

  // Keep interior vertices until the end offset.
  for (let i = index + 1; i < points.length - 1; i++) {
    if (travelled >= total - endTrim) break
    out.push(points[i])
    travelled += dist(points[i - 1], points[i])
  }

  // Walk back to the end offset.
  for (let i = points.length - 1; i > 0; i--) {
    const seg = dist(points[i - 1], points[i])
    if (travelled + seg >= total - endTrim) {
      out.push(pointToward(points[i], points[i - 1], travelled + seg - (total - endTrim)))
      break
    }
    travelled += seg
  }

  return cleanPolyline(out)
}

function trimShape(shape: Shape, startTrim: number, endTrim: number): Shape {
  if (startTrim <= 0 && endTrim <= 0) return shape
  if (shape.kind === 'poly') {
    return { kind: 'poly', points: trimPolyline(shape.points, startTrim, endTrim) }
  }
  const { curve } = shape
  const startSpeed = Math.hypot(curve.c1.x - curve.p0.x, curve.c1.y - curve.p0.y) * 3
  const endSpeed = Math.hypot(curve.p1.x - curve.c2.x, curve.p1.y - curve.c2.y) * 3
  const t0 = startSpeed > 0 ? Math.min(startTrim / startSpeed, 0.45) : 0
  const t1 = endSpeed > 0 ? Math.min(endTrim / endSpeed, 0.45) : 0
  let result = curve
  if (t1 > 0) result = splitBezier(result, 1 - t1)[0]
  if (t0 > 0) result = splitBezier(result, t0)[1]
  return { kind: 'bezier', curve: result }
}

function shapePath(shape: Shape): string {
  if (shape.kind === 'poly') return polylineToPath(shape.points)
  const { curve } = shape
  return `M ${fmt(curve.p0.x)} ${fmt(curve.p0.y)} C ${fmt(curve.c1.x)} ${fmt(curve.c1.y)} ${fmt(curve.c2.x)} ${fmt(curve.c2.y)} ${fmt(curve.p1.x)} ${fmt(curve.p1.y)}`
}

function shapeMidpoint(shape: Shape): Point {
  if (shape.kind === 'poly') {
    const { points } = shape
    let total = 0
    for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i])
    let travelled = 0
    for (let i = 1; i < points.length; i++) {
      const seg = dist(points[i - 1], points[i])
      if (travelled + seg >= total / 2) {
        return pointToward(points[i - 1], points[i], total / 2 - travelled)
      }
      travelled += seg
    }
    return points[Math.floor(points.length / 2)]
  }
  return bezierPoint(shape.curve, 0.5)
}

function shapeStart(shape: Shape): Point {
  return shape.kind === 'poly' ? shape.points[0] : shape.curve.p0
}

function shapeEnd(shape: Shape): Point {
  return shape.kind === 'poly' ? shape.points[shape.points.length - 1] : shape.curve.p1
}

function shapeStartDir(shape: Shape): Point {
  if (shape.kind === 'poly') {
    return normalize({ x: shape.points[1].x - shape.points[0].x, y: shape.points[1].y - shape.points[0].y })
  }
  return normalize(bezierTangent(shape.curve, 0))
}

function shapeEndDir(shape: Shape): Point {
  if (shape.kind === 'poly') {
    const p = shape.points
    return normalize({ x: p[p.length - 1].x - p[p.length - 2].x, y: p[p.length - 1].y - p[p.length - 2].y })
  }
  return normalize(bezierTangent(shape.curve, 1))
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

export interface BuildEdgeOptions {
  source: Rect
  target: Rect
  sourceAnchor: Anchor | null
  targetAnchor: Anchor | null
  routing: Routing
  arrowStart: ArrowStyle
  arrowEnd: ArrowStyle
  width: number
}

export function buildEdgeGeometry(options: BuildEdgeOptions): EdgeGeometry {
  const { source, target, routing, arrowStart, arrowEnd } = options
  const anchors = autoAnchors(source, target)
  const sourceSide = options.sourceAnchor ?? anchors.source
  const targetSide = options.targetAnchor ?? anchors.target

  const p0 = anchorPoint(source, sourceSide)
  const p1 = anchorPoint(target, targetSide)
  const n0 = anchorNormal(sourceSide)
  const n1 = anchorNormal(targetSide)

  let shape: Shape
  switch (routing) {
    case 'straight':
      shape = straightShape(p0, p1)
      break
    case 'stepped':
      shape = steppedShape(p0, n0, p1, n1)
      break
    case 'curved':
    default:
      shape = curvedShape(p0, n0, p1, n1)
      break
  }

  shape = trimShape(shape, trimFor(arrowStart), trimFor(arrowEnd))

  return {
    path: shapePath(shape),
    midpoint: shapeMidpoint(shape),
    start: shapeStart(shape),
    end: shapeEnd(shape),
    startDir: shapeStartDir(shape),
    endDir: shapeEndDir(shape),
  }
}

export function arrowheadSize(width: number): number {
  return Math.min(Math.max(width * 5, 11), 20)
}

/**
 * Filled arrowheads simply cover the end of the stroke, so only the open
 * "arrow" chevron needs the line pulled back a touch.
 */
function trimFor(style: ArrowStyle): number {
  return style === 'arrow' ? 2 : 0
}

/** SVG path data for an arrowhead drawn at `point` heading along `dir`. */
export function arrowheadPath(
  point: Point,
  dir: Point,
  style: ArrowStyle,
  size: number,
): { d: string; filled: boolean } | null {
  if (style === 'none') return null
  const d = normalize(dir)
  if (d.x === 0 && d.y === 0) return null
  const n = perpendicular(d)

  switch (style) {
    case 'arrow': {
      const back = size * 0.9
      const wing = size * 0.42
      const a = { x: point.x - d.x * back + n.x * wing, y: point.y - d.y * back + n.y * wing }
      const b = { x: point.x - d.x * back - n.x * wing, y: point.y - d.y * back - n.y * wing }
      return {
        d: `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(point.x)} ${fmt(point.y)} L ${fmt(b.x)} ${fmt(b.y)}`,
        filled: false,
      }
    }
    case 'triangle': {
      const base = 0.85
      const half = 0.5
      const a = { x: point.x - d.x * size * base + n.x * size * half, y: point.y - d.y * size * base + n.y * size * half }
      const b = { x: point.x - d.x * size * base - n.x * size * half, y: point.y - d.y * size * base - n.y * size * half }
      return { d: `M ${fmt(point.x)} ${fmt(point.y)} L ${fmt(a.x)} ${fmt(a.y)} L ${fmt(b.x)} ${fmt(b.y)} Z`, filled: true }
    }
    case 'diamond': {
      const half = 0.42
      const depth = 1.15
      const a = { x: point.x - d.x * size * depth, y: point.y - d.y * size * depth }
      const b = {
        x: point.x - d.x * size * half + n.x * size * half,
        y: point.y - d.y * size * half + n.y * size * half,
      }
      const c = {
        x: point.x - d.x * size * half - n.x * size * half,
        y: point.y - d.y * size * half - n.y * size * half,
      }
      return { d: `M ${fmt(point.x)} ${fmt(point.y)} L ${fmt(b.x)} ${fmt(b.y)} L ${fmt(a.x)} ${fmt(a.y)} L ${fmt(c.x)} ${fmt(c.y)} Z`, filled: true }
    }
    case 'circle':
      return { d: `M ${fmt(point.x - size * 0.34)} ${fmt(point.y)} a ${fmt(size * 0.34)} ${fmt(size * 0.34)} 0 1 0 ${fmt(size * 0.68)} 0 a ${fmt(size * 0.34)} ${fmt(size * 0.34)} 0 1 0 ${fmt(-size * 0.68)} 0 Z`, filled: true }
    default:
      return null
  }
}

/** `stroke-dasharray` for a line style. Returns null for solid lines. */
export function dashArray(lineStyle: 'solid' | 'dashed' | 'dotted', width: number): string | null {
  switch (lineStyle) {
    case 'dashed':
      return `${fmt(width * 5)} ${fmt(width * 4)}`
    case 'dotted':
      return `0.01 ${fmt(width * 3.4)}`
    case 'solid':
    default:
      return null
  }
}

/** Dash pattern used for the animated flow overlay on solid lines. */
export function flowDashArray(width: number): string {
  return `${fmt(width * 1.6)} ${fmt(width * 3.4)}`
}

/** One full cycle of the flow pattern, so the animation loops seamlessly. */
export function flowPeriod(width: number): number {
  return width * 5
}

export { rectCenter }
