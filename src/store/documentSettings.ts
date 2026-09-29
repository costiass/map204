/**
 * One small JSON settings document per person, per workspace.
 *
 * ## What is in it
 *
 *   position   the camera on each page, and which page was being looked at
 *   defaults   the appearance and canvas defaults as they stood on arrival
 *
 * `defaults` is a *copy*, not a link to `user_settings`. That is the point: a
 * workspace cannot hold "the settings somebody had when they opened it", because
 * two people open the same workspace with two different histories. Appearance that
 * the person changes later is still theirs and still lives in `user_settings`;
 * this is the snapshot they brought with them.
 *
 * ## Why a table and not a file in Storage
 *
 * The contents are JSON and always will be, but a `jsonb` column is a much smaller
 * thing to get right than a bucket: one indexed row instead of an upload, no
 * content-type or cache headers to argue with, and RLS written once in the same
 * place as every other table's. The shape of the document is unchanged either way.
 *
 * ## Why it is not the browser
 *
 * The camera used to live in `localStorage`, which is per *device*. One person on a
 * phone and a laptop got two unrelated views of one map. This is the reader's own
 * state, so it belongs beside the reader.
 *
 * What it still is not: part of the document, or part of the realtime broadcast. Two
 * people in one map have two cameras, and syncing them makes whoever moved last
 * decide where the other is looking. That was the bug, and it is why this is a
 * separate table rather than a column on `pages`.
 */

import { supabase } from '@/lib/supabase'
import { handleWriteError } from '@/store/writeErrors'
import { recallViewport, setCameraSink } from '@/store/viewportStore'
import { useUserSettings } from '@/store/userSettings'
import { useCanvasStore } from '@/store/useCanvasStore'
import type { Viewport } from '@/types'

/**
 * The version in the stored document.
 *
 * Read on every load, so a file written by an older build of the app can be told
 * apart from one written by this one. It is a number rather than nothing because
 * "the shape changed" is a thing that will happen, and the alternative is guessing
 * from which fields happen to be present.
 */
export const SETTINGS_VERSION = 1

/** The appearance and canvas defaults, as a snapshot. Mirrors `UserSettings`. */
export interface SettingsDefaults {
  theme: string
  palette: string
  accent: string
  cardRadius: number
  reduceMotion: boolean
  defaultSnapToGrid: boolean
  defaultGridPattern: string
  defaultGridSize: number
}

/** Where each page was left. Keyed by page id, which is not stable across an import. */
export interface SettingsPosition {
  activePageId: string | null
  pages: Record<string, Viewport>
}

export interface DocumentSettings {
  version: number
  defaults: SettingsDefaults | null
  position: SettingsPosition
}

export const EMPTY_SETTINGS: DocumentSettings = {
  version: SETTINGS_VERSION,
  defaults: null,
  position: { activePageId: null, pages: {} },
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The camera bounds, matching what the canvas will actually render.
 *
 * A stored camera is untrusted input: it was written by a browser, and a browser
 * can be a person with the devtools open. A zoom of zero or a NaN would not be a
 * wrong view, it would be a canvas that cannot be drawn, so the numbers are checked
 * before they are used rather than when something goes wrong.
 */
const MIN_ZOOM = 0.02
const MAX_ZOOM = 64

function isViewport(value: unknown): value is Viewport {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, zoom } = value as Record<string, unknown>
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    typeof zoom === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(zoom) &&
    zoom >= MIN_ZOOM &&
    zoom <= MAX_ZOOM
  )
}

/**
 * Turn whatever came out of the database into a settings document.
 *
 * Takes `unknown` on purpose. This is a JSON column that any client can write, and
 * an earlier version of the app, or a hand-edited row, or a future migration can all
 * put something here that is not the shape this expects. Every field is checked and
 * anything unrecognised is dropped, because a settings file that is a day old and
 * one that is malformed both have to end in a usable map.
 */
export function normalizeSettings(raw: unknown): DocumentSettings {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_SETTINGS, position: { activePageId: null, pages: {} } }

  const source = raw as Record<string, unknown>
  const version = typeof source.version === 'number' ? source.version : 0

  // A document from a newer build than this one is not interpreted. Reading a shape
  // this build does not know would be reading a field for the wrong thing, and
  // writing it back would destroy whatever the newer build put there.
  if (version > SETTINGS_VERSION) return { ...EMPTY_SETTINGS, position: { activePageId: null, pages: {} } }

  const positionSource =
    typeof source.position === 'object' && source.position !== null
      ? (source.position as Record<string, unknown>)
      : {}

  const pages: Record<string, Viewport> = {}
  if (typeof positionSource.pages === 'object' && positionSource.pages !== null) {
    for (const [pageId, value] of Object.entries(positionSource.pages as Record<string, unknown>)) {
      if (isViewport(value)) pages[pageId] = { x: value.x, y: value.y, zoom: value.zoom }
    }
  }

  const defaults = normalizeDefaults(source.defaults)

  return {
    version: SETTINGS_VERSION,
    defaults,
    position: {
      activePageId:
        typeof positionSource.activePageId === 'string' ? positionSource.activePageId : null,
      pages,
    },
  }
}

function normalizeDefaults(raw: unknown): SettingsDefaults | null {
  if (typeof raw !== 'object' || raw === null) return null
  const d = raw as Record<string, unknown>
  const num = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback

  return {
    theme: str(d.theme, 'light'),
    palette: str(d.palette, 'default'),
    accent: str(d.accent, 'indigo'),
    cardRadius: num(d.cardRadius, 12),
    reduceMotion: bool(d.reduceMotion, false),
    defaultSnapToGrid: bool(d.defaultSnapToGrid, true),
    defaultGridPattern: str(d.defaultGridPattern, 'dots'),
    defaultGridSize: num(d.defaultGridSize, 20),
  }
}

/** Read one person's settings for one workspace. Missing or unreadable gives the empty document. */
export async function loadDocumentSettings(
  userId: string,
  documentId: string,
): Promise<DocumentSettings> {
  if (!supabase) return { ...EMPTY_SETTINGS, position: { activePageId: null, pages: {} } }

  const { data, error } = await supabase
    .from('user_document_settings')
    .select('data')
    .eq('user_id', userId)
    .eq('document_id', documentId)
    .maybeSingle()

  if (error) {
    // Not a reason to interrupt anyone: the map opens, the camera is the default,
    // and the next save writes the file. Said once, because a failing select on
    // every open is a real fault and should be visible in the console.
    await handleWriteError(error, 'docSettings:load')
    return { ...EMPTY_SETTINGS, position: { activePageId: null, pages: {} } }
  }

  return normalizeSettings(data?.data)
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/** A camera move arrives per wheel tick, so writes are batched. */
const SAVE_DEBOUNCE_MS = 900

const pending = new Map<string, ReturnType<typeof setTimeout>>()
const queued = new Map<string, DocumentSettings>()

/**
 * Remember something about this workspace for this person.
 *
 * Merged into whatever is already queued rather than replacing it, so a camera move
 * followed by a page switch one tick later is one write carrying both, and neither
 * is lost.
 */
export function queueSettings(
  userId: string,
  documentId: string,
  patch: Partial<DocumentSettings>,
): void {
  if (!userId || !documentId) return

  const key = `${userId}:${documentId}`
  const current = queued.get(key) ?? { ...EMPTY_SETTINGS, position: { activePageId: null, pages: {} } }

  const next: DocumentSettings = {
    version: SETTINGS_VERSION,
    defaults: patch.defaults !== undefined ? patch.defaults : current.defaults,
    position: {
      activePageId:
        patch.position?.activePageId !== undefined
          ? patch.position.activePageId
          : current.position.activePageId,
      pages: { ...current.position.pages, ...(patch.position?.pages ?? {}) },
    },
  }

  queued.set(key, next)

  const existing = pending.get(key)
  if (existing) clearTimeout(existing)
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key)
      const toWrite = queued.get(key)
      queued.delete(key)
      if (toWrite) void writeDocumentSettings(userId, documentId, toWrite)
    }, SAVE_DEBOUNCE_MS),
  )
}

/** Write immediately, and report whether it worked. */
async function writeDocumentSettings(
  userId: string,
  documentId: string,
  settings: DocumentSettings,
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase.from('user_document_settings').upsert(
    { user_id: userId, document_id: documentId, data: settings },
    { onConflict: 'user_id,document_id' },
  )

  if (error) {
    // The camera is a convenience, so this is logged rather than shown. The next
    // move will try again, and the file is not in a state this can corrupt.
    await handleWriteError(error, 'docSettings:save')
  }
}

/**
 * Drop anything still queued for a workspace.
 *
 * Used when a workspace is deleted, and on sign-out. A camera move queued a moment
 * before either would otherwise write a row for a workspace that is gone, or for a
 * person who is no longer signed in.
 */
export function forgetQueuedSettings(documentId?: string, userId?: string): void {
  for (const [key, timer] of [...pending.entries()]) {
    const [keyUser, keyDocument] = key.split(':')
    const matches =
      (documentId === undefined || keyDocument === documentId) &&
      (userId === undefined || keyUser === userId)
    if (!matches) continue
    clearTimeout(timer)
    pending.delete(key)
    queued.delete(key)
  }
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Register as the far end of every camera move.
 *
 * The canvas store cannot import this module: it imports `viewportStore`, and
 * everything that store imports has to load without `VITE_SUPABASE_URL`, which
 * rules out anything reading `import.meta.env` at load time -- so this file, which
 * builds a Supabase client, cannot be in that graph. The direction is reversed
 * instead, and this is the registration.
 *
 * Safe to call repeatedly: the last registration wins, and there is only ever one.
 */
export function installCameraSink(): void {
  setCameraSink((documentId, pageId, viewport) => {
    // 'local' is the canvas store's name for "no workspace open", which is what an
    // unsaved scratch map is. There is nowhere to put a file for it, and nobody to
    // put it in.
    if (!documentId || documentId === 'local') return

    const userId = useUserSettings.getState().userId
    if (!userId) return

    queueSettings(userId, documentId, {
      position: {
        activePageId: useCanvasStore.getState().activePageId,
        pages: { [pageId]: viewport },
      },
    })
  })
}

export function uninstallCameraSink(): void {
  setCameraSink(null)
}

/**
 * Open a workspace on the page and at the zoom this person left it.
 *
 * The camera arrives in two waves on purpose. `localStorage` is read synchronously
 * by `setActivePage`, so the canvas has something to draw on the first frame; this
 * fetch lands afterwards, and when it does it wins, because it is the copy that
 * follows the person between devices and the browser one is only a cache of it.
 *
 * The defaults are seeded on the way past when the file has none, which is what
 * "saved when they registered" amounts to in practice: the first time somebody
 * opens a workspace, the appearance they arrived with is written down for it, and
 * it stays that way even as they change their mind later.
 */
export async function applyDocumentSettings(documentId: string): Promise<void> {
  const userId = useUserSettings.getState().userId
  if (!userId || !supabase) return

  const settings = await loadDocumentSettings(userId, documentId)

  useCanvasStore.setState((state) => {
    for (const page of state.doc.pages) {
      const remembered = settings.position.pages[page.id]
      if (remembered) {
        page.viewport = remembered
        recallViewport(documentId, page.id, remembered)
      }
    }

    // A page id that is not in this workspace is ignored. Ids are minted per
    // document and an import mints new ones, so a stored camera can name a page that
    // no longer exists and must not be matched by position in a list.
    const wanted = settings.position.activePageId
    if (wanted && state.doc.pages.some((p) => p.id === wanted)) {
      state.activePageId = wanted
    }
  })

  if (settings.defaults) return

  const current = useUserSettings.getState().settings
  queueSettings(userId, documentId, {
    defaults: {
      theme: current.theme,
      palette: current.palette,
      accent: current.accent,
      cardRadius: current.cardRadius,
      reduceMotion: current.reduceMotion,
      defaultSnapToGrid: current.defaultSnapToGrid,
      defaultGridPattern: current.defaultGridPattern,
      defaultGridSize: current.defaultGridSize,
    },
  })
}
