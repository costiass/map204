/**
 * Where each person's camera is, kept in their own browser.
 *
 * ## What changed and why
 *
 * The viewport used to be part of the page: saved in the `viewport` column, put in
 * the realtime broadcast, and part of `pageSignature` so that panning counted as an
 * edit. All three are gone.
 *
 * The broadcast was the part that was actively wrong. Two people in the same map
 * have two different cameras -- one is reading the top left, one is at the bottom
 * right, and that is the entire point of having a map. Syncing the viewport made
 * whoever moved last drag the other person's view around, which is not collaboration,
 * it is a fight over the scroll position. So the viewport is no longer sent, received
 * or applied from anybody else's camera.
 *
 * And it is no longer saved, because a saved camera is somebody else's opinion about
 * where a map should be opened. The first person to open a document decided, for
 * everyone, forever, and everybody else who came along was moved. The camera is a
 * property of the reader and of the moment.
 *
 * `localStorage` rather than the database, and rather than a cookie:
 *
 *   * not the database, because the database is shared and the whole point is that
 *     this is not;
 *   * not a cookie, because it would ride along on every request to every endpoint
 *     for a value of about forty bytes that is read once on load.
 *
 * ## What is left in the document
 *
 * Nothing. `Page.viewport` still exists in memory, because the canvas reads it every
 * frame and threading a separate store through the render path would be a large
 * change for no benefit. What changed is that it is *not* the document's: it is not
 * written, not broadcast, and not taken from the document when one is loaded. It is
 * restored from here instead.
 *
 * ## Why it is not part of the schema change
 *
 * The `viewport` column stays, and existing rows keep their values. Dropping a
 * column is a destructive change to somebody's data for no benefit -- nothing reads
 * it any more, which is not the same as it needing to be deleted. The reset will
 * take it out.
 */

import type { Viewport } from '@/types'

const KEY_PREFIX = 'map204:viewport'

/**
 * The camera a page opens at when this browser has never seen it.
 *
 * Declared here rather than imported from `supabase-sync`, because
 * `DEFAULT_PAGE_VIEWPORT` lives in a module that reads `import.meta.env` at load
 * time -- and the store imports this one. Importing it made every bundle of the
 * store, including the one `test-read-only.cjs` builds, fail on a missing
 * `VITE_SUPABASE_URL`. A remembered camera must not need the network layer.
 *
 * `test-viewport-private.cjs` asserts the two agree, so this cannot drift.
 */
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

/**
 * Keyed by document *and* page.
 *
 * Two reasons, and the second is the one that matters. Per document: you want to
 * come back to a map where you left it, and a map is a document. Per page: one map
 * is many pages, and a page you are zoomed into should not be reset by opening the
 * page you were on before.
 *
 * The user id is deliberately *not* in the key. One person signed in on two machines
 * is one person's camera; keying by account would give them two, and moving between
 * them would jump the view for no reason anybody asked for.
 */
function keyFor(documentId: string, pageId: string): string {
  return `${KEY_PREFIX}:${documentId}:${pageId}`
}

/**
 * Read a remembered camera.
 *
 * Never throws. A camera is a convenience, and `localStorage` throws in more
 * situations than people expect -- Safari's private mode, a full quota, a browser
 * with storage disabled by policy. Every one of those should give somebody a
 * sensible default view rather than a blank screen.
 *
 * The stored value is also checked rather than trusted, for the same reason the
 * normalizer checks what it reads: this is untrusted input that happens to have been
 * written by us once. A hand-edited value of `{}` must not become `NaN` zoom.
 */
export function rememberViewport(documentId: string, pageId: string): Viewport | null {
  try {
    const raw = window.localStorage.getItem(keyFor(documentId, pageId))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null

    const { x, y, zoom } = value as Record<string, unknown>
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof zoom !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(zoom) ||
      // The same bounds `normalizeDoc` applies to a stored viewport, so a camera
      // cannot come back at a zoom where the canvas is unreadable or invisible.
      zoom < 0.02 ||
      zoom > 64
    ) {
      return null
    }
    return { x, y, zoom }
  } catch {
    return null
  }
}

/**
 * Where a camera move also goes, beyond this browser.
 *
 * A plain callback rather than an import, and the reason is the trap documented at
 * the top of this file: the canvas store imports this module, so anything this
 * module imports has to be safe to load without `VITE_SUPABASE_URL` -- which means
 * nothing that reads `import.meta.env` at load time, which is everything that
 * touches Supabase. Importing the settings store from here put
 * `Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')` through
 * every bundle that builds the canvas store, including the one
 * `test-read-only.cjs` makes.
 *
 * So the direction is reversed. This module knows nothing about the database and
 * calls out; `documentSettings` registers the real writer and imports whatever it
 * likes. The canvas store is untouched by any of it.
 */
type CameraSink = (documentId: string, pageId: string, viewport: Viewport) => void

let cameraSink: CameraSink | null = null

/** Called by whoever is keeping a copy of the camera. Pass null to stop. */
export function setCameraSink(sink: CameraSink | null): void {
  cameraSink = sink
}

/** Remember a camera. Silently does nothing where storage is unavailable. */
export function recallViewport(documentId: string, pageId: string, viewport: Viewport): void {
  try {
    window.localStorage.setItem(keyFor(documentId, pageId), JSON.stringify(viewport))
  } catch {
    /* full, disabled, or private. The camera is a convenience; losing it is fine. */
  }
  // Not in the try: a broken sink must not stop the cache being written, and a throw
  // from it must not escape into a pointermove handler.
  try {
    cameraSink?.(documentId, pageId, viewport)
  } catch {
    /* the far end is optional */
  }
}

/**
 * Forget every remembered camera for a document.
 *
 * Used when a document is deleted. Not for tidiness -- the entries would be
 * harmless -- but because they are keyed by a document id that will never be issued
 * again, and a `localStorage` that only ever grows is a slow leak in a long-lived
 * tab.
 */
export function forgetViewports(documentId: string): void {
  try {
    const prefix = `${KEY_PREFIX}:${documentId}:`
    const doomed: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(prefix)) doomed.push(key)
    }
    for (const key of doomed) window.localStorage.removeItem(key)
  } catch {
    /* as above */
  }
}

/**
 * The document's stored camera, if there is one.
 *
 * Kept only for the case where there is nothing in this browser: a page opened for
 * the first time on this machine. It is the last resort and not the default, and it
 * is the reason "somebody else's opinion" is only ever seen once.
 */
export function fallbackViewport(stored: unknown): Viewport {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_VIEWPORT
  const { x, y, zoom } = stored as Record<string, unknown>
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof zoom !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(zoom) ||
    zoom < 0.02 ||
    zoom > 64
  ) {
    return DEFAULT_VIEWPORT
  }
  return { x, y, zoom }
}
