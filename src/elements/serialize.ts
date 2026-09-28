/**
 * Reading elements out of untrusted JSON, and making new ones.
 *
 * The single place that decides what an element is. An imported file, a
 * realtime message from a collaborator, and a document read back from the
 * database all arrive as `unknown`, and all three go through here.
 *
 * The rule throughout: **a missing field gets a default, a field of the wrong
 * type gets dropped, and anything that cannot be understood is turned into
 * something valid.** Never throw, never return `null`. An element that failed to
 * parse and vanished is a card somebody spent an hour on, and a document that
 * fails to open at all is a document everybody has lost.
 *
 * What *is* worth dropping is a step or a file reference that points at nothing —
 * those are reported, because they are the sign of a file that was already
 * broken rather than a field this forgot to read.
 */

import {
  DOC_VERSION,
  type Anchor,
  type CanvasDocV2,
  type Connection,
  type ConnectionStyle,
  type DocSettings,
  type Element,
  type FlashElement,
  type Group,
  type LinkElement,
  type NoteChecklistItem,
  type NoteElement,
  type NoteStyle,
  type Page,
  type PdfElement,
  type PresentationStepV2,
  type StoredFile,
  type TableElement,
  type VideoElement,
} from './schema'
import {
  DEFAULT_CONNECTION_STYLE_V2,
  DEFAULT_ELEMENT_SIZE,
  DEFAULT_GROUP_COLOR,
  DEFAULT_NOTE_STYLE,
  DEFAULT_RELATIONSHIP,
  DEFAULT_TABLE_COLUMNS,
  DEFAULT_TABLE_ROWS,
  DEFAULT_VIDEO_ASPECT,
} from './defaults'

/* ------------------------------------------------------------------ */
/* readers                                                              */
/* ------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const bool = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback

const strOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** An id, minted when the file does not have a usable one. */
let mintCounter = 0
function mintId(prefix: string): string {
  mintCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${mintCounter.toString(36)}`
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/**
 * `oneOf` that can also fall back to "nothing".
 *
 * Used for the connection anchors, where the absence of a value is a real state
 * — the renderer chooses the side — and not a missing field to be guessed at.
 */
function oneOfOrNull<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null
}

/** The four sides a box has. */
const ANCHORS = ['top', 'right', 'bottom', 'left'] as const

/* ------------------------------------------------------------------ */
/* the base                                                             */
/* ------------------------------------------------------------------ */

/** The geometry every element shares, read out of a raw object. */
interface BaseFields {
  id: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  createdAt: string
  updatedAt: string
}

function baseOf(raw: unknown, fallback: { x: number; y: number }): BaseFields {
  const value = isRecord(raw) ? raw : {}
  return {
    id: str(value.id) || mintId('el'),
    x: num(value.x, fallback.x),
    y: num(value.y, fallback.y),
    width: Math.max(40, num(value.width, DEFAULT_ELEMENT_SIZE.width)),
    height: Math.max(40, num(value.height, DEFAULT_ELEMENT_SIZE.height)),
    zIndex: Math.round(num(value.zIndex, 1)),
    createdAt: str(value.createdAt) || new Date().toISOString(),
    updatedAt: str(value.updatedAt) || new Date().toISOString(),
  }
}

/* ------------------------------------------------------------------ */
/* per-kind                                                             */
/* ------------------------------------------------------------------ */

const noteStyleOf = (raw: unknown): NoteStyle => {
  if (!isRecord(raw)) return { ...DEFAULT_NOTE_STYLE }
  return {
    backgroundColor: str(raw.backgroundColor, DEFAULT_NOTE_STYLE.backgroundColor),
    accentColor: str(raw.accentColor, DEFAULT_NOTE_STYLE.accentColor),
    textColor: str(raw.textColor, DEFAULT_NOTE_STYLE.textColor),
    borderColor: str(raw.borderColor, DEFAULT_NOTE_STYLE.borderColor),
    borderWidth: clamp(num(raw.borderWidth, DEFAULT_NOTE_STYLE.borderWidth), 0, 12),
    borderRadius: clamp(num(raw.borderRadius, DEFAULT_NOTE_STYLE.borderRadius), 0, 40),
    shadow: bool(raw.shadow, DEFAULT_NOTE_STYLE.shadow),
  }
}

const checklistOf = (raw: unknown): NoteChecklistItem[] =>
  Array.isArray(raw)
    ? raw.flatMap((item) => {
        if (!isRecord(item)) return []
        return [{ id: str(item.id) || mintId('step'), text: str(item.text), done: bool(item.done) }]
      })
    : []

function normalizeNote(raw: unknown, at: { x: number; y: number }): NoteElement {
  const value = isRecord(raw) ? raw : {}
  const base = baseOf(value, at)
  return {
    ...base,
    kind: 'note',
    title: str(value.title, 'Untitled'),
    body: str(value.body),
    style: noteStyleOf(value.style),
    checklist: checklistOf(value.checklist),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : [],
    image: {
      src: isRecord(value.image) ? strOrNull(value.image.src) : null,
      alt: isRecord(value.image) ? str(value.image.alt) : '',
    },
    ...(value.collapsed === true ? { collapsed: true } : {}),
    ...(value.locked === true ? { locked: true } : {}),
  }
}

function normalizeVideo(raw: unknown, at: { x: number; y: number }): VideoElement {
  const value = isRecord(raw) ? raw : {}
  const base = baseOf(value, at)
  return {
    ...base,
    kind: 'video',
    title: str(value.title, 'Video'),
    url: str(value.url),
    startSeconds: value.startSeconds === null ? null : Math.max(0, num(value.startSeconds, 0)),
    display: oneOf(value.display, ['thumbnail', 'player'] as const, 'thumbnail'),
    keepAspect: bool(value.keepAspect, true),
    // A stored aspect of zero would make every resize collapse the element, so
    // it falls back rather than being trusted.
    aspect:
      typeof value.aspect === 'number' && value.aspect > 0.01
        ? value.aspect
        : DEFAULT_VIDEO_ASPECT,
    ...(value.locked === true ? { locked: true } : {}),
  }
}

function normalizeFlash(raw: unknown, at: { x: number; y: number }): FlashElement {
  const value = isRecord(raw) ? raw : {}
  const base = baseOf(value, at)
  // `cards`, not `elements`. The deck is a flash element's *own* `cards` field,
  // and it is a different thing from a page's `elements` — which is exactly the
  // collision the rename pass walked into. Reading `value.elements` here makes
  // every deck in every document come back empty.
  const cards = Array.isArray(value.cards)
    ? value.cards.flatMap((pair) => {
        if (!Array.isArray(pair)) return []
        const sides = pair.flatMap((side) =>
          isRecord(side) ? [{ id: str(side.id) || mintId('face'), text: str(side.text) }] : [],
        )
        // Exactly two sides or nothing. A "card" with one side cannot be turned
        // over, and a card with three has nowhere to put the third.
        return sides.length === 2 ? [sides] : []
      })
    : []
  return {
    ...base,
    kind: 'flash',
    title: str(value.title, 'Flashcards'),
    // A deck with no cards in it cannot be stepped through, and an element that
    // renders as an empty frame is not a useful starting point — so a new or
    // broken deck gets one empty card.
    cards: cards.length > 0 ? cards : [[{ id: mintId('face'), text: '' }, { id: mintId('face'), text: '' }]],
    // Clamped rather than trusted: a file saying "card 900 of 2" is a bug in the
    // file, and a deck showing nothing is a worse outcome than showing the first.
    cardIndex: clamp(Math.round(num(value.cardIndex, 0)), 0, cards.length - 1),
    showing: oneOf(value.showing, ['front', 'back'] as const, 'front'),
    presentation: oneOf(value.presentation, ['carousel', 'single'] as const, 'single'),
    hideAnswer: bool(value.hideAnswer, true),
    ...(value.locked === true ? { locked: true } : {}),
  }
}

const storedFileOf = (raw: unknown): StoredFile | null => {
  if (!isRecord(raw)) return null
  const path = strOrNull(raw.path)
  if (!path) return null
  return {
    // A path is used to build a URL, so a leading slash or a `..` in it would
    // escape the document's own folder. Refused rather than normalised: a file
    // whose path is wrong is a file to re-upload, not one to guess at.
    path: path.startsWith('/') || path.includes('..') ? '' : path,
    name: str(raw.name, 'file'),
    size: Math.max(0, num(raw.size, 0)),
    mime: str(raw.mime, 'application/pdf'),
  }
}

/** A file with no usable path is no file at all. */
const storedFileOrNull = (raw: unknown): StoredFile | null => {
  const file = storedFileOf(raw)
  return file && file.path ? file : null
}

function normalizePdf(raw: unknown, at: { x: number; y: number }): PdfElement {
  const value = isRecord(raw) ? raw : {}
  const base = baseOf(value, at)
  return {
    ...base,
    kind: 'pdf',
    title: str(value.title, 'Document'),
    file: storedFileOrNull(value.file),
    url: str(value.url),
    display: oneOf(value.display, ['chip', 'preview', 'open'] as const, 'chip'),
    note: str(value.note),
    ...(value.locked === true ? { locked: true } : {}),
  }
}

function normalizeLink(raw: unknown, at: { x: number; y: number }): LinkElement {
  const value = isRecord(raw) ? raw : {}
  const base = baseOf(value, at)
  return {
    ...base,
    kind: 'link',
    title: str(value.title, 'Link'),
    url: str(value.url),
    display: oneOf(value.display, ['chip', 'preview', 'open'] as const, 'chip'),
    show: oneOf(value.show, ['host', 'full', 'none'] as const, 'host'),
    note: str(value.note),
    ...(value.locked === true ? { locked: true } : {}),
  }
}

function normalizeTable(raw: unknown, at: { x: number; y: number }): TableElement {
  const value = isRecord(raw) ? raw : {}
  const base = baseOf(value, at)
  const columns = Array.isArray(value.columns)
    ? value.columns.flatMap((column, index) => {
        if (!isRecord(column)) return []
        return [
          {
            id: str(column.id) || mintId('col'),
            title: str(column.title, `Column ${index + 1}`),
            width: Math.max(0.5, num(column.width, 1)),
          },
        ]
      })
    : []
  // A table with no columns cannot hold a row, and the column count is what the
  // cell array is indexed against — so a broken one is rebuilt rather than kept.
  const resolvedColumns =
    columns.length > 0 ? columns : makeTableColumns(DEFAULT_TABLE_COLUMNS)

  // The cell array is indexed against the column count, so a file whose cell
  // array does not match its columns is either unreadable or has text in the
  // wrong place. Both are fixed here rather than left to render as a table with
  // holes in it.
  const rawCells = Array.isArray(value.cells) ? value.cells : []
  const rowCount = Math.max(
    1,
    rawCells.length > 0 ? Math.floor(rawCells.length / resolvedColumns.length) : DEFAULT_TABLE_ROWS,
  )
  const expected = resolvedColumns.length * rowCount
  const cells = Array.from({ length: expected }, (_, i) => str(rawCells[i]))

  return {
    ...base,
    kind: 'table',
    title: str(value.title, 'Table'),
    columns: resolvedColumns,
    cells,
    rowCount,
    editing: bool(value.editing, false),
    header: bool(value.header, true),
    ...(value.locked === true ? { locked: true } : {}),
  }
}

function makeTableColumns(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: mintId('col'),
    title: `Column ${index + 1}`,
    width: 1,
  }))
}

/* ------------------------------------------------------------------ */
/* the registry of readers                                              */
/* ------------------------------------------------------------------ */

const NORMALIZERS = {
  note: normalizeNote,
  video: normalizeVideo,
  flash: normalizeFlash,
  pdf: normalizePdf,
  link: normalizeLink,
  table: normalizeTable,
} as const

export type ElementKind = keyof typeof NORMALIZERS

/**
 * One element out of untrusted JSON.
 *
 * An unknown `kind` becomes a note rather than being dropped. A file written by a
 * later version of the app, opened by an earlier one, is a real thing that will
 * happen to somebody — and a note with the text still in it is a document they
 * can read and recover, where a gap is a page that came apart.
 */
export function normalizeElement(raw: unknown, index = 0): Element {
  const value = isRecord(raw) ? raw : {}
  const at = { x: index * 40 + 40, y: index * 30 + 40 }
  const kind = str(value.kind) as ElementKind
  const normalize = NORMALIZERS[kind] ?? normalizeNote
  return normalize(value, at)
}

/* ------------------------------------------------------------------ */
/* makers                                                               */
/* ------------------------------------------------------------------ */

/**
 * A new element of a kind.
 *
 * `position` is the top-left of where it should land; the caller passes what it
 * already knows, and this fills in a size that suits the kind — a video is wide
 * and short, a table is wide and tall, and a note is neither. One default size
 * for all six is how a page ends up with a postage stamp of a table.
 */
export function createElement(
  kind: string,
  input: Partial<Record<string, unknown>> = {},
  at: { x: number; y: number } = { x: 40, y: 40 },
): Element {
  const stamp = new Date().toISOString()
  const id = str(input.id) || mintId(kind)

  switch (kind) {
    case 'video': {
      const width = DEFAULT_ELEMENT_SIZE.width * 1.4
      return {
        ...baseOf({ ...input, id, createdAt: stamp, updatedAt: stamp }, at),
        width,
        // Height from the aspect, so a new video is never created stretched.
        height: Math.round(width / DEFAULT_VIDEO_ASPECT),
        kind: 'video',
        title: str(input.title, 'Video'),
        url: str(input.url),
        startSeconds: typeof input.startSeconds === 'number' ? input.startSeconds : null,
        display: oneOf(input.display, ['thumbnail', 'player'] as const, 'thumbnail'),
        keepAspect: true,
        aspect: DEFAULT_VIDEO_ASPECT,
      }
    }
    case 'table': {
      const columns = makeTableColumns(DEFAULT_TABLE_COLUMNS)
      return {
        ...baseOf({ ...input, id, createdAt: stamp, updatedAt: stamp }, at),
        // A table is wide and short, the way a grid of text wants to be read.
        width: Math.round(DEFAULT_ELEMENT_SIZE.width * 1.4),
        height: Math.round(DEFAULT_ELEMENT_SIZE.height * 0.9),
        kind: 'table',
        title: str(input.title, 'Table'),
        columns,
        cells: Array.from({ length: DEFAULT_TABLE_COLUMNS * DEFAULT_TABLE_ROWS }, () => ''),
        rowCount: DEFAULT_TABLE_ROWS,
        editing: false,
        header: true,
      }
    }
    case 'flash': {
      const cards = Array.isArray(input.cards)
        ? normalizeFlash({ ...input, id }, at).cards
        : [[{ id: mintId('face'), text: '' }, { id: mintId('face'), text: '' }]]
      return {
        ...baseOf({ ...input, id, createdAt: stamp, updatedAt: stamp }, at),
        kind: 'flash',
        title: str(input.title, 'Flashcards'),
        cards,
        cardIndex: 0,
        showing: 'front',
        presentation: 'single',
        hideAnswer: true,
      }
    }
    case 'pdf':
      return {
        ...baseOf({ ...input, id, createdAt: stamp, updatedAt: stamp }, at),
        kind: 'pdf',
        title: str(input.title, 'Document'),
        file: storedFileOrNull(input.file),
        url: str(input.url),
        display: 'chip',
        note: '',
      }
    case 'link':
      return {
        ...baseOf({ ...input, id, createdAt: stamp, updatedAt: stamp }, at),
        kind: 'link',
        title: str(input.title, str(input.url, 'Link')),
        url: str(input.url),
        display: 'chip',
        show: 'host',
        note: '',
      }
    case 'note':
    default:
      // A kind the maker does not implement falls back to a note, loudly.
      //
      // Falling back silently is the failure this comment exists to prevent: the
      // registry marks `link` and `table` as not-yet-built, a menu that ignored
      // that would ask for one, and the result would be a note titled "Table"
      // that the person made and cannot get back. A note plus a warning is
      // recoverable; a silent one is not.
      if (typeof console !== 'undefined') {
        console.warn(
          `[map204] no element maker for kind "${kind}" — made a note instead. ` +
            'The registry marks unimplemented kinds as unsupported so menus do not offer them.',
        )
      }
      return normalizeNote(
        { ...input, id, createdAt: stamp, updatedAt: stamp, kind: 'note' },
        at,
      )
  }
}

/* ------------------------------------------------------------------ */
/* groups, connections, pages, documents                                */
/* ------------------------------------------------------------------ */

function normalizeGroup(raw: unknown, index: number): Group {
  const value = isRecord(raw) ? raw : {}
  const position = isRecord(value.position) ? value.position : {}
  return {
    id: str(value.id) || mintId('grp'),
    title: str(value.title, 'Group'),
    x: num(position.x, index * 40),
    y: num(position.y, index * 40),
    width: Math.max(60, num(position.width, 400)),
    height: Math.max(60, num(position.height, 300)),
    zIndex: Math.round(num(position.zIndex, 0)),
    color: str(value.color, DEFAULT_NOTE_STYLE.accentColor),
    memberIds: Array.isArray(value.memberIds)
      ? value.memberIds.filter((id): id is string => typeof id === 'string')
      : [],
    createdAt: str(value.createdAt) || new Date().toISOString(),
    updatedAt: str(value.updatedAt) || new Date().toISOString(),
  }
}

const connectionStyleOf = (raw: unknown): ConnectionStyle => {
  const value = isRecord(raw) ? raw : {}
  const fallback = DEFAULT_CONNECTION_STYLE_V2
  return {
    color: str(value.color, fallback.color),
    width: clamp(num(value.width, fallback.width), 1, 12),
    lineStyle: oneOf(value.lineStyle, ['solid', 'dashed', 'dotted'] as const, fallback.lineStyle),
    // Every arrowhead the renderer draws. A list narrower than the renderer
    // would quietly replace the ones missing from it with a default, so that a
    // reader's diamond arrowhead came back as a plain arrow.
    routing: oneOf(value.routing, ['straight', 'curved', 'orthogonal'] as const, fallback.routing),
    arrowStart: oneOf(
      value.arrowStart,
      ['none', 'arrow', 'triangle', 'circle', 'diamond'] as const,
      'none',
    ),
    arrowEnd: oneOf(
      value.arrowEnd,
      ['none', 'arrow', 'triangle', 'circle', 'diamond'] as const,
      'arrow',
    ),
    animated: bool(value.animated),
  }
}

function normalizeConnection(raw: unknown): Connection | null {
  if (!isRecord(raw)) return null
  const endpoint = (side: unknown) => {
    if (!isRecord(side)) return null
    const id = strOrNull(side.id)
    if (!id) return null
    return { kind: side.kind === 'group' ? ('group' as const) : ('element' as const), id }
  }
  const source = endpoint(raw.source)
  const target = endpoint(raw.target)
  // A connection is a fact about two things. One end missing is not a connection
  // with an invisible half, it is a broken file.
  if (!source || !target) return null
  return {
    id: str(raw.id) || mintId('link'),
    source,
    target,
    // `null` means "the renderer picks". An unrecognised anchor is treated as
    // no anchor rather than being passed through, because the renderer has no
    // case for it and would fall back to its default anyway — silently, and with
    // a field that says something the canvas is not doing.
    sourceAnchor: oneOfOrNull(raw.sourceAnchor, ANCHORS),
    targetAnchor: oneOfOrNull(raw.targetAnchor, ANCHORS),
    label: str(raw.label),
    relationshipType: str(raw.relationshipType, DEFAULT_CONNECTION_STYLE_V2.relationshipType),
    style: connectionStyleOf(raw.style),
  }
}

function normalizeStep(raw: unknown): PresentationStepV2 | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id) || mintId('step')
  const kind = oneOf(raw.targetKind, ['element', 'group', 'page'] as const, 'page')
  return {
    id,
    // A step whose target is the whole page must not also name something, or the
    // camera centres on the named thing while the step claims to show everything.
    targetId: kind === 'page' ? null : strOrNull(raw.targetId),
    targetKind: kind,
    zoom: clamp(num(raw.zoom, 1), 0.05, 2),
    transition: oneOf(raw.transition, ['ease', 'linear', 'drift', 'instant'] as const, 'ease'),
    trigger: oneOf(raw.trigger, ['manual', 'timed', 'hold'] as const, 'manual'),
    // A countdown is floored at a second: a step that flashes past is not a step.
    autoAdvanceMs:
      raw.trigger === 'timed' ? clamp(Math.round(num(raw.autoAdvanceMs, 4000)), 1000, 120000) : 0,
    // An `instant` step has no arrival to animate, so its duration is zero.
    // Everything else keeps the number the file gave it, within a range that
    // stops a 9e9 duration from hanging the tab.
    //
    // This read `oneOf(raw.transition, ['instant'], 'ease')` and tested the
    // result for truthiness. `oneOf` returns the *value*, not a boolean — and
    // 'ease' is a truthy string — so every step, whatever its transition, was
    // given a duration of zero. The camera was cutting between steps and nobody
    // had noticed because a cut is not obviously wrong.
    durationMs:
      raw.transition === 'instant' ? 0 : clamp(Math.round(num(raw.durationMs, 450)), 0, 4000),
    focus: oneOf(raw.focus, ['none', 'dim', 'spotlight'] as const, 'none'),
  }
}

function normalizeSettings(raw: unknown): DocSettings {
  const value = isRecord(raw) ? raw : {}
  // Duplicate step ids are dropped rather than renamed. A duplicate makes React
  // keys collide and makes "remove this step" remove the wrong one, and
  // renaming it would give the copy a different identity than the file says it
  // has — so the second one goes and the run is one step shorter, visibly.
  const seen = new Set<string>()
  return {
    defaultNoteStyle: noteStyleOf(value.defaultNoteStyle),
    defaultConnectionStyle: DEFAULT_CONNECTION_STYLE_V2,
    defaultRelationshipType: str(value.defaultRelationshipType, 'related to'),
    steps: Array.isArray(value.steps)
      ? value.steps.flatMap((step) => {
          const normalized = normalizeStep(step)
          if (!normalized) return []
          if (seen.has(normalized.id)) return []
          seen.add(normalized.id)
          return [normalized]
        })
      : [],
  }
}

function normalizePage(raw: unknown, index: number): Page {
  const value = isRecord(raw) ? raw : {}
  const viewport = isRecord(value.viewport) ? value.viewport : {}
  const elements = Array.isArray(value.elements)
    ? value.elements.map((element, elementIndex) => normalizeElement(element, elementIndex))
    : []
  const elementIds = new Set(elements.map((element) => element.id))
  const groupIds = new Set<string>()

  const groups = Array.isArray(value.groups)
    ? value.groups.map((group, groupIndex) => {
        const normalized = normalizeGroup(group, groupIndex)
        groupIds.add(normalized.id)
        return normalized
      })
    : []

  // A group whose members are not on this page draws an empty frame, and a
  // connection to something that is not here is a line into the void. Both are
  // re-pointed here rather than trusted, because the file is untrusted and the
  // failure is silent — the frame is just empty, and nobody knows why.
  const connections = Array.isArray(value.connections)
    ? value.connections.flatMap((connection) => {
        const normalized = normalizeConnection(connection)
        if (!normalized) return []
        const resolves = (endpoint: { kind: string; id: string }) =>
          endpoint.kind === 'group' ? groupIds.has(endpoint.id) : elementIds.has(endpoint.id)
        return resolves(normalized.source) && resolves(normalized.target) ? [normalized] : []
      })
    : []

  return {
    id: str(value.id) || mintId('page'),
    title: str(value.title, 'Page'),
    ordinal: Math.round(num(value.ordinal, index)),
    viewport: {
      x: num(viewport.x, 0),
      y: num(viewport.y, 0),
      zoom: clamp(num(viewport.zoom, 1), 0.05, 4),
    },
    elements,
    groups: groups.map((group) => ({
      ...group,
      memberIds: group.memberIds.filter((id) => elementIds.has(id)),
    })),
    connections,
    createdAt: str(value.createdAt) || new Date().toISOString(),
    updatedAt: str(value.updatedAt) || new Date().toISOString(),
  }
}

/**
 * A group: a rectangle that contains elements.
 *
 * Its members are ids, not nested children. A group that held its contents
 * would have to decide what happens when one of them is dragged out, and
 * `memberIds` plus `groupContaining` answers that in one place instead of at
 * every read.
 */
export function createGroup(input: Partial<Group> = {}): Group {
  const stamp = new Date().toISOString()
  return {
    id: str(input.id) || mintId('group'),
    title: str(input.title, 'Group'),
    color: str(input.color, DEFAULT_GROUP_COLOR),
    memberIds: Array.isArray(input.memberIds)
      ? input.memberIds.filter((id): id is string => typeof id === 'string')
      : [],
    x: Math.round(num(input.x, 0)),
    y: Math.round(num(input.y, 0)),
    width: Math.max(80, num(input.width, 400)),
    height: Math.max(60, num(input.height, 300)),
    zIndex: Math.round(num(input.zIndex, 1)),
    createdAt: str(input.createdAt) || stamp,
    updatedAt: stamp,
  }
}

/**
 * A connection between two things.
 *
 * The anchors default to `null`, which means "the renderer picks the side". That
 * is the right default for a new edge: the person drawing it has not said where
 * it should attach, and guessing on their behalf means the guess is wrong as
 * soon as either end moves.
 */
export function createConnection(input: {
  id?: string
  source: { kind: 'element' | 'group'; id: string }
  target: { kind: 'element' | 'group'; id: string }
  sourceAnchor?: Anchor | null
  targetAnchor?: Anchor | null
  label?: string
  relationshipType?: string
  style?: Partial<ConnectionStyle>
}): Connection {
  return {
    id: str(input.id) || mintId('conn'),
    source: input.source,
    target: input.target,
    sourceAnchor: oneOfOrNull(input.sourceAnchor, ANCHORS),
    targetAnchor: oneOfOrNull(input.targetAnchor, ANCHORS),
    label: str(input.label),
    relationshipType: str(input.relationshipType, DEFAULT_RELATIONSHIP),
    style: { ...DEFAULT_CONNECTION_STYLE_V2, ...input.style },
  }
}

/** A whole document. */
export function normalizeDoc(raw: unknown): CanvasDocV2 {
  const value = isRecord(raw) ? raw : {}
  return {
    version: DOC_VERSION,
    pages: Array.isArray(value.pages)
      ? value.pages.map((page, index) => normalizePage(page, index))
      : [],
    settings: normalizeSettings(value.settings),
    uploadBytes: Math.max(0, num(value.uploadBytes, 0)),
  }
}

/** The same document, ready to be written or exported. */
export function serializeDoc(doc: CanvasDocV2): string {
  return JSON.stringify(doc, null, 2)
}

// Re-exported so callers can name the type without also reaching into the
// schema module. Everything the library accepts and returns is named from here.
export {
  DOC_VERSION,
  MAX_UPLOAD_BYTES,
  type CanvasDocV2,
  type Connection,
  type ConnectionStyle,
  type DocSettings,
  type Element,
  type ElementBase,
  type FlashElement,
  type FlashSide,
  type Group,
  type LinkElement,
  type NoteChecklistItem,
  type NoteElement,
  type NoteStyle,
  type Page,
  type PdfElement,
  type PresentationStepV2,
  type StoredFile,
  type TableColumn,
  type TableElement,
  type VideoElement,
} from './schema'
