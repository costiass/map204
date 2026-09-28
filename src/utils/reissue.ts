import type { CanvasDoc, Card, Connection, Group, Page } from '@/types'
import { uid } from '@/utils/id'

/**
 * Re-issue every id in a document, preserving the structure exactly.
 *
 * ## Why
 *
 * An exported file carries the ids its objects had in the workspace it came from.
 * Importing those ids verbatim means the imported copy is entangled with its
 * origin: importing the same file twice silently overwrites rather than
 * duplicating, and every id-keyed feature (selection, undo, search, the
 * inspector) treats an imported object as the old one.
 *
 * So an import **reproduces** a document rather than copying one. The user sees
 * the same cards, in the same places, with the same connections, styling and
 * text — but the result shares no identity with the file, and two imports of
 * one file are two independent documents.
 *
 * ## Why this is fiddly, and why it is one function
 *
 * Card and group ids are referenced from six places:
 *
 *   cards[].parentId
 *   groups[].memberCardIds
 *   groups[].memberGroupIds
 *   connections[].source.id   (card or group)
 *   connections[].target.id   (card or group)
 *
 * Miss one and the reference dangles. That failure is silent rather than loud:
 * `normalizeDoc` drops references to ids it has not seen, so a bad rewrite here
 * would quietly flatten a card out of its group or orphan a connection, and the
 * user would see their carefully built map come apart with no error anywhere.
 *
 * Hence one function that walks the whole graph, and a test that asserts the
 * shape survives rather than trusting it.
 *
 * ## What is deliberately not changed
 *
 * Ids only. Positions, sizes, zoom, styles, text, tags, checklists, timestamps,
 * settings and ordering are all left alone — that is what "reproduce" means.
 */

/** The old id → new id map, per kind. */
export interface ReissuedIds {
  pages: Map<string, string>
  cards: Map<string, string>
  groups: Map<string, string>
  connections: Map<string, string>
}

function reissuePage(page: Page, maps: ReissuedIds): Page {
  const cards = page.cards.map((card) => {
    const next: Card = { ...card, id: maps.cards.get(card.id) ?? card.id }
    // A card's parent is a card. Remap it in the same pass, or the child ends
    // up pointing at an id that no longer exists.
    next.parentId = card.parentId ? (maps.cards.get(card.parentId) ?? null) : null
    return next
  })

  const groups = page.groups.map((group) => {
    const next: Group = { ...group, id: maps.groups.get(group.id) ?? group.id }
    next.memberCardIds = group.memberCardIds
      .map((id) => maps.cards.get(id))
      .filter((id): id is string => Boolean(id))
    next.memberGroupIds = group.memberGroupIds
      .map((id) => maps.groups.get(id))
      .filter((id): id is string => Boolean(id) && id !== next.id)
    return next
  })

  const endpoint = (e: Connection['source']): Connection['source'] => ({
    kind: e.kind,
    id:
      e.kind === 'card'
        ? (maps.cards.get(e.id) ?? e.id)
        : (maps.groups.get(e.id) ?? e.id),
  })

  const connections = page.connections.map((connection) => {
    const next: Connection = { ...connection, id: maps.connections.get(connection.id) ?? connection.id }
    next.source = endpoint(connection.source)
    next.target = endpoint(connection.target)
    return next
  })

  return {
    ...page,
    id: maps.pages.get(page.id) ?? page.id,
    cards,
    groups,
    connections,
  }
}

/**
 * A copy of `doc` with every id replaced by a fresh one.
 *
 * `original` is not modified; the result shares no object identity with it, so
 * the caller can keep both.
 */
export function reissueIds(doc: CanvasDoc): { doc: CanvasDoc; ids: ReissuedIds } {
  const maps: ReissuedIds = {
    pages: new Map(),
    cards: new Map(),
    groups: new Map(),
    connections: new Map(),
  }

  for (const page of doc.pages) {
    maps.pages.set(page.id, uid('page'))
    for (const card of page.cards) maps.cards.set(card.id, uid('card'))
    for (const group of page.groups) maps.groups.set(group.id, uid('group'))
    for (const connection of page.connections) {
      maps.connections.set(connection.id, uid('connection'))
    }
  }

  const pages = doc.pages.map((page) => reissuePage(page, maps))

  return { doc: { ...doc, pages }, ids: maps }
}
