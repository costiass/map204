import {
  clearStoredDoc,
  loadStoredDoc,
  saveStoredDoc,
  type LoadResult as LocalResult,
  type SaveResult as LocalSaveResult,
} from '@/store/persistence'
import { parseDoc, serializeDoc } from '@/utils/serialize'
import type { CanvasDoc, DocSettings, Page } from '@/types'

/**
 * Persistence for the document.
 *
 * The document used to live in `localStorage` as one JSON string, which meant
 * every autosave re-serialised and rewrote *everything* â€” every page, every
 * card, and every embedded image â€” no matter how small the edit.
 *
 * It now lives in IndexedDB, which is a real transactional record store:
 *
 *   - `meta`  holds one record: the format version and the document settings.
 *   - `pages` holds one record per page, with the page's position in the page
 *     list stored alongside it so ordering survives a partial write.
 *
 * A page is the natural unit: the app only ever edits the page you are looking
 * at, so a keystroke in a card rewrites that single page record instead of the
 * whole document. Which pages changed is decided by object identity â€” Immer
 * hands out a new page object for exactly the pages it touched â€” so the check
 * costs nothing more than a Map lookup per page and never re-serialises a page
 * that did not change. All the changed records go out in a single transaction,
 * so the document is never half-written.
 *
 * `localStorage` stays as a fallback for browsers that refuse IndexedDB
 * (private windows, and the server-side render used by the smoke tests), and its
 * existing document is migrated into the database on first run so nothing that
 * was already saved is lost.
 */

const DB_NAME = 'cardcanvas'
const DB_VERSION = 1
const META_STORE = 'meta'
const PAGE_STORE = 'pages'
const DOC_KEY = 'document'

/** A page plus its slot in the page list, so a partial write keeps the order. */
type PageRecord = Page & { order: number }

interface MetaRecord {
  key: string
  version: number
  settings: DocSettings
  savedAt: string
}

export type StorageKind = 'database' | 'localstorage'

export interface SaveResult {
  ok: boolean
  error?: string
  /** Rough size of what was actually written. */
  bytes?: number
  /** How many page records were rewritten. */
  pages?: number
  storage: StorageKind
}

export interface LoadResult {
  doc: CanvasDoc | null
  warnings: string[]
  error?: string
  storage: StorageKind
}

/* ------------------------------------------------------------------ */
/* connection                                                          */
/* ------------------------------------------------------------------ */

let dbPromise: Promise<IDBDatabase | null> | null = null
let storageKind: StorageKind = 'localstorage'
let openFailure: string | undefined

/**
 * Opens (once) the document database. Resolves `null` when IndexedDB is missing
 * or blocked, which puts the app on the localStorage fallback. A failed open is
 * not sticky: a blocked upgrade clears when the other tab closes, so the next
 * autosave gets another chance at the real database.
 */
function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  const attempt = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      openFailure = 'This browser has no IndexedDB.'
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      openFailure = describeError(error)
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(PAGE_STORE)) {
        db.createObjectStore(PAGE_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      storageKind = 'database'
      resolve(request.result)
    }
    request.onerror = () => {
      openFailure = describeError(request.error)
      resolve(null)
    }
    // Another tab is holding an older version open; fall back rather than hang.
    request.onblocked = () => {
      openFailure = 'Another CardCanvas tab is open with an older version.'
      resolve(null)
    }
  })
  dbPromise = attempt
  void attempt.then((db) => {
    if (!db && dbPromise === attempt) dbPromise = null
  })
  return attempt
}

function describeError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') {
      return 'Browser storage is full. Remove some images or export to JSON.'
    }
    return `${error.name}: ${error.message}`
  }
  return error instanceof Error ? error.message : 'Unknown storage error'
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/* ------------------------------------------------------------------ */
/* what has already been written                                       */
/* ------------------------------------------------------------------ */

/**
 * The last state that reached the database, per record. Comparing against this
 * is what makes an autosave cheap: unchanged pages are never re-serialised and
 * never re-written.
 */
const writtenPages = new Map<string, { page: Page; order: number }>()
let writtenSettings: DocSettings | null = null
let writtenVersion: number | null = null

interface WritePlan {
  put: PageRecord[]
  remove: string[]
  settings: boolean
}

/** Works out the smallest write that makes the database match `doc`. */
function planWrite(doc: CanvasDoc): WritePlan {
  const put: PageRecord[] = []
  const live = new Set<string>()
  doc.pages.forEach((page, order) => {
    live.add(page.id)
    const previous = writtenPages.get(page.id)
    if (previous && previous.page === page && previous.order === order) return
    put.push({ ...page, order })
  })
  const remove: string[] = []
  for (const id of writtenPages.keys()) {
    if (!live.has(id)) remove.push(id)
  }
  return {
    put,
    remove,
    settings: writtenSettings !== doc.settings || writtenVersion !== doc.version,
  }
}

/** Records a plan as done, so the next save can skip it. */
function rememberWrite(doc: CanvasDoc, plan: WritePlan): void {
  for (const record of plan.put) {
    const page = doc.pages.find((candidate) => candidate.id === record.id)
    if (page) writtenPages.set(record.id, { page, order: record.order })
  }
  for (const id of plan.remove) writtenPages.delete(id)
  if (plan.settings) {
    writtenSettings = doc.settings
    writtenVersion = doc.version
  }
}

function approximateBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

/** Runs one transaction that writes every planned change atomically. */
function commit(
  db: IDBDatabase,
  doc: CanvasDoc,
  plan: WritePlan,
  onDone: () => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PAGE_STORE, META_STORE], 'readwrite')
    const pages = transaction.objectStore(PAGE_STORE)
    let bytes = 0

    for (const record of plan.put) {
      bytes += approximateBytes(record)
      pages.put(record)
    }
    for (const id of plan.remove) pages.delete(id)

    if (plan.settings) {
      const record: MetaRecord = {
        key: DOC_KEY,
        version: doc.version,
        settings: doc.settings,
        savedAt: new Date().toISOString(),
      }
      bytes += approximateBytes(record)
      transaction.objectStore(META_STORE).put(record)
    }

    transaction.oncomplete = () => {
      onDone()
      resolve(bytes)
    }
    transaction.onerror = () => reject(transaction.error ?? new Error('Write failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException('Write was aborted', 'AbortError'))
  })
}

async function writeWholeDocument(db: IDBDatabase, doc: CanvasDoc): Promise<void> {
  await commit(
    db,
    doc,
    { put: doc.pages.map((page, order) => ({ ...page, order })), remove: [], settings: true },
    () => rememberWrite(doc, {
      put: doc.pages.map((page, order) => ({ ...page, order })),
      remove: [],
      settings: true,
    }),
  )
}

async function readAll(db: IDBDatabase): Promise<{ meta: MetaRecord | null; pages: PageRecord[] }> {
  const transaction = db.transaction([META_STORE, PAGE_STORE], 'readonly')
  // Both requests are issued before either is awaited: a transaction commits as
  // soon as it has no pending request left, so awaiting one and *then* asking for
  // the other would hit an already-closed transaction.
  const metaRequest = transaction.objectStore(META_STORE).get(DOC_KEY) as IDBRequest<
    MetaRecord | undefined
  >
  const pagesRequest = transaction.objectStore(PAGE_STORE).getAll()
  const [meta, pages] = await Promise.all([
    requestToPromise(metaRequest),
    requestToPromise(pagesRequest),
  ])
  pages.sort((a, b) => a.order - b.order)
  return { meta: meta ?? null, pages }
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

function localStorageResult(result: LocalSaveResult): SaveResult {
  return { ...result, storage: 'localstorage' }
}

/** Which backend the app ended up on, for the UI. */
export function currentStorageKind(): StorageKind {
  return storageKind
}

/** Why IndexedDB was not used, when it was not. */
export function storageWarning(): string | undefined {
  return openFailure
}

/**
 * Reads the document at boot. Migrates a localStorage document into the database
 * the first time it runs, and returns `null` when there is nothing saved yet.
 */
export async function loadDocument(): Promise<LoadResult> {
  const db = await openDatabase()
  if (!db) {
    const fallback: LocalResult = loadStoredDoc()
    return { ...fallback, storage: 'localstorage' }
  }

  try {
    const { meta, pages } = await readAll(db)
    if (meta && pages.length > 0) {
      const { doc, warnings } = parseDoc(
        serializeDoc({
          version: meta.version,
          // `order` is a storage detail; the parser rebuilds each page anyway.
          pages,
          settings: meta.settings,
        } as CanvasDoc),
      )
      return { doc, warnings, storage: 'database' }
    }

    // First run in this browser: adopt whatever the old JSON file held.
    const legacy = loadStoredDoc()
    if (legacy.doc) {
      await writeWholeDocument(db, legacy.doc)
      return { doc: legacy.doc, warnings: legacy.warnings, storage: 'database' }
    }
    return { doc: null, warnings: [], storage: 'database' }
  } catch (error) {
    return { doc: null, warnings: [], error: describeError(error), storage: 'database' }
  }
}

/**
 * Writes the document, touching only the records that changed. Safe to call on
 * every autosave tick: with nothing edited it performs no I/O at all.
 */
export async function saveDocument(doc: CanvasDoc): Promise<SaveResult> {
  const db = await openDatabase()
  if (!db) return localStorageResult(saveStoredDoc(doc))

  try {
    const plan = planWrite(doc)
    if (plan.put.length === 0 && plan.remove.length === 0 && !plan.settings) {
      return { ok: true, bytes: 0, pages: 0, storage: 'database' }
    }
    const bytes = await commit(db, doc, plan, () => rememberWrite(doc, plan))
    requestPersistentStorage()
    return { ok: true, bytes, pages: plan.put.length, storage: 'database' }
  } catch (error) {
    // The plan stays unremembered, so the next autosave retries these records.
    return { ok: false, error: describeError(error), storage: 'database' }
  }
}

/**
 * Persists the document as it stands right now, writing every record. Used on
 * boot to make the database match the (possibly repaired) document and by the
 * explicit "save now" action.
 */
export async function saveDocumentNow(doc: CanvasDoc): Promise<SaveResult> {
  const db = await openDatabase()
  if (!db) return localStorageResult(saveStoredDoc(doc))
  try {
    const plan: WritePlan = {
      put: doc.pages.map((page, order) => ({ ...page, order })),
      remove: [],
      settings: true,
    }
    const bytes = await commit(db, doc, plan, () => rememberWrite(doc, plan))
    requestPersistentStorage()
    return { ok: true, bytes, pages: plan.put.length, storage: 'database' }
  } catch (error) {
    return { ok: false, error: describeError(error), storage: 'database' }
  }
}

/** Empties both the database and the legacy JSON file. */
export async function clearDocument(): Promise<void> {
  writtenPages.clear()
  writtenSettings = null
  writtenVersion = null
  clearStoredDoc()
  const db = await openDatabase()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([PAGE_STORE, META_STORE], 'readwrite')
    transaction.objectStore(PAGE_STORE).clear()
    transaction.objectStore(META_STORE).clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Clear failed'))
  })
}

/** How much space the origin is using, when the browser will say. */
export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate || estimate.usage === undefined) return null
    return { usage: estimate.usage, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}

let askedForPersistence = false
/**
 * Asks the browser not to evict the database under storage pressure. It may say
 * no, which is fine â€” nothing depends on the answer.
 */
function requestPersistentStorage(): void {
  if (askedForPersistence || typeof navigator === 'undefined') return
  askedForPersistence = true
  void navigator.storage?.persist?.().catch(() => false)
}



