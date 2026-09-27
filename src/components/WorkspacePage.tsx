import { useCallback, useEffect, useRef, useState } from 'react'

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
  const newTitleRef = useRef<HTMLInputElement>(null)

  const sharedCount = documents.filter((entry) => entry.role !== 'owner').length

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
    <div className="cc-scroll h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Row 2 of the chrome is canvas-only, so the list brings its own
            heading: title and count on the left, primary action on the right. */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Workspaces</h1>
            <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
              {loading
                ? 'Loading…'
                : documents.length === 0
                  ? 'Nothing here yet.'
                  : `${documents.length} ${documents.length === 1 ? 'workspace' : 'workspaces'}${
                      sharedCount > 0 ? ` · ${sharedCount} shared with you` : ''
                    }`}
            </p>
          </div>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <input
              ref={newTitleRef}
              className="cc-input w-56"
              placeholder="New workspace name"
              aria-label="New workspace name"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <button
              type="submit"
              className="cc-btn"
              data-variant="primary"
              disabled={creating || !newTitle.trim()}
            >
              <IconPlus size={14} />
              Create
            </button>
          </form>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <div
                key={key}
                className="h-[7.5rem] animate-pulse rounded-xl border border-line bg-white/60 dark:bg-[#1a1a1a]/60"
              />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line py-16 text-center">
            <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm dark:bg-[#1e1e1e]">
              <IconPlus size={20} className="text-brand" />
            </div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              No workspaces yet
            </h2>
            <p className="mt-1 max-w-xs text-[13px] text-slate-500">
              A workspace holds as many pages of cards and arrows as your course needs. Name one
              above to get started.
            </p>
            <button
              type="button"
              className="cc-btn mt-4"
              data-variant="primary"
              onClick={() => newTitleRef.current?.focus()}
            >
              <IconPlus size={14} /> New workspace
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
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
                <article
                  key={doc.id}
                  className="group relative flex flex-col rounded-xl border border-line bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md dark:bg-[#1a1a1a] dark:hover:border-[#3a3a3a]"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-[#252525] dark:text-slate-400"
                      aria-label={`Open ${doc.title}`}
                      onClick={() => onOpenDocument(doc.id)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </button>

                    <span className="flex shrink-0 items-center gap-0.5">
                      {role === 'owner' ? (
                        <>
                          <button
                            type="button"
                            className="cursor-pointer rounded p-1 text-slate-400 opacity-100 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-[#252525]"
                            title="Rename workspace"
                            aria-label={`Rename ${doc.title}`}
                            onClick={() => setRenamingId(doc.id)}
                          >
                            <IconPencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="cursor-pointer rounded p-1 text-slate-400 opacity-100 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-red-900/30"
                            title="Delete workspace"
                            aria-label={`Delete ${doc.title}`}
                            onClick={() => {
                              if (confirm('Delete this workspace and every page in it?')) {
                                void remove(doc.id)
                              }
                            }}
                          >
                            <IconTrash size={14} />
                          </button>
                        </>
                      ) : (
                        <span className="cc-tag" title={`Shared with you as ${role}`}>
                          {role === 'editor' ? 'Shared · edit' : 'Shared · view'}
                        </span>
                      )}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="min-w-0 cursor-pointer text-left outline-none"
                    onClick={() => onOpenDocument(doc.id)}
                  >
                    <span className="block truncate text-sm font-semibold text-slate-700 group-hover:text-brand dark:text-slate-200 dark:group-hover:text-[#a5b4fc]">
                      {doc.title}
                    </span>
                  </button>
                  <p className="mt-1 text-xs text-slate-400">
                    Edited {new Date(doc.updated_at).toLocaleDateString()}
                  </p>
                </article>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  )
}