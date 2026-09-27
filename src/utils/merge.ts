import type { Card, Connection, Group, Page } from '@/types'

/**
 * Merge helpers for multi-user collaboration.
 *
 * Two situations need different rules:
 *
 *  - **The incoming snapshot is newer than anything we have** → it is
 *    authoritative: replace, so deletions made by the other person stick.
 *  - **Both sides changed at the same time** → union, so nothing anybody typed
 *    disappears. The next server write reconciles the two.
 */

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

export interface PageContent {
  cards: Card[]
  groups: Group[]
  connections: Connection[]
}

export function contentOf(page: Page): PageContent {
  return { cards: page.cards, groups: page.groups, connections: page.connections }
}

function connectionIsAnchored(connection: Connection, ids: Set<string>): boolean {
  return (
    (connection.source.kind === 'card' || connection.source.kind === 'group') &&
    (connection.target.kind === 'card' || connection.target.kind === 'group') &&
    ids.has(connection.source.id) &&
    ids.has(connection.target.id)
  )
}

/** Union of two snapshots, keyed by id, dropping dangling connections. */
export function unionContent(local: PageContent, remote: PageContent): PageContent {
  const cards = byId([...local.cards, ...remote.cards])
  const groups = byId([...local.groups, ...remote.groups])
  const ids = new Set<string>([...cards.keys(), ...groups.keys()])

  const connections = byId(
    [...local.connections, ...remote.connections].filter((c) => connectionIsAnchored(c, ids)),
  )

  return { cards: [...cards.values()], groups: [...groups.values()], connections: [...connections.values()] }
}

export interface RemoteSnapshot {
  title: string
  position: Page['position']
  viewport: Page['viewport']
  cards: Card[]
  groups: Group[]
  connections: Connection[]
  /** Sender's wall clock (ms) — decides who wins. */
  sentAt: number
}

export type MergeMode = 'replace' | 'union'

/**
 * Produce the page state to keep after a remote snapshot arrived.
 * `replace` is used when the snapshot is newer than the local edit clock,
 * `union` when the two may have diverged.
 */
export function applySnapshot(local: Page, remote: RemoteSnapshot, mode: MergeMode): Page {
  const stamp = new Date().toISOString()
  const content =
    mode === 'replace'
      ? { cards: remote.cards, groups: remote.groups, connections: remote.connections }
      : unionContent(contentOf(local), remote)

  return {
    ...local,
    title: remote.title,
    position: remote.position,
    viewport: remote.viewport,
    cards: content.cards,
    groups: content.groups,
    connections: content.connections,
    updatedAt: stamp,
  }
}
