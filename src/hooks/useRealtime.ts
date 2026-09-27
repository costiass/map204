import { useEffect } from 'react'

import { supabase } from '@/lib/supabase'
import { useCanvasStore } from '@/store/useCanvasStore'
import type { Card, Connection, Group, Viewport } from '@/types'

/**
 * Subscribe to realtime updates for the active page.
 * When another user changes cards/groups/connections, merge into local state.
 */
export function useRealtime() {
  const activePageId = useCanvasStore((s) => s.activePageId)
  const documentId = useCanvasStore((s) => s.documentId)

  useEffect(() => {
    if (!supabase || !activePageId || !documentId) return

    const channel = supabase
      .channel(`page:${activePageId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pages',
          filter: `id=eq.${activePageId}`,
        },
        (payload) => {
          const row = payload.new as {
            cards: Card[]
            groups: Group[]
            connections: Connection[]
            viewport: Viewport
          }
          const store = useCanvasStore.getState()
          // Merge remote changes into local state.
          store.mergeDoc({
            version: 1,
            pages: store.doc.pages.map((p) =>
              p.id === activePageId
                ? { ...p, cards: row.cards, groups: row.groups, connections: row.connections, viewport: row.viewport }
                : p,
            ),
            settings: store.doc.settings,
          })
        },
      )
      .subscribe()

    return () => {
      supabase?.removeChannel(channel)
    }
  }, [activePageId, documentId])
}
