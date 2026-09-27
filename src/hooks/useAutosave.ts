import { useEffect, useRef } from 'react'

import { supabase } from '@/lib/supabase'
import { useCanvasStore } from '@/store/useCanvasStore'
import type { Page } from '@/types'

/**
 * Autosave: subscribes to store changes and persists pages to Supabase.
 * Uses WebSocket (Realtime) for sync instead of HTTP PATCH.
 *
 * Flow:
 * 1. Local change → Zustand store updates
 * 2. Debounced 500ms → broadcast via WebSocket channel
 * 3. Other clients receive via WebSocket → update their store
 * 4. The client that made the change also writes to Postgres (persistent backup)
 */
export function useAutosave() {
  const doc = useCanvasStore((s) => s.doc)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const documentId = useCanvasStore((s) => s.documentId)
  const versions = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!supabase || !documentId) return

    const page = doc.pages.find((p) => p.id === activePageId)
    if (!page) return

    const timer = setTimeout(() => {
      void savePage(page)
    }, 500)

    return () => clearTimeout(timer)
  }, [doc, activePageId, documentId])

  const savePage = async (page: Page) => {
    if (!supabase || !documentId) return

    const currentVersion = (versions.current[page.id] ?? 0) + 1
    versions.current[page.id] = currentVersion

    // Broadcast via WebSocket (Realtime) — instant for other clients
    const channel = supabase.channel(`page:${page.id}`)
    channel.send({
      type: 'broadcast',
      event: 'page-update',
      payload: {
        cards: page.cards,
        groups: page.groups,
        connections: page.connections,
        viewport: page.viewport,
        version: currentVersion,
      },
    })

    // Also write to Postgres for persistence (debounced, less frequent)
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

    if (error) {
      console.error('Autosave failed:', error.message)
    }
  }
}
