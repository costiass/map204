/**
 * What you can do to the things on a page.
 *
 * Plain functions over a `Page`, mutating it, with no store and no React in
 * sight. That is a deliberate shape: the store's actions are one line each once
 * these exist, and — more to the point — these can be *tested*. A store action
 * needs a mounted store, a document and an active page before it will do
 * anything, which is a lot of scaffolding around a question like "does deleting
 * an element remove the connections that pointed at it".
 *
 * The rule throughout: **every function that removes something also removes what
 * referred to it.** Connections are stored by id, so deleting an element without
 * deleting its connections leaves lines drawn to nothing, and a group that still
 * lists a deleted member draws an empty frame around nothing. Both failures are
 * silent, which is the whole problem with them.
 */

import type {
  Element,
  Group,
  NoteElement,
  Page,
  TableColumn,
  TableElement,
  VideoElement,
} from '@/elements/schema'
import { DEFAULT_VIDEO_ASPECT, ELEMENT_HEADER_HEIGHT } from '@/elements/defaults'

/** The stamp every mutation leaves, so "what changed and when" is answerable. */
function now(): string {
  return new Date().toISOString()
}

export function findElement(page: Page, id: string): Element | undefined {
  return page.elements.find((element) => element.id === id)
}

/** The next free z-index for a normal element. */
export function nextZIndex(page: Page): number {
  return page.elements.reduce((max, element) => Math.max(max, element.zIndex), 0) + 1
}

/** The lowest z-index in use, for "send to back". */
export function lowestZIndex(page: Page): number {
  return page.elements.reduce((min, element) => Math.min(min, element.zIndex), 0) - 1
}

export type ZOrderMode = 'front' | 'back' | 'forward' | 'backward'

/* ------------------------------------------------------------------ */
/* placement                                                            */
/* ------------------------------------------------------------------ */

/**
 * A free spot near a point, so repeated presses do not stack.
 *
 * The nudge is a spiral of a few offsets rather than a random one: random
 * placement means two things you made on purpose end up nowhere near where you
 * put them, and you cannot find either of them again.
 */
export function freeSpotNear(page: Page, x: number, y: number): { x: number; y: number } {
  const at = (px: number, py: number) =>
    page.elements.some((e) => Math.abs(e.x - px) < 24 && Math.abs(e.y - py) < 24)

  if (!at(x, y)) return { x, y }
  for (let i = 1; i <= 8; i++) {
    for (const [dx, dy] of [
      [i * 32, i * 28],
      [i * 32, -i * 28],
      [-i * 32, i * 28],
      [-i * 32, -i * 28],
    ]) {
      if (!at(x + dx, y + dy)) return { x: x + dx, y: y + dy }
    }
  }
  return { x: x + 320, y: y + 280 }
}

/* ------------------------------------------------------------------ */
/* create                                                               */
/* ------------------------------------------------------------------ */

export interface PlaceOptions {
  x: number
  y: number
  zIndex?: number
  id?: string
}

/**
 * Put a new element on a page.
 *
 * `create` builds the element — the registry's job, not this file's — and this
 * only decides where it goes. Keeping the two apart is what lets a new type be
 * added without touching the store: it brings its own maker and the store does
 * not learn anything about it.
 */
export function placeElement(
  page: Page,
  element: Element,
  where: PlaceOptions,
): Element {
  const spot = where.zIndex === undefined && !where.id ? freeSpotNear(page, where.x, where.y) : where
  const placed: Element = {
    ...element,
    id: where.id ?? element.id,
    x: Math.round(spot.x),
    y: Math.round(spot.y),
    zIndex: where.zIndex ?? nextZIndex(page),
    createdAt: element.createdAt || now(),
    updatedAt: now(),
  }
  page.elements.push(placed)
  page.updatedAt = now()
  return placed
}

/* ------------------------------------------------------------------ */
/* update                                                               */
/* ------------------------------------------------------------------ */

type Patch = Record<string, unknown>

/**
 * Change an element.
 *
 * The geometry is clamped and the patch is applied in one place so that no
 * caller can write a width of zero, a `NaN` zoom or a negative height — the three
 * that make an element undraggable or invisible with nothing to show for it.
 */
export function applyPatch(element: Element, patch: Patch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'x') element.x = Math.round(safeNumber(value, element.x))
    else if (key === 'y') element.y = Math.round(safeNumber(value, element.y))
    else if (key === 'zIndex') element.zIndex = Math.round(safeNumber(value, element.zIndex))
    else if (key === 'width') element.width = Math.max(40, safeNumber(value, element.width))
    else if (key === 'height') element.height = Math.max(40, safeNumber(value, element.height))
    else if (key === 'createdAt') continue
    else (element as unknown as Patch)[key] = value
  }
  element.updatedAt = now()
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/* ------------------------------------------------------------------ */
/* resize                                                               */
/* ------------------------------------------------------------------ */

export interface ResizeOptions {
  /**
   * Keep this width-to-height ratio.
   *
   * A video passes its own aspect and the height follows. Nothing else passes
   * one, because a note is free to be any shape and a table is free too — a
   * constraint on an element that does not want it is a constraint somebody will
   * try to work around.
   */
  aspect?: number | null
}

/**
 * Resize an element, honouring its own shape rules.
 *
 * The aspect is applied to the *height* when a width is dragged, and to the
 * *width* when a height is dragged. Which one leads depends on which handle you
 * pulled, and getting it wrong is the difference between a video that grows
 * smoothly and one that fights the pointer.
 */
export function resizeElement(
  page: Page,
  id: string,
  size: { width: number; height: number },
  options: ResizeOptions = {},
  leading: 'width' | 'height' = 'width',
): void {
  const element = findElement(page, id)
  if (!element) return

  const aspect = options.aspect ?? (element.kind === 'video' ? aspectOf(element) : null)
  if (aspect && aspect > 0.01) {
    /*
     * The title bar is inside the element's height, so it is added before the
     * aspect is applied and taken off again after.
     *
     * Without it, dragging a video's width set the *element* to the video's shape
     * and the video was then drawn into what remained of the element once the bar
     * had taken its cut -- so every video was letterboxed by however tall its
     * title bar happened to be, and `height` was never the number on screen.
     */
    const bar = element.kind === 'video' ? ELEMENT_HEADER_HEIGHT : 0

    if (leading === 'width') {
      // Rounded, so a video sits on whole pixels. The grid is drawn in whole
      // pixels, and a video's height derived from a fractional width lands
      // between two rows and looks like it is not quite on the grid.
      element.width = Math.max(40, Math.round(size.width))
      element.height = Math.max(40, Math.round(bar + element.width / aspect))
    } else {
      element.height = Math.max(40, Math.round(size.height))
      element.width = Math.max(40, Math.round((element.height - bar) * aspect))
    }
  } else {
    element.width = Math.max(40, Math.round(size.width))
    element.height = Math.max(40, Math.round(size.height))
  }
  element.updatedAt = now()
  page.updatedAt = now()
}

function aspectOf(video: VideoElement): number {
  return video.aspect && video.aspect > 0.01 ? video.aspect : DEFAULT_VIDEO_ASPECT
}

/**
 * Resize every element a group is holding, when the group itself is resized.
 *
 * Members scale in *position* as well as size, measured from the group's own
 * corner — so an element near the top-left stays near the top-left when the group
 * grows, instead of staying absolutely still while the space around it stretches.
 *
 * One scale, not one per axis. Scaling x and y independently would turn a note
 * into a different note, and a video that keeps its aspect ratio would no longer
 * match the frame around it.
 */
export function resizeGroupMembers(
  page: Page,
  group: Group,
  before: { x: number; y: number; width: number; height: number },
): void {
  if (before.width <= 0 || before.height <= 0) return
  const scaleX = group.width / before.width
  const scaleY = group.height / before.height
  const scale = (scaleX + scaleY) / 2

  for (const memberId of group.memberIds) {
    const member = findElement(page, memberId)
    if (!member) continue

    // Position measured from where the group's top-left *was*.
    const offsetX = member.x - before.x
    const offsetY = member.y - before.y
    member.x = Math.round(group.x + offsetX * scale)
    member.y = Math.round(group.y + offsetY * scale)
    member.width = Math.max(40, Math.round(member.width * scale))
    member.height = Math.max(40, Math.round(member.height * scale))
    member.updatedAt = now()
  }
  page.updatedAt = now()
}

/* ------------------------------------------------------------------ */
/* move                                                                 */
/* ------------------------------------------------------------------ */

export function moveElements(page: Page, entries: Array<{ id: string; x: number; y: number }>): void {
  for (const entry of entries) {
    const element = findElement(page, entry.id)
    if (!element) continue
    element.x = Math.round(entry.x)
    element.y = Math.round(entry.y)
    element.updatedAt = now()
  }
  page.updatedAt = now()
}

/**
 * Move a group *and everything inside it*.
 *
 * This is the difference between a frame and a container. A frame that does not
 * move its contents is a rectangle you happened to draw around some things; a
 * container that does is a thing you can pick up, drag across the map, and put
 * down somewhere else, and the arrangement inside it arrives intact.
 */
export function moveGroupWithMembers(
  page: Page,
  groupId: string,
  dx: number,
  dy: number,
): void {
  const group = page.groups.find((g) => g.id === groupId)
  if (!group) return
  group.x += dx
  group.y += dy
  group.updatedAt = now()

  for (const memberId of group.memberIds) {
    const member = findElement(page, memberId)
    if (!member) continue
    // A member that is also in another group is moved by whichever group is
    // dragged, and moves once — the two are not additive, because a thing in two
    // groups is in one place and dragging it must move it from there.
    member.x += dx
    member.y += dy
    member.updatedAt = now()
  }
  page.updatedAt = now()
}

/**
 * Which group, if any, an element dropped at a point should go into.
 *
 * The innermost one that fully contains the element, because a group inside a
 * group is the more specific claim and joining the outer one too would make the
 * two impossible to separate again.
 */
export function groupContaining(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
  exclude: string[] = [],
): Group | null {
  const candidates = page.groups
    .filter((group) => !exclude.includes(group.id))
    .filter(
      (group) =>
        rect.x >= group.x &&
        rect.y >= group.y &&
        rect.x + rect.width <= group.x + group.width &&
        rect.y + rect.height <= group.y + group.height,
    )
    .sort((a, b) => a.width * a.height - b.width * b.height)
  return candidates[0] ?? null
}

/** Add an element to a group, and out of whatever group it was in. */
export function addElementToGroup(page: Page, groupId: string, elementId: string): void {
  for (const group of page.groups) {
    group.memberIds = group.memberIds.filter((id) => id !== elementId)
  }
  const group = page.groups.find((g) => g.id === groupId)
  if (!group) return
  group.memberIds.push(elementId)
  group.updatedAt = now()
  page.updatedAt = now()
}

export function removeElementFromGroup(page: Page, groupId: string, elementId: string): void {
  const group = page.groups.find((g) => g.id === groupId)
  if (!group) return
  group.memberIds = group.memberIds.filter((id) => id !== elementId)
  group.updatedAt = now()
  page.updatedAt = now()
}

/* ------------------------------------------------------------------ */
/* delete                                                               */
/* ------------------------------------------------------------------ */

/**
 * Remove elements, and everything that referred to them.
 *
 * Connections, group memberships and the selection all point at elements by id.
 * A delete that only removes the element leaves a line drawn to nothing, a group
 * with a hole in it, and a selection of things that are gone — none of which
 * raise anything, all of which show up as something being wrong on a map
 * somebody cannot fix.
 */
export function deleteElements(page: Page, ids: string[]): void {
  if (ids.length === 0) return
  const doomed = new Set(ids)
  page.elements = page.elements.filter((element) => !doomed.has(element.id))
  page.connections = page.connections.filter(
    (connection) =>
      !(
        (connection.source.kind === 'element' && doomed.has(connection.source.id)) ||
        (connection.target.kind === 'element' && doomed.has(connection.target.id))
      ),
  )
  for (const group of page.groups) {
    group.memberIds = group.memberIds.filter((id) => !doomed.has(id))
  }
  page.updatedAt = now()
}

/** Remove groups, and everything that referred to them. */
export function deleteGroups(page: Page, ids: string[]): void {
  if (ids.length === 0) return
  const doomed = new Set(ids)
  page.groups = page.groups.filter((group) => !doomed.has(group.id))
  page.connections = page.connections.filter(
    (connection) =>
      !(
        (connection.source.kind === 'group' && doomed.has(connection.source.id)) ||
        (connection.target.kind === 'group' && doomed.has(connection.target.id))
      ),
  )
  page.updatedAt = now()
}

/* ------------------------------------------------------------------ */
/* duplicate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Copy elements.
 *
 * A copy gets new ids *everywhere* — the element, and the ids of the things
 * inside it. Copying a table with its cells intact but its column ids shared with
 * the original means editing one column header renames both, and there is no way
 * back.
 */
export function duplicateElements(page: Page, ids: string[], makeId: (prefix: string) => string): string[] {
  const created: string[] = []
  for (const id of ids) {
    const source = findElement(page, id)
    if (!source) continue
    const copy = cloneElement(source, makeId)
    copy.x += 32
    copy.y += 32
    copy.zIndex = nextZIndex(page)
    copy.createdAt = now()
    copy.updatedAt = copy.createdAt
    page.elements.push(copy)
    created.push(copy.id)
  }
  if (created.length > 0) page.updatedAt = now()
  return created
}

function cloneElement(source: Element, makeId: (prefix: string) => string): Element {
  const copy = structuredClone(source) as Element
  copy.id = makeId(source.kind)
  if (copy.kind === 'note') {
    copy.checklist = copy.checklist.map((item) => ({ ...item, id: makeId('item') }))
  }
  if (copy.kind === 'flash') {
    copy.cards = copy.cards.map((pair) => pair.map((side) => ({ ...side, id: makeId('face') })))
  }
  if (copy.kind === 'table') {
    copy.columns = copy.columns.map((column) => ({ ...column, id: makeId('col') }))
  }
  return copy
}

/* ------------------------------------------------------------------ */
/* z-order                                                              */
/* ------------------------------------------------------------------ */

export function applyZOrder(page: Page, ids: string[], mode: ZOrderMode): void {
  if (ids.length === 0) return
  const selected = new Set(ids)

  if (mode === 'front') {
    let z = nextZIndex(page)
    for (const id of ids) {
      const element = findElement(page, id)
      if (!element) continue
      element.zIndex = z
      z += 1
    }
    page.updatedAt = now()
    return
  }

  if (mode === 'back') {
    let z = lowestZIndex(page)
    for (const id of ids) {
      const element = findElement(page, id)
      if (!element) continue
      element.zIndex = z
      z += 1
    }
    page.updatedAt = now()
    return
  }

  // Forward and backward, both a single pass over the sorted list.
  //
  // An element moves one step, and only if the neighbour in that direction is
  // *not* also selected — a block of three selected elements with one free
  // element behind them has exactly one thing that can move, and the other two
  // are blocked by each other. Sorting per element instead of in one pass gets
  // that wrong by shuffling the selection among themselves while leaving the page
  // exactly as it was.
  const ordered = [...page.elements].sort((a, b) => a.zIndex - b.zIndex)
  if (mode === 'forward') {
    for (let i = ordered.length - 2; i >= 0; i--) {
      if (selected.has(ordered[i].id) && !selected.has(ordered[i + 1].id)) {
        const swap = ordered[i].zIndex
        ordered[i].zIndex = ordered[i + 1].zIndex
        ordered[i + 1].zIndex = swap
      }
    }
  } else {
    // Backward walks the list the other way and swaps with the neighbour
    // *above*, not the one below. Using the same neighbour as "forward" moves
    // things toward the front, which is the opposite of what was asked for — and
    // it did, for a while, because the pass consulted the list it was halfway
    // through changing and so stopped after the first swap.
    for (let i = 0; i < ordered.length - 1; i++) {
      if (selected.has(ordered[i].id) && !selected.has(ordered[i + 1].id)) {
        const swap = ordered[i].zIndex
        ordered[i].zIndex = ordered[i + 1].zIndex
        ordered[i + 1].zIndex = swap
      }
    }
  }
  page.updatedAt = now()
}

/* ------------------------------------------------------------------ */
/* collapse                                                             */
/* ------------------------------------------------------------------ */

/**
 * Collapse elements to their title bar.
 *
 * A whole selection collapses or expands together, decided by the *first* one —
 * a mixed selection is collapsed if anything in it is open, because a fold where
 * half the cards are flat and half are not reads as a mistake.
 */
export function toggleCollapsed(page: Page, ids: string[]): void {
  if (ids.length === 0) return
  const shouldCollapse = ids.some((id) => {
    const element = findElement(page, id)
    return element ? element.collapsed !== true : false
  })
  for (const id of ids) {
    const element = findElement(page, id)
    if (!element) continue
    element.collapsed = shouldCollapse
    element.updatedAt = now()
  }
  page.updatedAt = now()
}

/* ------------------------------------------------------------------ */
/* per-kind edits                                                       */
/* ------------------------------------------------------------------ */

/**
 * Change something only a note has.
 *
 * Note-specific edits live here rather than in a dozen store actions, because
 * they are note-specific: adding a checklist item to a video is a thing that
 * cannot happen, and the type says so before it runs. A caller that reaches this
 * with the wrong kind gets nothing back rather than a field nobody reads.
 */
export function editNote(page: Page, id: string, patch: Partial<NoteElement>): boolean {
  const element = findElement(page, id)
  if (!element || element.kind !== 'note') return false
  applyPatch(element, patch as Patch)
  page.updatedAt = now()
  return true
}

export function editTable(page: Page, id: string, patch: Partial<TableElement>): boolean {
  const element = findElement(page, id)
  if (!element || element.kind !== 'table') return false
  applyPatch(element, patch as Patch)
  page.updatedAt = now()
  return true
}

/**
 * The cell at a row and column, or `''` if it is off the end of the table.
 *
 * The bounds check is not defensive padding, it is the arithmetic. Cells are
 * stored column-major, so the index is `column * rowCount + row` -- and with the
 * row unchecked, asking for row 2 of a two-row table computes index 2, which is
 * *column 1's first cell*. Every caller that walks a rectangle would read across
 * into its neighbour instead of off the end.
 *
 * That is not theoretical: `resizeTableRows` growing a table asked for the new
 * rows and got the next column's answers, so a 2x2 table turned into a 2x3 with
 * column 0's new last row reading "r0c1".
 */
export function tableCell(table: TableElement, row: number, column: number): string {
  if (row < 0 || column < 0) return ''
  if (row >= table.rowCount || column >= table.columns.length) return ''
  const index = column * table.rowCount + row
  return table.cells[index] ?? ''
}

/**
 * Write a cell. Refuses an address outside the table.
 *
 * This used to pad `cells` until the address fitted, on the theory that writing
 * past the end should grow the table. It does not: `cells` is indexed against
 * `rowCount` and `columns`, so a padded cell sits at an index nothing renders and
 * nothing can read back -- `tableCell` bounds-checks and returns empty for it.
 * The write was invisible from the moment it happened.
 *
 * Growing a table is `resizeTableRows` and `resizeTableColumns`, which rewrite the
 * shape and the cells together. Those are the only two ways to reach a cell that
 * is not already there.
 *
 * Returns whether the write landed, so a caller can tell a rejected address from
 * a successful write of an empty value.
 */
export function setTableCell(
  table: TableElement,
  row: number,
  column: number,
  value: string,
): boolean {
  if (row < 0 || column < 0) return false
  if (row >= table.rowCount || column >= table.columns.length) return false
  table.cells[column * table.rowCount + row] = value
  table.updatedAt = now()
  return true
}

/**
 * The smallest table worth having, in each direction.
 *
 * One row by one column is a cell, not a table, and a count of zero is a bug
 * waiting to divide by zero in `tableCell` -- the stride is `rowCount`, so a zero
 * makes every cell in the table address index zero. Both are enforced here rather
 * than in the inspector, because the inspector is not the only thing that can ask.
 */
export const MIN_TABLE_ROWS = 1
export const MIN_TABLE_COLUMNS = 1

/**
 * How many columns a table may have.
 *
 * A ceiling rather than an open end, because the inspector offers a stepper and a
 * stepper needs a top. 64 columns is far more than anybody has wanted and is far
 * below anything that would make the canvas stutter.
 */
export const MAX_TABLE_COLUMNS = 64

/**
 * Set the row count, re-striding the cells.
 *
 * Cells are stored column-major -- `cells[column * rowCount + row]` -- so the row
 * count is not a length, it is a *stride*. Changing it without rewriting the array
 * reinterprets every cell, and silently: a 2x2 table asked for a third row reads
 * column 0's new last row out of column 1's first cell, so the table fills with
 * the wrong answers and every number moves one place.
 *
 * That is not hypothetical. The inspector's "+ Row" button patched `rowCount`
 * directly and left `cells` alone, so it did exactly this.
 *
 * Rows past the old end are empty; rows beyond the new end are dropped.
 */
export function resizeTableRows(table: TableElement, rowCount: number): void {
  const rows = clamp(rowCount, MIN_TABLE_ROWS, Number.MAX_SAFE_INTEGER)
  if (rows === table.rowCount) return

  const next: string[] = []
  for (let column = 0; column < table.columns.length; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      next.push(tableCell(table, row, column))
    }
  }

  table.cells = next
  table.rowCount = rows
  table.updatedAt = now()
}

/**
 * Set the column count, rebuilding both the columns and the cells.
 *
 * Widths are redistributed rather than kept: `width` is a percentage and the
 * percentages have to add up to the element's width, so a new column has to take
 * its share from somewhere. The kept columns keep their *relative* sizes and are
 * scaled into what is left, which is what inserting a column into a spreadsheet
 * does and is far less surprising than giving everybody an equal slice.
 *
 * `makeId` is passed in rather than imported, for the same reason
 * `duplicateElements` takes one: an id minted by a global is an id the pure
 * operations cannot predict, and these are supposed to be testable without a
 * store.
 */
export function resizeTableColumns(
  table: TableElement,
  columnCount: number,
  makeId: (prefix: string) => string,
): void {
  const count = clamp(columnCount, MIN_TABLE_COLUMNS, MAX_TABLE_COLUMNS)
  if (count === table.columns.length) return

  const keptCount = Math.min(count, table.columns.length)
  const kept = table.columns.slice(0, keptCount)
  const keptTotal = kept.reduce((sum, column) => sum + column.width, 0)

  /*
   * The new columns each take an equal 1/count share, so the kept ones are scaled
   * into the remainder: growing from 3 to 4 leaves each new column a quarter and
   * the three kept ones sharing half between them.
   */
  const keptTarget = (100 * keptCount) / count
  const scale = keptTotal > 0 ? keptTarget / keptTotal : 0

  const columns: TableColumn[] = kept.map((column) => ({
    ...column,
    width: scale > 0 ? column.width * scale : keptTarget / keptCount,
  }))

  const equalShare = 100 / count
  for (let i = keptCount; i < count; i += 1) {
    columns.push({ id: makeId('col'), title: '', width: equalShare })
  }

  const next: string[] = []
  for (let column = 0; column < count; column += 1) {
    for (let row = 0; row < table.rowCount; row += 1) {
      next.push(tableCell(table, row, column))
    }
  }

  table.columns = columns
  table.cells = next
  table.updatedAt = now()
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  return Math.min(high, Math.max(low, Math.round(value)))
}
