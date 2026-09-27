import { useEffect, useRef } from 'react'

import { supabase } from '@/lib/supabase'
import { useCanvasStore } from '@/store/useCanvasStore'
import type { Page } from '@/types'

/**
 * Autosave with WebSocket sync:
 * 1. Local changes → Zustand store
 * 2. Debounced → broadcast via Supabase Realtime (WebSocket)
 * 3. Other clients receive via WebSocket → update their store
 * 4. Periodic persistence to Postgres via REST (backup)
 */
export function useAutosave() {
  const doc = useCanvasStore((s) => s.doc)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const documentId = useCanvasStore((s) => s.documentId)
  const versions = useRef<Record<string, number>>({})

  // Initialize Realtime channel for this page
  useEffect(() => {
    if (!supabase || !activePageId) return

    const channel = supabase!.channel(`page:${activePageId}`, {
      config: { broadcast: { ack: true } }
    })

    channel.subscribe()

    return () => {
      supabase!.removeChannel(channel)
    }
  }, [activePageId])

  // Autosave with WebSocket broadcast
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

    // 1. Broadcast via WebSocket (instant for other clients)
    const channel = supabase!.channel(`page:${page.id}`)
    await channel.send({
      type: 'broadcast',
      event: 'page-update',
      payload: {
        cards: page.cards,
        groups: page.groups,
        connections: page.connections,
        viewport: page.viewport,
        version: currentVersion,
        timestamp: Date.now(),
      }
    })

    // 2. Persist to Postgres (async, non-blocking)
    const { error } = await supabase!
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

export const versions = { current: {} as Record<string, number> }