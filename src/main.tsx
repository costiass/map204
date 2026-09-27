import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'
import { useCanvasStore } from './store/useCanvasStore'
import { loadDocumentFromSupabase, createDocumentInSupabase, createPageInSupabase } from './store/supabase-sync'
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
          await createPageInSupabase(docId, page.title)
        }
        doc = await loadDocumentFromSupabase(session.user.id)
        if (doc) {
          store.setDocumentId(docId)
        }
      }
    } else {
      // Get the document ID for this user's most recent document.
      const { data: docRow } = await supabase
        .from('documents')
        .select('id')
        .eq('owner_id', session.user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (docRow) store.setDocumentId(docRow.id)
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
