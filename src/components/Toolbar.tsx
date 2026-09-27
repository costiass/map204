import { useEffect, useRef, useState } from 'react'

import { LoginPage } from '@/components/LoginPage'
import { supabase } from '@/lib/supabase'
import type { SupabaseUser } from '@/lib/supabase'
import {
  IconDownload,
  IconFit,
  IconKeyboard,
  IconMagnet,
  IconMoon,
  IconPlus,
  IconRedo,
  IconSave,
  IconSearch,
  IconSidebar,
  IconSun,
  IconUndo,
  IconUpload,
  IconZoomIn,
  IconZoomOut,
} from '@/components/Icons'
import { saveDocumentNow } from '@/store/database'
import { useCanvasStore } from '@/store/useCanvasStore'
import { formatBytes } from '@/utils/image'
import { zoomAtPoint } from '@/utils/geometry'

const SHORTCUTS: Array<[string, string]> = [
  ['C', 'New card'],
  ['G', 'New group'],
  ['Double-click', 'New card at pointer'],
  ['Delete / Backspace', 'Delete selection'],
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Shift + Z', 'Redo'],
  ['Ctrl + S', 'Save to the database now'],
  ['Ctrl + A', 'Select all cards'],
  ['Ctrl + D', 'Duplicate selection'],
  ['Space + drag', 'Pan canvas'],
  ['Alt + drag', 'Pan canvas'],
  ['Scroll', 'Pan · Ctrl + scroll to zoom'],
  ['Shift + click', 'Add to selection'],
  ['Escape', 'Cancel drag / close menus'],
  ['F', 'Fit all cards'],
]

export function Toolbar() {
  const activePageId = useCanvasStore((s) => s.activePageId)
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const renamePage = useCanvasStore((s) => s.renamePage)
  const addCard = useCanvasStore((s) => s.addCard)
  const addGroup = useCanvasStore((s) => s.addGroup)
  const undo = useCanvasStore((s) => s.undo)
  const redo = useCanvasStore((s) => s.redo)
  const canUndo = useCanvasStore((s) => s.past.length > 0 || s.pendingSnapshot !== null)
  const canRedo = useCanvasStore((s) => s.future.length > 0)
  const snapToGrid = useCanvasStore((s) => s.snapToGrid)
  const toggleSnapToGrid = useCanvasStore((s) => s.toggleSnapToGrid)
  const gridPattern = useCanvasStore((s) => s.gridPattern)
  const setGridPattern = useCanvasStore((s) => s.setGridPattern)
  const searchOpen = useCanvasStore((s) => s.searchOpen)
  const setSearchOpen = useCanvasStore((s) => s.setSearchOpen)
  const setDialog = useCanvasStore((s) => s.setDialog)
  const sidebarOpen = useCanvasStore((s) => s.sidebarOpen)
  const setSidebarOpen = useCanvasStore((s) => s.setSidebarOpen)
  const viewportSize = useCanvasStore((s) => s.viewportSize)
  const pushToast = useCanvasStore((s) => s.pushToast)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const flushCommit = useCanvasStore((s) => s.flushCommit)
  const requestFitView = useCanvasStore((s) => s.requestFitView)
  const darkMode = useCanvasStore((s) => s.darkMode)
  const toggleDarkMode = useCanvasStore((s) => s.toggleDarkMode)
  const [showAuth, setShowAuth] = useState(false)
  const [user, setUser] = useState<SupabaseUser | null>(null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setUser({
          id: data.session.user.id,
          email: data.session.user.email ?? '',
          user_metadata: data.session.user.user_metadata,
        })
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email ?? '',
          user_metadata: session.user.user_metadata,
        })
      } else {
        setUser(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setUser(null)
    pushToast('Signed out.', 'info')
  }

  const [showShortcuts, setShowShortcuts] = useState(false)
  const shortcutsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showShortcuts) return
    const onPointerDown = (event: PointerEvent) => {
      if (!shortcutsRef.current?.contains(event.target as Node)) setShowShortcuts(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [showShortcuts])

  if (!page) return null

  const zoom = page.viewport.zoom
  const setZoom = (next: number) => {
    setViewport(
      zoomAtPoint(page.viewport, { x: viewportSize.width / 2, y: viewportSize.height / 2 }, next),
    )
  }

  const handleSave = () => {
    flushCommit()
    const doc = useCanvasStore.getState().doc
    void saveDocumentNow(doc).then((result) => {
      if (result.ok) {
        pushToast(
          `Saved to ${result.storage === 'database' ? 'this browser’s database' : 'local storage'}${
            result.bytes ? ` · ${formatBytes(result.bytes)}` : ''
          }`,
          'success',
        )
      } else {
        pushToast(result.error ?? 'Could not save', 'error')
      }
    })
  }

  return (
    <header className="z-30 flex flex-wrap items-center gap-2 border-b border-line bg-white/85 px-3 py-2 backdrop-blur">
      <button
        type="button"
        className="cc-btn px-2"
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <IconSidebar size={15} />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <img src="/favicon.svg" alt="Logo" width="22" height="22" className="shrink-0" />
        <span className="hidden text-sm font-bold tracking-tight text-slate-800 sm:inline">CardCanvas</span>
        <input
          key={activePageId}
          defaultValue={page.title}
          aria-label="Page title"
          className="cc-input max-w-[10rem] font-semibold sm:max-w-[16rem]"
          onChange={(event) => renamePage(activePageId, event.target.value)}
        />
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <button type="button" className="cc-btn" data-variant="primary" onClick={() => addCard()}>
          <IconPlus size={14} />
          <span className="hidden sm:inline">Card</span>
          <span className="cc-kbd ml-1 hidden lg:inline">C</span>
        </button>
        <button type="button" className="cc-btn" onClick={() => addGroup()}>
          <IconPlus size={14} />
          <span className="hidden sm:inline">Group</span>
          <span className="cc-kbd ml-1 hidden lg:inline">G</span>
        </button>

        <span className="mx-1 h-6 w-px bg-line" />

        <button type="button" className="cc-btn px-2" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <IconUndo size={15} />
        </button>
        <button type="button" className="cc-btn px-2" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <IconRedo size={15} />
        </button>

        <span className="mx-1 h-6 w-px bg-line" />

        <button type="button" className="cc-btn px-2" title="Zoom out" onClick={() => setZoom(zoom / 1.2)}>
          <IconZoomOut size={15} />
        </button>
        <button
          type="button"
          className="cc-btn min-w-[3.1rem] tabular-nums"
          title="Reset zoom to 100%"
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="cc-btn px-2" title="Zoom in" onClick={() => setZoom(zoom * 1.2)}>
          <IconZoomIn size={15} />
        </button>
        <button
          type="button"
          className="cc-btn px-2"
          title="Fit all cards in view (F)"
          onClick={requestFitView}
        >
          <IconFit size={15} />
        </button>

        <span className="mx-1 h-6 w-px bg-line" />

        <button
          type="button"
          className="cc-btn px-2"
          title="Snap to grid"
          data-active={snapToGrid}
          onClick={toggleSnapToGrid}
        >
          <IconMagnet size={15} />
        </button>
        <div className="cc-seg">
          <button type="button" data-active={gridPattern === 'none'} onClick={() => setGridPattern('none')}>
            Off
          </button>
          <button type="button" data-active={gridPattern === 'dots'} onClick={() => setGridPattern('dots')}>
            Dots
          </button>
          <button type="button" data-active={gridPattern === 'lines'} onClick={() => setGridPattern('lines')}>
            Lines
          </button>
        </div>

        <span className="mx-1 h-6 w-px bg-line" />

        <button
          type="button"
          className="cc-btn px-2"
          title="Search cards"
          data-active={searchOpen}
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <IconSearch size={15} />
        </button>
        <button type="button" className="cc-btn px-2" title="Import JSON" onClick={() => setDialog('import')}>
          <IconUpload size={15} />
        </button>
        <button type="button" className="cc-btn px-2" title="Export JSON" onClick={() => setDialog('export')}>
          <IconDownload size={15} />
        </button>
        <button type="button" className="cc-btn px-2" title="Save now (Ctrl+S)" onClick={handleSave}>
          <IconSave size={15} />
        </button>

        <button
          type="button"
          className="cc-btn px-2"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleDarkMode}
        >
          {darkMode ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>

        {user ? (
          <div className="relative">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ background: 'var(--color-brand)' }}
              title={user.email}
              onClick={() => {
                if (confirm('Sign out?')) handleSignOut()
              }}
            >
              {user.email.charAt(0).toUpperCase()}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="cc-btn px-2"
            title="Sign in"
            onClick={() => setShowAuth(true)}
          >
            Sign in
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            className="cc-btn px-2"
            title="Keyboard shortcuts"
            data-active={showShortcuts}
            onClick={() => setShowShortcuts((v) => !v)}
          >
            <IconKeyboard size={15} />
          </button>
          {showShortcuts ? (
            <div ref={shortcutsRef} className="cc-panel absolute right-0 top-[2.4rem] z-50 w-[19rem] p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Shortcuts</h3>
              <ul className="grid gap-1.5 text-xs">
                {SHORTCUTS.map(([keys, description]) => (
                  <li key={keys} className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
                    <span className="cc-kbd">{keys}</span>
                    <span className="text-slate-600">{description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {showAuth ? <LoginPage onAuth={(u) => { setUser(u); pushToast(`Welcome, ${u.email}!`, 'success') }} /> : null}
    </header>
  )
}
