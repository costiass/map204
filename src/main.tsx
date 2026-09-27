import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadDocument, saveDocumentNow, storageWarning } from './store/database'
import { useCanvasStore } from './store/useCanvasStore'

/**
 * Reads the saved document from IndexedDB before the first paint, so the app
 * never flashes the sample document and then swaps it for the real one.
 */
async function bootstrap() {
  const result = await loadDocument()
  if (result.doc) {
    useCanvasStore.getState().hydrateDocument(result.doc)
    // Writes the document back once, which normalises the records and repairs
    // anything the parse had to fix. It happens before the app is interactive
    // and is a single transaction.
    void saveDocumentNow(result.doc).then((saved) => {
      if (!saved.ok) useCanvasStore.getState().pushToast(saved.error ?? 'Could not save', 'error')
    })
  } else if (result.error) {
    useCanvasStore.getState().pushToast(`${result.error} Showing the sample document.`, 'error')
  }

  const root = createRoot(document.getElementById('root')!)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  if (storageWarning()) {
    useCanvasStore
      .getState()
      .pushToast(`${storageWarning()} Falling back to local storage — export to keep your work safe.`, 'info')
  }
}

void bootstrap()
