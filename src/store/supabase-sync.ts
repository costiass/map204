import type { SupabaseClient } from '@supabase/supabase-js'

import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase'
import { handleWriteError } from '@/store/writeErrors'
import type { DocSettings, LineStyle, Routing, ArrowStyle } from '@/types'
import type { Card, Connection, Group, Page, Position, Viewport } from '@/types'
import { uid } from '@/utils/id'

/**
 * Supabase data layer — every REST call the app makes against PostgREST.
 *
 *   documents            list / create / rename / delete
 *   pages                list / create / rename / delete / snapshot writes
 *   document_collaborators  share dialog
 *   profiles             resolve a collaborator by email
 *
 * Realtime (WebSocket) lives in `src/hooks/usePageSync.ts`.
 */

export interface DocumentRow {
  id: string
  owner_id: string
  title: string
  /** The workspace's colour, as a token name — see `getWorkspaceAccent`. */
  accent?: string | null
  /** The workspace's icon, as a lucide icon name. */
  icon?: string | null
  /** Document-wide defaults (`DocSettings`), `{}` until the user changes them. */
  settings?: Partial<DocSettings> | null
  created_at: string
  updated_at: string
}

export interface PageRow {
  id: string
  document_id: string
  title: string
  position: Position
  viewport: Viewport
  cards: Card[]
  groups: Group[]
  connections: Connection[]
  version: number
  ordinal: number
  created_at: string
  updated_at: string
}

export interface ProfileRow {
  id: string
  email: string | null
  full_name: string | null
  avatar_url: string | null
}

export interface CollaboratorRow {
  document_id: string
  user_id: string
  role: 'owner' | 'editor' | 'viewer'
  created_at: string
  profile: ProfileRow | null
}

export const DEFAULT_DOC_SETTINGS: DocSettings = {
  defaultCardStyle: {
    backgroundColor: '#ffffff',
    accentColor: '#6366F1',
    textColor: '#111827',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    shadow: true,
  },
  defaultConnectionStyle: {
    color: '#6366F1',
    width: 2,
    lineStyle: 'solid' as LineStyle,
    routing: 'curved' as Routing,
    arrowStart: 'none' as ArrowStyle,
    arrowEnd: 'arrow' as ArrowStyle,
    animated: false,
  },
  defaultRelationshipType: 'related to',
}

export const DEFAULT_PAGE_POSITION: Position = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  zIndex: 0,
}

export const DEFAULT_PAGE_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `position` was an integer before it became a JSON rect; old rows survive it. */
function asPosition(value: unknown): Position {
  return isRecord(value) ? (value as unknown as Position) : DEFAULT_PAGE_POSITION
}

function asViewport(value: unknown): Viewport {
  if (!isRecord(value)) return DEFAULT_PAGE_VIEWPORT
  return {
    x: typeof value.x === 'number' ? value.x : 0,
    y: typeof value.y === 'number' ? value.y : 0,
    zoom: typeof value.zoom === 'number' && value.zoom > 0 ? value.zoom : 1,
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    title: row.title || 'Untitled Page',
    position: asPosition(row.position),
    viewport: asViewport(row.viewport),
    cards: asArray<Card>(row.cards),
    groups: asArray<Group>(row.groups),
    connections: asArray<Connection>(row.connections),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** The document payload the canvas store is hydrated with. */
export interface LoadedDocument {
  document: DocumentRow
  pageRows: PageRow[]
  pages: Page[]
  settings: DocSettings
}

/** Narrowed client, or `null` when the environment is missing the env vars. */
function authRequired(): SupabaseClient | null {
  if (!supabase) {
    console.error('[sync] Supabase is not configured.')
    return null
  }
  return supabase
}

/* ------------------------------------------------------------------ */
/* Documents                                                            */
/* ------------------------------------------------------------------ */

export interface SharedDocument {
  document: DocumentRow
  role: 'owner' | 'editor' | 'viewer'
}

/**
 * `GET /documents?owner_id=eq.<uid>` plus `GET /document_collaborators?user_id=eq.<uid>`
 * — the workspace list holds what you own *and* what was shared with you.
 */
export async function listDocuments(userId: string): Promise<SharedDocument[]> {
  const db = authRequired()
  if (!db) return []

  const [owned, shared] = await Promise.all([
    db
      .from('documents')
      .select('id, owner_id, title, accent, icon, created_at, updated_at')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false }),
    db
      .from('document_collaborators')
      .select(
        'role, document:documents(id, owner_id, title, accent, icon, created_at, updated_at)',
      )
      .eq('user_id', userId),
  ])

  if (owned.error) await handleWriteError(owned.error, 'sync:listDocuments')
  if (shared.error) await handleWriteError(shared.error, 'sync:listSharedDocuments')

  const merged = new Map<string, SharedDocument>()

  for (const row of (owned.data ?? []) as DocumentRow[]) {
    merged.set(row.id, { document: row, role: 'owner' })
  }

  for (const row of (shared.data ?? []) as unknown as Array<{
    role: 'owner' | 'editor' | 'viewer'
    document: DocumentRow | DocumentRow[] | null
  }>) {
    const document = Array.isArray(row.document) ? row.document[0] : row.document
    if (!document || merged.has(document.id)) continue
    merged.set(document.id, { document, role: row.role })
  }

  return [...merged.values()].sort((a, b) =>
    b.document.updated_at.localeCompare(a.document.updated_at),
  )
}

/** `GET /documents?id=eq.<docId>` — documents a collaborator can also read. */
export async function getDocument(documentId: string): Promise<DocumentRow | null> {
  const db = authRequired()
  if (!db) return null
  const { data, error } = await db
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle()

  if (error) {
    await handleWriteError(error, 'sync:getDocument')
    return null
  }
  return (data as DocumentRow | null) ?? null
}

/** `GET /pages?document_id=eq.<docId>&order=ordinal.asc` */
export async function listPages(documentId: string): Promise<PageRow[]> {
  const db = authRequired()
  if (!db) return []
  const { data, error } = await db
    .from('pages')
    .select('*')
    .eq('document_id', documentId)
    .order('ordinal', { ascending: true })

  if (error) {
    await handleWriteError(error, 'sync:listPages')
    return []
  }
  return (data ?? []) as PageRow[]
}

/** `GET /documents` + `GET /pages` — everything the canvas needs. */
export async function loadDocument(documentId: string): Promise<LoadedDocument | null> {
  const db = authRequired()
  if (!db) return null

  const document = await getDocument(documentId)
  if (!document) return null

  const rows = await listPages(documentId)
  return {
    document,
    pageRows: rows,
    pages: rows.map(rowToPage),
    // Whatever the document has, falling back to the built-in defaults.
    settings: {
      ...DEFAULT_DOC_SETTINGS,
      ...(document.settings ?? {}),
    } as DocSettings,
  }
}

/**
 * `POST /documents` — the `trg_create_default_page` trigger adds page #1, so the
 * client never inserts a page itself.
 */
export async function createDocument(
  userId: string,
  title: string,
  look?: { accent?: string; icon?: string },
): Promise<{ document: DocumentRow; page: PageRow } | null> {
  const db = authRequired()
  if (!db) return null

  const { data, error } = await db
    .from('documents')
    .insert({ owner_id: userId, title, ...(look?.accent ? { accent: look.accent } : {}), ...(look?.icon ? { icon: look.icon } : {}) })
    .select('id, owner_id, title, accent, icon, created_at, updated_at')
    .single()

  if (error || !data) {
    await handleWriteError(error, 'sync:createDocument')
    return null
  }

  const document = data as DocumentRow
  const { data: page } = await db
    .from('pages')
    .select('*')
    .eq('document_id', document.id)
    .order('ordinal', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!page) {
    console.error('[sync] createDocument: the default page trigger produced no page')
    return null
  }

  return { document, page: page as PageRow }
}

/** `PATCH /documents` — rename. */
export async function renameDocument(documentId: string, title: string): Promise<boolean> {
  const db = authRequired()
  if (!db) return false
  const { error } = await db
    .from('documents')
    .update({ title })
    .eq('id', documentId)
  if (error) await handleWriteError(error, 'sync:renameDocument')
  return !error
}

/**
 * `PATCH /documents` — the workspace's colour and icon.
 *
 * Only the owner may do this, which the `documents` update policy already
 * enforces; there is no client-side branch for it and none is needed.
 */
export async function setDocumentLook(
  documentId: string,
  look: { accent?: string; icon?: string },
): Promise<boolean> {
  const db = authRequired()
  if (!db) return false
  const { error } = await db.from('documents').update(look).eq('id', documentId)
  if (error) await handleWriteError(error, 'sync:setDocumentLook')
  return !error
}

/** `PATCH /documents` — document-wide defaults. */
export async function saveDocumentSettings(
  documentId: string,
  settings: DocSettings,
): Promise<boolean> {
  const db = authRequired()
  if (!db) return false
  const { error } = await db
    .from('documents')
    .update({ settings })
    .eq('id', documentId)
  if (error) await handleWriteError(error, 'sync:saveDocumentSettings')
  return !error
}

/** `DELETE /documents` — pages cascade. */
export async function deleteDocument(documentId: string): Promise<boolean> {
  const db = authRequired()
  if (!db) return false
  const { error } = await db.from('documents').delete().eq('id', documentId)
  if (error) await handleWriteError(error, 'sync:deleteDocument')
  return !error
}

/* ------------------------------------------------------------------ */
/* Pages                                                                */
/* ------------------------------------------------------------------ */

/**
 * `POST /pages` — a new page in an existing document (client-generated id).
 *
 * The id comes from the app, so a page from an imported file can already exist.
 * That page may well belong to a *different* workspace, and the `pages` policies
 * decide access per document — so an id collision is not something to paper over
 * by overwriting the row. Doing that tried to move a page between workspaces,
 * which RLS correctly refused with
 *   42501  new row violates row-level security policy for table "pages"
 * and, worse, would have done it silently where the caller did have rights.
 *
 * So a colliding id is resolved where the conflict can be seen: the import
 * renumbers the page (see `replaceDocumentPages`). This function only inserts,
 * and reports a collision rather than hiding it.
 */
export async function createPage(documentId: string, page: Page): Promise<PageRow | null> {
  const db = authRequired()
  if (!db) return null

  const { data, error } = await db
    .from('pages')
    .insert({
      id: page.id,
      document_id: documentId,
      title: page.title,
      ordinal: 0,
      position: page.position ?? DEFAULT_PAGE_POSITION,
      viewport: page.viewport ?? DEFAULT_PAGE_VIEWPORT,
      cards: page.cards ?? [],
      groups: page.groups ?? [],
      connections: page.connections ?? [],
      version: 0,
    })
    .select('*')
    .single()

  if (!error && data) return data as PageRow

  if (error?.code === '23505') {
    // The caller's id is taken somewhere this client cannot see. Retrying with
    // a fresh id is the only correct move; the caller is told which id won.
    const fresh = uid('page')
    const { data: inserted, error: retryError } = await db
      .from('pages')
      .insert({
        id: fresh,
        document_id: documentId,
        title: page.title,
        ordinal: 0,
        position: page.position ?? DEFAULT_PAGE_POSITION,
        viewport: page.viewport ?? DEFAULT_PAGE_VIEWPORT,
        cards: page.cards ?? [],
        groups: page.groups ?? [],
        connections: page.connections ?? [],
        version: 0,
      })
      .select('*')
      .single()

    if (retryError) {
      await handleWriteError(retryError, 'sync:createPage:retry')
      return null
    }
    return inserted as PageRow
  }

  await handleWriteError(error, 'sync:createPage')
  return null
}

/** `PATCH /pages` — metadata only (title / list position). */
export async function updatePageMeta(
  pageId: string,
  patch: { title?: string; ordinal?: number },
): Promise<boolean> {
  const db = authRequired()
  if (!db) return false
  const { error } = await db.from('pages').update(patch).eq('id', pageId)
  if (error) await handleWriteError(error, 'sync:updatePageMeta')
  return !error
}

/** `DELETE /pages` — blocked by `trg_prevent_last_page_delete` on the last one. */
export async function deletePage(pageId: string): Promise<{ ok: boolean; error?: string }> {
  const db = authRequired()
  if (!db) return { ok: false, error: 'Supabase is not configured.' }

  const { error } = await db.from('pages').delete().eq('id', pageId)
  if (error) {
    await handleWriteError(error, 'sync:write')
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** `GET /pages?id=eq.<pageId>` */
export async function fetchPage(pageId: string): Promise<PageRow | null> {
  const db = authRequired()
  if (!db) return null
  const { data, error } = await db.from('pages').select('*').eq('id', pageId).maybeSingle()
  if (error) {
    await handleWriteError(error, 'sync:fetchPage')
    return null
  }
  return (data as PageRow | null) ?? null
}

export type SaveOutcome =
  | { status: 'saved'; version: number }
  | { status: 'conflict'; server: PageRow }
  | { status: 'error'; error: string }

/**
 * `PATCH /pages` with optimistic concurrency.
 *
 * The write only lands when the stored `version` still equals `baseVersion`, so
 * two people editing at once can never silently overwrite each other: the loser
 * of the race gets `conflict` back with the current server row and merges.
 */
export async function savePageSnapshot(page: Page, baseVersion: number): Promise<SaveOutcome> {
  const db = authRequired()
  if (!db) return { status: 'error', error: 'Supabase is not configured.' }

  const nextVersion = baseVersion + 1
  const { data, error } = await db
    .from('pages')
    .update({
      title: page.title,
      position: page.position,
      viewport: page.viewport,
      cards: page.cards,
      groups: page.groups,
      connections: page.connections,
      version: nextVersion,
    })
    .eq('id', page.id)
    .eq('version', baseVersion)
    .select('version')

  if (error) {
    await handleWriteError(error, 'sync:savePageSnapshot')
    return { status: 'error', error: error.message }
  }
  if (data && data.length > 0) return { status: 'saved', version: nextVersion }

  // Nobody matched: either the row moved on, or the page is gone.
  const server = await fetchPage(page.id)
  if (!server) return { status: 'error', error: 'This page no longer exists.' }
  return { status: 'conflict', server }
}

/**
 * Same write, but through `fetch(..., { keepalive: true })` so a flush can still
 * leave during `pagehide` / tab close.
 */
export async function savePageSnapshotKeepalive(
  accessToken: string,
  page: Page,
  baseVersion: number,
): Promise<boolean> {
  if (!supabaseUrl || !supabaseAnonKey) return false

  const nextVersion = baseVersion + 1
  const url = `${supabaseUrl}/rest/v1/pages?id=eq.${encodeURIComponent(page.id)}&version=eq.${baseVersion}`

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        title: page.title,
        position: page.position,
        viewport: page.viewport,
        cards: page.cards,
        groups: page.groups,
        connections: page.connections,
        version: nextVersion,
      }),
    })
    return response.ok
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Whole-document rewrites (JSON import)                               */
/* ------------------------------------------------------------------ */

export interface WrittenPage {
  id: string
  title: string
  ordinal: number
  version: number
}

/**
 * Makes the server hold exactly `pages`, in order. Used by "Replace document"
 * in the import dialog: pages that are new are inserted with their content,
 * pages that already exist are rewritten, and the leftovers are deleted.
 *
 * Writes happen before deletes so the "a document always has a page" trigger is
 * never in danger.
 *
 * Returns the ids the server actually holds, which is not always the ids that
 * were passed in. A page id from the file may already be in use by another
 * workspace; those pages are renumbered on the way in, because a page id
 * identifies one page in one workspace and two files may legitimately share
 * one. Nothing inside a page refers to its page id — connections point at cards
 * and groups — so renumbering is safe.
 */
export async function replaceDocumentPages(
  documentId: string,
  pages: Page[],
): Promise<{ written: WrittenPage[]; remap: Record<string, string> } | null> {
  const db = authRequired()
  if (!db) return null
  if (pages.length === 0) return { written: [], remap: {} }

  const existing = await listPages(documentId)
  const existingById = new Map(existing.map((row) => [row.id, row]))
  const written: WrittenPage[] = []
  const remap: Record<string, string> = {}

  for (const [ordinal, page] of pages.entries()) {
    const current = existingById.get(page.id)
    const body = {
      title: page.title,
      ordinal,
      position: page.position ?? DEFAULT_PAGE_POSITION,
      viewport: page.viewport ?? DEFAULT_PAGE_VIEWPORT,
      cards: page.cards ?? [],
      groups: page.groups ?? [],
      connections: page.connections ?? [],
    }

    if (current) {
      const { data, error } = await db
        .from('pages')
        .update({ ...body, version: (current.version ?? 0) + 1 })
        .eq('id', page.id)
        .select('version')
        .maybeSingle()
      if (error || !data) {
        await handleWriteError(error, 'sync:replaceDocumentPages')
        return null
      }
      written.push({ id: page.id, title: page.title, ordinal, version: (data as PageRow).version })
      continue
    }

    const row = await createPage(documentId, page)
    if (!row) return null

    // The row may carry a different id to the one we asked for, if that id was
    // already taken elsewhere. The caller needs the truth, not the request.
    if (row.id !== page.id) {
      remap[page.id] = row.id
      await updatePageMeta(row.id, { ordinal })
    } else {
      await updatePageMeta(page.id, { ordinal })
    }

    written.push({ id: row.id, title: page.title, ordinal, version: row.version ?? 0 })
  }

  // Only pages of *this* workspace can be deleted, and only the ones the import
  // did not keep. A page the import renumbered is not in `wanted`, but it was
  // never in `existing` either, so nothing here can touch another workspace.
  const wanted = new Set(pages.map((page) => page.id))
  for (const row of existing) {
    if (wanted.has(row.id)) continue
    await deletePage(row.id)
  }

  return { written, remap }
}

/* ------------------------------------------------------------------ */
/* Sharing                                                              */
/* ------------------------------------------------------------------ */

/** `GET /document_collaborators` with the joined profile. */
export async function listCollaborators(documentId: string): Promise<CollaboratorRow[]> {
  const db = authRequired()
  if (!db) return []
  const { data, error } = await db
    .from('document_collaborators')
    .select('document_id, user_id, role, created_at, profile:profiles(id, email, full_name, avatar_url)')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true })

  if (error) {
    await handleWriteError(error, 'sync:listCollaborators')
    return []
  }
  return ((data ?? []) as unknown as CollaboratorRow[]).map((row) => ({
    ...row,
    profile: Array.isArray(row.profile) ? (row.profile[0] ?? null) : row.profile,
  }))
}

/**
 * What the signed-in account may do in this workspace: `owner`, `editor`,
 * `viewer`, or `null` when it is not a collaborator at all.
 *
 * This exists because the app was guessing. A refused write was being reported
 * as "you may have view-only access", which is wrong whenever the real cause is
 * something else — and it was wrong, for an account that genuinely was an
 * editor. Guessing at a cause is how a schema bug gets reported to the user as a
 * permissions problem, so the role is read from the same table the share dialog
 * uses, and the question is answered rather than assumed.
 *
 * Note the owner check: `add_document_owner` is never called, so the owner has
 * no `document_collaborators` row and must be identified by `documents.owner_id`.
 */
export async function fetchMyRole(
  documentId: string,
  userId: string,
): Promise<'owner' | 'editor' | 'viewer' | null> {
  const db = authRequired()
  if (!db) return null

  const document = await getDocument(documentId)
  if (!document) return null
  if (document.owner_id === userId) return 'owner'

  const { data, error } = await db
    .from('document_collaborators')
    .select('role')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    await handleWriteError(error, 'sync:fetchMyRole')
    return null
  }
  const role = (data as { role?: string } | null)?.role
  return role === 'owner' || role === 'editor' || role === 'viewer' ? role : null
}

/** `POST /rpc/find_profile_by_email` — exact match only. */
export async function findProfileByEmail(email: string): Promise<ProfileRow | null> {
  const db = authRequired()
  if (!db) return null
  const { data, error } = await db.rpc('find_profile_by_email', { p_email: email.trim() })
  if (error) {
    await handleWriteError(error, 'sync:findProfileByEmail')
    return null
  }
  const row = (data as ProfileRow[] | null)?.[0]
  return row ?? null
}

/** `POST /document_collaborators` */
export async function addCollaborator(
  documentId: string,
  userId: string,
  role: CollaboratorRow['role'],
): Promise<{ ok: boolean; error?: string }> {
  const db = authRequired()
  if (!db) return { ok: false, error: 'Supabase is not configured.' }
  const { error } = await db
    .from('document_collaborators')
    .upsert({ document_id: documentId, user_id: userId, role }, { onConflict: 'document_id,user_id' })
  if (error) {
    await handleWriteError(error, 'sync:write')
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** `PATCH /document_collaborators` */
export async function updateCollaboratorRole(
  documentId: string,
  userId: string,
  role: CollaboratorRow['role'],
): Promise<{ ok: boolean; error?: string }> {
  const db = authRequired()
  if (!db) return { ok: false, error: 'Supabase is not configured.' }
  const { error } = await db
    .from('document_collaborators')
    .update({ role })
    .eq('document_id', documentId)
    .eq('user_id', userId)
  if (error) {
    await handleWriteError(error, 'sync:write')
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** `DELETE /document_collaborators` */
export async function removeCollaborator(
  documentId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = authRequired()
  if (!db) return { ok: false, error: 'Supabase is not configured.' }
  const { error } = await db
    .from('document_collaborators')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId)
  if (error) {
    await handleWriteError(error, 'sync:write')
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * `POST /functions/v1/send-share-email` — tell somebody they were given access.
 *
 * Strictly a notification: the grant itself is already in
 * `document_collaborators` by the time this runs, so a failure here must not
 * undo or block the share. It reports success or the reason, and the caller
 * decides what to say — the person has access whether or not the mail arrived.
 */
export async function notifyShare(
  documentId: string,
  to: string,
  role: 'editor' | 'viewer',
): Promise<{ ok: boolean; error?: string }> {
  const db = authRequired()
  if (!db) return { ok: false, error: 'Supabase is not configured.' }
  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, error: 'Supabase is not configured.' }
  }

  const { data: session, error: sessionError } = await db.auth.getSession()
  if (sessionError || !session.session?.access_token) {
    return { ok: false, error: 'You are not signed in.' }
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/send-share-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({ documentId, to, role }),
      },
    )

    if (response.ok) return { ok: true }

    const body = (await response.json().catch(() => null)) as { error?: string } | null
    return { ok: false, error: body?.error ?? `The email failed (${response.status}).` }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The email could not be sent.',
    }
  }
}

/** `GET /profiles?id=eq.<uid>` — used for the owner row and avatars. */
export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const db = authRequired()
  if (!db) return null
  const { data, error } = await db
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    await handleWriteError(error, 'sync:getProfile')
    return null
  }
  return (data as ProfileRow | null) ?? null
}
