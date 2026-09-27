import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'
import { useCanvasStore } from './store/useCanvasStore'
import { loadDocumentFromSupabase, createDocumentInSupabase } from './store/supabase-sync'
import { createSampleDoc } from './data/sample'
import { normalizeDoc } from './utils/serialize'

async function bootstrap() {
  const store = useCanvasStore.getState()

  const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }

  if (session?.user && supabase) {
    let doc = await loadDocumentFromSupabase(session.user.id)

    if (!doc) {
      const docId = await createDocumentInSupabase(session.user.id)
      if (docId) {
        const sample = normalizeDoc(createSampleDoc()).doc
        for (const page of sample.pages) {
          await supabase.from('pages').insert({
            document_id: docId,
            title: page.title,
            position: page.position,
            viewport: page.viewport,
            cards: page.cards,
            groups: page.groups,
            connections: page.connections,
            version: 0,
          })
        }
        doc = await loadDocumentFromSupabase(session.user.id)
        if (doc) {
          store.setDocumentId(docId)
        }
      }
    }

    if (doc) {
      store.hydrateDocument(doc)
    }
  }

  const root = createRoot(document.getElementById('root')!)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()