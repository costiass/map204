import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { ElementNode } from '@/components/ElementNode'
import { ConnectionLayer } from '@/components/ConnectionLayer'
import { CursorLayer } from '@/components/CursorLayer'
import type { DraftConnection } from '@/components/ConnectionLayer'
import { GroupNode } from '@/components/GroupNode'
import { useCanvasStore } from '@/store/useCanvasStore'
import {
  MAX_CARD_HEIGHT,
  MAX_CARD_WIDTH,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  type Anchor,
  type Element,
  type Connection,
  type Group,
  type Point,
  type Viewport,
} from '@/types'
import {
  boundsOf,
  rectOf,
  centerOn,
  clamp,
  clampZoom,
  fitViewport,
  nearestAnchor,
  rectsIntersect,
  screenToWorld,
  snap,
  visualRectOf,
  zoomAtPoint,
} from '@/utils/geometry'
import { isFiltering, matchesFilters } from '@/utils/filters'
import { cameraCurve } from '@/utils/cameraCurves'

interface DragState {
  pointerId: number
  startWorld: Point
  primaryId: string
  ids: string[]
  moved: boolean
}

type Interaction =
  | { kind: 'idle' }
  | { kind: 'pan'; pointerId: number; startClient: Point; startViewport: Viewport }
  | DragState & { kind: 'drag' }
  | {
      kind: 'resize'
      pointerId: number
      cardId: string
      startWorld: Point
      startSize: { width: number; height: number }
    }
  | {
      kind: 'group-resize'
      pointerId: number
      groupId: string
      startWorld: Point
      startSize: { width: number; height: number }
    }
  | { kind: 'marquee'; pointerId: number; startWorld: Point; current: Point; additive: boolean }
  | {
      kind: 'connect'
      pointerId: number
      sourceElementId: string
      sourceAnchor: Anchor
      current: Point
      hoverCardId: string | null
      hoverAnchor: Anchor | null
    }

type Preview =
  | { kind: 'drag'; delta: Point; ids: string[] }
  | { kind: 'resize'; cardId: string; width: number; height: number }
  | { kind: 'group-resize'; groupId: string; width: number; height: number }
  | { kind: 'marquee'; start: Point; current: Point }
  | null

const EMPTY_SET: Set<string> = new Set()
const EMPTY_CARDS: Element[] = []
const EMPTY_GROUPS: Group[] = []
const EMPTY_CONNECTIONS: Connection[] = []

/** Minimum pixel movement before a drag starts — prevents accidental drags on click. */
const DRAG_THRESHOLD = 4

function gridBackground(pattern: 'none' | 'dots' | 'lines'): string {
  if (pattern === 'dots') {
    return 'radial-gradient(circle, rgba(100,116,139,0.38) 1px, transparent 1px)'
  }
  if (pattern === 'lines') {
    return 'linear-gradient(to right, rgba(100,116,139,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,0.16) 1px, transparent 1px)'
  }
  return 'none'
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const worldRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const activePageId = useCanvasStore((s) => s.activePageId)
  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds)
  const selectedConnectionIds = useCanvasStore((s) => s.selectedConnectionIds)
  const selectedGroupId = useCanvasStore((s) => s.selectedGroupId)
  const searchQuery = useCanvasStore((s) => s.searchQuery)
  const filterTags = useCanvasStore((s) => s.filterTags)
  const filterColor = useCanvasStore((s) => s.filterColor)
  const gridPattern = useCanvasStore((s) => s.gridPattern)
  const gridSize = useCanvasStore((s) => s.gridSize)
  const snapToGrid = useCanvasStore((s) => s.snapToGrid)
  const spacePressed = useCanvasStore((s) => s.spacePressed)

  const cards = page?.elements ?? EMPTY_CARDS
  const groups = page?.groups ?? EMPTY_GROUPS
  const connections = page?.connections ?? EMPTY_CONNECTIONS

  const cardMap = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const groupMap = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])

  /**
   * Which elements sit inside which group, by title.
   *
   * This used to be built from each card's `parentId`, which was the old way of
   * saying "this is inside that". A group is that now, and it says so in
   * `memberIds` — so the nesting a card shows is the nesting a group defines,
   * and there is no second opinion to disagree with it.
   */
  const childrenOf = useMemo(() => {
    const map = new Map<string, string[]>()
    const byId = new Map(cards.map((card) => [card.id, card]))
    for (const group of groups) {
      const list = group.memberIds
        .map((id) => byId.get(id)?.title || 'Untitled')
      if (list.length > 0) map.set(group.id, list)
    }
    return map
  }, [cards, groups])

  const filterDimmedCardIds = useMemo(() => {
    const filters = { query: searchQuery, tags: filterTags, color: filterColor }
    if (!isFiltering(filters)) return EMPTY_SET
    const set = new Set<string>()
    for (const card of cards) {
      if (!matchesFilters(card, filters)) set.add(card.id)
    }
    return set
  }, [cards, searchQuery, filterTags, filterColor])

  // A running step can dim everything it is not pointing at, which is a
  // different thing from a search filter and lives somewhere else entirely: the
  // filter is a thing the reader asked for, this is a thing the presentation
  // decided, and they must not cancel each other out.
  const focusTargetId = useCanvasStore((s) => s.focusTargetId)
  const focusMode = useCanvasStore((s) => s.focusMode)
  const presenting = useCanvasStore((s) => s.presenting)

  /**
   * The grid is part of the editor, not part of the map.
   *
   * Dots and lines are the thing that tells you where a card *is* while you are
   * arranging it, and they are the first thing in the way when somebody is
   * presenting the map to a room — a screen of faint dots is a screen of visual
   * noise behind the thing being talked about.
   *
   * The canvas is blank while presenting, and the chrome is hidden, so what is
   * left is the map on the page colour: no grid, no toolbar, no inspector, no
   * sidebar.
   */
  const showGrid = gridPattern !== 'none' && !presenting
  // `spotlight` dims the rest *and* rings the target; `dim` only dims. Ringed
  // only when the step asked for it, because a ring the step did not ask for
  // is a second thing competing for the eye it is meant to direct.
  const spotlightId = presenting && focusMode === 'spotlight' ? focusTargetId : null

  const dimmedCardIds = useMemo(() => {
    if (presenting && focusTargetId) {
      const set = new Set<string>()
      for (const card of cards) {
        if (card.id !== focusTargetId) set.add(card.id)
      }
      return set
    }
    return filterDimmedCardIds
  }, [cards, presenting, focusTargetId, filterDimmedCardIds])

  /* ---------------------------------------------------------------- */
  /* viewport                                                         */
  /* ---------------------------------------------------------------- */

  // Pan and zoom are written straight to the DOM (no React re-render per frame)
  // and mirrored in this ref, so any later render still reads a live viewport.
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 })
  const bootstrapped = useRef(false)
  if (!bootstrapped.current) {
    viewportRef.current = { ...(page?.viewport ?? { x: 0, y: 0, zoom: 1 }) }
    bootstrapped.current = true
  }

  const panFrame = useRef<number | null>(null)
  const cancelViewportAnimation = useCallback(() => {
    if (panFrame.current !== null) {
      cancelAnimationFrame(panFrame.current)
      panFrame.current = null
    }
  }, [])

  const commitTimer = useRef<number | null>(null)
  const commitViewport = useCallback((immediate = false) => {
    if (commitTimer.current !== null) {
      window.clearTimeout(commitTimer.current)
      commitTimer.current = null
    }
    const write = () => {
      useCanvasStore.getState().setViewport({ ...viewportRef.current })
    }
    if (immediate) {
      write()
      return
    }
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null
      write()
    }, 200)
  }, [])

  const applyViewport = useCallback(() => {
    const { x, y, zoom } = viewportRef.current
    const world = worldRef.current
    if (world) world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`
    const grid = gridRef.current
    if (grid) {
      // Read from the store rather than closing over the render's value: this
      // runs once per frame from an animation, and a captured `presenting` would
      // be whatever it was when the frame started. Starting a presentation and
      // then panning has to show a blank background on the first frame.
      const { gridPattern: pattern, gridSize: size, presenting: isPresenting } =
        useCanvasStore.getState()
      if (isPresenting || pattern === 'none') {
        grid.style.backgroundImage = 'none'
        return
      }
      const step = Math.max(6, size * zoom)
      grid.style.backgroundImage = gridBackground(pattern)
      grid.style.backgroundSize = `${step}px ${step}px`
      grid.style.backgroundPosition = `${x}px ${y}px`
    }
  }, [])

  /* ---------------------------------------------------------------- */
  /* the camera, on request                                            */
  /* ---------------------------------------------------------------- */

  // The store asks for a move; the canvas carries it out. The animation is
  // frame-by-frame on the same ref the drag uses, so a step can interrupt a pan
  // and a pan can interrupt a step without either leaving the canvas halfway.
  const cameraRequest = useCanvasStore((s) => s.cameraRequest)
  useEffect(() => {
    if (cameraRequest.token === 0) return
    cancelViewportAnimation()

    const from = { ...viewportRef.current }
    const to = cameraRequest.viewport
    const duration = cameraRequest.durationMs

    // A zero-length move, or one already there, would otherwise spin a
    // cancellation frame for nothing.
    if (
      duration <= 0 ||
      (Math.abs(from.x - to.x) < 0.5 &&
        Math.abs(from.y - to.y) < 0.5 &&
        Math.abs(from.zoom - to.zoom) < 0.001)
    ) {
      viewportRef.current = to
      applyViewport()
      commitViewport(true)
      return
    }

    const started = performance.now()
    const curve = cameraCurve(cameraRequest.transition)
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      const eased = curve(t)

      viewportRef.current = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        zoom: from.zoom * (to.zoom / from.zoom) ** eased,
      }
      applyViewport()

      if (t < 1) {
        panFrame.current = requestAnimationFrame(tick)
      } else {
        panFrame.current = null
        commitViewport(true)
      }
    }
    panFrame.current = requestAnimationFrame(tick)

    return () => {
      if (panFrame.current !== null) {
        cancelAnimationFrame(panFrame.current)
        panFrame.current = null
      }
    }
  }, [cameraRequest, applyViewport, cancelViewportAnimation, commitViewport])

  // Switching pages swaps the viewport that is restored on the canvas.
  const previousPageId = useRef(activePageId)
  useEffect(() => {
    if (previousPageId.current === activePageId) return
    previousPageId.current = activePageId
    cancelViewportAnimation()
    const next = useCanvasStore.getState().doc.pages.find((p) => p.id === activePageId)
    if (next) viewportRef.current = { ...next.viewport }
    applyViewport()
  }, [activePageId, applyViewport, cancelViewportAnimation])

  // Follow viewport writes that come from elsewhere (search, inspector, undo).
  const storedViewport = page?.viewport
  useEffect(() => {
    if (!storedViewport) return
    if (interactionRef.current.kind !== 'idle') return
    const current = viewportRef.current
    if (
      current.x === storedViewport.x &&
      current.y === storedViewport.y &&
      current.zoom === storedViewport.zoom
    ) {
      return
    }
    // A jump from elsewhere wins over an in-flight slide: a card scrolled into
    // view by the search panel must not keep drifting afterwards.
    if (panFrame.current !== null) {
      cancelViewportAnimation()
      commitViewport(true)
      return
    }
    viewportRef.current = { ...storedViewport }
    applyViewport()
  }, [storedViewport, applyViewport, cancelViewportAnimation, commitViewport])

  /* ---------------------------------------------------------------- */
  /* sizing + initial fit                                             */
  /* ---------------------------------------------------------------- */

  const setViewportSize = useCanvasStore((s) => s.setViewportSize)
  const didInitialFit = useRef(false)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setViewportSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [setViewportSize])

  const fitView = useCallback(() => {
    const element = containerRef.current
    const state = useCanvasStore.getState()
    const target = state.doc.pages.find((p) => p.id === state.activePageId)
    if (!element) return
    cancelViewportAnimation()
    const rect = element.getBoundingClientRect()
    const bounds = boundsOf((target?.elements ?? []).map(rectOf))
    viewportRef.current = fitViewport(bounds, { width: rect.width, height: rect.height })
    applyViewport()
    commitViewport(true)
  }, [applyViewport, cancelViewportAnimation, commitViewport])

  useEffect(() => {
    if (didInitialFit.current) return
    didInitialFit.current = true
    if ((page?.elements.length ?? 0) === 0) return
    const timer = window.setTimeout(fitView, 0)
    return () => window.clearTimeout(timer)
  }, [fitView, page?.elements.length])

  const fitViewToken = useCanvasStore((s) => s.fitViewToken)
  useEffect(() => {
    if (fitViewToken === 0) return
    fitView()
  }, [fitViewToken, fitView])

  /* ---------------------------------------------------------------- */
  /* center selection on the visible canvas                             */
  /* ---------------------------------------------------------------- */

  const hasSelection = selectedElementIds.length > 0 || selectedConnectionIds.length > 0 || selectedGroupId !== null
  const prevSelectionKey = useRef<string>('')
  const centerTimer = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (!hasSelection) {
      prevSelectionKey.current = ''
      return
    }

    const store = useCanvasStore.getState()
    const page = store.doc.pages.find((p) => p.id === store.activePageId)
    const element = containerRef.current
    if (!page || !element) return

    // Build a key for the current selection to detect changes.
    const selKey = store.selectedGroupId
      ? `g:${store.selectedGroupId}`
      : store.selectedElementIds.length > 0
        ? `c:${store.selectedElementIds.join(',')}`
        : store.selectedConnectionIds.length > 0
          ? `l:${store.selectedConnectionIds.join(',')}`
          : ''

    // Skip if we already centered this exact selection.
    if (selKey && selKey === prevSelectionKey.current) return
    prevSelectionKey.current = selKey

    const rect = element.getBoundingClientRect()
    const size = { width: rect.width, height: rect.height, offsetX: rect.left, offsetY: rect.top }

    let target: { x: number; y: number; width: number; height: number } | null = null
    if (store.selectedGroupId) {
      const group = page.groups.find((g) => g.id === store.selectedGroupId)
      if (group) target = rectOf(group)
    } else if (store.selectedElementIds.length === 1) {
      const element = page.elements.find((c) => c.id === store.selectedElementIds[0])
      // The *visual* rect, so centring on a collapsed element frames the title
      // bar that is actually on screen rather than the height it would occupy
      // expanded.
      if (element) target = visualRectOf(element)
    }
    if (!target) return

    const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 }

    // Animate to center with a smooth transition.
    if (centerTimer.current !== null) {
      cancelAnimationFrame(centerTimer.current)
    }
    const from = { ...viewportRef.current }
    const to = centerOn(center, size, 1)
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced || (Math.abs(to.x - from.x) < 1 && Math.abs(to.y - from.y) < 1 && Math.abs(to.zoom - from.zoom) < 0.01)) {
      viewportRef.current = to
      applyViewport()
      commitViewport(true)
      return
    }

    const start = performance.now()
    const duration = 300
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      viewportRef.current = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        zoom: from.zoom + (to.zoom - from.zoom) * eased,
      }
      applyViewport()
      if (t < 1) {
        centerTimer.current = requestAnimationFrame(step)
      } else {
        centerTimer.current = null
        commitViewport(true)
      }
    }
    centerTimer.current = requestAnimationFrame(step)
  }, [hasSelection, selectedElementIds, selectedGroupId, applyViewport, commitViewport])

  useEffect(() => {
    return () => {
      if (centerTimer.current !== null) {
        cancelAnimationFrame(centerTimer.current)
      }
    }
  }, [])

  /* ---------------------------------------------------------------- */
  /* interaction                                                      */
  /* ---------------------------------------------------------------- */

  const interactionRef = useRef<Interaction>({ kind: 'idle' })
  const [preview, setPreviewState] = useState<Preview>(null)
  // Mirrors `preview` so pointerup always reads the newest value even if React
  // has not re-rendered yet.
  const previewRef = useRef<Preview>(null)
  const [draft, setDraft] = useState<DraftConnection | null>(null)
  const [dragging, setDragging] = useState(false)
  const [panning, setPanning] = useState(false)

  const setPreview = useCallback((value: Preview) => {
    previewRef.current = value
    setPreviewState(value)
  }, [])

  const worldPoint = useCallback((event: { clientX: number; clientY: number }): Point => {
    return screenToWorld({ x: event.clientX, y: event.clientY }, viewportRef.current)
  }, [])

  const capture = (pointerId: number) => {
    containerRef.current?.setPointerCapture(pointerId)
  }

  const beginPan = (event: ReactPointerEvent) => {
    capture(event.pointerId)
    interactionRef.current = {
      kind: 'pan',
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startViewport: { ...viewportRef.current },
    }
    setPanning(true)
  }

  const handleBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return
    const store = useCanvasStore.getState()
    cancelViewportAnimation()

    if (event.button === 1 || store.spacePressed || event.altKey) {
      event.preventDefault()
      beginPan(event)
      return
    }
    if (event.button !== 0) return

    capture(event.pointerId)
    interactionRef.current = {
      kind: 'marquee',
      pointerId: event.pointerId,
      startWorld: worldPoint(event),
      current: worldPoint(event),
      additive: event.shiftKey,
    }
    if (!event.shiftKey) store.clearSelection()
  }

  const handleGroupPointerDown = (event: ReactPointerEvent<HTMLElement>, groupId: string) => {
    if (event.button !== 0) return
    // Dimmed groups (filtered out) are not interactive.
    if (dimmedCardIds.has(groupId)) return
    // Panning is still allowed; dragging a group is not.
    if (!useCanvasStore.getState().canEdit()) {
      cancelViewportAnimation()
      if (useCanvasStore.getState().spacePressed || event.altKey) {
        event.preventDefault()
        beginPan(event)
      }
      return
    }
    cancelViewportAnimation()
    if (useCanvasStore.getState().spacePressed || event.altKey) {
      event.preventDefault()
      beginPan(event)
      return
    }
    event.stopPropagation()

    const interactive = (event.target as HTMLElement).closest('[data-no-drag]') !== null
    if (!interactive) event.preventDefault()

    const store = useCanvasStore.getState()
    const additive = event.shiftKey || event.metaKey || event.ctrlKey

    if (additive) {
      if (store.selectedGroupId === groupId) {
        store.selectGroup(null)
      } else {
        store.selectGroup(groupId)
      }
    } else if (store.selectedGroupId !== groupId) {
      store.selectGroup(groupId)
    }

    if (interactive) return

    capture(event.pointerId)
    interactionRef.current = {
      kind: 'drag',
      pointerId: event.pointerId,
      startWorld: worldPoint(event),
      primaryId: groupId,
      ids: [groupId],
      moved: false,
    }
    setDragging(true)
  }

  const handleCardPointerDown = (event: ReactPointerEvent<HTMLElement>, cardId: string) => {
    if (event.button !== 0) return
    // Dimmed cards (filtered out) are not interactive.
    if (dimmedCardIds.has(cardId)) return
    // Panning is navigation, not editing, so it stays available in every mode
    // that is not editing — reading, viewing and presenting. A camera that
    // cannot be moved is fine right up until somebody asks a question about the
    // part of the map you are not showing, and then it is the worst possible
    // thing on screen. Everything below this line moves or edits something.
    if (!useCanvasStore.getState().canEdit()) {
      cancelViewportAnimation()
      if (useCanvasStore.getState().spacePressed || event.altKey) {
        event.preventDefault()
        beginPan(event)
      }
      return
    }
    cancelViewportAnimation()
    if (useCanvasStore.getState().spacePressed || event.altKey) {
      event.preventDefault()
      beginPan(event)
      return
    }
    event.stopPropagation()

    // Clicking anywhere on the card selects it, including the body and the
    // title. Controls marked `data-no-drag` still select it but keep their own
    // click behaviour, so text can be picked out of the title without moving it.
    const interactive = (event.target as HTMLElement).closest('[data-no-drag]') !== null
    if (!interactive) event.preventDefault()

    const store = useCanvasStore.getState()
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    let ids: string[]

    if (additive) {
      store.toggleElementSelection(cardId)
      ids = useCanvasStore.getState().selectedElementIds
      if (!ids.includes(cardId)) ids = [...ids, cardId]
    } else if (store.selectedElementIds.includes(cardId)) {
      ids = store.selectedElementIds
    } else {
      store.selectElements([cardId])
      ids = [cardId]
    }

    if (interactive) return

    capture(event.pointerId)
    interactionRef.current = {
      kind: 'drag',
      pointerId: event.pointerId,
      startWorld: worldPoint(event),
      primaryId: cardId,
      ids,
      moved: false,
    }
    setDragging(true)
  }

  /**
   * The title bar: drag, and nothing else.
   *
   * Deliberately separate from `handleCardPointerDown` rather than a flag on it,
   * because the difference is not a mode -- it is a different promise. The body
   * says "press this to select it"; the title says "press and move this". Running
   * the body through the same handler is what made a drag also select the element
   * and pop the inspector open, so every reposition left you looking at a panel
   * you did not ask for.
   *
   * So this handler never touches the selection. Not on pointerdown, not on
   * release. What it moves is:
   *
   *   - the whole selection, if this element is already part of one. Dragging one
   *     member of a multi-selection and having the rest stay behind is the one
   *     surprise that would actually lose work.
   *   - otherwise just this element.
   *
   * and either way the selection afterwards is exactly the selection before.
   */
  const handleElementTitlePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    elementId: string,
  ) => {
    if (event.button !== 0) return
    if (dimmedCardIds.has(elementId)) return
    if (!useCanvasStore.getState().canEdit()) return
    cancelViewportAnimation()
    if (useCanvasStore.getState().spacePressed || event.altKey) {
      event.preventDefault()
      beginPan(event)
      return
    }

    // Stop the canvas' own pointerdown, which would otherwise read this as a
    // marquee against the background and clear the selection on release.
    event.stopPropagation()
    // A drag that turns out to be a click must not also select the text of the
    // title, or moving an element leaves a blue smudge behind.
    event.preventDefault()

    const store = useCanvasStore.getState()
    const ids = store.selectedElementIds.includes(elementId)
      ? store.selectedElementIds
      : [elementId]

    capture(event.pointerId)
    interactionRef.current = {
      kind: 'drag',
      pointerId: event.pointerId,
      startWorld: worldPoint(event),
      primaryId: elementId,
      ids,
      moved: false,
    }
    setDragging(true)
  }

  const handleGroupHandlePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    groupId: string,
    side: Anchor,
  ) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    cancelViewportAnimation()
    capture(event.pointerId)
    const start = worldPoint(event)
    interactionRef.current = {
      kind: 'connect',
      pointerId: event.pointerId,
      sourceElementId: groupId,
      sourceAnchor: side,
      current: start,
      hoverCardId: null,
      hoverAnchor: null,
    }
    setDraft({
      sourceElementId: groupId,
      sourceAnchor: side,
      from: start,
      to: start,
      targetElementId: null,
      targetAnchor: null,
    })
  }

  const handleGroupResizePointerDown = (event: ReactPointerEvent<HTMLElement>, groupId: string) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    cancelViewportAnimation()
    const group = groupMap.get(groupId)
    if (!group) return
    capture(event.pointerId)
    interactionRef.current = {
      kind: 'group-resize',
      pointerId: event.pointerId,
      groupId,
      startWorld: worldPoint(event),
      startSize: { width: group.width, height: group.height },
    }
    setDragging(true)
  }

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLElement>, cardId: string) => {
    if (event.button !== 0) return
    if (!useCanvasStore.getState().canEdit()) return
    event.stopPropagation()
    event.preventDefault()
    cancelViewportAnimation()
    const card = cardMap.get(cardId)
    if (!card) return
    capture(event.pointerId)
    interactionRef.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      cardId,
      startWorld: worldPoint(event),
      startSize: { width: card.width, height: card.height },
    }
    setDragging(true)
  }

  const handleHandlePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    cardId: string,
    side: Anchor,
  ) => {
    if (event.button !== 0) return
    // Drawing a new link is an edit, not a look.
    if (!useCanvasStore.getState().canEdit()) return
    event.stopPropagation()
    event.preventDefault()
    cancelViewportAnimation()
    capture(event.pointerId)
    const start = worldPoint(event)
    interactionRef.current = {
      kind: 'connect',
      pointerId: event.pointerId,
      sourceElementId: cardId,
      sourceAnchor: side,
      current: start,
      hoverCardId: null,
      hoverAnchor: null,
    }
    setDraft({
      sourceElementId: cardId,
      sourceAnchor: side,
      from: start,
      to: start,
      targetElementId: null,
      targetAnchor: null,
    })
  }

  const cancelInteraction = useCallback(() => {
    interactionRef.current = { kind: 'idle' }
    setPreview(null)
    setDraft(null)
    setDragging(false)
    setPanning(false)
  }, [setPreview])

  // Cancels the in-flight interaction and hands the pointer back to the
  // browser. The id has to be read before cancelling, which clears the state.
  const endInteraction = useCallback(() => {
    const element = containerRef.current
    const interaction = interactionRef.current
    const pointerId = interaction.kind === 'idle' ? undefined : interaction.pointerId
    cancelInteraction()
    if (element && pointerId !== undefined) {
      try {
        if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
      } catch {
        /* pointer already released */
      }
    }
  }, [cancelInteraction])

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current
    if (interaction.kind === 'idle' || interaction.pointerId !== event.pointerId) return

    switch (interaction.kind) {
      case 'pan': {
        const dx = event.clientX - interaction.startClient.x
        const dy = event.clientY - interaction.startClient.y
        viewportRef.current = {
          ...interaction.startViewport,
          x: interaction.startViewport.x + dx,
          y: interaction.startViewport.y + dy,
        }
        applyViewport()
        commitViewport()
        break
      }
      case 'drag': {
        const current = worldPoint(event)
        let dx = current.x - interaction.startWorld.x
        let dy = current.y - interaction.startWorld.y
        // Only start dragging past a threshold, so a clean click never moves.
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
          if (interaction.moved) interaction.moved = false
          setPreview(null)
          return
        }
        const primaryCard = cardMap.get(interaction.primaryId)
        const primaryGroup = groupMap.get(interaction.primaryId)
        const primary = primaryCard ?? primaryGroup
        if (snapToGrid && primary) {
          dx = snap(primary.x + dx, gridSize) - primary.x
          dy = snap(primary.y + dy, gridSize) - primary.y
        }
        interaction.moved = true
        setPreview({ kind: 'drag', delta: { x: dx, y: dy }, ids: interaction.ids })
        break
      }
      case 'resize': {
        const current = worldPoint(event)
        // Both dimensions follow the grid when snapping is on, so cards land on
        // the same lattice whether they were dragged or resized.
        const rawWidth = interaction.startSize.width + (current.x - interaction.startWorld.x)
        const width = clamp(
          snapToGrid ? snap(rawWidth, gridSize) : rawWidth,
          MIN_CARD_WIDTH,
          MAX_CARD_WIDTH,
        )
        const rawHeight = interaction.startSize.height + (current.y - interaction.startWorld.y)
        const height = clamp(
          snapToGrid ? snap(rawHeight, gridSize) : rawHeight,
          MIN_CARD_HEIGHT,
          MAX_CARD_HEIGHT,
        )
        setPreview({ kind: 'resize', cardId: interaction.cardId, width, height })
        break
      }
      case 'group-resize': {
        const current = worldPoint(event)
        const rawWidth = interaction.startSize.width + (current.x - interaction.startWorld.x)
        const width = clamp(
          snapToGrid ? snap(rawWidth, gridSize) : rawWidth,
          200,
          3000,
        )
        const rawHeight = interaction.startSize.height + (current.y - interaction.startWorld.y)
        const height = clamp(
          snapToGrid ? snap(rawHeight, gridSize) : rawHeight,
          150,
          3000,
        )
        setPreview({ kind: 'group-resize', groupId: interaction.groupId, width, height })
        break
      }
      case 'marquee': {
        setPreview({ kind: 'marquee', start: interaction.startWorld, current: worldPoint(event) })
        break
      }
      case 'connect': {
        const current = worldPoint(event)
        const element = document.elementFromPoint(event.clientX, event.clientY)
        const host = element?.closest('[data-card-id]') as HTMLElement | null
        const targetId = host?.dataset.cardId ?? null
        const targetCard = targetId && targetId !== interaction.sourceElementId ? cardMap.get(targetId) : undefined
        const anchor = targetCard ? nearestAnchor(visualRectOf(targetCard), current) : null
        interaction.hoverCardId = targetCard?.id ?? null
        interaction.hoverAnchor = anchor
        setDraft({
          sourceElementId: interaction.sourceElementId,
          sourceAnchor: interaction.sourceAnchor,
          from: current,
          to: current,
          targetElementId: targetCard?.id ?? null,
          targetAnchor: anchor,
        })
        break
      }
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current
    if (interaction.kind === 'idle' || interaction.pointerId !== event.pointerId) return
    const store = useCanvasStore.getState()
    const latest = previewRef.current

    switch (interaction.kind) {
      case 'pan': {
        commitViewport(true)
        break
      }
      case 'drag': {
        if (interaction.moved && latest?.kind === 'drag') {
          const cardEntries: Array<{ id: string; x: number; y: number }> = []
          const groupEntries: Array<{ id: string; x: number; y: number }> = []
          for (const id of interaction.ids) {
            const card = cardMap.get(id)
            if (card) {
              cardEntries.push({
                id,
                x: Math.round(card.x + latest.delta.x),
                y: Math.round(card.y + latest.delta.y),
              })
              continue
            }
            const group = groupMap.get(id)
            if (group) {
              groupEntries.push({
                id,
                x: Math.round(group.x + latest.delta.x),
                y: Math.round(group.y + latest.delta.y),
              })
            }
          }
          if (cardEntries.length > 0) store.moveElements(cardEntries)
          if (groupEntries.length > 0) store.moveGroups(groupEntries)
        }
        break
      }
      case 'resize': {
        if (latest?.kind === 'resize') {
          store.resizeElement(latest.cardId, { width: latest.width, height: latest.height })
        }
        break
      }
      case 'group-resize': {
        if (latest?.kind === 'group-resize') {
          // `resizeGroup`, not `updateGroup` with a new width. The store action
          // captures where the group's corner *was* and rescales its members by
          // that factor, so what is inside follows the box. Setting the width on
          // its own resizes the frame and leaves the contents where they were.
          store.resizeGroup(latest.groupId, { width: latest.width, height: latest.height })
        }
        break
      }
      case 'marquee': {
        const selection = latest?.kind === 'marquee' ? latest : null
        if (selection) {
          const rect = {
            x: Math.min(selection.start.x, selection.current.x),
            y: Math.min(selection.start.y, selection.current.y),
            width: Math.abs(selection.current.x - selection.start.x),
            height: Math.abs(selection.current.y - selection.start.y),
          }
          if (rect.width < 4 && rect.height < 4) {
            if (!interaction.additive) store.clearSelection()
          } else {
            const hits = cards.filter((card) => rectsIntersect(rect, rectOf(card))).map((card) => card.id)
            store.selectElements(hits, interaction.additive)
          }
        }
        break
      }
      case 'connect': {
        if (interaction.hoverCardId) {
          store.addConnection({
            source: { kind: 'element', id: interaction.sourceElementId },
            target: { kind: 'element', id: interaction.hoverCardId },
            sourceAnchor: interaction.sourceAnchor,
            targetAnchor: interaction.hoverAnchor,
          })
        }
        break
      }
    }

    interactionRef.current = { kind: 'idle' }
    setPreview(null)
    setDraft(null)
    setDragging(false)
    setPanning(false)
  }

  const handlePointerCancel = () => endInteraction()

  /* ---------------------------------------------------------------- */
  /* wheel: card content, then pan + zoom                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    /** True while a scrollable card body still has room left in that direction. */
    const canScrollWithin = (scroller: HTMLElement, deltaY: number): boolean => {
      if (scroller.scrollHeight <= scroller.clientHeight + 1) return false
      if (deltaY < 0) return scroller.scrollTop > 0
      if (deltaY > 0) return scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1
      return false
    }

    const onWheel = (event: WheelEvent) => {
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      const deltaX = event.deltaX * scale
      const deltaY = event.deltaY * scale

      // Over a card, the wheel scrolls the card itself. Pinch-zoom still zooms,
      // and once the card is at its end the canvas takes over again. Scrolling is
      // not a click, so it must not open the inspector — only a click selects.
      if (!event.ctrlKey && !event.metaKey) {
        const scroller = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('.cc-card__scroll')
        if (scroller && canScrollWithin(scroller, deltaY)) {
          // No preventDefault: the browser scrolls the card body natively.
          return
        }
      }

      // Nothing is blocked here. Panning and zooming the canvas are allowed
      // while presenting, on purpose — see the note in `PresentOverlay`. A step
      // frames what it points at, but a presenter who is asked about the part of
      // the map they are not showing has to be able to get there.
      event.preventDefault()
      cancelViewportAnimation()

      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-deltaY * 0.0022)
        const box = element.getBoundingClientRect()
        viewportRef.current = zoomAtPoint(
          viewportRef.current,
          { x: event.clientX - box.left, y: event.clientY - box.top },
          clampZoom(viewportRef.current.zoom * factor),
        )
      } else {
        viewportRef.current = {
          ...viewportRef.current,
          x: viewportRef.current.x - (event.shiftKey && deltaX === 0 ? deltaY : deltaX),
          y: viewportRef.current.y - (event.shiftKey && deltaX === 0 ? 0 : deltaY),
        }
      }
      applyViewport()
      commitViewport()
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [applyViewport, commitViewport, cancelViewportAnimation])

  /* ---------------------------------------------------------------- */
  /* misc canvas interactions                                        */
  /* ---------------------------------------------------------------- */

  const openCanvasMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    // Every entry in this menu is an edit — delete, duplicate, change style.
    // A read-only canvas has no menu to show, and the browser's own is blocked
    // while presenting, so a right click does nothing at all.
    if (!useCanvasStore.getState().canEdit()) return
    useCanvasStore.getState().setContextMenu({
      x: event.clientX,
      y: event.clientY,
      cardId: null,
      connectionId: null,
      groupId: null,
    })
  }

  const openCardMenu = (event: React.MouseEvent<HTMLDivElement>, cardId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const store = useCanvasStore.getState()
    if (!store.canEdit()) return
    if (!store.selectedElementIds.includes(cardId)) store.selectElements([cardId])
    store.setContextMenu({ x: event.clientX, y: event.clientY, cardId, connectionId: null, groupId: null })
  }

  const openGroupMenu = (event: React.MouseEvent<HTMLDivElement>, groupId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const store = useCanvasStore.getState()
    if (!store.canEdit()) return
    if (store.selectedGroupId !== groupId) store.selectGroup(groupId)
    store.setContextMenu({ x: event.clientX, y: event.clientY, cardId: null, connectionId: null, groupId })
  }

  const openConnectionMenu = (event: React.MouseEvent<SVGGElement>, connectionId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const store = useCanvasStore.getState()
    if (!store.canEdit()) return
    if (!store.selectedConnectionIds.includes(connectionId)) store.selectConnection(connectionId)
    store.setContextMenu({ x: event.clientX, y: event.clientY, cardId: null, connectionId, groupId: null })
  }

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-card-id]')) return
    const store = useCanvasStore.getState()
    // A double-click on empty canvas makes a note, centred on the point
    // clicked. The kind is the first argument because it decides the shape; the
    // rest is a patch over the defaults for that kind.
    store.addElement('note', {
      title: 'New note',
      // An empty body. This used to be seeded with '<p></p>', which is HTML
      // rather than Markdown: the element showed a stray empty paragraph, and
      // the renderer escaped the tags into visible text.
      body: '',
    })
  }

  // Escape cancels an in-flight drag / resize / connect.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (interactionRef.current.kind === 'idle') return
      event.preventDefault()
      endInteraction()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [endInteraction])

  const gridStyle = (() => {
    const { x, y, zoom } = viewportRef.current
    const step = Math.max(6, gridSize * zoom)
    return {
      // Blank while presenting, so the map is on the page colour and nothing
      // else. `applyViewport` clears the same element imperatively on every
      // frame; this is what the first paint shows.
      backgroundImage: showGrid ? gridBackground(gridPattern) : 'none',
      backgroundSize: showGrid ? `${step}px ${step}px` : 'auto',
      backgroundPosition: `${x}px ${y}px`,
    }
  })()

  const marqueeRect =
    preview?.kind === 'marquee'
      ? {
          x: Math.min(preview.start.x, preview.current.x),
          y: Math.min(preview.start.y, preview.current.y),
          width: Math.abs(preview.current.x - preview.start.x),
          height: Math.abs(preview.current.y - preview.start.y),
        }
      : null

  const dragOffsetFor = (id: string): Point | null =>
    preview?.kind === 'drag' && preview.ids.includes(id) ? preview.delta : null

  return (
    <div
      ref={containerRef}
      className="cc-canvas flex-1 bg-canvas"
      data-panning={panning ? 'true' : undefined}
      data-space={spacePressed ? 'true' : undefined}
      data-connecting={draft ? 'true' : undefined}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={openCanvasMenu}
      onDoubleClick={handleDoubleClick}
    >
      {/* Not rendered at all while presenting, rather than rendered with no
          background: a full-canvas element that paints nothing is still an
          element the browser composites, and on a large map that is real work
          for a picture that is only ever empty. */}
      {showGrid ? <div ref={gridRef} className="cc-grid" style={gridStyle} /> : null}

      <div
        ref={worldRef}
        className="cc-world"
        data-interacting={dragging ? 'true' : undefined}
        style={{
          transform: `translate3d(${viewportRef.current.x}px, ${viewportRef.current.y}px, 0) scale(${viewportRef.current.zoom})`,
        }}
      >
        <ConnectionLayer
          cards={cardMap}
          groups={groupMap}
          connections={connections}
          selectedIds={selectedConnectionIds}
          dimmedCardIds={dimmedCardIds}
          draft={draft}
          onSelect={(connectionId) => useCanvasStore.getState().selectConnection(connectionId)}
          onContextMenu={openConnectionMenu}
          onLabelChange={(connectionId, label) =>
            useCanvasStore.getState().updateConnection(connectionId, { label })
          }
        />

        {/* Groups always render in a layer behind all cards */}
        <div className="cc-groups">
          {groups.map((group: Group) => (
            <GroupNode
              key={group.id}
              group={group}
              selected={selectedGroupId === group.id}
              dimmed={dimmedCardIds.has(group.id)}
              offset={dragOffsetFor(group.id)}
              onPointerDown={handleGroupPointerDown}
              onHandlePointerDown={handleGroupHandlePointerDown}
              onResizePointerDown={handleGroupResizePointerDown}
              onContextMenu={openGroupMenu}
            />
          ))}
        </div>

        <div className="cc-cards">
          {cards.map((element: Element) => (
            <ElementNode
              key={element.id}
              element={element}
              selected={selectedElementIds.includes(element.id)}
              dimmed={dimmedCardIds.has(element.id)}
              spotlight={spotlightId === element.id}
              dragTarget={draft?.targetElementId === element.id}
              // The grabbing cursor, and a heavier shadow, while this element is
              // one of the ones being held. The attribute was in the stylesheet
              // from the start and never rendered, so neither had ever applied.
              dragging={
                dragging &&
                (preview?.kind === 'drag'
                  ? preview.ids.includes(element.id)
                  : selectedElementIds.includes(element.id))
              }
              offset={dragOffsetFor(element.id)}
              size={
                preview?.kind === 'resize' && preview.cardId === element.id
                  ? { width: preview.width, height: preview.height }
                  : null
              }
              childTitles={childrenOf.get(element.id) ?? []}
              onElementPointerDown={handleCardPointerDown}
              onElementTitlePointerDown={handleElementTitlePointerDown}
              onResizePointerDown={handleResizePointerDown}
              onHandlePointerDown={handleHandlePointerDown}
              onContextMenu={openCardMenu}
            />
          ))}
        </div>

        {marqueeRect ? (
          <div
            className="cc-marquee"
            style={{ left: marqueeRect.x, top: marqueeRect.y, width: marqueeRect.width, height: marqueeRect.height }}
          />
        ) : null}
      </div>

      {/* Other people's pointers. A sibling of `.cc-world`, not a child: that
          element is already pan- and zoom-transformed, so anything inside it
          would have its coordinates scaled a second time — and because it is
          sized by its children, an `inset-0` overlay inside it collapses to
          zero. Screen-space placement belongs outside the transform. Ephemeral:
          broadcast only, never part of the document or anybody's undo history. */}
      <CursorLayer />
      {/*
        No empty-page overlay.

        There was a centred panel here with a heading, a paragraph of keyboard
        shortcuts and two buttons. It is gone, and nothing replaced it, on purpose:

        * "Fit view" on an empty page fits nothing. `fitViewport(null, ...)`
          returns the origin viewport, so the button reset the camera to somewhere
          that looks identical, and read as broken.

        * "New card" duplicated the toolbar's Card button, the `C` shortcut and
          double-clicking the canvas. Three working ways to do the same thing were
          already one click away, and the panel covered the canvas they all act on.

        An empty page is not an error state and does not need an explanation
        drawn over it. The canvas is the interface; when there is nothing on it,
        the toolbar and the shortcut are what you use next, and both are visible.
      */}
    </div>
  )
}
