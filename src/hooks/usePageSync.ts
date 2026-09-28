import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { getAccessToken, supabase } from '@/lib/supabase'
import { colorFor, usePresence, type PresenceEntry } from '@/store/presence'
import { useCanvasStore } from '@/store/useCanvasStore'
import type { LoadedDocument } from '@/store/supabase-sync'
import {
  createPage,
  deletePage,
  renameDocument,
  saveDocumentSettings,
  savePageSnapshot,
  savePageSnapshotKeepalive,
  updatePageMeta,
} from '@/store/supabase-sync'
import type { Page } from '@/types'
import { screenToWorld } from '@/utils/geometry'
import { applySnapshot, unionContent, type RemoteSnapshot } from '@/utils/merge'

/**
 * Collaboration for the open document.
 *
 * Persistence is idle-debounced like a Google Doc rather than fired on every
 * keystroke, so the server is never saturated:
 *
 *   local edit ──► broadcast `page-update` (WebSocket, instant for everyone)
 *              └─► 1.2 s idle timer  ──► `PATCH /pages`  (durable write)
 *                  max 4 s since the last write
 *                  forced on: page switch, `pagehide`, tab hidden, Ctrl+S
 *
 * Writes use optimistic concurrency (`version` must still match), so two people
 * saving at the same instant cannot overwrite each other: the loser refetches,
 * unions the two states and writes again.
 */

const IDLE_FLUSH_MS = 1200
const MAX_FLUSH_MS = 4000
const PAGE_TOPIC = 'page:'
const DOC_TOPIC = 'document:'

/** Broadcast payload. Kept small-ish: only what the canvas draws. */
export interface PageUpdatePayload extends RemoteSnapshot {}

interface PageRuntime {
  /** Server version this client last knows about. */
  version: number
  /** Wall clock of the newest local edit. */
  localEditAt: number
  /** Wall clock of the newest remote snapshot we accepted. */
  remoteAt: number
  /** Unwritten changes. */
  dirty: boolean
  idleTimer: ReturnType<typeof setTimeout> | null
  maxTimer: ReturnType<typeof setTimeout> | null
  saving: boolean
}

const runtime = new Map<string, PageRuntime>()

function runtimeFor(pageId: string): PageRuntime {
  let entry = runtime.get(pageId)
  if (!entry) {
    entry = {
      version: 0,
      localEditAt: 0,
      remoteAt: 0,
      dirty: false,
      idleTimer: null,
      maxTimer: null,
      saving: false,
    }
    runtime.set(pageId, entry)
  }
  return entry
}

function setKnownPageVersion(pageId: string, version: number): void {
  runtimeFor(pageId).version = version
}

let clientId = `c_${Math.random().toString(36).slice(2, 10)}`

/** Latest JWT, cached so the `pagehide` flush can fire without awaiting. */
let cachedToken: string | null = null

/* ------------------------------------------------------------------ */
/* Server state known at load time                                     */
/* ------------------------------------------------------------------ */

/** Which document `knownPages` describes. Guards the page-list diff. */
let syncedDocumentId: string | null = null
const knownPages = new Map<string, { title: string; ordinal: number }>()

/**
 * Called right after a document is loaded. It records what the server holds —
 * the page list, every page's `version`, and the content of every page — and
 * re-arms the page-list diff for this document. Because the content signatures
 * are seeded here, simply opening a workspace writes nothing.
 */
export function primePageSync(documentId: string, loaded: LoadedDocument): void {
  syncedDocumentId = documentId

  knownPages.clear()
  lastBroadcastSignature.clear()
  loaded.pageRows.forEach((row, index) => {
    knownPages.set(row.id, { title: row.title, ordinal: row.ordinal ?? index })
    setKnownPageVersion(row.id, row.version ?? 0)
  })
  for (const page of loaded.pages) {
    lastBroadcastSignature.set(page.id, pageSignature(page))
  }

  lastDocumentTitle.set(documentId, loaded.document.title)
  lastDocumentSettings.set(documentId, JSON.stringify(loaded.settings))
}

/** Forget everything (sign-out, or a document that failed to load). */
export function resetPageSync(): void {
  syncedDocumentId = null
  knownPages.clear()
  lastBroadcastSignature.clear()
  lastDocumentTitle.clear()
  lastDocumentSettings.clear()
  runtime.clear()
}

const lastBroadcastSignature = new Map<string, string>()
const lastDocumentTitle = new Map<string, string>()
const lastDocumentSettings = new Map<string, string>()

/**
 * Content fingerprint of a page. It decides whether something actually changed
 * (no write) and it is also stamped when a remote snapshot is applied, so the
 * echo that comes back through the store never triggers a second broadcast.
 */
function pageSignature(page: Page): string {
  return JSON.stringify({
    t: page.title,
    p: page.position,
    v: page.viewport,
    c: page.cards,
    g: page.groups,
    n: page.connections,
  })
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

export function usePageSync() {
  const documentId = useCanvasStore((s) => s.documentId)
  const documentTitle = useCanvasStore((s) => s.documentTitle)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const doc = useCanvasStore((s) => s.doc)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const pagesRef = useRef<Page[]>(doc.pages)

  /** Who we are on the presence channel, once the subscription confirms. */
  const identity = useRef<{
    userId: string
    name: string
    color: string
    avatarUrl: string | null
  } | null>(null)
  const lastCursorAt = useRef(0)

  pagesRef.current = doc.pages

  /* --- inbound: broadcasts from other people --------------------- */
  useEffect(() => {
    const db = supabase
    if (!db || !documentId || !activePageId) return

    const channel = db
      .channel(`${PAGE_TOPIC}${activePageId}`, {
        config: { private: true, broadcast: { ack: true }, presence: { key: clientId } },
      })
      .on('broadcast', { event: 'page-update' }, ({ payload }) => {
        const data = payload as PageUpdatePayload & { origin?: string }
        if (data.origin === clientId) return

        const store = useCanvasStore.getState()
        const page = store.doc.pages.find((p) => p.id === activePageId)
        if (!page) return

        const entry = runtimeFor(activePageId)
        // Older than what we already applied → nothing to do.
        if (data.sentAt <= entry.remoteAt) return

        const mode = data.sentAt >= entry.localEditAt ? 'replace' : 'union'
        entry.remoteAt = data.sentAt

        const merged = applySnapshot(page, data, mode)
        // The sender already wrote this to Postgres: adopt it without echoing.
        lastBroadcastSignature.set(activePageId, pageSignature(merged))
        store.applyRemotePage(activePageId, merged)
      })
      .subscribe()

    channelRef.current = channel

    return () => {
      channelRef.current = null
      void db.removeChannel(channel)
    }
  }, [activePageId, documentId])

  /* --- document presence and live cursors -------------------------- */
  useEffect(() => {
    const db = supabase
    if (!db || !documentId) return

    const channel = db
      .channel(`${DOC_TOPIC}${documentId}`, {
        config: { private: true, presence: { key: clientId } },
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Record<string, unknown>>()
        const seen = new Map<string, PresenceEntry>()

        for (const row of Object.values(state).flat()) {
          const meta = row as {
            user_id?: string
            name?: string
            color?: string
            avatar_url?: string | null
            cursor?: { x: number; y: number } | null
            page_id?: string | null
          }
          if (!meta.user_id || seen.has(meta.user_id)) continue
          seen.set(meta.user_id, {
            userId: meta.user_id,
            name: meta.name ?? 'Someone',
            color: meta.color ?? colorFor(meta.user_id),
            avatarUrl: meta.avatar_url ?? null,
            cursor: meta.cursor ?? null,
            pageId: meta.page_id ?? null,
          })
        }

        // A cursor is a live value, not tracked state: carry over what we
        // already know so a pointer does not jump when someone reconnects.
        const previous = new Map(
          usePresence.getState().entries.map((entry) => [entry.userId, entry]),
        )
        const merged = [...seen.values()].map((entry) => ({
          ...entry,
          cursor: entry.cursor ?? previous.get(entry.userId)?.cursor ?? null,
          pageId: entry.pageId ?? previous.get(entry.userId)?.pageId ?? null,
        }))

        // A cursor broadcast can land before that person's presence snapshot.
        // Dropping it here would make the pointer blink out of existence the
        // moment they arrive, and it would not come back until they moved the
        // mouse again. Hold on to any unseen entry that still has a pointer;
        // the next presence sync, when they really have left, clears it.
        for (const [userId, entry] of previous) {
          if (seen.has(userId) || !entry.cursor) continue
          merged.push(entry)
        }

        usePresence.getState().setEntries(merged)
      })
      // Somebody else's pointer. Broadcast only — it is never stored anywhere.
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        const data = payload as {
          origin: string
          userId: string
          name: string
          color: string
          avatarUrl: string | null
          pageId: string
          point: { x: number; y: number }
        }
        if (data.origin === clientId) return

        const store = usePresence.getState()
        store.upsert({
          userId: data.userId,
          name: data.name,
          color: data.color,
          // The picture travels with the pointer, so a cursor is enough to
          // render a face even if the presence snapshot has not arrived yet.
          avatarUrl:
            data.avatarUrl ??
            store.entries.find((e) => e.userId === data.userId)?.avatarUrl ??
            null,
          cursor: data.point,
          pageId: data.pageId,
        })
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return
        const { data } = await db.auth.getUser()
        const meta = data.user?.user_metadata
        identity.current = {
          userId: data.user?.id ?? clientId,
          name: meta?.name ?? meta?.full_name ?? data.user?.email ?? 'Someone',
          color: colorFor(data.user?.id ?? clientId),
          // Google's picture lives in `picture`; Supabase's own convention is
          // `avatar_url`. Take whichever this provider sent.
          avatarUrl: meta?.avatar_url ?? meta?.picture ?? null,
        }

        // Tracked under snake_case on purpose: the `presence` handler above
        // reads `user_id` / `avatar_url`, and these are two different wire
        // formats. Spreading the camelCase identity here used to publish rows
        // the reader then threw away, which is why other people never appeared
        // in the avatar cluster and had no cursor.
        void channel.track({
          user_id: identity.current.userId,
          name: identity.current.name,
          color: identity.current.color,
          avatar_url: identity.current.avatarUrl,
          cursor: null,
          page_id: null,
        })
      })

    return () => {
      usePresence.getState().clear()
      void db.removeChannel(channel)
    }
  }, [documentId])

  /* --- the pointer, going out -------------------------------------- */
  useEffect(() => {
    if (!supabase || !documentId || !activePageId) return

    const onMove = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      const surface = target?.closest('.cc-canvas')
      if (!surface) return

      const now = Date.now()
      // ~25 messages a second: smooth to watch, and a mouse sweep across the
      // canvas cannot flood the channel.
      if (now - lastCursorAt.current < 40) return
      lastCursorAt.current = now

      const me = identity.current
      if (!me) return

      const rect = surface.getBoundingClientRect()
      const page = useCanvasStore.getState().activePage()
      if (!page) return

      void channelRef.current?.send({
        type: 'broadcast',
        event: 'cursor',
        payload: {
          origin: clientId,
          userId: me.userId,
          name: me.name,
          color: me.color,
          avatarUrl: me.avatarUrl,
          pageId: activePageId,
          // World coordinates, so the same point lands in the same place for
          // everyone whatever they have panned or zoomed to.
          point: screenToWorld(
            { x: event.clientX - rect.left, y: event.clientY - rect.top },
            page.viewport,
          ),
          sentAt: now,
        },
      })
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [activePageId, documentId])

  /* --- page list: create / rename / reorder / delete -------------- */
  useEffect(() => {
    if (!supabase || !documentId) return

    const run = async () => {
      const pages = pagesRef.current
      const seen = new Set<string>()

      for (const [ordinal, page] of pages.entries()) {
        seen.add(page.id)
        const previous = knownPages.get(page.id)

        if (!previous) {
          // Added locally: give it a row of its own, content included.
          const row = await createPage(documentId, page)
          if (row) setKnownPageVersion(page.id, row.version)
          knownPages.set(page.id, { title: page.title, ordinal })
          continue
        }

        if (previous.title === page.title && previous.ordinal === ordinal) continue

        // Renaming used to be skipped for the open page, on the assumption that
        // its debounced content write would carry the title along. That made a
        // rename depend on an unrelated write succeeding, so it could silently
        // vanish. It is one small request; always send it.
        const ok = await updatePageMeta(page.id, { title: page.title, ordinal })
        if (!ok) {
          useCanvasStore.getState().pushToast(`Could not rename "${page.title}".`, 'error')
        }
        knownPages.set(page.id, { title: page.title, ordinal })
      }

      for (const [pageId, meta] of knownPages) {
        if (seen.has(pageId)) continue
        knownPages.delete(pageId)
        const result = await deletePage(pageId)
        if (!result.ok) {
          useCanvasStore
            .getState()
            .pushToast(result.error ?? `Could not delete "${meta.title}".`, 'error')
        }
      }
    }

    // Nothing is diffed until the loader has told us what the server holds, so
    // switching documents can never mistake the old document's pages for
    // deletions.
    if (syncedDocumentId !== documentId) return

    const timer = setTimeout(() => void run(), 250)
    return () => clearTimeout(timer)
  }, [doc.pages, documentId])

  /* --- outbound: debounced broadcast + durable write -------------- */
  useEffect(() => {
    if (!supabase || !documentId || !activePageId) return

    const page = doc.pages.find((p) => p.id === activePageId)
    if (!page) return

    const signature = pageSignature(page)
    if (lastBroadcastSignature.get(activePageId) === signature) return
    lastBroadcastSignature.set(activePageId, signature)

    const entry = runtimeFor(activePageId)
    entry.dirty = true
    entry.localEditAt = Date.now()

    // 1. Realtime: everyone else sees the edit now.
    const payload: PageUpdatePayload & { origin: string } = {
      title: page.title,
      position: page.position,
      viewport: page.viewport,
      cards: page.cards,
      groups: page.groups,
      connections: page.connections,
      sentAt: entry.localEditAt,
      origin: clientId,
    }
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'page-update',
      payload,
    })

    // 2. Durable write, once typing stops.
    const schedule = () => {
      if (entry.idleTimer) clearTimeout(entry.idleTimer)
      entry.idleTimer = setTimeout(() => void flush(page.id), IDLE_FLUSH_MS)
    }
    schedule()

    if (!entry.maxTimer) {
      entry.maxTimer = setTimeout(() => void flush(page.id), MAX_FLUSH_MS)
    }

    function flush(pageId: string) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer)
        entry.idleTimer = null
      }
      if (entry.maxTimer) {
        clearTimeout(entry.maxTimer)
        entry.maxTimer = null
      }
      void writePage(pageId)
    }
  }, [doc, activePageId, documentId])

  /* --- document: title and document-wide defaults ------------------ */
  useEffect(() => {
    if (!documentId || !documentTitle) return
    if (lastDocumentTitle.get(documentId) === documentTitle) return
    lastDocumentTitle.set(documentId, documentTitle)
    void renameDocument(documentId, documentTitle)
  }, [documentTitle, documentId])

  useEffect(() => {
    if (!documentId) return
    const signature = JSON.stringify(doc.settings)
    if (lastDocumentSettings.get(documentId) === signature) return
    lastDocumentSettings.set(documentId, signature)
    void saveDocumentSettings(documentId, doc.settings)
  }, [doc.settings, documentId])

  /* --- access token, kept in hand for the unload flush ------------- */
  useEffect(() => {
    const db = supabase
    if (!db) return

    let live = true
    void getAccessToken().then((token) => {
      if (live) cachedToken = token
    })

    const { data } = db.auth.onAuthStateChange((_event, session) => {
      cachedToken = session?.access_token ?? null
    })

    return () => {
      live = false
      cachedToken = null
      data.subscription.unsubscribe()
    }
  }, [])

  /* --- leaving: never lose the last few hundred ms ---------------- */
  useEffect(() => {
    if (!supabase || !documentId || !activePageId) return

    const onLeave = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) return
      const entry = runtime.get(activePageId)
      if (!entry?.dirty) return
      entry.dirty = false

      const page = useCanvasStore.getState().doc.pages.find((p) => p.id === activePageId)
      if (!page) return

      // `keepalive` lets this request outlive the page, so it must be fired
      // synchronously — an awaited token would arrive too late.
      if (cachedToken) void savePageSnapshotKeepalive(cachedToken, page, entry.version)
    }

    window.addEventListener('pagehide', onLeave)
    document.addEventListener('visibilitychange', onLeave)
    return () => {
      window.removeEventListener('pagehide', onLeave)
      document.removeEventListener('visibilitychange', onLeave)
    }
  }, [activePageId, documentId])
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

async function writePage(pageId: string): Promise<void> {
  const entry = runtime.get(pageId)
  if (!entry || entry.saving) return

  const store = useCanvasStore.getState()
  const page = store.doc.pages.find((p) => p.id === pageId)
  if (!page) return

  entry.saving = true
  try {
    const outcome = await savePageSnapshot(page, entry.version)

    if (outcome.status === 'saved') {
      entry.version = outcome.version
      entry.dirty = false
      return
    }

    if (outcome.status === 'conflict') {
      // Somebody else wrote first: union their state with ours, then write again.
      const merged = unionContent(
        { cards: page.cards, groups: page.groups, connections: page.connections },
        {
          cards: outcome.server.cards ?? [],
          groups: outcome.server.groups ?? [],
          connections: outcome.server.connections ?? [],
        },
      )
      const retry = await savePageSnapshot(
        { ...page, title: page.title, ...merged },
        outcome.server.version,
      )
      if (retry.status === 'saved') {
        entry.version = retry.version
        entry.dirty = false
        const reconciled = { ...page, ...merged }
        // Already durable, so the store update must not queue another write.
        lastBroadcastSignature.set(pageId, pageSignature(reconciled))
        store.applyRemotePage(pageId, reconciled)
        return
      }
      store.pushToast('Could not save this page — try again.', 'error')
      return
    }

    store.pushToast(`Could not save: ${outcome.error}`, 'error')
  } finally {
    entry.saving = false
  }
}

/** Ctrl+S / toolbar "Save now". */
export function flushPageNow(pageId?: string): Promise<void> {
  const store = useCanvasStore.getState()
  const id = pageId ?? store.activePageId
  return writePage(id)
}
