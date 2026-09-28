/**
 * Filtering the sidebar and the search panel.
 *
 * Almost everything here is note-specific: a note has a style, tags, a body and
 * a checklist, and no other element does. So each matcher narrows on `kind`
 * first and a non-note simply does not match. That is the right answer rather
 * than a fallback — searching for a tag and getting every video on the page
 * because videos have no tags is a filter that does not filter.
 */

import type { Element, NoteElement } from '@/types'
import { markdownToPlainText } from '@/utils/markdown'

export interface FilterState {
  query: string
  tags: string[]
  color: string | null
}

export const EMPTY_FILTERS: FilterState = { query: '', tags: [], color: null }

export function isFiltering(filters: FilterState): boolean {
  return filters.query.trim().length > 0 || filters.tags.length > 0 || filters.color !== null
}

export function normalizeColor(color: string | null | undefined): string | null {
  if (!color) return null
  return color.trim().toUpperCase()
}

/** A note's own fields, or `null` for anything that has none. */
function asNote(element: Element): NoteElement | null {
  return element.kind === 'note' ? element : null
}

export function matchesColor(element: Element, color: string | null): boolean {
  const target = normalizeColor(color)
  if (!target) return true
  const note = asNote(element)
  if (!note) return false
  return (
    normalizeColor(note.style.backgroundColor) === target ||
    normalizeColor(note.style.accentColor) === target
  )
}

export function matchesQuery(element: Element, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  // The title is on every element, so a text search works for all of them. The
  // rest is notes only.
  if (element.title.toLowerCase().includes(needle)) return true

  const note = asNote(element)
  if (!note) return false
  if (note.tags.some((tag) => tag.toLowerCase().includes(needle))) return true
  if (markdownToPlainText(note.body).toLowerCase().includes(needle)) return true
  if (note.checklist.some((item) => item.text.toLowerCase().includes(needle))) return true
  if (note.image.alt.toLowerCase().includes(needle)) return true
  return false
}

export function matchesFilters(element: Element, filters: FilterState): boolean {
  if (!matchesQuery(element, filters.query)) return false
  if (filters.tags.length > 0) {
    const note = asNote(element)
    if (!note || !filters.tags.every((tag) => note.tags.includes(tag))) return false
  }
  if (!matchesColor(element, filters.color)) return false
  return true
}

/** Case-insensitive substring used to bold the matched run in result lists. */
export function splitMatch(text: string, query: string): { before: string; match: string; after: string } {
  const needle = query.trim().toLowerCase()
  // No query, so the whole string is "before" and there is nothing to bold.
  if (!needle) return { before: text, match: '', after: '' }
  const index = text.toLowerCase().indexOf(needle)
  if (index === -1) return { before: text, match: '', after: '' }
  return {
    before: text.slice(0, index),
    match: text.slice(index, index + needle.length),
    after: text.slice(index + needle.length),
  }
}

/** Tags in use, most-used first. Notes only — nothing else has tags. */
export function collectTags(elements: Element[]): string[] {
  const counts = new Map<string, number>()
  for (const element of elements) {
    const note = asNote(element)
    if (!note) continue
    for (const tag of note.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag)
}

/** Colours in use, most-used first. */
export function collectColors(elements: Element[]): string[] {
  const seen = new Map<string, number>()
  for (const element of elements) {
    const note = asNote(element)
    if (!note) continue
    for (const color of [note.style.backgroundColor, note.style.accentColor]) {
      const key = normalizeColor(color)
      if (!key) continue
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color)
}
