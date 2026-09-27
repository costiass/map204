import type { CanvasDoc } from '@/types'

/**
 * Persistence adapter interface.
 *
 * The app currently persists to IndexedDB (with a localStorage fallback).
 * When a backend is added (e.g. Supabase), implement this interface and swap
 * the adapter — no other code needs to change.
 *
 * The interface is intentionally minimal: load, save, and clear. All
 * transport details (REST, WebSocket, etc.) are the adapter's concern.
 */
export interface PersistenceAdapter {
  /** Unique name for this adapter (e.g. 'indexeddb', 'supabase'). */
  readonly name: string

  /**
   * Load the document. Returns `null` when nothing has been saved yet.
   * Warnings are non-fatal notes from parsing (e.g. repaired duplicate ids).
   */
  load(): Promise<{
    doc: CanvasDoc | null
    warnings: string[]
    error?: string
  }>

  /**
   * Save the document. Implementations should diff against the last write
   * to minimise I/O where possible.
   */
  save(doc: CanvasDoc): Promise<{
    ok: boolean
    error?: string
    bytes?: number
  }>

  /** Save immediately, writing every record. Used on boot and Ctrl+S. */
  saveNow(doc: CanvasDoc): Promise<{
    ok: boolean
    error?: string
    bytes?: number
  }>

  /** Clear all persisted data. */
  clear(): Promise<void>
}

/**
 * The active adapter. Defaults to the IndexedDB implementation.
 * Swap this when adding a backend (e.g. Supabase).
 */
let activeAdapter: PersistenceAdapter | null = null

export function setPersistenceAdapter(adapter: PersistenceAdapter): void {
  activeAdapter = adapter
}

export function getPersistenceAdapter(): PersistenceAdapter | null {
  return activeAdapter
}
