import { useEffect } from 'react'

import { saveDocument } from '@/store/database'
import { useCanvasStore } from '@/store/useCanvasStore'

/**
 * Debounced write-through of the central document to IndexedDB.
 *
 * Any document change (cards, connections, page viewport) schedules a save, and
 * the save only rewrites the records that actually changed — see
 * `store/database.ts`. `maxWait` bounds how long a continuous stream of edits
 * (typing in a card, dragging a slider) can postpone a write. Writes never
 * overlap: an edit that lands mid-write is picked up by a follow-up pass, so
 * the newest state is always the last thing written.
 */
export function useAutosave(delay = 500, maxWait = 2500) {
  useEffect(() => {
    let timer: number | null = null
    let firstDueAt = 0
    let writing = false
    let queued = false

    const write = () => {
      timer = null
      writing = true
      void saveDocument(useCanvasStore.getState().doc).then((result) => {
        writing = false
        if (result.ok) {
          if (queued) {
            queued = false
            write()
          }
          return
        }
        useCanvasStore.getState().pushToast(result.error ?? 'Autosave failed', 'error')
      })
    }

    const schedule = () => {
      if (writing) {
        queued = true
        return
      }
      const now = Date.now()
      if (timer === null) firstDueAt = now
      if (timer !== null) window.clearTimeout(timer)
      // Long bursts keep their own schedule but never wait out the whole window.
      const wait = Math.max(0, Math.min(delay, firstDueAt + maxWait - now))
      timer = window.setTimeout(write, wait)
    }

    const unsubscribe = useCanvasStore.subscribe((state, previous) => {
      if (state.doc === previous.doc) return
      schedule()
    })

    // Also save when the tab goes away so nothing is lost on a hard close.
    const onHide = () => {
      if (timer !== null) window.clearTimeout(timer)
      if (writing) queued = true
      else write()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)

    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [delay, maxWait])
}
