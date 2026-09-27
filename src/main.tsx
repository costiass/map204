import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import App from './App.tsx'

// Supabase is the only store for the document: the canvas hydrates from it once
// the signed-in user opens a workspace (see `App.tsx`), so there is nothing to
// load before React mounts.
const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)
