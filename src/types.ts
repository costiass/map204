/**
 * Map204 data model.
 *
 * Coordinate contract (important):
 *  - `position.x` / `position.y` are CANVAS / WORLD coordinates.
 *  - The viewport (pan + zoom) is stored separately on the page, so changing the
 *    viewport never mutates a card's stored position, and moving a card never
 *    touches the viewport.
 *  - Connections only ever reference cards by id. No connection stores
 *    coordinates, which is what keeps edges attached while cards move.
 */

export const DOC_VERSION = 1

export type Anchor = 'top' | 'right' | 'bottom' | 'left'
export type LineStyle = 'solid' | 'dashed' | 'dotted'
export type ArrowStyle = 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond'
export type Routing = 'curved' | 'straight' | 'stepped'
export type GridPattern = 'none' | 'dots' | 'lines'

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface CardImage {
  src: string | null
  alt: string
}

export interface CardPosition {
  x: number
  y: number
  width: number
  height: number
  zIndex: number
}

export type Position = CardPosition

export interface CardStyle {
  backgroundColor: string
  accentColor: string
  textColor: string
  borderColor: string
  borderWidth: number
  borderRadius: number
  shadow: boolean
}

/**
 * What a card *is*.
 *
 * Each kind does one job, rather than being a Markdown body with an optional
 * embed field bolted on — one unreadable card that tries to be three things is
 * worse than three cards that are each one thing.
 *
 *   note      the original: a title and a Markdown body
 *   flash     two sides, and a click turns it over
 *   youtube   a video, rendered from a YouTube id
 *   pdf       a document, referenced by URL
 *
 * `note` is the default everywhere, so a document written before this existed
 * needs no migration: a card with no `type` is a note.
 */
export type CardType = 'note' | 'flash' | 'youtube' | 'pdf'

/**
 * The thing a non-note card refers to.
 *
 * Only `url` is stored. For YouTube the video id is *derived* from it rather
 * than kept alongside, so the two cannot drift apart — a card whose id and URL
 * disagree is a card that shows the wrong video.
 */
export interface CardEmbed {
  url: string
  /** Per-kind extras: `{ start }` for a timestamp, `{ pages }` for a PDF. */
  meta?: Record<string, string | number | boolean>
}

export interface Card {
  id: string
  /** Which of the kinds above this card is. Absent means `note`. */
  type: CardType
  title: string
  /**
   * The card body, stored as Markdown — the same format the document itself
   * uses. Images are ordinary Markdown and may appear anywhere:
   * `![alt](url)` or a pasted `data:image/...` URL.
   *
   * For a non-note card this is a caption, and may be empty.
   */
  content: string
  /** What a `youtube` or `pdf` card points at. `null` for a note. */
  embed: CardEmbed | null
  image: CardImage
  position: CardPosition
  style: CardStyle
  tags: string[]
  collapsed: boolean
  /** Optional child-card relationship. `null` means top-level. */
  parentId: string | null
  checklist: ChecklistItem[]
  createdAt: string
  updatedAt: string
}

export interface GroupPosition {
  x: number
  y: number
  width: number
  height: number
  zIndex: number
}

export interface Group {
  id: string
  title: string
  position: Position
  color: string
  memberCardIds: string[]
  memberGroupIds: string[]
  createdAt: string
  updatedAt: string
}

export interface ConnectionStyle {
  color: string
  width: number
  lineStyle: LineStyle
  routing: Routing
  arrowStart: ArrowStyle
  arrowEnd: ArrowStyle
  animated: boolean
}

export type ConnectionEndpoint =
  | { kind: 'card'; id: string }
  | { kind: 'group'; id: string }

export interface Connection {
  id: string
  source: ConnectionEndpoint
  target: ConnectionEndpoint
  /** `null` = pick the best side automatically from relative geometry. */
  sourceAnchor: Anchor | null
  targetAnchor: Anchor | null
  label: string
  /** Free-form, but see RELATIONSHIP_PRESETS for the suggested values. */
  relationshipType: string
  style: ConnectionStyle
}

export interface Page {
  id: string
  title: string
  position: Position
  viewport: Viewport
  cards: Card[]
  groups: Group[]
  connections: Connection[]
  createdAt: string
  updatedAt: string
}

/**
 * One step of a presentation: what to show, and how closely.
 *
 * The target is a card *or* a group — a group being the natural way to frame a
 * section of a map, which is the thing a presentation actually wants to point
 * at. The zoom is absolute rather than a multiplier because "the same size as
 * last time" is not a thing you can reason about while presenting; 1.4 either
 * means the same thing every time or the reader has no idea.
 */
export interface PresentationStep {
  id: string
  /** A card or group on the page. `null` for an establishing shot of the page. */
  targetId: string | null
  targetKind: 'card' | 'group' | 'page'
  /** How close to come. Clamped to the app's zoom limits, and never more than
   *  the target actually fits at — see `stepViewport`. */
  zoom: number
  /**
   * How long the camera takes to arrive, in ms. Zero snaps. Longer reads as a
   * deliberate move rather than a jump, which is the difference between a
   * presentation and a slideshow.
   */
  durationMs: number
}

/**
 * Document-wide choices, stored with the document so an exported file carries
 * the look of the workspace with it. `setDefaultCardStyle` / right-click →
 * "Set as default style" writes here; new objects inherit from it.
 */
export interface DocSettings {
  defaultCardStyle: CardStyle
  defaultConnectionStyle: ConnectionStyle
  /**
   * Relationship new links start with. `''` means no relationship at all, which
   * is a valid choice: the link is drawn without a word on it. Set from a link
   * with "Set as default for new links".
   */
  defaultRelationshipType: string
  /**
   * The presentation, in order.
   *
   * It lives here rather than in a table of its own because it is per-document
   * and `settings` is already per-document JSONB — so a presentation travels in
   * an export and needs no migration. It is not a *default* like the two fields
   * above, and the name says so.
   */
  steps: PresentationStep[]
}

export interface CanvasDoc {
  version: number
  pages: Page[]
  settings: DocSettings
}

/* ------------------------------------------------------------------ */
/* Presets & defaults                                                 */
/* ------------------------------------------------------------------ */

export const RELATIONSHIP_PRESETS = [
  'related to',
  'supports',
  'depends on',
  'example of',
  'causes',
  'contradicts',
  'part of',
  'leads to',
] as const

export const ANCHORS: Anchor[] = ['top', 'right', 'bottom', 'left']
export const LINE_STYLES: LineStyle[] = ['solid', 'dashed', 'dotted']
export const ROUTINGS: Routing[] = ['curved', 'straight', 'stepped']
export const ARROW_STYLES: ArrowStyle[] = ['none', 'arrow', 'triangle', 'circle', 'diamond']

export const CARD_BACKGROUNDS = [
  '#FFF8CC',
  '#FFE4E6',
  '#FCE7F3',
  '#EDE9FE',
  '#E0E7FF',
  '#DBEAFE',
  '#CFFAFE',
  '#DCFCE7',
  '#FEF3C7',
  '#FFEDD5',
  '#F1F5F9',
  '#FFFFFF',
]

export const CARD_ACCENTS = [
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#8B5CF6',
  '#6366F1',
  '#0EA5E9',
  '#06B6D4',
  '#22C55E',
  '#F97316',
  '#64748B',
  '#111827',
]

export const CONNECTION_COLORS = [
  '#6366F1',
  '#0EA5E9',
  '#22C55E',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
  '#111827',
]

export const TEXT_COLORS = ['#111827', '#1F2937', '#374151', '#0F172A', '#FFFFFF', '#78350F']

export const MIN_CARD_WIDTH = 180
export const MIN_CARD_HEIGHT = 110
export const MAX_CARD_WIDTH = 1200
export const MAX_CARD_HEIGHT = 1600

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 2
export const DEFAULT_GRID_SIZE = 20
export const COLLAPSED_HEADER_HEIGHT = 34

export const DEFAULT_CARD_STYLE: CardStyle = {
  backgroundColor: '#ffffff',
  accentColor: '#6366F1',
  textColor: '#111827',
  borderColor: '#E5E7EB',
  borderWidth: 1,
  borderRadius: 12,
  shadow: true,
}

export const DEFAULT_CONNECTION_STYLE: ConnectionStyle = {
  color: '#6366F1',
  width: 2,
  lineStyle: 'solid',
  routing: 'curved',
  arrowStart: 'none',
  arrowEnd: 'arrow',
  animated: false,
}

export const MIN_CARD_BORDER_WIDTH = 0
export const MAX_CARD_BORDER_WIDTH = 8

/** A link with no relationship: drawn, but with no word on it. */
export const NO_RELATIONSHIP = ''

/** The relationship a brand-new link gets before any default is set. */
export const DEFAULT_RELATIONSHIP = 'related to'

/** The starting point for a fresh document, before any user preferences. */
export function createDefaultSettings(): DocSettings {
  return {
    defaultCardStyle: { ...DEFAULT_CARD_STYLE },
    defaultConnectionStyle: { ...DEFAULT_CONNECTION_STYLE },
    defaultRelationshipType: DEFAULT_RELATIONSHIP,
    steps: [],
  }
}
