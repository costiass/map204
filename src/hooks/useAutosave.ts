import { useEffect, useRef } from 'react'

import { supabase } from '@/lib/supabase'
import { useCanvasStore } from '@/store/useCanvasStore'
import type { Page } from '@/types'

/**
 * Autosave: subscribes to store changes and persists pages to Supabase.
 * Debounced — one write per burst of edits, not per keystroke.
 *
 * Conflict resolution:
 * - Each page has a version number that increments on every save
 * - The realtime hook only accepts remote changes with a higher version
 * - This prevents an older write from overwriting a newer one
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
