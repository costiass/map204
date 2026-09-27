import { useEffect, useRef } from 'react'

import { supabase } from '@/lib/supabase'
import { useCanvasStore } from '@/store/useCanvasStore'
import type { Card, Connection, Group, Viewport } from '@/types'

/**
 * Subscribe to realtime broadcasts for the active page.
 * Listens for broadcast events (WebSocket) from other clients.
 *
 * Conflict resolution:
 * - Each save increments a version number
 * - Remote changes are only applied if their version is newer than local
 * - This prevents an older write from overwriting a newer one
 */
export function useRealtime() {
  const activePageId = useCanvasStore((s) => s.activePageId)
  const documentId = useCanvasStore((s) => s.documentId)
  const doc = useCanvasStore((s) => s.doc)
  const localVersion = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!supabase || !activePageId || !documentId) return

    const channel = supabase!
      .channel(`page:${activePageId}`, {
        config: { broadcast: { ack: true } }
      })
      .on('broadcast', { event: 'page-update' }, (payload) => {
        const data = payload.payload as {
          cards: Card[]
          groups: Group[]
          connections: Connection[]
          viewport: Viewport
          version: number
        }

        const currentVersion = localVersion.current[activePageId] ?? 0
        if (data.version <= currentVersion) return
        localVersion.current[activePageId] = data.version

        const store = useCanvasStore.getState()
        store.mergeDoc({
          version: 1,
          pages: store.doc.pages.map((p) =>
            p.id === activePageId
              ? {
                  ...p,
                  cards: data.cards,
                  groups: data.groups,
                  connections: data.connections,
                  viewport: data.viewport,
                  updatedAt: new Date().toISOString(),
                }
              : p,
          ),
          settings: store.doc.settings,
        })
      })
      .subscribe()

    return () => {
      supabase!.removeChannel(channel)
    }
  }, [activePageId, documentId, doc])
}