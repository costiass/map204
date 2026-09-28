/**
 * Version 1 documents into version 2 elements.
 *
 * This is the reason a format change is survivable. Anything that produces a
 * version 1 file — an export from the old app, a hand-written JSON, a colleague's
 * copy of a course — comes through here and comes out the other side as elements,
 * so the format can change without anyone's saved work depending on the version
 * the app happened to be on the day they exported.
 *
 * What changes, and why each one is a translation rather than a copy:
 *
 *   cards          → elements, split by their `type`. A version 1 card carried
 *                    every field of every kind, most of them empty; a version 2
 *                    element carries only the ones its kind reads. A video's
 *                    empty `title` does not survive, because there is nowhere to
 *                    put it.
 *   position       → x/y/width/height on the base. Flattened, because every
 *                    element has it and nesting it inside a `position` object
 *                    meant every type repeated the same five fields.
 *   content        → body, on a note. Renamed because "content" also meant the
 *                    page's whole payload in two other places, and the same word
 *                    meaning two things is how one of them gets read wrongly.
 *   embed          → the kind's own reference. A video's `embed.url` becomes the
 *                    video's `url`; a PDF's becomes the PDF's; neither keeps an
 *                    `embed` wrapper, because a wrapper is a type that owns
 *                    another type's fields.
 *   a flash card   → a deck of one. Not a special case for its own sake: a deck
 *                    of one *is* a flash card, so the translation is exact
 *                    rather than approximate, and there is no single-card shape
 *                    to keep supporting.
 *   groups         → unchanged in substance. Their members are re-pointed at the
 *                    new element ids, because the ids are re-issued on import
 *                    and a group pointing at an id that no longer exists draws
 *                    an empty frame.
 *
 * What is deliberately *not* here: any attempt to be clever about a version 1
 * document that is already broken. A file whose connections point at cards that
 * do not exist was already broken before this function saw it, and silently
 * inventing the missing cards would be a lie about the file.
 */

import {
  DOC_VERSION,
  MAX_UPLOAD_BYTES,
  type CanvasDocV2,
  type Anchor,
  type Connection,
  type DocSettings,
  type Element,
  type Group,
  type NoteStyle,
  type Page,
  type PresentationStepV2,
} from './schema'
import { DEFAULT_NOTE_STYLE, DEFAULT_CONNECTION_STYLE_V2 } from './defaults'

/** The version 1 shapes, as loosely as they need to be described. */
interface V1Card {
  id?: unknown
  type?: unknown
  title?: unknown
  content?: unknown
  image?: unknown
  position?: unknown
  style?: unknown
  tags?: unknown
  collapsed?: unknown
  parentId?: unknown
  checklist?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  embed?: unknown
}

export interface MigrationResult {
  doc: CanvasDocV2
  /** What was changed, so an import can say what it did. */
  notes: string[]
  /** Things that could not be translated. Never swallowed. */
  warnings: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every arrowhead `utils/edges.ts` can actually draw. */
const ARROWHEADS = ['none', 'arrow', 'triangle', 'circle', 'diamond'] as const
type Arrowhead = (typeof ARROWHEADS)[number]

/**
 * A stored arrowhead, or the default.
 *
 * Written as an `includes` test rather than a `Set.has` one because `Set.has`
 * does not narrow, and the value on the other side is `unknown` off an imported
 * file.
 */
function arrowheadOf(value: unknown, fallback: Arrowhead): Arrowhead {
  return ARROWHEADS.includes(value as Arrowhead) ? (value as Arrowhead) : fallback
}

/** A side of a box, or `null` for "the renderer decides". */
function anchorOf(value: unknown): Anchor | null {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left'
    ? value
    : null
}

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const strOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

let counter = 0
/** Ids the translator mints, so two cards from the same file never collide. */
function mintId(prefix: string): string {
  counter += 1
  return `${prefix}_v2_${counter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function noteStyleOf(raw: unknown): NoteStyle {
  if (!isRecord(raw)) return { ...DEFAULT_NOTE_STYLE }
  const base = DEFAULT_NOTE_STYLE
  return {
    backgroundColor: str(raw.backgroundColor, base.backgroundColor),
    accentColor: str(raw.accentColor, base.accentColor),
    textColor: str(raw.textColor, base.textColor),
    borderColor: str(raw.borderColor, base.borderColor),
    borderWidth: num(raw.borderWidth, base.borderWidth),
    borderRadius: num(raw.borderRadius, base.borderRadius),
    shadow: typeof raw.shadow === 'boolean' ? raw.shadow : base.shadow,
  }
}

/** `youtube.com/watch?v=X` → the id, or null. A copy of the live one, because
 *  this module runs on files that never reach the app. */
function videoIdOf(url: string): string | null {
  const match = /(?:youtu\.be\/|[?&]v=|\/(?:embed|shorts|live|v)\/)([A-Za-z0-9_-]{11})/.exec(url)
  return match ? match[1] : null
}

function startSecondsOf(url: string): number | null {
  try {
    const value = new URL(url).searchParams.get('t') ?? new URL(url).searchParams.get('start')
    if (!value) return null
    const parsed = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value)
    if (!parsed) return null
    const total = Number(parsed[1] ?? 0) * 3600 + Number(parsed[2] ?? 0) * 60 + Number(parsed[3] ?? 0)
    return total > 0 ? total : null
  } catch {
    return null
  }
}

/**
 * One version 1 card into zero or more version 2 elements.
 *
 * Zero, because a card whose `type` is one this version has never heard of is
 * not a card of an unknown kind — it is something the file got wrong, and
 * inventing a note for it would turn a bad file into a plausible one.
 */
function convertCard(raw: unknown, index: number, stamp: string): Element | null {
  if (!isRecord(raw)) return null
  const card = raw as V1Card

  const position = isRecord(card.position) ? card.position : {}
  const base = {
    id: str(card.id) || mintId('el'),
    x: num(position.x, index * 40 + 40),
    y: num(position.y, index * 30 + 40),
    width: num(position.width, 280),
    height: num(position.height, 160),
    zIndex: num(position.zIndex, 1),
    createdAt: str(card.createdAt) || stamp,
    updatedAt: str(card.updatedAt) || stamp,
    ...(card.collapsed === true ? { collapsed: true } : {}),
  }

  const title = str(card.title, 'Untitled')
  const body = str(card.content)
  const type = str(card.type, 'note')

  const embed = isRecord(card.embed) ? card.embed : null
  const url = str(embed?.url)
  const embedMeta = isRecord(embed?.meta) ? embed.meta : {}
  const embedStart = num(embedMeta.start, 0)

  switch (type) {
    case 'note':
      return {
        ...base,
        kind: 'note',
        title,
        body,
        style: noteStyleOf(card.style),
        checklist: Array.isArray(card.checklist)
          ? card.checklist.flatMap((item) => {
              if (!isRecord(item) || typeof item.id !== 'string') return []
              return [{ id: item.id, text: str(item.text, 'New step'), done: item.done === true }]
            })
          : [],
        tags: Array.isArray(card.tags) ? card.tags.filter((t): t is string => typeof t === 'string') : [],
        image: {
          src: isRecord(card.image) ? strOrNull(card.image.src) : null,
          alt: isRecord(card.image) ? str(card.image.alt) : '',
        },
      }

    case 'flash': {
      // A version 1 flash card was one question and one answer, and the question
      // was the *title* — that is what the renderer put on the front face. So the
      // translation reads the same two fields the old renderer read, and getting
      // this backwards would quietly put the answer on the front of every
      // migrated card, which is the sort of thing nobody notices until they are
      // revising and the answers are wrong.
      //
      // Version 2's shape is a deck, so this is a deck of exactly one — an exact
      // translation rather than a loss, and it means there is no single-card
      // shape to support forever.
      return {
        ...base,
        kind: 'flash',
        title,
        cards: [[{ id: mintId('face'), text: title }, { id: mintId('face'), text: body }]],
        cardIndex: 0,
        showing: 'front',
        presentation: 'single',
        hideAnswer: true,
      }
    }

    case 'youtube':
    case 'video': {
      const id = videoIdOf(url)
      if (!id) return null
      // A timestamp in the link wins over a stored one, because the link is the
      // thing the author actually pasted.
      const fromLink = startSecondsOf(url)
      return {
        ...base,
        kind: 'video',
        title: title === 'Untitled' ? `Video ${id}` : title,
        url,
        startSeconds: fromLink ?? (embedStart > 0 ? embedStart : null),
        display: 'thumbnail' as const,
        keepAspect: true,
        aspect: null,
      }
    }

    case 'pdf':
      if (!url) return null
      return {
        ...base,
        kind: 'pdf',
        title,
        file: null,
        url,
        display: 'chip',
        note: '',
      }

    default:
      // `link` did not exist in version 1, and anything unrecognised is a file
      // that says something the app cannot honour. Returning null lets the
      // caller say so, rather than showing a note that was never written.
      return null
  }
}

/** The whole file. */
export function migrateToV2(input: unknown): MigrationResult {
  const notes: string[] = []
  const warnings: string[] = []
  const stamp = new Date().toISOString()
  counter = 0

  const root = isRecord(input) ? input : {}
  const version = num(root.version, 1)

  if (version >= DOC_VERSION) {
    // Already current, or newer than this build knows about. Either way it is
    // not this function's business, and re-running it would double-convert.
    return { doc: root as unknown as CanvasDocV2, notes, warnings }
  }

  notes.push(`Converted a version ${version} document to version ${DOC_VERSION}.`)

  const rawPages = Array.isArray(root.pages) ? root.pages : []
  if (rawPages.length === 0) warnings.push('The file has no pages.')

  /** Old id → new id, so groups and connections can be re-pointed. */
  const idMap = new Map<string, string>()

  const pages: Page[] = rawPages.flatMap((rawPage, pageIndex): Page[] => {
    if (!isRecord(rawPage)) return []
    const pageId = str(rawPage.id) || mintId('page')
    const rawCards = Array.isArray(rawPage.cards) ? rawPage.cards : []

    const elements: Element[] = []
    rawCards.forEach((rawCard, index) => {
      const element = convertCard(rawCard, index, stamp)
      if (!element) {
        const id = isRecord(rawCard) ? str(rawCard.id) : ''
        const type = isRecord(rawCard) ? str(rawCard.type, 'note') : '?'
        warnings.push(
          `Dropped a card of type "${type}"${id ? ` (${id})` : ''}: version 1 has no such kind, or it had nothing to show.`,
        )
        return
      }
      const previousId = isRecord(rawCard) ? str(rawCard.id) : ''
      if (previousId) idMap.set(previousId, element.id)
      elements.push(element)
    })

    const rawGroups = Array.isArray(rawPage.groups) ? rawPage.groups : []
    const groupIdMap = new Map<string, string>()
    const groups: Group[] = rawGroups.flatMap((rawGroup): Group[] => {
      if (!isRecord(rawGroup)) return []
      const previousId = str(rawGroup.id)
      const id = previousId || mintId('group')
      if (previousId) groupIdMap.set(previousId, id)
      const position = isRecord(rawGroup.position) ? rawGroup.position : {}
      const members = Array.isArray(rawGroup.memberCardIds)
        ? rawGroup.memberCardIds
            .map((member) => (typeof member === 'string' ? idMap.get(member) : undefined))
            .filter((member): member is string => Boolean(member))
        : []
      if (Array.isArray(rawGroup.memberCardIds) && members.length !== rawGroup.memberCardIds.length) {
        warnings.push(
          `A group referenced ${rawGroup.memberCardIds.length - members.length} card(s) that are not in the file.`,
        )
      }
      return [
        {
          id,
          title: str(rawGroup.title, 'Group'),
          x: num(position.x, 0),
          y: num(position.y, 0),
          width: num(position.width, 400),
          height: num(position.height, 300),
          zIndex: num(position.zIndex, 0),
          color: str(rawGroup.color, '#6366F1'),
          memberIds: members,
          createdAt: str(rawGroup.createdAt) || stamp,
          updatedAt: str(rawGroup.updatedAt) || stamp,
        },
      ]
    })

    const rawConnections = Array.isArray(rawPage.connections) ? rawPage.connections : []
    // Annotated, not inferred: without it TypeScript widens every narrowed
    // literal back to `string`, and the whole point of these unions is that a
    // value which is not one of the three is a compile error. An inferred type
    // would quietly accept anything.
    const connections: Connection[] = rawConnections.flatMap((rawConnection): Connection[] => {
      if (!isRecord(rawConnection)) return []
      const source = isRecord(rawConnection.source) ? rawConnection.source : null
      const target = isRecord(rawConnection.target) ? rawConnection.target : null
      if (!source || !target) {
        warnings.push('Dropped a connection that had no two ends.')
        return []
      }
      const resolve = (endpoint: Record<string, unknown>) => {
        const kind = str(endpoint.kind, 'card')
        const id = str(endpoint.id)
        if (kind === 'group') return { kind: 'group' as const, id: groupIdMap.get(id) ?? id }
        return { kind: 'element' as const, id: idMap.get(id) ?? id }
      }
      const from = resolve(source)
      const to = resolve(target)
      // A connection to a card that is not in the file points at nothing. It is
      // dropped with a word, not drawn as a line into the void.
      const known = (endpoint: { kind: string; id: string }) =>
        endpoint.kind === 'group' ? groupIdMap.has(endpoint.id) : idMap.has(endpoint.id)
      if (!known(from) || !known(to)) {
        warnings.push('Dropped a connection to a card that is not in the file.')
        return []
      }
      const style = isRecord(rawConnection.style) ? rawConnection.style : {}
      const fallback = DEFAULT_CONNECTION_STYLE_V2
      return [
        {
          id: str(rawConnection.id) || mintId('link'),
          source: from,
          target: to,
          // The anchors survive. A person who chose "leave from the left" meant
          // it, and the alternative — dropping the choice and letting the
          // renderer decide — changes how every edge in their document attaches
          // the first time it is opened.
          sourceAnchor: anchorOf(rawConnection.sourceAnchor),
          targetAnchor: anchorOf(rawConnection.targetAnchor),
          label: str(rawConnection.label),
          relationshipType: str(rawConnection.relationshipType, fallback.relationshipType),
          style: {
            color: str(style.color, fallback.color),
            width: num(style.width, fallback.width),
            lineStyle:
              style.lineStyle === 'dashed' || style.lineStyle === 'dotted'
                ? style.lineStyle
                : fallback.lineStyle,
            // Version 1 called the right-angled routing `stepped`; version 2
            // calls it `orthogonal`. It is the same path, and reading only the
            // new name here turned every stepped connection in every saved
            // document into a curve — a change nobody would notice until they
            // opened a map they had drawn and it looked different.
            routing:
              style.routing === 'stepped'
                ? ('orthogonal' as const)
                : style.routing === 'straight' || style.routing === 'curved'
                  ? style.routing
                  : fallback.routing,
            // Every arrowhead the renderer draws, kept. Narrowing this list
            // silently rewrites a reader's connections on the next save.
            arrowStart: arrowheadOf(style.arrowStart, 'none'),
            arrowEnd: arrowheadOf(style.arrowEnd, 'arrow'),
            animated: style.animated === true,
          },
        },
      ]
    })

    return [
      {
        id: pageId,
        // The annotation again: an inferred object here widens `targetKind` and
        // the transition names back to `string`, and then the file's contents no
        // longer have to be one of the allowed values.
        title: str(rawPage.title, 'Page'),
        ordinal: num(rawPage.ordinal, pageIndex),
        viewport: isRecord(rawPage.viewport)
          ? {
              x: num(rawPage.viewport.x, 0),
              y: num(rawPage.viewport.y, 0),
              zoom: num(rawPage.viewport.zoom, 1),
            }
          : { x: 0, y: 0, zoom: 1 },
        elements,
        groups,
        connections,
        createdAt: str(rawPage.createdAt) || stamp,
        updatedAt: str(rawPage.updatedAt) || stamp,
      },
    ]
  })

  const rawSettings = isRecord(root.settings) ? root.settings : {}
  const rawSteps = Array.isArray(rawSettings.steps) ? rawSettings.steps : []

  const settings: DocSettings = {
    // Version 1 called the card style `defaultCardStyle`; version 2 calls it the
    // note style, because there is more than one kind of style now and "card" is
    // no longer a word that means anything.
    defaultNoteStyle: noteStyleOf(rawSettings.defaultCardStyle),
    defaultConnectionStyle: DEFAULT_CONNECTION_STYLE_V2,
    defaultRelationshipType: str(rawSettings.defaultRelationshipType, 'related to'),
    // Steps survive with their `targetKind` renamed, because they used to point
    // at a "card" and now point at an element of any kind.
    steps: rawSteps.flatMap((rawStep): PresentationStepV2[] => {
      if (!isRecord(rawStep)) return []
      // An unrecognised kind is an establishing shot, not a step pointing at
      // nothing. Mapping it to 'element' would keep its `targetId` and fly the
      // camera to an object that does not exist, which is the one outcome a
      // viewer notices immediately. Version 1 did this too.
      //
      // So the three cases are kept apart rather than collapsed: 'card' is a real
      // version 1 kind and becomes an element step; a kind we do not recognise
      // becomes a page step and loses its target.
      const rawKind = str(rawStep.targetKind, 'card')
      const known = rawKind === 'card' || rawKind === 'group' || rawKind === 'page'
      const transition = str(rawStep.transition, 'ease')
      const trigger = str(rawStep.trigger, 'manual')
      const focus = str(rawStep.focus, 'none')
      return [
        {
          id: str(rawStep.id) || mintId('step'),
          // A step whose kind we did not recognise becomes an establishing shot,
          // and an establishing shot does not name a target: pointing the camera
          // at a thing that is not there is the failure a viewer notices
          // immediately.
          targetId: known ? strOrNull(rawStep.targetId) : null,
          targetKind: !known
            ? ('page' as const)
            : rawKind === 'group'
              ? ('group' as const)
              : rawKind === 'page'
                ? ('page' as const)
                : ('element' as const),
          zoom: num(rawStep.zoom, 1),
          transition:
            transition === 'linear' || transition === 'drift' || transition === 'instant'
              ? transition
              : ('ease' as const),
          trigger:
            trigger === 'timed' || trigger === 'hold' ? trigger : ('manual' as const),
          autoAdvanceMs: num(rawStep.autoAdvanceMs, 0),
          durationMs: num(rawStep.durationMs, 450),
          focus: focus === 'dim' || focus === 'spotlight' ? focus : ('none' as const),
        },
      ]
    }),
  }

  return {
    doc: {
      version: DOC_VERSION,
      pages,
      settings,
      // Version 1 had no uploads, so the quota starts at nothing used.
      uploadBytes: 0,
    },
    notes,
    warnings,
  }
}

export { MAX_UPLOAD_BYTES }
