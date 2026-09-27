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
import { WorkspacePage } from '@/components/WorkspacePage'
import { useAutosave } from '@/hooks/useAutosave'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useRealtime } from '@/hooks/useRealtime'
import { bootError, bootWarnings, useCanvasStore } from '@/store/useCanvasStore'

export default function App() {
  useKeyboardShortcuts()
  useAutosave()
  useRealtime()

  const sidebarOpen = useCanvasStore((s) => s.sidebarOpen)
  const setSidebarOpen = useCanvasStore((s) => s.setSidebarOpen)
  const pushToast = useCanvasStore((s) => s.pushToast)
  const darkMode = useCanvasStore((s) => s.darkMode)
  const documentId = useCanvasStore((s) => s.documentId)
  const reportedBoot = useRef(false)

  // Simple routing: if no documentId, show workspace list.
  const [currentDocId, setCurrentDocId] = useState<string | null>(null)

  useEffect(() => {
    if (documentId) {
      setCurrentDocId(documentId)
    }
  }, [documentId])

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

  // Show workspace page if no document is open.
  if (!currentDocId) {
    return (
      <AuthGuard>
        <div className={`flex h-full w-full flex-col overflow-hidden bg-canvas ${darkMode ? 'dark' : ''}`}>
          <Toolbar />
          <div className="flex-1 overflow-auto">
            <WorkspacePage
              userId={useCanvasStore.getState().doc?.pages[0]?.id ?? ''}
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

  return (
    <AuthGuard>
      <div className={`flex h-full w-full flex-col overflow-hidden bg-canvas ${darkMode ? 'dark' : ''}`}>
        <Toolbar />
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
