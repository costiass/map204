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
  IconMore,
  IconPlus,
  IconRedo,
  IconSave,
  IconSearch,
  IconShare,
  IconSidebar,
  IconSun,
  IconUndo,
  IconUpload,
  IconZoomIn,
  IconZoomOut,
} from '@/components/Icons'
import { flushPageNow } from '@/hooks/usePageSync'
import { firstNameOf, initialOf, usePresence } from '@/store/presence'
import { useCanvasStore } from '@/store/useCanvasStore'
import { useUserSettings } from '@/store/userSettings'
import { zoomAtPoint } from '@/utils/geometry'

const SHORTCUTS: Array<[string, string]> = [
  ['C', 'New card'],
  ['G', 'New group'],
  ['Double-click', 'New card at pointer'],
  ['Delete / Backspace', 'Delete selection'],
  ['Ctrl + Z', 'Undo'],
  ['Ctrl + Shift + Z', 'Redo'],
  ['Ctrl + S', 'Write the page now'],
  ['Ctrl + A', 'Select all cards'],
  ['Ctrl + D', 'Duplicate selection'],
  ['Space + drag', 'Pan canvas'],
  ['Alt + drag', 'Pan canvas'],
  ['Scroll', 'Pan · Ctrl + scroll to zoom'],
  ['Shift + click', 'Add to selection'],
  ['Escape', 'Cancel drag / close menus'],
  ['F', 'Fit all cards'],
]

interface ToolbarProps {
  user: SupabaseUser | null
  /** Non-null on the canvas route. The route decides the layout, not the store. */
  documentId: string | null
  onOpenSettings?: () => void
  onOpenWorkspace?: () => void
  onOpenShare?: () => void
  onUserChange: (user: SupabaseUser | null) => void
}

/**
 * The app chrome, in the two rows every editor uses: identity on top, tools
 * below.
 *
 *   row 1  [sidebar] [logo] [document name] ……… [people] [share] [theme] [⋯] [avatar]
 *   row 2  add · history · zoom · grid · search        (canvas route only)
 *
 * Row 1 is the same height and the same arrangement on every route, so nothing
 * shifts when you open a workspace. Row 2 appears only on the canvas, and
 * scrolls sideways rather than wrapping, so it can never change the height.
 */
export function Toolbar({
  user,
  documentId,
  onOpenSettings,
  onOpenWorkspace,
  onOpenShare,
  onUserChange,
}: ToolbarProps) {
  const isCanvas = Boolean(documentId)
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
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
  const documentTitle = useCanvasStore((s) => s.documentTitle)
  const setDocumentTitle = useCanvasStore((s) => s.setDocumentTitle)
  const [showAuth, setShowAuth] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)

  // The dark-mode button and the settings panel are the same preference: the
  // store writes the change to `user_settings`.
  const setTheme = useUserSettings((s) => s.setTheme)
  const presence = usePresence((s) => s.entries)
  const followingId = usePresence((s) => s.followingId)
  const setFollowing = usePresence((s) => s.setFollowing)

  const others = presence.filter((entry) => entry.userId !== user?.id)

  const toggleTheme = () => {
    setTheme(darkMode ? 'light' : 'dark')
  }

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        onUserChange({
          id: data.session.user.id,
          email: data.session.user.email ?? '',
          user_metadata: data.session.user.user_metadata,
        })
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        onUserChange({
          id: session.user.id,
          email: session.user.email ?? '',
          user_metadata: session.user.user_metadata,
        })
      } else {
        onUserChange(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [onUserChange])

  const handleSignOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    onUserChange(null)
    pushToast('Signed out.', 'info')
  }

  // Close the popovers on outside click.
  useEffect(() => {
    if (!showUserMenu && !showMore) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (showUserMenu && !userMenuRef.current?.contains(target)) setShowUserMenu(false)
      if (showMore && !moreRef.current?.contains(target)) setShowMore(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [showUserMenu, showMore])

  const zoomBy = (factor: number) => {
    if (!page) return
    const centre = { x: viewportSize.width / 2, y: viewportSize.height / 2 }
    setViewport(zoomAtPoint(page.viewport, centre, (page.viewport.zoom ?? 1) * factor))
  }

  const saveNow = () => {
    flushCommit()
    void flushPageNow().then(() => pushToast('Saved', 'success'))
  }

  return (
    <header className="cc-topbar z-30 flex-none border-b border-line bg-surface/90 backdrop-blur">
      {/* ---------------------------------------------------------------- */}
      {/* Row 1 — identity, present on every route                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex h-12 items-center gap-2 px-2 sm:px-3">
        {isCanvas ? (
          <button
            type="button"
            className="cc-icon"
            title={sidebarOpen ? 'Hide pages' : 'Show pages'}
            aria-label="Toggle page sidebar"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <IconSidebar size={16} />
          </button>
        ) : null}

        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-sunken"
          onClick={() => onOpenWorkspace?.()}
          title="All workspaces"
        >
          <img src="/favicon.svg" alt="" width="22" height="22" className="shrink-0" />
          <span className="hidden shrink-0 text-sm font-bold tracking-tight text-ink-strong text-ink-strong sm:inline">
            ClassCards
          </span>
        </button>

        <span className="h-5 w-px shrink-0 bg-line" />

        {isCanvas ? (
          <input
            key={documentId}
            defaultValue={documentTitle}
            aria-label="Workspace name"
            placeholder="Untitled workspace"
            className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-ink outline-none hover:border-line focus:border-brand focus:bg-surface text-ink"
            onChange={(event) => setDocumentTitle(event.target.value)}
            onBlur={(event) => {
              const clean = event.target.value.trim()
              if (clean) setDocumentTitle(clean)
              else setDocumentTitle('Untitled')
            }}
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate px-1.5 text-sm font-semibold text-ink">
            All workspaces
          </h1>
        )}

        {isCanvas ? (
          <button
            type="button"
            className="cc-btn shrink-0"
            data-variant="primary"
            onClick={() => onOpenShare?.()}
          >
            <IconShare size={14} />
            <span className="hidden sm:inline">Share</span>
          </button>
        ) : null}

        {/* Who else is here, stacked the way Google Docs stacks them.
            Clicking one follows that person's pointer around the canvas. */}
        {isCanvas && others.length > 0 ? (
          <div className="flex shrink-0 items-center pl-1">
            {others.slice(0, 4).map((entry) => {
              const on = followingId === entry.userId
              return (
                <button
                  key={entry.userId}
                  type="button"
                  className="-ml-1.5 flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 text-[11px] font-bold text-white transition first:ml-0 hover:z-10 hover:-translate-y-0.5"
                  style={{
                    background: entry.color,
                    borderColor: on ? entry.color : 'var(--cc-surface)',
                    boxShadow: on ? `0 0 0 2px ${entry.color}` : undefined,
                  }}
                  title={on ? `Stop following ${firstNameOf(entry.name)}` : `Follow ${entry.name}`}
                  aria-label={on ? `Stop following ${entry.name}` : `Follow ${entry.name}`}
                  aria-pressed={on}
                  onClick={() => {
                    setFollowing(on ? null : entry.userId)
                    pushToast(
                      on
                        ? `Stopped following ${firstNameOf(entry.name)}.`
                        : `Following ${firstNameOf(entry.name)}. Click again to stop.`,
                      'info',
                    )
                  }}
                >
                  {entry.avatarUrl ? (
                    <img src={entry.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initialOf(entry.name, user?.email)
                  )}
                </button>
              )
            })}
            {others.length > 4 ? (
              <span className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--cc-surface)] bg-[var(--cc-muted)] text-[11px] font-bold text-white">
                +{others.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className="cc-icon shrink-0"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
          onClick={toggleTheme}
        >
          {darkMode ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>

        <div ref={moreRef} className="relative shrink-0">
          <button
            type="button"
            className="cc-icon"
            title="More"
            aria-label="More actions"
            onClick={() => setShowMore((v) => !v)}
          >
            <IconMore size={16} />
          </button>
          {showMore ? (
            <div className="cc-menu absolute right-0 top-10 z-50 w-56">
              <button
                type="button"
                onClick={() => {
                  setShowMore(false)
                  setShowShortcuts((v) => !v)
                }}
              >
                <IconKeyboard size={15} /> Keyboard shortcuts
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMore(false)
                  setSearchOpen(true)
                }}
              >
                <IconSearch size={15} /> Search cards
                <span className="ml-auto text-[11px] text-muted">⌘K</span>
              </button>
              <hr />
              <button
                type="button"
                onClick={() => {
                  setShowMore(false)
                  setDialog('import')
                }}
              >
                <IconUpload size={15} /> Import JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMore(false)
                  setDialog('export')
                }}
              >
                <IconDownload size={15} /> Export JSON
              </button>
              {isCanvas ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowMore(false)
                    saveNow()
                  }}
                >
                  <IconSave size={15} /> Save now
                  <span className="ml-auto text-[11px] text-muted">⌘S</span>
                </button>
              ) : null}
              <hr />
              <button
                type="button"
                onClick={() => {
                  setShowMore(false)
                  onOpenSettings?.()
                }}
              >
                Settings
              </button>
            </div>
          ) : null}
        </div>

        {user ? (
          <div ref={userMenuRef} className="relative shrink-0">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-[var(--cc-on-brand)]"
              style={{ background: 'var(--color-brand)' }}
              title={user.email}
              onClick={() => setShowUserMenu((v) => !v)}
            >
              {user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
                <img
                  src={user.user_metadata.avatar_url ?? user.user_metadata.picture}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                initialOf(user.user_metadata?.name, user.email)
              )}
            </button>
            {showUserMenu ? (
              <div className="cc-menu absolute right-0 top-10 z-50 w-52">
                <div className="border-b border-line px-2 py-1.5">
                  <p className="truncate text-xs font-semibold text-ink">
                    {user.user_metadata?.name ?? user.email}
                  </p>
                  <p className="truncate text-[11px] text-muted">{user.email}</p>
                </div>
                <button
                  type="button"
                  className="mt-1"
                  onClick={() => {
                    setShowUserMenu(false)
                    onOpenSettings?.()
                  }}
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false)
                    onOpenWorkspace?.()
                  }}
                >
                  Workspaces
                </button>
                <hr />
                <button
                  type="button"
                  data-danger="true"
                  onClick={() => {
                    setShowUserMenu(false)
                    void handleSignOut()
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <button type="button" className="cc-btn shrink-0" onClick={() => setShowAuth(true)}>
            Sign in
          </button>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Row 2 — canvas tools                                             */}
      {/* ---------------------------------------------------------------- */}
      {isCanvas ? (
        <div className="cc-scroll flex h-10 items-center gap-1 overflow-x-auto border-t border-line px-2 sm:px-3">
          <button type="button" className="cc-btn shrink-0" data-variant="primary" onClick={() => addCard()}>
            <IconPlus size={14} />
            Card
            <span className="cc-kbd ml-0.5 hidden lg:inline">C</span>
          </button>
          <button type="button" className="cc-btn shrink-0" onClick={() => addGroup()}>
            <IconPlus size={14} />
            Group
            <span className="cc-kbd ml-0.5 hidden lg:inline">G</span>
          </button>

          <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />

          <button type="button" className="cc-icon shrink-0" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            <IconUndo size={16} />
          </button>
          <button type="button" className="cc-icon shrink-0" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
            <IconRedo size={16} />
          </button>

          <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />

          <button type="button" className="cc-icon shrink-0" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            <IconZoomOut size={16} />
          </button>
          <button
            type="button"
            className="cc-btn min-w-[3.4rem] shrink-0 tabular-nums"
            title="Reset zoom to 100%"
            onClick={() => {
              if (!page) return
              setViewport(
                zoomAtPoint(page.viewport, { x: viewportSize.width / 2, y: viewportSize.height / 2 }, 1),
              )
            }}
          >
            {page ? Math.round((page.viewport.zoom ?? 1) * 100) : 100}%
          </button>
          <button type="button" className="cc-icon shrink-0" title="Zoom in" onClick={() => zoomBy(1.2)}>
            <IconZoomIn size={16} />
          </button>
          <button
            type="button"
            className="cc-icon shrink-0"
            title="Fit all cards in view (F)"
            onClick={requestFitView}
          >
            <IconFit size={16} />
          </button>

          <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />

          <button
            type="button"
            className="cc-icon shrink-0"
            title="Snap to grid"
            data-active={snapToGrid}
            onClick={toggleSnapToGrid}
          >
            <IconMagnet size={16} />
          </button>
          <div className="cc-seg shrink-0">
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

          <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />

          <button
            type="button"
            className="cc-icon shrink-0"
            title="Search cards"
            data-active={searchOpen}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <IconSearch size={16} />
          </button>
          <button
            type="button"
            className="cc-icon shrink-0"
            title="Write the page now (Ctrl+S)"
            onClick={saveNow}
          >
            <IconSave size={16} />
          </button>
        </div>
      ) : null}

      {/* Shortcuts sheet, opened from the overflow menu. */}
      {showShortcuts ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-surface-sunken/40 p-4"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="cc-panel w-full max-w-md p-4"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label="Keyboard shortcuts"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink-strong">
                Keyboard shortcuts
              </h2>
              <button type="button" className="cc-btn px-1.5 py-1" onClick={() => setShowShortcuts(false)}>
                ✕
              </button>
            </div>
            <ul className="grid gap-1.5 text-xs">
              {SHORTCUTS.map(([keys, description]) => (
                <li key={keys} className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
                  <span className="cc-kbd">{keys}</span>
                  <span className="text-ink text-muted">{description}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {showAuth ? (
        <LoginPage
          onAuth={(u) => {
            onUserChange(u)
            pushToast(`Welcome, ${u.email}!`, 'success')
          }}
        />
      ) : null}
    </header>
  )
}
