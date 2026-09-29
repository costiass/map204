import { useCallback, useEffect, useState } from 'react'

import { AuthGuard } from '@/components/AuthGuard'
import { applyDocumentSettings, installCameraSink, uninstallCameraSink } from '@/store/documentSettings'
import { Canvas } from '@/components/Canvas'
import { ConnectionTree } from '@/components/ConnectionTree'
import { ContextMenu } from '@/components/ContextMenu'
import { ImportExportDialog } from '@/components/ImportExportDialog'
import { InsertCardDialog } from '@/components/InsertCardDialog'
import { PresentOverlay } from '@/components/PresentOverlay'
import { PresentationInspector } from '@/components/PresentationInspector'
import { PresentationTree } from '@/components/PresentationTree'
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
import { DOC_VERSION } from '@/types'
import { useCanvasStore } from '@/store/useCanvasStore'
import { useUserSettings } from '@/store/userSettings'
import type { SupabaseUser } from '@/lib/supabase'
import { DEFAULT_WORKSPACE_ACCENT, DEFAULT_WORKSPACE_ICON } from '@/theme'

export default function App() {
  /*
   * Every camera move, to this reader's settings file.
   *
   * Registered here rather than inside the canvas store because of the constraint
   * documented on `setCameraSink`: the canvas store cannot import anything that
   * reads `import.meta.env` at load time, and this module builds a Supabase client.
   * So the store calls out and this answers.
   *
   * Mount and unmount, not once at module load: a hot reload would otherwise stack
   * registrations, and the last one registered is the only one that would run, so it
   * would be harmless -- but "harmless by accident" is not a thing to leave in.
   */
  useEffect(() => {
    installCameraSink()
    return () => uninstallCameraSink()
  }, [])

  useKeyboardShortcuts()
  usePageSync()

  const sidebarOpen = useCanvasStore((s) => s.sidebarOpen)
  const setSidebarOpen = useCanvasStore((s) => s.setSidebarOpen)
  const readOnlyReason = useCanvasStore((s) => s.readOnlyReason)
  const presenting = useCanvasStore((s) => s.presenting)
  const presentationOpen = useCanvasStore((s) => s.presentationOpen)
  const setPresentationOpen = useCanvasStore((s) => s.setPresentationOpen)
  const stopPresenting = useCanvasStore((s) => s.stopPresenting)

  // Real paths: `/`, `/doc/<docId>`, `/settings`. Anything else is a 404.
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
    // Fire-and-forget on purpose. The document is loaded below and the canvas must
    // not wait on anything; this is a convenience applied when it lands.
    if (currentDocId && user) void applyDocumentSettings(currentDocId)

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

        // Primed *before* the title reaches the store. primePageSync records what
        // the server holds for this document, and the rename effect compares
        // against it to tell a reader's typing from the loader filling the field
        // in — so the record has to exist first, or the first value seen looks
        // like an edit and is written straight back.
        primePageSync(currentDocId, loaded)

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

        store.hydrateDocument({
          version: DOC_VERSION,
          pages: loaded.pages,
          settings: loaded.settings,
          // The upload total is re-read from the server when a file is opened;
          // until then this document has no counted uploads of its own.
          uploadBytes: 0,
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
        {/* The route — not the store — decides what the chrome shows. A
            presentation takes the screen over completely: a toolbar, a sidebar
            and an inspector are all things the audience should not be looking at,
            and all of them are ways to change the map mid-sentence. Escape and
            the mouse are the way back. */}
        {presenting ? null : (
          <Toolbar
            user={user}
            documentId={currentDocId}
            onOpenSettings={openSettings}
            onOpenWorkspace={openWorkspace}
            onOpenShare={() => setShowShare(true)}
            onUserChange={setUser}
          />
        )}
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
        <InsertCardDialog />
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
        {sidebarOpen && !presenting ? (
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

        {/* The inspector is the editor, and a canvas that cannot be edited has
            no business showing one — an open panel of controls that quietly do
            nothing is worse than no panel, because it looks like it works. The
            presentation inspector edits the document too, so it goes for the
            same reason. */}
        {/* The inspector is the editor, and a canvas that cannot be edited has
            no business showing one — an open panel of controls that quietly do
            nothing is worse than no panel, because it looks like it works. The
            presentation inspector edits the document too, so it goes for the
            same reason.

            A *presentation* gets the connection tree instead, which is the one
            panel that helps rather than edits: it shows how the map hangs
            together, which is exactly what you want while talking over it, and
            it cannot change anything. */}
        {readOnlyReason === null ? (
          presentationOpen ? (
            <PresentationInspector onClose={() => setPresentationOpen(false)} />
          ) : (
            <Inspector />
          )
        ) : null}

        {presenting ? <PresentationTree onClose={stopPresenting} /> : null}
      </div>

      {presenting ? <PresentOverlay /> : null}

      {!presenting ? <Toasts /> : null}
    </>,
  )
}
