/**
 * A tiny in-memory stand-in for IndexedDB, just enough of the API for
 * `store/database.ts`: open/upgrade, two object stores, and the handful of
 * methods the app uses. It mirrors the parts that matter â€” records are cloned in
 * and out, page order lives on the record, a transaction only reports
 * `complete` once every request in it has finished, and a request issued after a
 * transaction committed throws, as a real one does.
 *
 * Imported only by the smoke suite; the app always uses the real database.
 */
interface FakeRequest<T> {
  onsuccess: ((event: { target: FakeRequest<T> }) => void) | null
  onerror: ((event: { target: FakeRequest<T> }) => void) | null
  result: T | undefined
  error: unknown
}

interface FakeStore {
  keyPath: string
  data: Map<string, unknown>
}

interface FakeTransaction {
  committed: boolean
  pending: number
  error: unknown
  oncomplete: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
  objectStore: (name: string) => ReturnType<typeof makeStore>
  settle: () => void
}

function makeStore(store: FakeStore, tx: FakeTransaction) {
  const run = <T>(compute: () => T) => {
    const request: FakeRequest<T> = { onsuccess: null, onerror: null, result: undefined, error: null }
    if (tx.committed) {
      throw new DOMException('The transaction has finished', 'TransactionInactiveError')
    }
    tx.pending += 1
    setTimeout(() => {
      request.result = compute()
      setTimeout(() => request.onsuccess?.({ target: request }), 0)
      tx.pending -= 1
      tx.settle()
    }, 0)
    return request
  }

  return {
    put: (record: Record<string, unknown>) =>
      run(() => {
        const key = record[store.keyPath] as string
        store.data.set(key, structuredClone(record))
        return key
      }),
    delete: (key: string) =>
      run(() => {
        store.data.delete(key)
        return undefined
      }),
    get: (key: string) =>
      run(() => {
        const found = store.data.get(key)
        return (found === undefined ? undefined : structuredClone(found)) as never
      }),
    getAll: () => run(() => [...store.data.values()].map((value) => structuredClone(value)) as never),
    clear: () =>
      run(() => {
        store.data.clear()
        return undefined
      }),
  }
}

function makeTransaction(entry: Map<string, FakeStore>, names: string | string[]): FakeTransaction {
  for (const name of Array.isArray(names) ? names : [names]) {
    if (!entry.has(name)) throw new DOMException(`No store named ${name}`, 'NotFoundError')
  }

  const tx: FakeTransaction = {
    committed: false,
    pending: 0,
    error: null,
    oncomplete: null,
    onerror: null,
    onabort: null,
    objectStore: (name) => makeStore(entry.get(name)!, tx),
    settle: () => {
      if (tx.committed || tx.pending > 0) return
      tx.committed = true
      setTimeout(() => tx.oncomplete?.(), 0)
    },
  }

  // A transaction that never issues a request still has to complete.
  setTimeout(() => tx.settle(), 0)
  return tx
}

export interface FakeIndexedDB {
  /** Empties every database, as if the browser profile were new. */
  reset: () => void
  /** Reads a store straight out of the fake, bypassing the app. */
  dump: (database: string, store: string) => Array<Record<string, unknown>>
}

/** Installs the fake on `globalThis.indexedDB` and hands back a test handle. */
export function installFakeIndexedDB(): FakeIndexedDB {
  const databases = new Map<string, { version: number; stores: Map<string, FakeStore> }>()

  const factory = {
    open(name: string, version: number) {
      const request: FakeRequest<IDBDatabase> & {
        onupgradeneeded: ((event: { target: unknown }) => void) | null
        onblocked: ((event: { target: unknown }) => void) | null
        result: IDBDatabase
      } = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
        result: undefined as unknown as IDBDatabase,
        error: null,
      }

      setTimeout(() => {
        let entry = databases.get(name)
        const fresh = !entry
        if (!entry) {
          entry = { version, stores: new Map() }
          databases.set(name, entry)
        }
        const stores = entry.stores
        request.result = {
          objectStoreNames: { contains: (store: string) => stores.has(store) },
          createObjectStore: (store: string, options: { keyPath: string }) => {
            stores.set(store, { keyPath: options.keyPath, data: new Map() })
            return {}
          },
          transaction: (names: string | string[]) => makeTransaction(stores, names),
        } as unknown as IDBDatabase
        if (fresh) request.onupgradeneeded?.({ target: request })
        request.onsuccess?.({ target: request })
      }, 0)
      return request as unknown as IDBOpenDBRequest
    },
  }

  globalThis.indexedDB = factory as unknown as IDBFactory
  return {
    reset: () => databases.clear(),
    dump: (database, store) => [...(databases.get(database)?.stores.get(store)?.data.values() ?? [])] as Array<
      Record<string, unknown>
    >,
  }
}





