import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { IconPlus, IconTrash } from '@/components/Icons'

interface DocumentInfo {
  id: string
  title: string
  updated_at: string
}

interface WorkspacePageProps {
  userId: string
  onOpenDocument: (docId: string, title: string) => void
}

/**
 * Landing page — lists all user's documents (Google Docs style).
 */
export function WorkspacePage({ userId, onOpenDocument }: WorkspacePageProps) {
  const [documents, setDocuments] = useState<DocumentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void loadDocuments()
  }, [userId])

  const loadDocuments = async () => {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase
      .from('documents')
      .select('id, title, updated_at')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false })

    if (!error && data) {
      setDocuments(data as DocumentInfo[])
    }
    setLoading(false)
  }

  const createDocument = async () => {
    if (!supabase || !newTitle.trim()) return
    setCreating(true)
    const { data, error } = await supabase
      .from('documents')
      .insert({ owner_id: userId, title: newTitle.trim() })
      .select('id, title')
      .single()

    if (!error && data) {
      onOpenDocument((data as DocumentInfo).id, (data as DocumentInfo).title)
    }
    setCreating(false)
    setNewTitle('')
  }

  const deleteDocument = async (docId: string) => {
    if (!supabase) return
    await supabase.from('documents').delete().eq('id', docId)
    setDocuments((docs) => docs.filter((d) => d.id !== docId))
  }

  return (
    <div className="flex h-full w-full flex-col items-center bg-canvas p-8">
      <div className="w-full max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-800">Your workspaces</h1>

        {/* Create new document */}
        <div className="mb-8 flex gap-2">
          <input
            className="cc-input max-w-xs"
            placeholder="New workspace name..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void createDocument()}
          />
          <button
            type="button"
            className="cc-btn"
            data-variant="primary"
            disabled={creating || !newTitle.trim()}
            onClick={() => void createDocument()}
          >
            <IconPlus size={14} />
            Create
          </button>
        </div>

        {/* Document grid */}
        {loading ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-slate-400">No workspaces yet. Create one above.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {documents.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className="group relative cursor-pointer rounded-xl border border-line bg-white p-4 text-left shadow-sm transition hover:shadow-md dark:bg-slate-800"
                onClick={() => onOpenDocument(doc.id, doc.title)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  </div>
                  <span
                    className="cursor-pointer rounded p-1 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30"
                    title="Delete workspace"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm('Delete this workspace?')) void deleteDocument(doc.id)
                    }}
                  >
                    <IconTrash size={14} />
                  </span>
                </div>
                <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {doc.title}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(doc.updated_at).toLocaleDateString()}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
