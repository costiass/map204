import { useCallback, useEffect, useState } from 'react'

import { AuthGuard } from '@/components/AuthGuard'
import { Canvas } from '@/components/Canvas'
import { ConnectionTree } from '@/components/ConnectionTree'
import { ContextMenu } from '@/components/ContextMenu'
import { DevOverlay } from '@/components/DevOverlay'
import { ImportExportDialog } from '@/components/ImportExportDialog'
import { Inspector } from '@/components/Inspector'
import { NotFound } from '@/components/NotFound'
import { PageSidebar } from '@/components/PageSidebar'
import { SearchPanel } from '@/components/SearchPanel'
import { ShareDialog } from '@/components/ShareDialog'
import { StatusBar } from '@/components/StatusBar'
import { Toasts } from '@/components/Toasts'
import { Toolbar } from '@/components/Toolbar'
import { UserSettingsPage } from '@/components/UserSettingsPage'
import { WorkspacePage } from '@/components/WorkspacePage'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { primePageSync, resetPageSync, usePageSync } from '@/hooks/usePageSync'
import { navigate, migrateLegacyHash, useRoute } from '@/router'
import { loadDocument, fetchMyRole } from '@/store/supabase-sync'
import type { DocumentRow } from '@/store/supabase-sync'
import { useCanvasStore } from '@/store/useCanvasStore'
import { useUserSettings } from '@/store/userSettings'
import type { SupabaseUser } from '@/lib/supabase'
import { DEFAULT_WORKSPACE_ACCENT, DEFAULT_WORKSPACE_ICON } from '@/theme'

export default function App() {
  useKeyboardShortcuts()
  usePageSync()

  const sidebarOpen = useCanvasStore((s) => s.sidebarOpen)
  const setSidebarOpen = useCanvasStore((s) => s.setSidebarOpen)

  // Real paths: `/`, `/w/<docId>`, `/settings`. Anything else is a 404.
  // Runs once, before the first route is read, so a saved `#workspace/…` link
  // lands on its real address instead of the home page.
  useEffect(() => {
    migrateLegacyHash()
  }, [])
  const route = useRoute()
  const currentDocId = route.name === 'workspace' ? route.docId : null

  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [document_, setDocument] = useState<DocumentRow | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const settings = useUserSettings((s) => s.settings)
  const loadSettings = useUserSettings((s) => s.loadSettings)

  // User preferences: `GET /user_settings` once per user (the row is created by
  // the signup trigger, and by the store itself if it is somehow missing).
  useEffect(() => {
    if (!user) return
    void loadSettings(user)
  }, [user, loadSettings])

  // Signing out drops the cached preferences so the next user does not inherit them.
  useEffect(() => {
    if (user) return
    resetPageSync()
    useUserSettings.setState({ userId: null, loaded: false })
  }, [user])

  // The theme owns the document root (variables, `.dark`, colour-scheme), so
  // this only forwards the canvas-level preferences.
  useEffect(() => {
    const store = useCanvasStore.getState()
    store.setSnapToGrid(settings.defaultSnapToGrid)
    store.setGridPattern(settings.defaultGridPattern)
    store.setGridSize(settings.defaultGridSize)
    store.setDarkMode(settings.theme === 'dark')
  }, [settings])

  // `GET /documents` + `GET /pages` for the workspace in the URL.
  useEffect(() => {
    const store = useCanvasStore.getState()
    store.setDocumentId(currentDocId)

    if (!currentDocId || !user) {
      setDocument(null)
      return
    }

    let cancelled = false
    setLoadingDoc(true)
    // Arm the page-list diff only once the real page list is known, so the
    // canvas still showing the previous document is never read as deletions.
    resetPageSync()

    const open = async () => {
      try {
        const loaded = await loadDocument(currentDocId)
        if (cancelled) return
        setLoadingDoc(false)

        if (!loaded) {
          store.pushToast('That workspace could not be opened.', 'error')
          // Replace, so Back does not walk straight into the dead address.
          navigate.replace('/')
          return
        }

        setDocument(loaded.document)
        store.setDocumentTitle(loaded.document.title)
        store.setDocumentLookState({
          accent: loaded.document.accent ?? DEFAULT_WORKSPACE_ACCENT,
          icon: loaded.document.icon ?? DEFAULT_WORKSPACE_ICON,
        })

        // Read the role rather than inferring it from a refused write later. The
        // two requests are independent, so this does not delay the canvas.
        void fetchMyRole(currentDocId, user.id).then((role) => {
          if (!cancelled) store.setDocumentRole(role)
        })

        primePageSync(currentDocId, loaded)

        store.hydrateDocument({
          version: 1,
          pages: loaded.pages,
          settings: loaded.settings,
        })
      } catch (error) {
        if (cancelled) return
        setLoadingDoc(false)
        store.pushToast(
          error instanceof Error
            ? `Could not open that workspace: ${error.message}`
            : 'Could not open that workspace.',
          'error',
        )
      }
    }

    void open()

    return () => {
      cancelled = true
    }
  }, [currentDocId, user])

  // A saved /settings link opens the overlay and cleans the address bar, since
  // settings is no longer a page of its own.
  useEffect(() => {
    if (route.name !== 'settings') return
    setShowSettings(true)
    navigate.replace('/')
  }, [route])

  const openDocument = useCallback((docId: string) => {
    navigate.workspace(docId)
  }, [])

  const openWorkspace = useCallback(() => {
    navigate.home()
  }, [])

  const openSettings = useCallback(() => {
    setShowSettings(true)
  }, [])

  const shell = (children: React.ReactNode) => (
    <AuthGuard onUserChange={setUser}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
        {/* The route — not the store — decides what the chrome shows. */}
        <Toolbar
          user={user}
          documentId={currentDocId}
          onOpenSettings={openSettings}
          onOpenWorkspace={openWorkspace}
          onOpenShare={() => setShowShare(true)}
          onUserChange={setUser}
        />
        {children}

        {/* Both panels are overlays, so they work the same on every screen. */}
        {showShare && user && document_ ? (
          <ShareDialog
            document={document_}
            currentUserId={user.id}
            onClose={() => setShowShare(false)}
          />
        ) : null}
        {showSettings && user ? (
          <UserSettingsPage user={user} onClose={() => setShowSettings(false)} />
        ) : null}

        <ContextMenu />
        <ImportExportDialog />
        <StatusBar />
        {/* TEMPORARY debug overlay. See src/components/DevOverlay.tsx. */}
        <DevOverlay />
        <Toasts />
      </div>
    </AuthGuard>
  )

  // A path we do not serve. Still inside the chrome, so Back and the logo work.
  if (route.name === 'not-found') {
    return shell(
      <div className="min-h-0 flex-1 overflow-hidden">
        <NotFound path={route.path} />
      </div>,
    )
  }

  // Workspace list. The page owns the scroll; the shell just gives it a height.
  if (!currentDocId) {
    return shell(
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspacePage userId={user?.id ?? ''} onOpenDocument={openDocument} />
      </div>,
    )
  }

  // Canvas.
  return shell(
    <>
      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? (
          <>
            <div
              className="fixed inset-0 z-30 bg-slate-900/25 lg:hidden"
              onPointerDown={() => setSidebarOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-40 lg:static lg:z-auto">
              <PageSidebar onClose={() => setSidebarOpen(false)} />
            </div>
          </>
        ) : null}

        <div className="relative flex min-w-0 flex-1">
          {loadingDoc ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-canvas/70 text-sm text-muted">
              Opening workspace…
            </div>
          ) : null}
          <Canvas />
          <SearchPanel />
          <ConnectionTree />
        </div>

        <Inspector />
      </div>

    </>,
  )
}
