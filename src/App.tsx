import { useEffect, useRef, useState } from 'react'

import { AuthGuard } from '@/components/AuthGuard'
import { Canvas } from '@/components/Canvas'
import { ConnectionTree } from '@/components/ConnectionTree'
import { ContextMenu } from '@/components/ContextMenu'
import { ImportExportDialog } from '@/components/ImportExportDialog'
import { Inspector } from '@/components/Inspector'
import { PageSidebar } from '@/components/PageSidebar'
import { SearchPanel } from '@/components/SearchPanel'
import { Toasts } from '@/components/Toasts'
import { Toolbar } from '@/components/Toolbar'
import { UserSettingsPage } from '@/components/UserSettingsPage'
import { WorkspacePage } from '@/components/WorkspacePage'
import { useAutosave } from '@/hooks/useAutosave'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useRealtime } from '@/hooks/useRealtime'
import { bootError, bootWarnings, useCanvasStore } from '@/store/useCanvasStore'
import { useUserSettings } from '@/store/userSettings'
import type { SupabaseUser } from '@/lib/supabase'

type Route = 'workspace' | 'canvas' | 'settings'

export default function App() {
  useKeyboardShortcuts()
  useAutosave()
  useRealtime()

  const sidebarOpen = useCanvasStore((s) => s.sidebarOpen)
  const setSidebarOpen = useCanvasStore((s) => s.setSidebarOpen)
  const pushToast = useCanvasStore((s) => s.pushToast)

  const reportedBoot = useRef(false)

  const [route, setRoute] = useState<Route>('workspace')
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const { settings } = useUserSettings()

  // Sync user settings to canvas store.
  useEffect(() => {
    const store = useCanvasStore.getState()
    store.setDarkMode(settings.theme === 'dark')
    store.setSnapToGrid(settings.defaultSnapToGrid)
    store.setGridPattern(settings.defaultGridPattern)
    store.setGridSize(settings.defaultGridSize)
  }, [settings])

  // Report anything that had to be repaired while loading saved data.
  useEffect(() => {
    if (reportedBoot.current) return
    reportedBoot.current = true
    if (bootError) {
      pushToast(`${bootError} Loaded the sample document instead.`, 'error')
      return
    }
    for (const warning of bootWarnings.slice(0, 2)) {
      pushToast(warning, 'info')
    }
  }, [pushToast])

  const openDocument = (docId: string, _title: string) => {
    useCanvasStore.getState().setDocumentId(docId)
    setRoute('canvas')
  }

  const openWorkspace = () => {
    setRoute('workspace')
  }

  // Settings page
  if (route === 'settings') {
    return (
      <AuthGuard>
        <div className={`flex h-full w-full flex-col overflow-hidden bg-canvas ${settings.theme === 'dark' ? 'dark' : ''}`}>
          <Toolbar
            route={route}
            user={user}
            onNavigate={setRoute}
            onUserChange={setUser}
          />
          <div className="flex-1 overflow-auto">
            {user ? (
              <UserSettingsPage user={user} onBack={openWorkspace} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Please sign in to access settings.
              </div>
            )}
          </div>
          <ContextMenu />
          <ImportExportDialog />
          <Toasts />
        </div>
      </AuthGuard>
    )
  }

  // Workspace page (document list)
  if (route === 'workspace') {
    return (
      <AuthGuard>
        <div className={`flex h-full w-full flex-col overflow-hidden bg-canvas ${settings.theme === 'dark' ? 'dark' : ''}`}>
          <Toolbar
            route={route}
            user={user}
            onNavigate={setRoute}
            onUserChange={setUser}
          />
          <div className="flex-1 overflow-auto">
            <WorkspacePage
              userId={user?.id ?? ''}
              onOpenDocument={openDocument}
            />
          </div>
          <ContextMenu />
          <ImportExportDialog />
          <Toasts />
        </div>
      </AuthGuard>
    )
  }

  // Canvas page (main editor)
  return (
    <AuthGuard>
      <div className={`flex h-full w-full flex-col overflow-hidden bg-canvas ${settings.theme === 'dark' ? 'dark' : ''}`}>
        <Toolbar
          route={route}
          user={user}
          onNavigate={setRoute}
          onUserChange={setUser}
        />
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
            <Canvas />
            <SearchPanel />
            <ConnectionTree />
          </div>

          <Inspector />
        </div>

        <ContextMenu />
        <ImportExportDialog />
        <Toasts />
      </div>
    </AuthGuard>
  )
}
