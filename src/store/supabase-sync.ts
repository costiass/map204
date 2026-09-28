import type { SupabaseClient } from '@supabase/supabase-js'

import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase'
import { handleWriteError } from '@/store/writeErrors'
import type { Connection, DocSettings, Element, Group, Page, Rect, Viewport } from '@/types'

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
  /**
   * What kind of document this is — `'map'` today, and nothing else.
   *
   * Optional and nullable on purpose. There is no column for it yet, and adding
   * one that can only ever hold one value is a migration to undo the day a second
   * kind exists. The field is here so the *call sites* already pass it, and the
   * day the column lands nothing outside this file has to change.
   */
  kind?: string | null
  created_at: string
  updated_at: string
}

/**
 * A row of the `pages` table.
 *
 * `cards` is the *column name* and is not going away in this change: the database
 * has always called it that, and renaming it is part of the reset in Phase I. The
 * value in it is a list of v2 `Element`s — the wire name and the in-memory type
 * differ here on purpose, and the two ends of that mismatch are this file and
 * `rowToPage` below. Do not "fix" the column name without renaming the column.
 */
export interface PageRow {
  id: string
  document_id: string
  title: string
  /** The page's place in the sidebar. Not canvas geometry. */
  position: Rect
  viewport: Viewport
  cards: Element[]
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

/**
 * A share to an address with no account behind it.
 *
 * No `user_id`, no `profile`, no avatar -- because there is nobody to have any of
 * those yet. `email` is the identity, and the database claims it when somebody
 * registers with that address.
 */
export interface PendingInviteRow {
  email: string
  role: 'editor' | 'viewer'
  created_at: string
}

export const DEFAULT_DOC_SETTINGS: DocSettings = {
  defaultNoteStyle: {
    backgroundColor: '#ffffff',
    accentColor: '#6366F1',
    textColor: '#111827',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    shadow: true,
  },
  // The v2 vocabulary: `orthogonal` rather than `stepped`, and three arrowheads
  // rather than five. The extra v1 shapes (`diamond`, `triangle`) were never
  // rendered — the schema listed what the editor offered, not what the canvas
  // could draw, and offering a choice that silently does nothing is worse than
  // not offering it.
  defaultConnectionStyle: {
    color: '#6366F1',
    width: 2,
    lineStyle: 'solid',
    routing: 'curved',
    arrowStart: 'none',
    arrowEnd: 'arrow',
    animated: false,
  },
  defaultRelationshipType: 'related to',
  // A workspace with no presentation yet is a real state, not a missing field.
  steps: [],
}

export const DEFAULT_PAGE_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

/**
 * The `position` column, which the `pages` table still has and still requires.
 *
 * v2's `Page` has no `position`, because nothing ever read it: the sidebar orders
 * pages by `ordinal` and the canvas geometry lives on the elements themselves.
 * The column stays until the Phase I reset drops it, and until then it gets a
 * constant — writing a value derived from a field that does not exist would be
 * inventing data to satisfy a `not null` nobody reads.
 */
const LEGACY_PAGE_POSITION: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/**
 * Wire shape to in-memory shape.
 *
 * The asymmetry on the `cards` line is the whole point of the comment on
 * `PageRow`: the column is called `cards` and always has been, and what comes
 * out of it is a list of elements. Renaming only one side of that is how a
 * document's entire contents becomes an empty array, silently, on first sync.
 */
export function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    title: row.title || 'Untitled Page',
    ordinal: typeof row.ordinal === 'number' ? row.ordinal : 0,
    viewport: asViewport(row.viewport),
    elements: asArray<Element>(row.cards),
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

  // An empty title is *omitted* rather than written, so the column's own default
  // is what names the map. Hard-coding "Untitled" here as well would mean two
  // places to change the name of a thing nobody has named, and they would
  // eventually disagree.
  const insert: Record<string, string> = { owner_id: userId }
  if (title.trim()) insert.title = title.trim()
  if (look?.accent) insert.accent = look.accent
  if (look?.icon) insert.icon = look.icon

  const { data, error } = await db
    .from('documents')
    .insert(insert)
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
 * `POST /pages` — a new page in an existing document, content included.
 *
 * The id comes from the app, so a page can in principle already exist. It used
 * to be papered over by overwriting the colliding row, which tried to move a
 * page between workspaces and was refused by RLS:
 *
 *   42501  new row violates row-level security policy for table "pages"
 *
 * A collision is now impossible by construction. An import does not come through
 * here at all: it is one `import_pages` call, and the server mints the ids. What
 * reaches this function is a page the user just added, so the id was minted by
 * this client moments ago. The insert is therefore plain, and a collision is
 * reported rather than silently resolved — it would mean two clients generated
 * the same id, which is a bug worth seeing.
 *
 * The ordinal is written here rather than patched afterwards. Writing `0` and
 * correcting it in a second request meant every page briefly sat at the front of
 * the list, and a failure between the two left a permanently misordered page
 * list that no later write would repair.
 */
export async function createPage(
  documentId: string,
  page: Page,
  ordinal = 0,
): Promise<PageRow | null> {
  const db = authRequired()
  if (!db) return null

  const { data, error } = await db
    .from('pages')
    .insert({
      id: page.id,
      document_id: documentId,
      title: page.title,
      ordinal,
      position: LEGACY_PAGE_POSITION,
      viewport: page.viewport ?? DEFAULT_PAGE_VIEWPORT,
      cards: page.elements ?? [],
      groups: page.groups ?? [],
      connections: page.connections ?? [],
      version: 0,
    })
    .select('*')
    .single()

  if (!error && data) return data as PageRow

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
      position: LEGACY_PAGE_POSITION,
      viewport: page.viewport,
      cards: page.elements,
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
        position: LEGACY_PAGE_POSITION,
        viewport: page.viewport,
        cards: page.elements,
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
 * `POST /rpc/import_pages` — add every page in a file to a workspace.
 *
 * One request, one transaction. The server mints the ids, rewrites every
 * reference between them, and inserts the pages; the browser does none of that.
 * The previous version did all of it client-side, which meant N + N + 1 requests
 * and — the reason it mattered — no atomicity: a failure part-way through left
 * a workspace holding both the old pages and some of the new ones.
 *
 * Additive. Nothing already in the workspace is read, written or deleted, so
 * there is no destructive mode left to get wrong and importing twice is safe.
 *
 * Returns the pages the server created, or `null` if the whole import was
 * refused — in which case the workspace is untouched.
 */
export async function importPages(
  documentId: string,
  pages: Page[],
): Promise<WrittenPage[] | null> {
  const db = authRequired()
  if (!db) return null
  if (pages.length === 0) return null

  const { data, error } = await db.rpc('import_pages', {
    p_document_id: documentId,
    // The pages are plain JSON already; the cast is only to satisfy the
    // generated client, which types every non-primitive RPC argument as `Json`.
    p_pages: pages as unknown as Record<string, unknown>,
  })

  if (error) {
    await handleWriteError(error, 'sync:importPages')
    return null
  }

  const created = (data ?? []) as Array<{ id: string; title: string }>
  return created.map((row, index) => ({
    id: row.id,
    title: row.title,
    ordinal: index,
    version: 0,
  }))
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

/**
 * `GET /document_invites` — the shares that have not landed yet.
 *
 * A pending invite is a share to an address with no account behind it. It is
 * rendered as a person who cannot be clicked, cannot have their role changed, and
 * has no avatar — because none of those are true of them yet. Listing them
 * separately is the whole point: folding them into the collaborator list would mean
 * inventing a user id for somebody who does not exist.
 */
export async function listPendingInvites(
  documentId: string,
): Promise<PendingInviteRow[]> {
  const db = authRequired()
  if (!db) return []
  const { data, error } = await db
    .from('document_invites')
    .select('email, role, created_at')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true })
  if (error) {
    await handleWriteError(error, 'sync:listPendingInvites')
    return []
  }
  return (data as PendingInviteRow[] | null) ?? []
}

/**
 * `POST /document_invites` — invite an address that has no account yet.
 *
 * The stored row is the share. Nothing else has to succeed for the person to end up
 * with access: `claim_pending_invites` runs on sign-up and turns the row into a
 * collaborator row, so the invitation survives the email never being delivered, and
 * the address being registered from a different browser, and the mail going to spam.
 *
 * The address is lower-cased here as well as by the column's CHECK. The check would
 * refuse a mixed-case insert rather than fix it, and "refused, try again" is a
 * worse answer than "we know what you meant" for a thing a person typed.
 */
export async function addPendingInvite(
  documentId: string,
  email: string,
  role: CollaboratorRow['role'],
): Promise<{ ok: boolean; error?: string }> {
  const db = authRequired()
  if (!db) return { ok: false, error: 'Supabase is not configured.' }
  const { error } = await db.from('document_invites').upsert(
    { document_id: documentId, email: email.trim().toLowerCase(), role },
    { onConflict: 'document_id,email' },
  )
  if (error) {
    await handleWriteError(error, 'sync:addPendingInvite')
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** `DELETE /document_invites` — take back an invitation nobody has accepted. */
export async function removePendingInvite(
  documentId: string,
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = authRequired()
  if (!db) return { ok: false, error: 'Supabase is not configured.' }
  const { error } = await db
    .from('document_invites')
    .delete()
    .eq('document_id', documentId)
    .eq('email', email.trim().toLowerCase())
  if (error) {
    await handleWriteError(error, 'sync:removePendingInvite')
    return { ok: false, error: error.message }
  }
  return { ok: true }
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
