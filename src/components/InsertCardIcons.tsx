import { FileText, Layers, Play, StickyNote } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { CardType } from '@/types'

/**
 * One icon per kind, and one answer to "does this kind need a link first?".
 *
 * Both were previously a `const ICONS` record duplicated in three components, and
 * a kind added to `CARD_TYPES` without adding it to a map is a runtime
 * `undefined` in a menu — an entry that renders blank and looks like a bug in the
 * app rather than in the code.
 *
 * Typing the map against `CardType` is the point. A new kind that is not here
 * does not compile, and the compiler says so before anybody sees a blank menu.
 */
export const INSERT_ICONS: Record<CardType, LucideIcon> = {
  note: StickyNote,
  flash: Layers,
  youtube: Play,
  pdf: FileText,
}

/**
 * The kinds that cannot be created without asking for a link first.
 *
 * A note and a flash card are made of text and exist the moment you ask for one.
 * A video and a PDF are a *reference*, so there is nothing to create until
 * somebody says to what.
 */
export const NEEDS_LINK: ReadonlySet<CardType> = new Set<CardType>(['youtube', 'pdf'])
