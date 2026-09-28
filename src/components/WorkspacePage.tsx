import { useCallback, useEffect, useRef, useState } from 'react'

import { IconCheck, IconPalette, IconPencil, IconPlus, IconTrash } from '@/components/Icons'
import { LookPicker } from '@/components/LookPicker'
import { WorkspaceDot, WorkspaceMark } from '@/components/WorkspaceMark'
import {
  createDocument,
  deleteDocument,
  listDocuments,
  renameDocument,
  setDocumentLook,
} from '@/store/supabase-sync'
import type { SharedDocument } from '@/store/supabase-sync'
import { useCanvasStore } from '@/store/useCanvasStore'
import {
  DEFAULT_WORKSPACE_ACCENT,
  DEFAULT_WORKSPACE_ICON,
  getWorkspaceAccent,
  getWorkspaceIconLabel,
  type WorkspaceAccentId,
} from '@/theme'

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
  /** Which workspace is showing its colour and icon picker, if any. */
  const [stylingId, setStylingId] = useState<string | null>(null)
  /** What the new workspace should look like, chosen before it exists. */
  const [newAccent, setNewAccent] = useState<WorkspaceAccentId>(DEFAULT_WORKSPACE_ACCENT)
  const [newIcon, setNewIcon] = useState(DEFAULT_WORKSPACE_ICON)
  const newTitleRef = useRef<HTMLInputElement>(null)
  const stylingRef = useRef<HTMLDivElement>(null)
  const pushToast = useCanvasStore((s) => s.pushToast)

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
    const created = await createDocument(userId, newTitle.trim(), {
      accent: newAccent,
      icon: newIcon,
    })
    setCreating(false)
    setNewTitle('')

    if (!created) {
      setDocuments(await listDocuments(userId))
      return
    }
    onOpenDocument(created.document.id)
  }

  /** Close the picker on a click outside it, or on Escape. */
  useEffect(() => {
    if (!stylingId) return
    const onDown = (event: PointerEvent) => {
      if (!stylingRef.current?.contains(event.target as Node)) setStylingId(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStylingId(null)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [stylingId])

  /** Apply a colour or icon to a workspace the reader owns. */
  const restyle = async (docId: string, look: { accent?: string; icon?: string }) => {
    // Optimistic: the tile is a colour and a glyph, and waiting a round trip to
    // repaint it makes the picker feel broken.
    setDocuments((docs) =>
      docs.map((entry) =>
        entry.document.id === docId
          ? { ...entry, document: { ...entry.document, ...look } }
          : entry,
      ),
    )
    const ok = await setDocumentLook(docId, look)
    if (!ok) {
      pushToast('Could not change that.', 'error')
      setDocuments(await listDocuments(userId))
    }
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
            <h1 className="text-xl font-bold text-ink-strong text-ink-strong">Workspaces</h1>
            <p className="mt-0.5 text-[13px] text-muted">
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
            className="flex items-start gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <div className="w-64">
              <input
                ref={newTitleRef}
                className="cc-input w-full"
                placeholder="New workspace name"
                aria-label="New workspace name"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <div className="mt-2">
                <LookPicker
                  accent={newAccent}
                  icon={newIcon}
                  onAccent={(accent) => setNewAccent(accent as WorkspaceAccentId)}
                  onIcon={setNewIcon}
                />
              </div>
            </div>
            <button
              type="submit"
              className="cc-btn mt-[1px]"
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
                className="h-[7.5rem] animate-pulse rounded-xl border border-line bg-surface/60"
              />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line py-16 text-center">
            <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface shadow-sm dark:bg-[#1e1e1e]">
              <IconPlus size={20} className="text-brand" />
            </div>
            <h2 className="text-sm font-semibold text-ink">
              No workspaces yet
            </h2>
            <p className="mt-1 max-w-xs text-[13px] text-muted">
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
                  className="group relative flex flex-col rounded-xl border border-line bg-surface p-4 text-left shadow-sm transition hover:border-line-strong hover:shadow-md hover:border-line-strong"
                  // A hairline in the workspace's own colour, so a tile is
                  // recognisable by its edge before the name is read.
                  style={{ borderTopColor: getWorkspaceAccent(doc.accent).base }}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg transition"
                      style={{
                        background: getWorkspaceAccent(doc.accent).soft,
                        color: getWorkspaceAccent(doc.accent).ink,
                      }}
                      aria-label={`Open ${doc.title}`}
                      title={getWorkspaceIconLabel(doc.icon)}
                      onClick={() => onOpenDocument(doc.id)}
                    >
                      <WorkspaceMark icon={doc.icon} accent={doc.accent} size={15} />
                    </button>

                    <span className="flex shrink-0 items-center gap-0.5">
                      {role === 'owner' ? (
                        <>
                          <button
                            type="button"
                            className="cursor-pointer rounded p-1 text-muted opacity-100 transition hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-[#252525]"
                            title="Rename workspace"
                            aria-label={`Rename ${doc.title}`}
                            onClick={() => setRenamingId(doc.id)}
                          >
                            <IconPencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="cursor-pointer rounded p-1 text-muted opacity-100 transition hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-[#252525]"
                            title="Change colour and icon"
                            aria-label={`Change the colour and icon of ${doc.title}`}
                            aria-pressed={stylingId === doc.id}
                            onClick={() => setStylingId(stylingId === doc.id ? null : doc.id)}
                          >
                            <IconPalette size={14} />
                          </button>
                          <button
                            type="button"
                            className="cursor-pointer rounded p-1 text-muted opacity-100 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:bg-danger-soft"
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
                    <span className="block truncate text-sm font-semibold text-ink text-ink">
                      {doc.title}
                    </span>
                  </button>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <WorkspaceDot accent={doc.accent} size={7} />
                    Edited {new Date(doc.updated_at).toLocaleDateString()}
                  </p>

                  {/* The picker hangs off the bottom of the tile rather than
                      replacing it, so the colour you are choosing stays visible
                      while you choose it. */}
                  {stylingId === doc.id ? (
                    <div
                      ref={stylingRef}
                      className="absolute left-2 right-2 top-full z-30 mt-1 rounded-xl border border-line bg-surface p-3 shadow-lg"
                    >
                      <LookPicker
                        accent={doc.accent}
                        icon={doc.icon}
                        heading={`${getWorkspaceIconLabel(doc.icon)} workspace`}
                        onAccent={(accent) => void restyle(doc.id, { accent })}
                        onIcon={(icon) => void restyle(doc.id, { icon })}
                      />
                      <button
                        type="button"
                        className="cc-btn mt-3 w-full justify-center py-1 text-xs"
                        onClick={() => setStylingId(null)}
                      >
                        <IconCheck size={13} /> Done
                      </button>
                    </div>
                  ) : null}
                </article>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  )
}