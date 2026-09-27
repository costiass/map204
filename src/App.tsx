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

export default function App() {
  useKeyboardShortcuts()
  useAutosave()
  useRealtime()

  const sidebarOpen = useCanvasStore((s) => s.sidebarOpen)
  const setSidebarOpen = useCanvasStore((s) => s.setSidebarOpen)
  const pushToast = useCanvasStore((s) => s.pushToast)
  const reportedBoot = useRef(false)

  const [currentDocId, setCurrentDocId] = useState<string | null>(null)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false)
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
    setCurrentDocId(docId)
    useCanvasStore.getState().setDocumentId(docId)
  }

  const openWorkspace = () => {
    setCurrentDocId(null)
    useCanvasStore.getState().setDocumentId(null)
  }

  // Wrap AuthGuard to expose user via context-like pattern
  return (
    <AuthGuard onUserChange={setUser}>
      <div className={`flex h-full w-full flex-col overflow-hidden bg-canvas ${settings.theme === 'dark' ? 'dark' : ''}`}>
        <Toolbar
          user={user}
          onOpenSettings={() => setShowSettingsOverlay(true)}
          onOpenWorkspace={openWorkspace}
          onUserChange={setUser}
        />

        <div className="flex min-h-0 flex-1">
          {!currentDocId ? (
            <div className="flex-1 overflow-auto">
              <WorkspacePage
                userId={user?.id ?? ''}
                onOpenDocument={openDocument}
              />
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* Settings overlay (same style as inspector) */}
        {showSettingsOverlay ? (
          <UserSettingsPage
            user={user ?? { id: '', email: '', user_metadata: {} }}
            onClose={() => setShowSettingsOverlay(false)}
          />
        ) : null}

        <ContextMenu />
        <ImportExportDialog />
        <Toasts />
      </div>
    </AuthGuard>
  )
}
