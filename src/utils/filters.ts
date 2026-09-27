import type { Card } from '@/types'
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

export function matchesColor(card: Card, color: string | null): boolean {
  const target = normalizeColor(color)
  if (!target) return true
  return (
    normalizeColor(card.style.backgroundColor) === target ||
    normalizeColor(card.style.accentColor) === target
  )
}

export function matchesQuery(card: Card, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (card.title.toLowerCase().includes(needle)) return true
  if (card.tags.some((tag) => tag.toLowerCase().includes(needle))) return true
  if (markdownToPlainText(card.content).toLowerCase().includes(needle)) return true
  if (card.checklist.some((item) => item.text.toLowerCase().includes(needle))) return true
  if (card.image.alt.toLowerCase().includes(needle)) return true
  return false
}

export function matchesFilters(card: Card, filters: FilterState): boolean {
  if (!matchesQuery(card, filters.query)) return false
  if (filters.tags.length > 0 && !filters.tags.every((tag) => card.tags.includes(tag))) return false
  if (!matchesColor(card, filters.color)) return false
  return true
}

/** Case-insensitive substring used to bold the matched run in result lists. */
export function splitMatch(text: string, query: string): { before: string; match: string; after: string } {
  const needle = query.trim().toLowerCase()
  if (!needle) return { before: text, match: '', after: '' }
  const index = text.toLowerCase().indexOf(needle)
  if (index === -1) return { before: text, match: '', after: '' }
  return {
    before: text.slice(0, index),
    match: text.slice(index, index + needle.length),
    after: text.slice(index + needle.length),
  }
}

export function collectTags(cards: Card[]): string[] {
  const counts = new Map<string, number>()
  for (const card of cards) {
    for (const tag of card.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag)
}

export function collectColors(cards: Card[]): string[] {
  const seen = new Map<string, number>()
  for (const card of cards) {
    for (const color of [card.style.backgroundColor, card.style.accentColor]) {
      const key = normalizeColor(color)
      if (!key) continue
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color)
}
