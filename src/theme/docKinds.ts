/**
 * What kind of document this is.
 *
 * There is only one kind today — a map — and this is deliberately not a database
 * column yet. A type nobody can choose, in a column nobody can read, is a
 * migration to undo the first time somebody actually adds a second kind.
 *
 * What exists is the *place* for it. The badge is on the document's title in the
 * chrome and on its tile in the list, so when a second kind arrives it appears
 * where the first one already is instead of meaning a new pass over every
 * screen. The list is the harder of the two to retrofit: a tile is a component,
 * and a badge inside a tile that renders nothing for most rows is a badge
 * nobody notices until it is needed.
 */
export type DocKind = 'map'

/** Every kind, and what it is called. One entry, and adding to it is the whole change. */
export const DOC_KINDS: Record<DocKind, { label: string; blurb: string }> = {
  map: {
    label: 'Map',
    blurb: 'Cards, groups and links on an infinite canvas',
  },
}

/** The kind a document is. Everything is a map until that stops being true. */
export function docKindOf(kind: string | null | undefined): DocKind {
  return kind === 'map' ? 'map' : 'map'
}
