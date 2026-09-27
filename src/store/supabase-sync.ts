import { supabase } from '@/lib/supabase'
import type { Card, Group, Connection, Viewport, LineStyle, Routing, ArrowStyle, Position } from '@/types'

/**
 * Supabase sync layer — all data operations via REST API (PostgREST).
 * Realtime subscriptions handled by useRealtime hook.
 */

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
  position: Position
  viewport: Viewport
  cards: Card[]
  groups: Group[]
  connections: Connection[]
  version: number
  created_at: string
  updated_at: string
}

export async function loadDocumentFromSupabase(userId: string) {
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
      position: p.position,
      viewport: p.viewport,
      cards: p.cards ?? [],
      groups: p.groups ?? [],
      connections: p.connections ?? [],
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
        lineStyle: 'solid' as LineStyle,
        routing: 'curved' as Routing,
        arrowStart: 'none' as ArrowStyle,
        arrowEnd: 'arrow' as ArrowStyle,
        animated: false,
      },
      defaultRelationshipType: 'related to',
    },
  }
}

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

export async function savePageToSupabase(page: { id: string; title: string; viewport: Viewport; cards: Card[]; groups: Group[]; connections: Connection[]; version: number }): Promise<boolean> {
  if (!supabase) return false

  const { error } = await supabase
    .from('pages')
    .update({
      title: page.title,
      viewport: page.viewport,
      cards: page.cards,
      groups: page.groups,
      connections: page.connections,
      version: page.version,
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

const documentPageMap = new Map<string, string>()

export function getDocumentIdForPage(pageId: string): string | null {
  return documentPageMap.get(pageId) ?? null
}

export function registerPageDocument(pageId: string, documentId: string): void {
  documentPageMap.set(pageId, documentId)
}

export function unregisterPageDocument(pageId: string): void {
  documentPageMap.delete(pageId)
}