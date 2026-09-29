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
import { createSaveQueue, type SaveQueue } from '@/store/saveQueue'
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

/**
 * How long to wait before writing.
 *
 * The same figure the default-style save uses (`userSettings.ts`, 400ms), on
 * purpose. They are both "a change the person made, remembered shortly afterwards",
 * and there is no reason the camera should take more than twice as long to be
 * remembered as the colours beside it. It was 900ms, which meant a pan followed by
 * a quick look elsewhere and back was not written before the second move replaced
 * the first.
 */
const SAVE_DEBOUNCE_MS = 400

/** One queue per person per workspace, so two maps do not overwrite each other. */
const queues = new Map<string, SaveQueue<DocumentSettings>>()

function emptySettings(): DocumentSettings {
  return { version: SETTINGS_VERSION, defaults: null, position: { activePageId: null, pages: {} } }
}

function queueFor(userId: string, documentId: string): SaveQueue<DocumentSettings> {
  const key = `${userId}:${documentId}`
  const existing = queues.get(key)
  if (existing) return existing

  const queue = createSaveQueue<DocumentSettings>({
    debounceMs: SAVE_DEBOUNCE_MS,
    write: (settings) => writeDocumentSettings(userId, documentId, settings),
    onError: (error) => {
      // Reported, not swallowed. A camera that quietly stops being remembered is
      // indistinguishable from one that was never remembered.
      void handleWriteError(
        { code: 'settings:save', message: error instanceof Error ? error.message : String(error) },
        'docSettings:save',
      )
    },
  })

  queues.set(key, queue)
  return queue
}

/**
 * Remember something about this workspace for this person.
 *
 * Merged into whatever is still waiting rather than replacing it, so a camera move
 * followed by a page switch one tick later is one write carrying both, and neither
 * is lost. That merge is the queue's job, which is why it is in one place.
 */
export function queueSettings(
  userId: string,
  documentId: string,
  patch: Partial<DocumentSettings>,
): void {
  if (!userId || !documentId) return

  queueFor(userId, documentId).push((current) => {
    const base = current ?? emptySettings()
    return {
      version: SETTINGS_VERSION,
      defaults: patch.defaults !== undefined ? patch.defaults : base.defaults,
      position: {
        activePageId:
          patch.position?.activePageId !== undefined
            ? patch.position.activePageId
            : base.position.activePageId,
        pages: { ...base.position.pages, ...(patch.position?.pages ?? {}) },
      },
    }
  })
}

/** Write now, and reject on failure so the queue retries rather than losing it. */
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

  // Thrown, not logged. The queue retries, and it only clears the value once a
  // write has actually succeeded -- so an error here keeps the data rather than
  // dropping it, which is what happened when this logged and returned.
  if (error) throw error
}

/**
 * Drop anything still queued for a workspace.
 *
 * Used when a workspace is deleted, and on sign-out. A camera move queued a moment
 * before either would otherwise write a row for a workspace that is gone, or for a
 * person who is no longer signed in.
 */
export function forgetQueuedSettings(documentId?: string, userId?: string): void {
  for (const [key, queue] of [...queues.entries()]) {
    const separator = key.indexOf(':')
    if (separator < 0) continue
    const keyUser = key.slice(0, separator)
    const keyDocument = key.slice(separator + 1)

    const matches =
      (documentId === undefined || keyDocument === documentId) &&
      (userId === undefined || keyUser === userId)
    if (!matches) continue

    queue.clear()
    queues.delete(key)
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
/**
 * Write anything waiting, right now.
 *
 * The debounce is 900ms, which is right for a pointer sweeping across a canvas and
 * badly wrong for the last thing anybody did before closing the tab. Without this,
 * "pan somewhere, close the tab" -- the single most common way a camera is set --
 * loses the camera entirely, and the bug looks intermittent because it depends on
 * how fast the tab went away.
 */
export function flushQueuedSettings(): void {
  for (const queue of queues.values()) queue.flush()
}

/**
 * The listeners `uninstallCameraSink` has to be able to remove.
 *
 * Held at module scope because `install` and `uninstall` are separate calls and a
 * closure would hand the second one a function it had no reference to. Without this
 * a hot reload stacks listeners: each flushes the same key, so the worst case is the
 * same write twice and the best is a listener outliving the component that made it.
 */
const onHideRef: { current: (() => void) | null } = { current: null }
const onVisibilityRef: { current: (() => void) | null } = { current: null }

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

  // The debounce has a floor, and the last camera before a tab closes is inside it.
  //
  // `pagehide` is the event that actually fires on mobile Safari, where a tab is
  // dismissed by a swipe rather than a button. `visibilitychange` covers the rest
  // and also covers switching to another tab, which is the same shape of loss.
  //
  // `beforeunload` is deliberately not used: it cannot await a fetch, so the write
  // would be cancelled by the navigation it was racing -- which would look like it
  // worked and lose the camera anyway.
  if (typeof window === 'undefined') return

  const onHide = () => flushQueuedSettings()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flushQueuedSettings()
  }

  onHideRef.current = onHide
  onVisibilityRef.current = onVisibility
  window.addEventListener('pagehide', onHide)
  document.addEventListener('visibilitychange', onVisibility)
}

export function uninstallCameraSink(): void {
  setCameraSink(null)
  if (typeof window === 'undefined') return
  if (onHideRef.current) window.removeEventListener('pagehide', onHideRef.current)
  if (onVisibilityRef.current) {
    document.removeEventListener('visibilitychange', onVisibilityRef.current)
  }
  onHideRef.current = null
  onVisibilityRef.current = null
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
