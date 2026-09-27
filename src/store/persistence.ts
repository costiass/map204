import type { CanvasDoc } from '@/types'
import { parseDoc } from '@/utils/serialize'

/**
 * The old home of the document: one JSON string in `localStorage`.
 *
 * It is no longer the store — `store/database.ts` keeps the document in
 * IndexedDB, one record per page — but it still has two jobs:
 *
 *  - the fallback for browsers that refuse IndexedDB (private windows), so the
 *    app keeps working rather than losing the document, and
 *  - the source of the one-time migration: a document saved by an earlier
 *    version is read from here and written into the database on first run.
 */

export const STORAGE_KEY = 'cardcanvas:doc:v1'

export interface SaveResult {
  ok: boolean
  error?: string
  bytes?: number
}

export function saveStoredDoc(doc: CanvasDoc): SaveResult {
  try {
    const payload = JSON.stringify(doc)
    localStorage.setItem(STORAGE_KEY, payload)
    return { ok: true, bytes: payload.length }
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'Browser storage is full. Remove some images or export to JSON.'
        : error instanceof Error
          ? error.message
          : 'Unknown storage error'
    return { ok: false, error: message }
  }
}

export interface LoadResult {
  doc: CanvasDoc | null
  warnings: string[]
  error?: string
}

export function loadStoredDoc(): LoadResult {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return { doc: null, warnings: [], error: 'Local storage is unavailable in this browser.' }
  }
  if (!raw) return { doc: null, warnings: [] }

  try {
    const { doc, warnings } = parseDoc(raw)
    return { doc, warnings }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stored document could not be read.'
    return { doc: null, warnings: [], error: message }
  }
}

export function clearStoredDoc(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
