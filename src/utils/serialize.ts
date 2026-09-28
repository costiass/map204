import {
    DEFAULT_CARD_STYLE,
    DEFAULT_CONNECTION_STYLE,
    DEFAULT_RELATIONSHIP,
    DOC_VERSION,
  MAX_CARD_BORDER_WIDTH,
  MAX_CARD_HEIGHT,
  MAX_CARD_WIDTH,
  MAX_ZOOM,
  MIN_CARD_BORDER_WIDTH,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  MIN_ZOOM,
  createDefaultSettings,
  type Anchor,
  type ArrowStyle,
  type Card,
  type CardEmbed,
  type CardImage,
  type CardPosition,
  type CardStyle,
  type CardType,
  type CanvasDoc,
  type ChecklistItem,
  type Connection,
  type ConnectionEndpoint,
  type ConnectionStyle,
  type DocSettings,
  type Group,
  type GroupPosition,
  type LineStyle,
  type Page,
  type Position,
  type Routing,
  type Viewport,
} from '@/types'
import { clamp, clampZoom } from '@/utils/geometry'
import { isCardType } from '@/utils/embeds'
import { clone, nowIso, uid } from '@/utils/id'
import { htmlToMarkdown, looksLikeHtml } from '@/utils/markdown'

/* ------------------------------------------------------------------ */
/* Type guards                                                         */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

const ANCHOR_VALUES: Anchor[] = ['top', 'right', 'bottom', 'left']
const LINE_STYLE_VALUES: LineStyle[] = ['solid', 'dashed', 'dotted']
const ARROW_VALUES: ArrowStyle[] = ['none', 'arrow', 'triangle', 'circle', 'diamond']
const ROUTING_VALUES: Routing[] = ['curved', 'straight', 'stepped']

/* ------------------------------------------------------------------ */
/* Normalisers                                                         */
/* ------------------------------------------------------------------ */

function normalizeViewport(raw: unknown): Viewport {
  const value = isRecord(raw) ? raw : {}
  return {
    x: num(value.x, 0),
    y: num(value.y, 0),
    zoom: clampZoom(num(value.zoom, 1) || 1) as number,
  }
}

function normalizeImage(raw: unknown): CardImage {
  const value = isRecord(raw) ? raw : {}
  return { src: strOrNull(value.src), alt: str(value.alt, '') }
}

function normalizePosition(raw: unknown, fallbackZ: number): CardPosition {
  const value = isRecord(raw) ? raw : {}
  return {
    x: num(value.x, 0),
    y: num(value.y, 0),
    width: clamp(num(value.width, 280), MIN_CARD_WIDTH, MAX_CARD_WIDTH),
    height: clamp(num(value.height, 220), MIN_CARD_HEIGHT, MAX_CARD_HEIGHT),
    zIndex: num(value.zIndex, fallbackZ),
  }
}

function normalizeGroupPosition(raw: unknown, fallbackZ: number): Position {
  const value = isRecord(raw) ? raw : {}
  return {
    x: num(value.x, 0),
    y: num(value.y, 0),
    width: clamp(num(value.width, 400), 200, 3000),
    height: clamp(num(value.height, 300), 150, 3000),
    zIndex: num(value.zIndex, fallbackZ),
  }
}

function normalizeGroup(raw: unknown, index: number, stamp: string): Group {
  const value = isRecord(raw) ? raw : {}
  return {
    id: str(value.id) || uid('group'),
    title: str(value.title, 'New group'),
    position: normalizeGroupPosition(value.position, index + 1),
    color: str(value.color, '#6366F1'),
    memberCardIds: Array.isArray(value.memberCardIds)
      ? value.memberCardIds.filter((v): v is string => typeof v === 'string')
      : [],
    memberGroupIds: Array.isArray(value.memberGroupIds)
      ? value.memberGroupIds.filter((v): v is string => typeof v === 'string')
      : [],
    createdAt: str(value.createdAt) || stamp,
    updatedAt: str(value.updatedAt) || stamp,
  }
}

function normalizeCardStyle(raw: unknown): CardStyle {
  const value = isRecord(raw) ? raw : {}
  return {
    backgroundColor: str(value.backgroundColor, DEFAULT_CARD_STYLE.backgroundColor),
    accentColor: str(value.accentColor, DEFAULT_CARD_STYLE.accentColor),
    textColor: str(value.textColor, DEFAULT_CARD_STYLE.textColor),
    borderColor: str(value.borderColor, DEFAULT_CARD_STYLE.borderColor),
    borderWidth: clamp(
      num(value.borderWidth, DEFAULT_CARD_STYLE.borderWidth),
      MIN_CARD_BORDER_WIDTH,
      MAX_CARD_BORDER_WIDTH,
    ),
    borderRadius: clamp(num(value.borderRadius, DEFAULT_CARD_STYLE.borderRadius), 0, 40),
    shadow: bool(value.shadow, DEFAULT_CARD_STYLE.shadow),
  }
}

function normalizeChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return []
  const out: ChecklistItem[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') {
      out.push({ id: uid('item'), text: entry, done: false })
      continue
    }
    if (!isRecord(entry)) continue
    const text = str(entry.text)
    if (!text) continue
    out.push({ id: str(entry.id) || uid('item'), text, done: bool(entry.done) })
  }
  return out
}

/**
 * A card's kind, defaulting to a note.
 *
 * A document written before card kinds existed has no `type` at all, so the
 * default is what makes those files open unchanged rather than as a card of an
 * unknown kind.
 */
function normalizeCardType(raw: unknown): CardType {
  return isCardType(raw) ? raw : 'note'
}

function normalizeCardEmbed(raw: unknown, type: CardType): CardEmbed | null {
  if (type === 'note') return null
  if (!isRecord(raw)) return null

  const url = str(raw.url)
  if (!url) return null

  const meta: Record<string, string | number | boolean> = {}
  if (isRecord(raw.meta)) {
    for (const [key, value] of Object.entries(raw.meta)) {
      if (typeof value === 'string' || typeof value === 'boolean') meta[key] = value
      else if (typeof value === 'number' && Number.isFinite(value)) meta[key] = value
    }
  }

  return { url, ...(Object.keys(meta).length > 0 ? { meta } : {}) }
}

function normalizeCard(raw: unknown, index: number, stamp: string): Card {
  const value = isRecord(raw) ? raw : {}
  // Card bodies are Markdown now; documents saved as HTML are converted once.
  const stored = str(value.content, '')
  const type = normalizeCardType(value.type)
  return {
    id: str(value.id) || uid('card'),
    type,
    title: str(value.title, 'Untitled card'),
    content: looksLikeHtml(stored) ? htmlToMarkdown(stored) : stored,
    embed: normalizeCardEmbed(value.embed, type),
    image: normalizeImage(value.image),
    position: normalizePosition(value.position, index + 1),
    style: normalizeCardStyle(value.style),
    tags: Array.isArray(value.tags)
      ? Array.from(new Set(value.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)))
      : [],
    collapsed: bool(value.collapsed),
    parentId: strOrNull(value.parentId),
    checklist: normalizeChecklist(value.checklist),
    createdAt: str(value.createdAt) || stamp,
    updatedAt: str(value.updatedAt) || stamp,
  }
}

function normalizeConnectionStyle(raw: unknown): ConnectionStyle {
  const value = isRecord(raw) ? raw : {}
  return {
    color: str(value.color, DEFAULT_CONNECTION_STYLE.color),
    width: clamp(num(value.width, DEFAULT_CONNECTION_STYLE.width), 1, 12),
    lineStyle: oneOf(value.lineStyle, LINE_STYLE_VALUES, DEFAULT_CONNECTION_STYLE.lineStyle),
    routing: oneOf(value.routing, ROUTING_VALUES, DEFAULT_CONNECTION_STYLE.routing),
    arrowStart: oneOf(value.arrowStart, ARROW_VALUES, DEFAULT_CONNECTION_STYLE.arrowStart),
    arrowEnd: oneOf(value.arrowEnd, ARROW_VALUES, DEFAULT_CONNECTION_STYLE.arrowEnd),
    animated: bool(value.animated),
  }
}

function normalizeEndpoint(raw: unknown, fallbackId = ''): ConnectionEndpoint {
  if (isRecord(raw)) {
    const kind = raw.kind === 'group' ? 'group' : 'card'
    const id = str(raw.id, fallbackId) || fallbackId
    if (id) return { kind, id }
  }
  // Legacy flat format: { sourceCardId: '...' } or plain string
  return { kind: 'card', id: fallbackId }
}

function normalizeConnection(raw: unknown): Connection {
  const value = isRecord(raw) ? raw : {}
  return {
    id: str(value.id) || uid('connection'),
    source: normalizeEndpoint(value.source, str(value.sourceCardId)),
    target: normalizeEndpoint(value.target, str(value.targetCardId)),
    sourceAnchor: oneOf<Anchor>(value.sourceAnchor, ANCHOR_VALUES, 'right'),
    targetAnchor: oneOf<Anchor>(value.targetAnchor, ANCHOR_VALUES, 'left'),
    label: str(value.label),
    relationshipType: str(value.relationshipType, DEFAULT_RELATIONSHIP),
    style: normalizeConnectionStyle(value.style),
  }
}

function normalizeSettings(raw: unknown): DocSettings {
  const value = isRecord(raw) ? raw : {}
  const fallback = createDefaultSettings()
  return {
    defaultCardStyle: normalizeCardStyle(value.defaultCardStyle ?? fallback.defaultCardStyle),
    defaultConnectionStyle: normalizeConnectionStyle(
      value.defaultConnectionStyle ?? fallback.defaultConnectionStyle,
    ),
    // A stored empty string is a deliberate "no relationship", not a missing
    // value, so the fallback only applies when the key is absent or not a string.
    defaultRelationshipType:
      typeof value.defaultRelationshipType === 'string'
        ? value.defaultRelationshipType
        : fallback.defaultRelationshipType,
  }
}

export interface NormalizeResult {
  doc: CanvasDoc
  warnings: string[]
}

/**
 * Turns arbitrary parsed JSON into a valid document.
 *
 * Guarantees after this runs:
 *  - every page / card / connection has a unique, non-empty id
 *  - every connection points at two cards that exist on the same page
 *  - every numeric field is a finite number inside a sane range
 *  - missing fields are filled from the defaults
 */
export function normalizeDoc(raw: unknown): NormalizeResult {
  const warnings: string[] = []
  const stamp = nowIso()

  if (!isRecord(raw)) {
    throw new Error('File does not contain a Map204 document object.')
  }

  const rawPages = Array.isArray(raw.pages)
    ? raw.pages
    : Array.isArray((raw as { cards?: unknown }).cards)
      ? [raw]
      : null

  if (!rawPages) {
    throw new Error('No "pages" array found in the file.')
  }
  if (rawPages.length === 0) {
    warnings.push('Document had no pages — an empty page was created.')
  }

  const usedPageIds = new Set<string>()
  const pages: Page[] = rawPages.map((rawPage, pageIndex) => {
    const page = isRecord(rawPage) ? rawPage : {}

    let pageId = str(page.id) || uid('page')
    if (usedPageIds.has(pageId)) {
      const replacement = uid('page')
      warnings.push(`Duplicate page id "${pageId}" renamed to "${replacement}".`)
      pageId = replacement
    }
    usedPageIds.add(pageId)

    // Cards first: connections are validated against the resulting id set.
    const usedCardIds = new Set<string>()
    const remap = new Map<string, string>()
    const rawCards = Array.isArray(page.cards) ? page.cards : []
    const cards: Card[] = rawCards.map((rawCard, cardIndex) => {
      const card = normalizeCard(rawCard, cardIndex, stamp)
      if (usedCardIds.has(card.id)) {
        const replacement = uid('card')
        warnings.push(`Duplicate card id "${card.id}" on page "${pageId}" renamed to "${replacement}".`)
        remap.set(card.id, replacement)
        card.id = replacement
      }
      usedCardIds.add(card.id)
      return card
    })

    for (const card of cards) {
      if (card.parentId && !usedCardIds.has(card.parentId)) {
        card.parentId = null
      }
      if (card.parentId === card.id) {
        card.parentId = null
      }
    }

    // Groups: validated the same way, and connections may reference them.
    const usedGroupIds = new Set<string>()
    const groupRemap = new Map<string, string>()
    const rawGroups = Array.isArray(page.groups) ? page.groups : []
    const groups: Group[] = rawGroups.map((rawGroup, groupIndex) => {
      const group = normalizeGroup(rawGroup, groupIndex, stamp)
      if (usedGroupIds.has(group.id)) {
        const replacement = uid('group')
        warnings.push(`Duplicate group id "${group.id}" renamed to "${replacement}".`)
        groupRemap.set(group.id, replacement)
        group.id = replacement
      }
      usedGroupIds.add(group.id)
      return group
    })

    // Validate group memberships.
    for (const group of groups) {
      group.memberCardIds = group.memberCardIds.filter((id) => usedCardIds.has(id))
      group.memberGroupIds = group.memberGroupIds.filter(
        (id) => id !== group.id && usedGroupIds.has(id),
      )
    }

    // Combined endpoint lookup for connection validation.
    const endpointExists = (endpoint: { kind: 'card' | 'group'; id: string }): boolean => {
      if (endpoint.kind === 'card') return usedCardIds.has(endpoint.id)
      return usedGroupIds.has(endpoint.id)
    }

    const usedConnectionIds = new Set<string>()
    const rawConnections = Array.isArray(page.connections) ? page.connections : []
    let droppedConnections = 0
    const connections: Connection[] = []
    for (const rawConnection of rawConnections) {
      const connection = normalizeConnection(rawConnection)
      // Remap endpoints through the card/group id maps.
      if (connection.source.kind === 'card') {
        connection.source.id = remap.get(connection.source.id) ?? connection.source.id
      } else {
        connection.source.id = groupRemap.get(connection.source.id) ?? connection.source.id
      }
      if (connection.target.kind === 'card') {
        connection.target.id = remap.get(connection.target.id) ?? connection.target.id
      } else {
        connection.target.id = groupRemap.get(connection.target.id) ?? connection.target.id
      }

      if (!endpointExists(connection.source) || !endpointExists(connection.target)) {
        droppedConnections += 1
        continue
      }
      if (
        connection.source.kind === connection.target.kind &&
        connection.source.id === connection.target.id
      ) {
        droppedConnections += 1
        continue
      }
      let id = connection.id
      if (usedConnectionIds.has(id)) {
        id = uid('connection')
        warnings.push(`Duplicate connection id "${connection.id}" renamed to "${id}".`)
        connection.id = id
      }
      usedConnectionIds.add(id)
      connections.push(connection)
    }
    if (droppedConnections > 0) {
      warnings.push(
        `Dropped ${droppedConnections} connection${droppedConnections === 1 ? '' : 's'} on page "${pageId}" with missing or identical endpoints.`,
      )
    }

    return {
      id: pageId,
      title: str(page.title, `Page ${pageIndex + 1}`) || `Page ${pageIndex + 1}`,
      position: normalizeGroupPosition(page.position, pageIndex + 1) as Position,
      viewport: normalizeViewport(page.viewport),
      cards,
      groups,
      connections,
      createdAt: str(page.createdAt) || stamp,
      updatedAt: str(page.updatedAt) || stamp,
    }
  })

  return {
    doc: {
      version: num(raw.version, DOC_VERSION) || DOC_VERSION,
      pages,
      settings: normalizeSettings(raw.settings),
    },
    warnings,
  }
}

/* ------------------------------------------------------------------ */
/* Factories                                                           */
/* ------------------------------------------------------------------ */

export function createCard(input: Partial<Card> & { position: Partial<CardPosition> }): Card {
  const stamp = nowIso()
  const type = isCardType(input.type) ? input.type : 'note'
  return {
    id: uid('card'),
    type,
    title: input.title ?? 'New card',
    content: input.content ?? '',
    // A note has nothing to point at, and an embed without a kind to give it
    // purpose would be read as a note with stray data attached.
    embed: type === 'note' ? null : (input.embed ?? null),
    image: input.image ?? { src: null, alt: '' },
    position: {
      x: num(input.position.x, 0),
      y: num(input.position.y, 0),
      width: clamp(num(input.position.width, 280), MIN_CARD_WIDTH, MAX_CARD_WIDTH),
      height: clamp(num(input.position.height, 220), MIN_CARD_HEIGHT, MAX_CARD_HEIGHT),
      zIndex: num(input.position.zIndex, 1),
    },
    style: { ...DEFAULT_CARD_STYLE, ...input.style },
    tags: input.tags ?? [],
    collapsed: input.collapsed ?? false,
    parentId: input.parentId ?? null,
    checklist: input.checklist ?? [],
    createdAt: input.createdAt ?? stamp,
    updatedAt: input.updatedAt ?? stamp,
  }
}

export function createConnection(input: {
  source: ConnectionEndpoint
  target: ConnectionEndpoint
  sourceAnchor?: Anchor | null
  targetAnchor?: Anchor | null
  label?: string
  relationshipType?: string
  style?: Partial<ConnectionStyle>
}): Connection {
  return {
    id: uid('connection'),
    source: input.source,
    target: input.target,
    sourceAnchor: input.sourceAnchor ?? null,
    targetAnchor: input.targetAnchor ?? null,
    label: input.label ?? '',
    relationshipType: input.relationshipType ?? DEFAULT_RELATIONSHIP,
    style: { ...DEFAULT_CONNECTION_STYLE, ...input.style },
  }
}

export function createGroup(input: Partial<Group> & { position: Partial<GroupPosition> }): Group {
  const stamp = nowIso()
  return {
    id: uid('group'),
    title: input.title ?? 'New group',
    position: {
      x: num(input.position.x, 0),
      y: num(input.position.y, 0),
      width: clamp(num(input.position.width, 400), 200, 3000),
      height: clamp(num(input.position.height, 300), 150, 3000),
      zIndex: num(input.position.zIndex, 1),
    },
    color: input.color ?? '#6366F1',
    memberCardIds: input.memberCardIds ?? [],
    memberGroupIds: input.memberGroupIds ?? [],
    createdAt: input.createdAt ?? stamp,
    updatedAt: input.updatedAt ?? stamp,
  }
}

/* ------------------------------------------------------------------ */
/* Export / import helpers                                             */
/* ------------------------------------------------------------------ */

export function serializeDoc(doc: CanvasDoc): string {
  return JSON.stringify(doc, null, 2)
}

export function parseDoc(text: string): NormalizeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON: ${message}`)
  }
  return normalizeDoc(parsed)
}

export function downloadDoc(doc: CanvasDoc, filename: string): void {
  const blob = new Blob([serializeDoc(doc)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.json') ? filename : `${filename}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function cloneDoc(doc: CanvasDoc): CanvasDoc {
  return clone(doc)
}

export { MIN_ZOOM, MAX_ZOOM }
