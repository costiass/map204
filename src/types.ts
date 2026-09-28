/**
 * Map204 data model.
 *
 * The *document* — pages, elements, groups, connections, settings, presentation
 * steps — is defined in `elements/schema` and re-exported below, so every
 * `import { Page } from '@/types'` keeps working and gets the v2 shape.
 *
 * What stays here is the canvas's own vocabulary: coordinates, anchors, line and
 * arrow styles, the palette. Those are about how the thing is drawn rather than
 * about what a document contains.
 *
 * Coordinate contract (unchanged, and load-bearing):
 *  - `x` / `y` on an element are CANVAS / WORLD coordinates, flat rather than
 *    behind a nested `position` object.
 *  - The viewport (pan + zoom) is stored separately on the page, so changing the
 *    viewport never mutates an element's stored position, and moving an element
 *    never touches the viewport.
 *  - Connections only ever reference things by id. No connection stores
 *    coordinates, which is what keeps edges attached while elements move.
 */

export type GridPattern = 'none' | 'dots' | 'lines'

/**
 * The line and arrow vocabulary belongs to the connection style, so it is
 * defined once in the schema and named here. Two lists of "what arrowheads can
 * this draw" is one of them wrong, and the wrong one is a user who picks a shape
 * and gets a different one.
 *
 * `LineStyle`, `ArrowStyle` and `Routing` are therefore *derived* from
 * `ConnectionStyle` rather than written out again.
 */
type Style = import('@/elements/schema').ConnectionStyle
export type LineStyle = Style['lineStyle']
export type ArrowStyle = Style['arrowStart']
export type Routing = 'curved' | 'straight' | 'orthogonal'

// Imported, not only re-exported: `export type { Anchor } from` is not in this
// file's own scope, and `ANCHORS` below is annotated with it.
import type { Anchor } from '@/elements/schema'

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

/* ------------------------------------------------------------------ */
/* The document model lives in `elements/schema`                        */
/* ------------------------------------------------------------------ */

/**
 * Everything about what a page *contains* is defined in `@/elements/schema` and
 * re-exported here.
 *
 * Not tidiness. It is what stops the two from drifting: the schema is what the
 * element types are written against, and a second copy of `Page` here would be a
 * second thing to remember to change whenever one of them moves. One definition,
 * two ways to import it.
 */
export { DOC_VERSION, MAX_UPLOAD_BYTES } from '@/elements/schema'

/** Which side of a box an edge leaves from. Defined in the schema — see there. */
export type { Anchor } from '@/elements/schema'

export type {
  CanvasDocV2 as CanvasDoc,
  Connection,
  ConnectionStyle,
  DocSettings,
  Element,
  ElementBase,
  ElementKindName,
  FlashElement,
  FlashSide,
  Group,
  LinkElement,
  NoteChecklistItem as ChecklistItem,
  NoteElement,
  NoteStyle as CardStyle,
  Page,
  PdfElement,
  PresentationStepV2 as PresentationStep,
  RefDisplay,
  StepFocusV2 as StepFocus,
  StepTransitionV2 as StepTransition,
  StepTriggerV2 as StepTrigger,
  StoredFile,
  TableColumn,
  TableElement,
  VideoDisplay,
  VideoElement,
} from '@/elements/schema'

/**
 * An endpoint of a connection.
 *
 * A connection is between two things, and each end is either an element of any
 * kind or a group. It used to be a `Card`, and the word outlived the thing it
 * named — which is the sort of thing that makes a type read narrower than it is.
 */
export type ConnectionEndpoint = { kind: 'element' | 'group'; id: string }

/** The image on a note: a stored file's path, or a URL, or nothing. */
export type CardImage = { src: string | null; alt: string }

/** What a card used to be called, where the name still appears in a string. */
export type CardType = 'note' | 'flash' | 'video' | 'pdf' | 'link' | 'table'


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
export const ROUTINGS: Routing[] = ['curved', 'straight', 'orthogonal']
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

/* ------------------------------------------------------------------ */
/* Defaults                                                             */
/* ------------------------------------------------------------------ */

/**
 * The defaults live in `elements/defaults`, because there are three ways to make
 * an element — the toolbar, the context menu, a keyboard shortcut — and three
 * copies of "what does a new note look like" is three places for them to
 * disagree.
 *
 * Re-exported under the names the chrome already uses, so nothing outside this
 * file has to know where they came from. Imported as well, because a re-export
 * is not in this file's own scope and the two functions below name these types.
 */
export {
  DEFAULT_CONNECTION_STYLE_V2 as DEFAULT_CONNECTION_STYLE,
  DEFAULT_NOTE_STYLE as DEFAULT_CARD_STYLE,
  DEFAULT_VIDEO_ASPECT,
} from '@/elements/defaults'
import {
  DEFAULT_CONNECTION_STYLE_V2 as DEFAULT_CONNECTION_STYLE,
  DEFAULT_NOTE_STYLE as DEFAULT_CARD_STYLE,
} from '@/elements/defaults'
import type { DocSettings, PresentationStepV2 as PresentationStep } from '@/elements/schema'

export const MIN_CARD_BORDER_WIDTH = 0
export const MAX_CARD_BORDER_WIDTH = 8

/** A link with no relationship: drawn, but with no word on it. */
export const NO_RELATIONSHIP = ''

/** The relationship a brand-new link gets before any default is set. */
export const DEFAULT_RELATIONSHIP = 'related to'

/** The starting point for a fresh document, before any user preferences. */
export function createDefaultSettings(): DocSettings {
  return {
    defaultNoteStyle: { ...DEFAULT_CARD_STYLE },
    defaultConnectionStyle: { ...DEFAULT_CONNECTION_STYLE },
    defaultRelationshipType: DEFAULT_RELATIONSHIP,
    steps: [],
  }
}

/**
 * What a new step gets, before anybody touches it.
 *
 * In one place, because a step built from three different places — the toolbar,
 * the inspector, a keyboard shortcut — and assembled slightly differently in
 * each is how a presentation ends up with steps that do not match.
 *
 * These are the *arrival* defaults. `autoAdvanceMs` is 0 because the trigger is
 * `manual`, and a manual step has nothing to count down.
 */
export function createDefaultStep(
  input: Partial<Omit<PresentationStep, 'id'>> = {},
): Omit<PresentationStep, 'id'> {
  const transition = input.transition ?? 'ease'
  const trigger = input.trigger ?? 'manual'
  return {
    targetId: input.targetId ?? null,
    targetKind: input.targetKind ?? 'page',
    zoom: input.zoom ?? 1,
    transition,
    trigger,
    autoAdvanceMs: trigger === 'timed' ? (input.autoAdvanceMs ?? 4000) : 0,
    durationMs: transition === 'instant' ? 0 : (input.durationMs ?? 450),
    focus: input.focus ?? 'none',
  }
}
