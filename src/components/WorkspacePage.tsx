import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  FolderOpen,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import { DocTypeBadge } from '@/components/DocTypeBadge'
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

/** How the list reads a document, for the search box. */
function matches(entry: SharedDocument, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const title = entry.document.title.toLowerCase()
  if (title.includes(q)) return true
  // Also match on the kind's name, so "map" finds everything and "outliner"
  // will find nothing rather than everything — an honest empty result is better
  // than a filter that quietly does not filter.
  return getWorkspaceIconLabel(entry.document.icon).toLowerCase().includes(q)
}

/**
 * Landing page — `GET /documents`, laid out the way a file list is rather than
 * the way a gallery is.
 *
 * Three decisions worth stating, because each one is a change from what was here:
 *
 * **A search box, because a list you cannot search is a list you scroll.** The
 * old grid was fine at four documents and useless at forty. Search is the thing
 * that makes a growing list usable, so it is the largest thing on the page
 * rather than an icon beside the title.
 *
 * **Colour and icon are hidden until you edit.** They were on every tile, all
 * the time, which made the list a wall of coloured squares you have to read
 * *past* to find a document. They are identity, and identity is only interesting
 * when you are doing something to the document.
 *
 * **One edit button, not four.** Rename, recolour and re-icon were three
 * separate affordances that appeared on hover, so the tile's own title was
 * competing with a row of icons for the same corner. One button opens one place
 * with all three in it, and the whole card is that button's target.
 */
export function WorkspacePage({ userId, onOpenDocument }: WorkspacePageProps) {
  const [documents, setDocuments] = useState<SharedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  /** Which document is open for editing, if any. Only ever one. */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** What the new document should look like, chosen before it exists. */
  const [newAccent, setNewAccent] = useState<WorkspaceAccentId>(DEFAULT_WORKSPACE_ACCENT)
  const [newIcon, setNewIcon] = useState(DEFAULT_WORKSPACE_ICON)
  const newTitleRef = useRef<HTMLInputElement>(null)
  const pushToast = useCanvasStore((s) => s.pushToast)

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

  const restyle = async (docId: string, look: { accent?: string; icon?: string }) => {
    const ok = await setDocumentLook(docId, look)
    if (!ok) {
      pushToast('Could not change that.', 'error')
      return
    }
    setDocuments((docs) =>
      docs.map((entry) =>
        entry.document.id === docId
          ? { ...entry, document: { ...entry.document, ...look } }
          : entry,
      ),
    )
  }

  const remove = async (docId: string) => {
    const ok = await deleteDocument(docId)
    if (!ok) {
      pushToast('Could not delete that.', 'error')
      return
    }
    setDocuments((docs) => docs.filter((entry) => entry.document.id !== docId))
  }

  const rename = async (docId: string, title: string) => {
    const clean = title.trim()
    if (!clean) return
    const ok = await renameDocument(docId, clean)
    if (!ok) {
      pushToast('Could not rename that.', 'error')
      return
    }
    setDocuments((docs) =>
      docs.map((entry) =>
        entry.document.id === docId ? { ...entry, document: { ...entry.document, title: clean } } : entry,
      ),
    )
  }

  const sharedCount = documents.filter((entry) => entry.role !== 'owner').length
  const visible = useMemo(
    () => documents.filter((entry) => matches(entry, query)),
    [documents, query],
  )
  const searching = query.trim().length > 0

  return (
    <div className="cc-scroll h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-ink-strong">Workspaces</h1>
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

        {/* The search box is the largest thing on the page. It is the only way
            to find anything once there are more than a handful, so it is sized
            like the primary action rather than tucked into a corner. */}
        <div className="relative mb-4">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            className="cc-input w-full py-2.5 pl-9 pr-9"
            placeholder="Search workspaces"
            aria-label="Search workspaces"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching ? (
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted transition hover:text-ink"
              title="Clear the search"
              aria-label="Clear the search"
              onClick={() => setQuery('')}
            >
              <X size={15} />
            </button>
          ) : null}
        </div>

        {/* New workspace. Colour and icon are chosen here, before it exists,
            rather than after — the alternative is creating it and then being
            invited to style it, which is two trips for one job. */}
        <form
          className="mb-6 flex flex-wrap items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <div className="min-w-[14rem] flex-1">
            <input
              ref={newTitleRef}
              className="cc-input w-full"
              placeholder="New workspace name"
              aria-label="New workspace name"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="cc-btn"
            data-variant="primary"
            disabled={creating || !newTitle.trim()}
          >
            <Plus size={14} />
            New workspace
          </button>
          <details className="group w-full">
            <summary className="cc-btn cursor-pointer list-none text-xs opacity-70 hover:opacity-100">
              <MoreHorizontal size={14} />
              Change the new workspace&rsquo;s colour and icon
            </summary>
            <div className="mt-2">
              <LookPicker
                accent={newAccent}
                icon={newIcon}
                onAccent={(accent) => setNewAccent(accent as WorkspaceAccentId)}
                onIcon={setNewIcon}
              />
            </div>
          </details>
        </form>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className="h-16 animate-pulse rounded-xl bg-surface/60" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line py-16 text-center">
            <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface shadow-sm">
              <FolderOpen size={20} className="text-brand" />
            </div>
            <h2 className="text-sm font-semibold text-ink">No workspaces yet</h2>
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
              <Plus size={14} /> New workspace
            </button>
          </div>
        ) : visible.length === 0 ? (
          // A search with no results says so, rather than showing an empty list
          // that looks like the documents have gone.
          <div className="grid place-items-center rounded-2xl border border-dashed border-line py-14 text-center">
            <Search size={20} className="mb-2 text-muted" />
            <p className="text-sm font-semibold text-ink">
              No workspace matches &ldquo;{query.trim()}&rdquo;
            </p>
            <p className="mt-1 text-[13px] text-muted">
              You have {documents.length} {documents.length === 1 ? 'workspace' : 'workspaces'}.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map(({ document: doc, role }) => (
              <li key={doc.id}>
                <WorkspaceRow
                  doc={doc}
                  role={role}
                  editing={editingId === doc.id}
                  onEdit={() => setEditingId((id) => (id === doc.id ? null : doc.id))}
                  onCancelEdit={() => setEditingId(null)}
                  onOpen={() => onOpenDocument(doc.id)}
                  onRename={(title) => void rename(doc.id, title)}
                  onAccent={(accent) => void restyle(doc.id, { accent })}
                  onIcon={(icon) => void restyle(doc.id, { icon })}
                  onDelete={() => {
                    if (confirm(`Delete “${doc.title}” and every page in it?`)) void remove(doc.id)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface WorkspaceRowProps {
  doc: SharedDocument['document']
  role: SharedDocument['role']
  editing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onOpen: () => void
  onRename: (title: string) => void
  onAccent: (accent: string) => void
  onIcon: (icon: string) => void
  onDelete: () => void
}

/**
 * One row of the list.
 *
 * The whole row opens the document, not the title. A row is one thing and it
 * does one thing; making the title the only clickable part means aiming at a
 * target the size of a word, and the empty space either side of it does nothing
 * — which reads as the row being broken rather than as a design choice.
 *
 * Editing replaces the row's contents rather than opening a dialog, so the
 * colour and the icon you are changing are the ones in front of you.
 */
function WorkspaceRow({
  doc,
  role,
  editing,
  onEdit,
  onCancelEdit,
  onOpen,
  onRename,
  onAccent,
  onIcon,
  onDelete,
}: WorkspaceRowProps) {
  const [title, setTitle] = useState(doc.title)
  const inputRef = useRef<HTMLInputElement>(null)

  // A row that starts editing needs the caret in the name, or "edit" opens a
  // form you then have to click into before you can type.
  useEffect(() => {
    if (editing) {
      setTitle(doc.title)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing, doc.title])

  const accent = getWorkspaceAccent(doc.accent)

  if (editing) {
    return (
      <div className="rounded-xl border border-brand bg-surface p-3 shadow-md">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
            style={{ background: accent.soft, color: accent.ink }}
          >
            <WorkspaceMark icon={doc.icon} accent={doc.accent} size={15} />
          </span>
          <input
            ref={inputRef}
            className="cc-input min-w-[10rem] flex-1"
            aria-label={`Rename ${doc.title}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onRename(title)
                onCancelEdit()
              }
              if (event.key === 'Escape') onCancelEdit()
            }}
          />
        </div>

        <div className="mt-3">
          <LookPicker
            accent={doc.accent}
            icon={doc.icon}
            heading={`${getWorkspaceIconLabel(doc.icon)} workspace`}
            onAccent={onAccent}
            onIcon={onIcon}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="cc-btn"
            data-variant="primary"
            onClick={() => {
              onRename(title)
              onCancelEdit()
            }}
          >
            <Check size={14} /> Done
          </button>
          <button type="button" className="cc-btn" onClick={onCancelEdit}>
            <X size={14} /> Cancel
          </button>
          {role === 'owner' ? (
            <button
              type="button"
              className="cc-btn ml-auto text-danger"
              onClick={() => {
                onCancelEdit()
                onDelete()
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div
      className="group relative flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-sm transition hover:border-line-strong hover:shadow-md"
      // The whole row is the button. A keyboard focus lands on this, and Enter
      // and Space both open, because it is a real <button>.
      role="button"
      tabIndex={0}
      aria-label={`Open ${doc.title}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        // A hairline in the workspace's own colour, so a row is recognisable by
        // its edge before the name is read.
        style={{ background: accent.soft, color: accent.ink, boxShadow: `inset 0 0 0 1px ${accent.base}` }}
        title={getWorkspaceIconLabel(doc.icon)}
      >
        <WorkspaceMark icon={doc.icon} accent={doc.accent} size={16} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{doc.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
          <WorkspaceDot accent={doc.accent} size={7} />
          Edited {new Date(doc.updated_at).toLocaleDateString()}
          <DocTypeBadge kind={doc.kind} />
          {role === 'owner' ? null : (
            <span className="cc-tag" title={`Shared with you as ${role}`}>
              <Link2 size={10} className="mr-0.5" />
              {role === 'editor' ? 'Can edit' : 'View only'}
            </span>
          )}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-0.5">
        {role === 'owner' ? (
          <>
            <button
              type="button"
              className="cursor-pointer rounded p-1.5 text-muted transition hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              title="Rename, recolour and re-icon"
              aria-label={`Edit ${doc.title}`}
              onClick={(event) => {
                // The row is a button, so a click here would otherwise open the
                // document *as well as* starting an edit.
                event.stopPropagation()
                onEdit()
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="cursor-pointer rounded p-1.5 text-muted transition hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              title="Delete"
              aria-label={`Delete ${doc.title}`}
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 size={14} />
            </button>
          </>
        ) : null}
      </span>
    </div>
  )
}
