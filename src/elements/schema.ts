/**
 * Document version 2 — the element model.
 *
 * Version 1 stored every object as a `Card`: one row, one shape, with a `type`
 * string and a bag of optional fields. `title` and `content` on a video were
 * fields nothing read. `embed` on a note was a field that was always null. The
 * type was a string rather than a union, so nothing checked it, and every
 * renderer started with a chain of `if` asking what it was actually holding.
 *
 * Version 2 makes the type the *shape*. A `NoteElement` has no video id, and
 * there is no way to write one, because the JSON has no field for it. That is
 * the whole point: a wrong shape is unrepresentable rather than validated.
 *
 * So each element is a discriminated union member, sharing a `ElementBase`, and
 * its own payload is only read by its own renderer, its own inspector and its
 * own migration.
 */

/** The current document format. Bumped only when the shape changes. */
export const DOC_VERSION = 2

/* ------------------------------------------------------------------ */
/* The base                                                            */
/* ------------------------------------------------------------------ */

/**
 * What every element has, whatever else it is.
 *
 * Position and size are the interaction system's, not any one element's, which
 * is why they are here and not repeated. Two elements that each had their own
 * copy are two elements that can disagree about where they are.
 */
export interface ElementBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** Painted in this order. Higher is nearer. */
  zIndex: number
  createdAt: string
  updatedAt: string
  /**
   * Whether the player can move this. Not a style — a *constraint* on the
   * interaction system, and the one every element respects.
   */
  locked?: boolean
  collapsed?: boolean
}

/* ------------------------------------------------------------------ */
/* Note                                                                */
/* ------------------------------------------------------------------ */

export interface NoteStyle {
  backgroundColor: string
  accentColor: string
  textColor: string
  borderColor: string
  borderWidth: number
  borderRadius: number
  shadow: boolean
}

export interface NoteChecklistItem {
  id: string
  text: string
  done: boolean
}

/** A piece of Markdown with a title. The plainest thing on the page. */
export interface NoteElement extends ElementBase {
  kind: 'note'
  title: string
  /** Markdown. The same format the document itself uses. */
  body: string
  style: NoteStyle
  checklist: NoteChecklistItem[]
  tags: string[]
  image: { src: string | null; alt: string }
}

/* ------------------------------------------------------------------ */
/* Video                                                               */
/* ------------------------------------------------------------------ */

/** How a video element draws itself. */
export type VideoDisplay = 'thumbnail' | 'player'

export interface VideoElement extends ElementBase {
  kind: 'video'
  title: string
  /**
   * The link, kept as the truth. The id is *derived* from it on read and never
   * stored beside it, because a card whose id and URL disagree shows the wrong
   * video and there is no way to tell which one is right.
   */
  url: string
  /** Where in the video to start, in seconds. From the link, or set by hand. */
  startSeconds: number | null
  /** Which face to show before anybody clicks. */
  display: VideoDisplay
  /**
   * Whether the element keeps the video's shape as it is resized.
   *
   * On by default, and it is the reason this field exists: a video resized to a
   * different shape is a stretched video, which looks broken rather than chosen.
   */
  keepAspect: boolean
  /**
   * The shape to keep, as width over height. Captured from the link when the
   * video is first added, and used by the resizer.
   */
  aspect: number | null
}

/* ------------------------------------------------------------------ */
/* Flashcards                                                          */
/* ------------------------------------------------------------------ */

export interface FlashSide {
  id: string
  /** The question, or the answer. Which is which depends on the card's `front`. */
  text: string
}

export interface FlashElement extends ElementBase {
  kind: 'flash'
  title: string
  /**
   * Every card in the deck, each one a pair of sides.
   *
   * A *list*, not a single pair. One element is a deck: the arrows step through
   * it, the counter says where you are, and the element resizes to show the
   * largest card rather than clipping. A deck of one is a flash card, which is
   * why this is the only shape and there is no separate single-card type.
   */
  cards: FlashSide[][]
  /** Which side is showing. `front` is the question. */
  showing: 'front' | 'back'
  /**
   * Which card of the deck is showing. Wraps, because a deck is something you
   * flick through. Clamped on load — a file saying card 900 of a two-card deck is
   * a bug in the file, and a deck that shows nothing is a worse outcome than
   * showing the first one.
   */
  cardIndex: number
  /** Whether the deck is stepped through on the canvas or only in the inspector. */
  presentation: 'carousel' | 'single'
  /** Whether the answer is hidden until the card is clicked. */
  hideAnswer: boolean
}

/* ------------------------------------------------------------------ */
/* Document reference (PDF and link)                                   */
/* ------------------------------------------------------------------ */

/** How a reference draws itself. */
export type RefDisplay = 'chip' | 'preview' | 'open'

/**
 * A file that lives on our server rather than somewhere else.
 *
 * Stored as a path, never as bytes. Base64 in a page's JSONB is a third larger
 * than the file, it is rewritten on every autosave, and two people editing the
 * same page would each upload the whole document to move one cell of a table.
 */
export interface StoredFile {
  /** Path in the document's folder, not a full URL. */
  path: string
  name: string
  /** Bytes. Used to refuse an upload that would blow the quota, not trusted. */
  size: number
  mime: string
}

/** A PDF. A reference, not a document — the file is somewhere, not here. */
export interface PdfElement extends ElementBase {
  kind: 'pdf'
  title: string
  /** Either an upload or a link. Never both; an upload wins. */
  file: StoredFile | null
  url: string
  display: RefDisplay
  /** Shown when the server will not allow framing. Always available. */
  note: string
}

/** Another page, or anywhere else. The link is the content. */
export interface LinkElement extends ElementBase {
  kind: 'link'
  title: string
  url: string
  display: RefDisplay
  /**
   * What to show in the chip. A link to a long URL is unreadable at chip size,
   * so the host is shown unless somebody has given it a better name.
   */
  show: 'host' | 'full' | 'none'
  note: string
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export interface TableColumn {
  id: string
  title: string
  /** Relative widths, so a table is not tied to a pixel size. */
  width: number
}

export interface TableElement extends ElementBase {
  kind: 'table'
  title: string
  columns: TableColumn[]
  /**
   * One string per cell, in column-major order — so a cell is
   * `cells[column * rowCount + row]`. Storing strings rather than objects is the
   * point: a grid of text is a grid of text, and a cell is not a thing with a
   * `text` field, a `bold` field and a colour that nothing reads.
   */
  cells: string[]
  /**
   * How many rows. Derivable from `cells.length / columns.length`, but stored so
   * an empty table has a height to render rather than collapsing to nothing.
   */
  rowCount: number
  /**
   * Where a click lands. A table is for reading; making it editable in place is
   * a mode you enter deliberately, not the default state of a thing on a canvas.
   */
  editing: boolean
  /** Whether the first row is repeated and styled as a header. */
  header: boolean
}

/* ------------------------------------------------------------------ */
/* Group                                                               */
/* ------------------------------------------------------------------ */

/**
 * A frame that holds other elements.
 *
 * A group is *not* an element in its own right — it has no content, only a
 * rectangle and a set of members. That is why it is a layer rather than an
 * element: it is drawn behind its members, and moving it moves them.
 */
export interface Group {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  color: string
  /** Elements inside. Order is not meaningful; the rectangle is. */
  memberIds: string[]
  createdAt: string
  updatedAt: string
  collapsed?: boolean
}

/* ------------------------------------------------------------------ */
/* The union                                                           */
/* ------------------------------------------------------------------ */

/**
 * One thing on a page.
 *
 * `kind` is the discriminant, and it is a *union* rather than a string, so a
 * `VideoElement` cannot be given a `cards` field and a `NoteElement` cannot be
 * given a `url`. Every switch on `kind` is checked, and adding an element type
 * makes each exhaustive switch fail to compile until it is handled — which is the
 * property the version 1 string type did not have.
 */
export type Element =
  | NoteElement
  | VideoElement
  | FlashElement
  | PdfElement
  | LinkElement
  | TableElement

export type ElementKindName = Element['kind']

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/**
 * Which side of a box an edge leaves from.
 *
 * Defined here rather than in `types.ts` because a connection stores two of
 * them, and a document type should not depend on a file that depends on it.
 */
export type Anchor = 'top' | 'right' | 'bottom' | 'left'

export interface Connection {
  id: string
  source: { kind: 'element' | 'group'; id: string }
  target: { kind: 'element' | 'group'; id: string }
  /**
   * Which side of each end the edge leaves from, or `null` to let the renderer
   * choose.
   *
   * Kept from version 1. They are optional on purpose: `null` means "pick the
   * sensible side", which is what an edge wants when the thing it points at
   * moves. A stored anchor is a person overriding that, and it is wrong the
   * moment either end is dragged somewhere else.
   */
  sourceAnchor: Anchor | null
  targetAnchor: Anchor | null
  label: string
  relationshipType: string
  style: ConnectionStyle
}

/**
 * How a connection is drawn.
 *
 * Every value here is one `utils/edges.ts` actually draws. A version of this
 * schema briefly narrowed `routing` and dropped two arrowheads; the renderer
 * implemented all of them and the editor offered all of them, so the narrowing
 * would have removed working features during a data migration. A schema is not
 * the place to decide what the product should support.
 *
 * `orthogonal` is the name the schema uses for what the renderer calls `stepped`
 * and what the old editor called `stepped` too. The rename is the only change.
 */
export interface ConnectionStyle {
  color: string
  width: number
  lineStyle: 'solid' | 'dashed' | 'dotted'
  routing: 'straight' | 'curved' | 'orthogonal'
  arrowStart: 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond'
  arrowEnd: 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond'
  animated: boolean
}

export interface Page {
  id: string
  title: string
  ordinal: number
  viewport: { x: number; y: number; zoom: number }
  elements: Element[]
  groups: Group[]
  connections: Connection[]
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

/**
 * How big a document's uploads may be, in total.
 *
 * Checked in the upload function and again by the storage bucket's policy. Both,
 * because a quota enforced only in the browser is a quota that can be skipped.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export interface DocSettings {
  defaultNoteStyle: NoteStyle
  defaultConnectionStyle: ConnectionStyle
  defaultRelationshipType: string
  steps: PresentationStepV2[]
}

export type StepTransitionV2 = 'ease' | 'linear' | 'drift' | 'instant'
export type StepTriggerV2 = 'manual' | 'timed' | 'hold'
export type StepFocusV2 = 'none' | 'dim' | 'spotlight'

export interface PresentationStepV2 {
  id: string
  targetId: string | null
  /** A card, a table, a video — whatever kind of thing it points at. */
  targetKind: 'element' | 'group' | 'page'
  zoom: number
  transition: StepTransitionV2
  trigger: StepTriggerV2
  autoAdvanceMs: number
  durationMs: number
  focus: StepFocusV2
}

export interface CanvasDocV2 {
  version: typeof DOC_VERSION
  pages: Page[]
  settings: DocSettings
  /** Running total of uploaded bytes, so the quota is visible before it is hit. */
  uploadBytes: number
}
