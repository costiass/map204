import { useCallback, useEffect, useState } from 'react'

import { IconPencil, IconPlus, IconTrash } from '@/components/Icons'
import {
  createDocument,
  deleteDocument,
  listDocuments,
  renameDocument,
} from '@/store/supabase-sync'
import type { SharedDocument } from '@/store/supabase-sync'

interface WorkspacePageProps {
  userId: string
  onOpenDocument: (docId: string) => void
}

/**
 * Landing page — `GET /documents` (Google Docs style). Creating a workspace is a
 * single `POST /documents`: the `trg_create_default_page` trigger gives it its
 * first page, so the client never inserts one itself.
 */
export function WorkspacePage({ userId, onOpenDocument }: WorkspacePageProps) {
  const [documents, setDocuments] = useState<SharedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const loadDocuments = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setDocuments(await listDocuments(userId))
    setLoading(false)
  }, [userId])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

  const create = async () => {
    if (!userId || !newTitle.trim()) return
    setCreating(true)
    const created = await createDocument(userId, newTitle.trim())
    setCreating(false)
    setNewTitle('')

    if (!created) {
      setDocuments(await listDocuments(userId))
      return
    }
    onOpenDocument(created.document.id)
  }

  const remove = async (docId: string) => {
    const ok = await deleteDocument(docId)
    if (!ok) return
    setDocuments((docs) => docs.filter((entry) => entry.document.id !== docId))
  }

  /** `PATCH /documents` — rename from the workspace list. */
  const rename = async (docId: string, title: string) => {
    const clean = title.trim()
    if (!clean) {
      await loadDocuments()
      return
    }
    const ok = await renameDocument(docId, clean)
    if (!ok) {
      await loadDocuments()
      return
    }
    setDocuments((docs) =>
      docs.map((entry) =>
        entry.document.id === docId ? { ...entry, document: { ...entry.document, title: clean } } : entry,
      ),
    )
  }

  return (
    <div className="flex h-full w-full flex-col items-center bg-canvas p-8">
      <div className="w-full max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-800 dark:text-slate-100">
          Your workspaces
        </h1>

        {/* Create new document */}
        <div className="mb-8 flex gap-2">
          <input
            className="cc-input max-w-xs"
            placeholder="New workspace name..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          <button
            type="button"
            className="cc-btn"
            data-variant="primary"
            disabled={creating || !newTitle.trim()}
            onClick={() => void create()}
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
            {documents.map(({ document: doc, role }) =>
              renamingId === doc.id ? (
                <input
                  key={doc.id}
                  autoFocus
                  defaultValue={doc.title}
                  className="cc-input"
                  onBlur={(event) => {
                    void rename(doc.id, event.target.value)
                    setRenamingId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === 'Escape') {
                      event.currentTarget.blur()
                    }
                  }}
                />
              ) : (
                <button
                  key={doc.id}
                  type="button"
                  className="group relative cursor-pointer rounded-xl border border-line bg-white p-4 text-left shadow-sm transition hover:shadow-md dark:bg-slate-800"
                  onClick={() => onOpenDocument(doc.id)}
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
                    <span className="flex items-center gap-1">
                      {role === 'owner' ? (
                        <span
                          className="cursor-pointer rounded p-1 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-700"
                          title="Rename workspace"
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenamingId(doc.id)
                          }}
                        >
                          <IconPencil size={14} />
                        </span>
                      ) : (
                        <span className="cc-tag" title={`Shared with you as ${role}`}>
                          {role}
                        </span>
                      )}
                      {role === 'owner' ? (
                        <span
                          className="cursor-pointer rounded p-1 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30"
                          title="Delete workspace"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm('Delete this workspace and every page in it?')) {
                              void remove(doc.id)
                            }
                          }}
                        >
                          <IconTrash size={14} />
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {doc.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(doc.updated_at).toLocaleDateString()}
                  </p>
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  )
}