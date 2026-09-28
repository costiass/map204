import { useEffect, useRef, useState } from 'react'

import { useCanvasStore } from '@/store/useCanvasStore'
import { usePresence } from '@/store/presence'
import { screenToWorld, worldToScreen } from '@/utils/geometry'
import type { Point } from '@/types'

/**
 * !!!! TEMPORARY DEBUG OVERLAY — DELETE THIS FILE AND ITS THREE USES WHEN DONE.
 *
 * It exists to answer one question at a glance: *where is everybody, and what
 * does the server think about me?* Both the cursor work and the unresolved
 * `42501` needed that, and neither could be settled by reading code.
 *
 * Toggle with Ctrl+Shift+D.
 *
 * It is deliberately one file with no imports from the rest of the app beyond
 * reading state, so removing it is: delete the file, delete the import, delete
 * the `<DevOverlay />` line in App.tsx.
 */

interface Sample {
  screen: Point
  world: Point
  at: number
}

export function DevOverlay() {
  const [open, setOpen] = useState(false)
  const [mine, setMine] = useState<Sample | null>(null)
  const frame = useRef(0)

  // Live, re-reading the store on every frame rather than subscribing: the
  // numbers are for watching, and a 60fps poll of a handful of objects costs
  // nothing compared to reasoning about a value that was sampled 200ms ago.
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    // The panel reads the stores through `getState`, which does not re-render.
    // Bumping a counter on every frame is the cheapest way to keep the numbers
    // on screen honest: a handful of objects at 60fps is nothing, and a value
    // sampled 200ms ago is not what "live" means when you are watching a cursor
    // move.
    const loop = () => {
      setTick((value) => (value + 1) % 1000000)
      frame.current = requestAnimationFrame(loop)
    }
    frame.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame.current)
  }, [open])

  // The local pointer, tracked separately because nothing else records it: the
  // app only broadcasts other people's cursors, never your own.
  useEffect(() => {
    if (!open) return
    const onMove = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      const surface = target?.closest?.('.cc-canvas')
      if (!surface) {
        setMine(null)
        return
      }
      const rect = surface.getBoundingClientRect()
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const page = useCanvasStore.getState().activePage()
      if (!page) return
      setMine({ screen, world: screenToWorld(screen, page.viewport), at: performance.now() })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [open])

  if (!open) return null

  const store = useCanvasStore.getState()
  const entries = usePresence.getState().entries
  const viewport = store.activePage()?.viewport ?? { x: 0, y: 0, zoom: 1 }
  const page = store.activePage()
  const pageTitle = page?.title ?? '—'
  void tick // the rAF loop is what makes this live

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-[99] max-w-[23rem]">
      <div className="pointer-events-auto rounded-lg border border-white/20 bg-black/85 font-mono text-[10.5px] leading-relaxed text-emerald-300 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-white/15 px-2.5 py-1">
          <span className="font-bold text-white">DEV · Ctrl+Shift+D</span>
          <span className="text-white/50">{new Date().toLocaleTimeString()}</span>
        </div>

        <div className="space-y-1 px-2.5 py-1.5">
          <Row k="document" v={store.documentId ?? '(none)'} />
          <Row k="my role" v={store.documentRole ?? 'unknown'} />
          <Row k="page" v={`${pageTitle} (${store.activePageId || '—'})`} />
          <Row
            k="viewport"
            v={`x ${viewport.x.toFixed(1)}  y ${viewport.y.toFixed(1)}  zoom ${viewport.zoom.toFixed(3)}`}
          />
          <Row k="pages" v={String(store.doc.pages.length)} />
          <Row k="store pages" v={String(store.doc.pages.length)} />
        </div>

        <div className="border-t border-white/15 px-2.5 py-1 text-white/60">
          my pointer
        </div>
        <div className="space-y-1 px-2.5 pb-1.5">
          {mine ? (
            <>
              <Row k="screen" v={`${mine.screen.x.toFixed(1)}, ${mine.screen.y.toFixed(1)}`} />
              <Row k="world" v={`${mine.world.x.toFixed(1)}, ${mine.world.y.toFixed(1)}`} />
            </>
          ) : (
            <div className="text-white/35">— not over the canvas —</div>
          )}
        </div>

        <div className="border-t border-white/15 px-2.5 py-1 text-white/60">
          other pointers ({entries.length})
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto px-2.5 pb-1.5">
          {entries.length === 0 ? (
            <div className="text-white/35">— nobody else connected —</div>
          ) : null}
          {entries.map((entry) => {
            const onThisPage = entry.pageId === store.activePageId
            const screen = entry.cursor ? worldToScreen(entry.cursor, viewport) : null
            return (
              <div
                key={entry.userId}
                className="rounded border border-white/10 px-1.5 py-1"
                style={{ borderLeftColor: entry.color, borderLeftWidth: 3 }}
              >
                <div className="font-bold text-white">
                  {entry.name} <span className="text-white/40">{entry.userId.slice(0, 8)}</span>
                </div>
                <Row k="page" v={onThisPage ? 'this page' : (entry.pageId ?? 'unknown')} />
                {entry.cursor ? (
                  <>
                    <Row
                      k="world"
                      v={`${entry.cursor.x.toFixed(1)}, ${entry.cursor.y.toFixed(1)}`}
                    />
                    <Row
                      k="screen"
                      v={screen ? `${screen.x.toFixed(1)}, ${screen.y.toFixed(1)}` : '—'}
                    />
                  </>
                ) : (
                  <div className="text-white/35">— no pointer sent yet —</div>
                )}
                <Row k="avatar" v={entry.avatarUrl ? 'yes' : 'MISSING'} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="w-14 shrink-0 text-white/45">{k}</span>
      <span className="truncate text-emerald-300">{v}</span>
    </div>
  )
}
