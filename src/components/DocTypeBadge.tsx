import { DOC_KINDS, docKindOf, type DocKind } from '@/theme/docKinds'

/**
 * The kind of a document, as a badge.
 *
 * Shown next to a document's title and on its tile. It is the *place* for the
 * kind rather than the kind itself — there is one kind today, and a column
 * nobody can choose anything into is a migration to undo later.
 *
 * Reads nothing from a prop on purpose. It asks the store, so a document cannot
 * disagree with itself between the title in the chrome and the tile in the list:
 * both read the same row, so both are right or both are wrong together.
 */
export function DocTypeBadge({ kind }: { kind?: DocKind | string | null } = {}) {
  const resolved = docKindOf(kind)
  const meta = DOC_KINDS[resolved]

  return (
    <span
      className="hidden shrink-0 rounded-full border border-line px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted sm:inline"
      title={meta.blurb}
    >
      {meta.label}
    </span>
  )
}
