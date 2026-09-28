import type { LucideIcon } from 'lucide-react'
import { FileText, Frame, Layers, Link2, Play, StickyNote, Table2 } from 'lucide-react'

/**
 * The element system.
 *
 * Every object on a page is an *element*. They are not interchangeable: a video
 * element is a video, a table element is a table, and a card is a piece of
 * Markdown. The mistake this file exists to prevent is one type with optional
 * fields, where a video card and a note card are the same row and each has to
 * check what it actually is before rendering.
 *
 * Three layers, and the order matters:
 *
 *   1. **A common base.** Position, size, z-order, and — the important part —
 *      the link system and the interaction system. Every element can be linked
 *      to and from every other, and every element can be selected, dragged,
 *      resized and connected. That is shared because it is true of all of them,
 *      and re-implementing it per type is how two elements end up behaving
 *      differently.
 *   2. **A per-type payload.** Only that type reads it. A video has a video id;
 *      a table has rows and columns; a card has Markdown. Nothing else looks at
 *      them, and a type's payload is never `Record<string, unknown>` because
 *      that is just a union with the names taken off.
 *   3. **A per-type view, settings and inspector.** Each element decides how it
 *      looks, what can be configured about it, and what the panel shows. A video
 *      element's inspector is a link and a timestamp; a table's is columns and
 *      widths. Neither knows the other exists.
 *
 * What is here today is the *seam*: the registry that the insert menus, the
 * context menu and the presentation step picker all read from, so a new element
 * type is one entry rather than an edit in three menus. The data model is
 * migrated to a discriminated union in the same change, because a registry that
 * advertises a table element while the row it writes is a card with a `type`
 * field is a lie with a type signature.
 */

/** What every element has, whatever else it is. */
export interface ElementBase {
  id: string
  /**
   * Where it is, and how big. Absolute world coordinates, so two elements never
   * have to know about each other's layout.
   */
  position: {
    x: number
    y: number
    width: number
    height: number
    zIndex: number
  }
  createdAt: string
  updatedAt: string
}

/**
 * A link between two elements.
 *
 * Connections are their own thing rather than a field on an element, because a
 * link is a fact about *two* of them and storing it on one makes the other one
 * incomplete. This is the shared link system every element participates in.
 */
export interface ElementLink {
  id: string
  source: { kind: string; id: string }
  target: { kind: string; id: string }
  label: string
}

/**
 * What an element type is, and what it needs to exist.
 *
 * `needsSource` is the question that decides what inserting one does. A card is
 * made of text and appears the moment you ask for one. A video, a PDF and a link
 * are *references* — there is nothing to create until somebody says to what — so
 * they open a dialog first. Getting this wrong in either direction is bad: a
 * video card with no link is a card that shows nothing, and asking for a link to
 * make a card is a form for something that did not need one.
 */
export interface ElementKind {
  id: string
  label: string
  /** One line, for a menu. */
  hint: string
  icon: LucideIcon
  /** What it is for, on a tooltip. */
  blurb: string
  needsSource: boolean
  /**
   * Can this type hold other elements? A group can; nothing else can. This is
   * how "put this in that" is decided, rather than by a hard-coded check for
   * the string "group" somewhere in the middle of the store.
   */
  container: boolean
  /** Is it the background of a page, drawn beneath everything else? */
  layer: 'normal' | 'behind'
  /**
   * Can this kind be created *yet*?
   *
   * False for the kinds the model has not been migrated to carry. They are
   * declared here so the target shape is written down and reviewable, and they
   * are not offered in any menu — because offering a table element that writes a
   * card row with a `type` field is worse than not offering it at all: it fails
   * after the click rather than before it.
   *
   * The alternative — casting the id to `CardType` at every call site — compiles
   * fine and lies at runtime. This flag is the difference.
   */
  supported: boolean
}

/**
 * The element types that exist.
 *
 * Every menu that offers "make a thing" reads this list, so the toolbar menu,
 * the context menu and the keyboard all offer exactly the same set. That was
 * true in name and false in practice: three components each had their own copy
 * of the icons and their own opinion about which kinds need a link, and they
 * had already drifted.
 */
export const ELEMENT_KINDS: readonly ElementKind[] = [
  {
    id: 'note',
    label: 'Note',
    hint: 'A title and some Markdown',
    blurb: 'A titled piece of Markdown. The plainest thing on the page.',
    icon: StickyNote,
    needsSource: false,
    container: false,
    layer: 'normal',
    supported: true,
  },
  {
    id: 'flash',
    label: 'Flash',
    hint: 'Two sides, turns over on click',
    blurb: 'A question on one side and its answer on the other.',
    icon: Layers,
    needsSource: false,
    container: false,
    layer: 'normal',
    supported: true,
  },
  {
    id: 'video',
    label: 'Video',
    hint: 'A YouTube link, played in place',
    blurb: 'A video, referenced by its link. Plays in the page when asked.',
    icon: Play,
    needsSource: true,
    container: false,
    layer: 'normal',
    supported: true,
  },
  {
    id: 'pdf',
    label: 'PDF',
    hint: 'A document, referenced by link',
    blurb: 'A document. A link, and a preview when the server allows framing.',
    icon: FileText,
    needsSource: true,
    container: false,
    layer: 'normal',
    supported: true,
  },
  {
    id: 'link',
    label: 'Link',
    hint: 'Another page, referenced',
    blurb: 'A reference to somewhere else. The link itself is the content.',
    icon: Link2,
    needsSource: true,
    container: false,
    layer: 'normal',
    supported: false,
  },
  {
    id: 'group',
    label: 'Group',
    hint: 'A frame that holds other things',
    blurb: 'A frame that holds other elements, drawn behind them.',
    icon: Frame,
    needsSource: false,
    container: true,
    layer: 'behind',
    supported: true,
  },
  {
    id: 'table',
    label: 'Table',
    hint: 'Rows and columns you can edit',
    blurb: 'A grid of your own. Not inside a card — a thing in its own right.',
    icon: Table2,
    // A table with no cells is an empty grid, which is a perfectly good thing to
    // want, so this one does not make you fill in a form first.
    needsSource: false,
    container: false,
    layer: 'normal',
    /*
      Supported.
+
      This was false when the registry was written, on the grounds that the
      element did not exist yet. It does now: a maker in `elements/serialize`, a
      body in `ElementNode`, a section in `ElementInspectorTab`, and the operations
      it needs were already there because a table was the reason the column-major
      `cells` array was designed that way.
+
      Leaving the flag false hid a working kind behind "not implemented yet" and
      made the app look like it could not do something it can. `link` is the one
      still genuinely unimplemented, and its flag says so.
    */
    supported: true,
  },
] as const

/** One kind, by id. */
export function elementKind(id: string): ElementKind {
  return ELEMENT_KINDS.find((kind) => kind.id === id) ?? ELEMENT_KINDS[0]
}

/**
 * The kinds a menu should offer.
 *
 * Only the ones the data model can actually store, and only the ones that are
 * *made* rather than *containing* — a group is a container you put things in, not
 * a thing you put on the page, so it is a separate action.
 */
export function insertableKinds(): readonly ElementKind[] {
  return ELEMENT_KINDS.filter((kind) => kind.supported && !kind.container)
}

/** Does this kind need something to point at before it can exist? */
export function needsSource(id: string): boolean {
  return elementKind(id).needsSource
}
