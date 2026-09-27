import { useEffect } from 'react'

import { supabase } from '@/lib/supabase'
import { useCanvasStore } from '@/store/useCanvasStore'
import { savePageToSupabase } from '@/store/supabase-sync'

/**
 * Autosave: subscribes to store changes and persists pages to Supabase.
 * Debounced — one write per burst of edits, not per keystroke.
 */
export function useAutosave() {
  const doc = useCanvasStore((s) => s.doc)
  const activePageId = useCanvasStore((s) => s.activePageId)

  useEffect(() => {
    if (!supabase) return

    // Save the active page whenever it changes.
    const page = doc.pages.find((p) => p.id === activePageId)
    if (!page) return

    const timer = setTimeout(() => {
      void savePageToSupabase(page)
    }, 500)

    return () => clearTimeout(timer)
  }, [doc, activePageId])
}
