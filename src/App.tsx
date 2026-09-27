import { useCallback, useEffect, useState } from 'react'

import { AuthGuard } from '@/components/AuthGuard'
import { Canvas } from '@/components/Canvas'
import { ConnectionTree } from '@/components/ConnectionTree'
import { ContextMenu } from '@/components/ContextMenu'
import { ImportExportDialog } from '@/components/ImportExportDialog'
import { Inspector } from '@/components/Inspector'
import { PageSidebar } from '@/components/PageSidebar'
import { SearchPanel } from '@/components/SearchPanel'
import { ShareDialog } from '@/components/ShareDialog'
import { Toasts } from '@/components/Toasts'
import { Toolbar } from '@/components/Toolbar'
import { UserSettingsPage } from '@/components/UserSettingsPage'
import { WorkspacePage } from '@/components/WorkspacePage'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { primePageSync, resetPageSync, usePageSync } from '@/hooks/usePageSync'
import { loadDocument } from '@/store/supabase-sync'
import type { DocumentRow } from '@/store/supabase-sync'
import { useCanvasStore } from '@/store/useCanvasStore'
import { useUserSettings } from '@/store/userSettings'
import type { SupabaseUser } from '@/lib/supabase'

export default function App() {
  useKeyboardShortcuts()
  usePageSync()

  const sidebarOpen = useCanvasStore((s) => s.sidebarOpen)
  const setSidebarOpen = useCanvasStore((s) => s.setSidebarOpen)

  const [currentDocId, setCurrentDocId] = useState<string | null>(null)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [document_, setDocument] = useState<DocumentRow | null>(null)
  const [showShare, setShowShare] = useState(false)
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

  useEffect(() => {
    const store = useCanvasStore.getState()
    store.setDarkMode(settings.theme === 'dark')
    store.setSnapToGrid(settings.defaultSnapToGrid)
    store.setGridPattern(settings.defaultGridPattern)
    store.setGridSize(settings.defaultGridSize)
  }, [settings])

  // Hash routing: #workspace/<docId> opens a document, anything else is the list.
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1)
      if (hash.startsWith('workspace/')) {
        const docId = decodeURIComponent(hash.slice('workspace/'.length))
        setCurrentDocId(docId || null)
      } else {
        setCurrentDocId(null)
      }
    }

    handleHashChange()
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // `GET /documents` + `GET /pages` for the document in the URL.
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
          window.location.hash = ''
          return
        }

        setDocument(loaded.document)
        store.setDocumentTitle(loaded.document.title)
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

  const openDocument = useCallback((docId: string) => {
    window.location.hash = `workspace/${encodeURIComponent(docId)}`
  }, [])

  const openWorkspace = useCallback(() => {
    window.location.hash = ''
  }, [])

  const shell = (children: React.ReactNode) => (
    <AuthGuard onUserChange={setUser}>
      <div
        className={`flex h-full w-full flex-col overflow-hidden bg-canvas ${
          settings.theme === 'dark' ? 'dark' : ''
        }`}
      >
        <Toolbar
          user={user}
          onOpenSettings={() => {
            window.location.hash = 'settings'
          }}
          onOpenWorkspace={openWorkspace}
          onOpenShare={() => setShowShare(true)}
          onUserChange={setUser}
        />
        {children}
        <ContextMenu />
        <ImportExportDialog />
        <Toasts />
      </div>
    </AuthGuard>
  )

  // Settings (full page, hash route).
  if (window.location.hash === '#settings') {
    return shell(
      <div className="flex-1 overflow-auto">
        {user ? (
          <UserSettingsPage user={user} onClose={openWorkspace} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Please sign in to access settings.
          </div>
        )}
      </div>,
    )
  }

  // Workspace list.
  if (!currentDocId) {
    return shell(
      <div className="flex-1 overflow-auto">
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
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-canvas/70 text-sm text-slate-400">
              Opening workspace…
            </div>
          ) : null}
          <Canvas />
          <SearchPanel />
          <ConnectionTree />
        </div>

        <Inspector />
      </div>

      {showShare && user && document_ ? (
        <ShareDialog
          document={document_}
          currentUserId={user.id}
          onClose={() => setShowShare(false)}
        />
      ) : null}
    </>,
  )
}
