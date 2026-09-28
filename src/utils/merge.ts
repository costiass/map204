/**
 * Merge helpers for multi-user collaboration.
 *
 * Two situations need different rules:
 *
 *  - **The incoming snapshot is newer than anything we have** → it is
 *    authoritative: replace, so deletions made by the other person stick.
 *  - **Both sides changed at the same time** → union, so nothing anybody typed
 *    disappears. The next server write reconciles the two.
 *
 * A page's *contents* — `PageContent` — is kept separate from the page itself,
 * because the wire protocol sends contents and metadata as different concerns
 * and the merge only ever arbitrates the contents.
 */

import type { Connection, Element, Group, Page } from '@/types'

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

export interface PageContent {
  elements: Element[]
  groups: Group[]
  connections: Connection[]
}

export function contentOf(page: Page): PageContent {
  return { elements: page.elements, groups: page.groups, connections: page.connections }
}

/**
 * A connection survives a union only if both of its ends still exist.
 *
 * Either end may be an element of any kind or a group, so this checks against
 * the union of both id sets rather than one or the other. A connection whose end
 * was deleted on one side would otherwise reappear pointing at nothing — which
 * draws as a line to nowhere with nothing on screen to explain it.
 */
function connectionIsAnchored(connection: Connection, ids: Set<string>): boolean {
  return ids.has(connection.source.id) && ids.has(connection.target.id)
}

/** Union of two snapshots, keyed by id, dropping dangling connections. */
export function unionContent(local: PageContent, remote: PageContent): PageContent {
  const elements = byId([...local.elements, ...remote.elements])
  const groups = byId([...local.groups, ...remote.groups])
  const ids = new Set<string>([...elements.keys(), ...groups.keys()])

  const connections = byId(
    [...local.connections, ...remote.connections].filter((c) => connectionIsAnchored(c, ids)),
  )

  return {
    elements: [...elements.values()],
    groups: [...groups.values()],
    connections: [...connections.values()],
  }
}

/**
 * What one collaborator sends.
 *
 * `position` is the page's place in the sidebar, not canvas geometry — it is
 * sent separately because two people renaming pages should not conflict over it.
 */
export interface RemoteSnapshot {
  title: string
  ordinal: number
  viewport: Page['viewport']
  elements: Element[]
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
  const content =
    mode === 'replace'
      ? { elements: remote.elements, groups: remote.groups, connections: remote.connections }
      : unionContent(contentOf(local), remote)

  return {
    ...local,
    title: remote.title,
    ordinal: remote.ordinal,
    viewport: remote.viewport,
    elements: content.elements,
    groups: content.groups,
    connections: content.connections,
    updatedAt: new Date().toISOString(),
  }
}
