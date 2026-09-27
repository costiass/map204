import { supabase } from '@/lib/supabase'
import type { CanvasDoc, Page, Card, Group, Connection, Viewport } from '@/types'

/**
 * Supabase sync layer — replaces IndexedDB entirely.
 * All data is stored in PostgreSQL. Realtime subscriptions
 * broadcast changes to all connected clients.
 *
 * Conflict resolution:
 * - Each page has a `version` integer that increments on every save
 * - Remote changes are only applied if their version is newer than local
 * - This is "last-write-wins" with version ordering
 */

// ---------------------------------------------------------------------------
// Types matching the database schema
// ---------------------------------------------------------------------------

interface DocumentRow {
  id: string
  owner_id: string
  title: string
  created_at: string
  updated_at: string
}

interface PageRow {
  id: string
  document_id: string
  title: string
  position: number
  viewport: Viewport
  cards: Card[]
  groups: Group[]
  connections: Connection[]
  version: number
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadDocumentFromSupabase(userId: string): Promise<CanvasDoc | null> {
  if (!supabase) return null

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('owner_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (docError || !doc) return null

  const { data: pages, error: pagesError } = await supabase
    .from('pages')
    .select('*')
    .eq('document_id', doc.id)
    .order('position', { ascending: true })

  if (pagesError) return null

  return {
    version: 1,
    pages: (pages as PageRow[]).map((p) => ({
      id: p.id,
      title: p.title,
      viewport: p.viewport,
      cards: p.cards,
      groups: p.groups,
      connections: p.connections,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
    settings: {
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
        lineStyle: 'solid',
        routing: 'curved',
        arrowStart: 'none',
        arrowEnd: 'arrow',
        animated: false,
      },
      defaultRelationshipType: 'related to',
    },
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createDocumentInSupabase(userId: string, title = 'Untitled'): Promise<string | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('documents')
    .insert({ owner_id: userId, title })
    .select('id')
    .single()

  if (error || !data) return null
  return (data as DocumentRow).id
}

export async function createPageInSupabase(documentId: string, title = 'Page 1'): Promise<string | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('pages')
    .insert({
      document_id: documentId,
      title,
      position: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
      cards: [],
      groups: [],
      connections: [],
      version: 0,
    })
    .select('id')
    .single()

  if (error || !data) return null
  return (data as PageRow).id
}

// ---------------------------------------------------------------------------
// Save (upsert page data with version tracking)
// ---------------------------------------------------------------------------

export async function savePageToSupabase(page: Page, currentVersion: number): Promise<boolean> {
  if (!supabase) return false

  const { error } = await supabase
    .from('pages')
    .update({
      title: page.title,
      viewport: page.viewport,
      cards: page.cards,
      groups: page.groups,
      connections: page.connections,
      version: currentVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', page.id)

  return !error
}

export async function saveDocumentTitleInSupabase(docId: string, title: string): Promise<boolean> {
  if (!supabase) return false

  const { error } = await supabase
    .from('documents')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', docId)

  return !error
}

// ---------------------------------------------------------------------------
// Realtime subscription
// ---------------------------------------------------------------------------

export function subscribeToPage(
  pageId: string,
  onUpdate: (cards: Card[], groups: Group[], connections: Connection[], viewport: Viewport, version: number) => void,
): (() => void) | null {
  if (!supabase) return null

  const channel = supabase
    .channel(`page:${pageId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'pages',
        filter: `id=eq.${pageId}`,
      },
      (payload) => {
        const row = payload.new as PageRow
        onUpdate(row.cards, row.groups, row.connections, row.viewport, row.version)
      },
    )
    .subscribe()

  return () => {
    supabase?.removeChannel(channel)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getDocumentIdForPage(pageId: string): string | null {
  return documentPageMap.get(pageId) ?? null
}

// Module-level map: pageId -> documentId
const documentPageMap = new Map<string, string>()

export function registerPageDocument(pageId: string, documentId: string): void {
  documentPageMap.set(pageId, documentId)
}

export function unregisterPageDocument(pageId: string): void {
  documentPageMap.delete(pageId)
}
