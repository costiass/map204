import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  FolderOpen,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import { DocTypeBadge } from '@/components/DocTypeBadge'
import { Map204Logo } from '@/components/Map204Logo'
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
import { getWorkspaceAccent, getWorkspaceIconLabel } from '@/theme'

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
  /** List reads names; grid reads colour and icon. Both are kept. */
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [creating, setCreating] = useState(false)
  /** Which document is open for editing, if any. Only ever one. */
  const [editingId, setEditingId] = useState<string | null>(null)
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

  /**
   * Create a map and open it.
   *
   * No name is asked for. "Untitled" is a perfectly good first name for a thing,
   * and asking for one before the thing exists was the only step in this that was
   * not optional — every other action on a new map is easier once you can see
   * it. The name can be typed in the chrome the moment the map opens, which is
   * where you are already looking.
   *
   * No colour or icon is asked for either: the map gets one automatically, and
   * both are one edit away on the list.
   */
  const create = async () => {
    if (!userId) return
    setCreating(true)
    const created = await createDocument(userId, '', {})
    setCreating(false)

    if (!created) {
      pushToast('Could not create a map. Try again.', 'error')
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
      {/*
        The mark, centred above everything, in the place a browser puts its own.

        This is the screen a person arrives at before they have a map open, so it
        is the one place the product's name belongs. Above the search and above
        the heading, because neither of those is the first thing they are looking
        at — they are looking for the thing they left.
      */}
      <div className="flex justify-center px-6 pt-8">
        <Map204Logo className="h-9 w-auto" />
      </div>

      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-strong">Maps</h1>
            <p className="mt-0.5 text-[13px] text-muted">
              {loading
                ? 'Loading…'
                : documents.length === 0
                  ? 'Nothing here yet.'
                  : `${documents.length} ${documents.length === 1 ? 'map' : 'maps'}${
                      sharedCount > 0 ? ` · ${sharedCount} shared with you` : ''
                    }`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* List or grid. A list is better for *finding* — a name reads in a
                row, and you scan names. A grid is better for *recognising* — a
                colour and an icon read at a glance, which is what somebody
                looking for one specific map they half-remember is doing. Both are
                legitimate, so the choice is kept rather than guessed. */}
            <div className="cc-seg" role="group" aria-label="How to show your maps">
              <button
                type="button"
                data-active={view === 'list'}
                aria-pressed={view === 'list'}
                title="List"
                onClick={() => setView('list')}
              >
                <List size={14} />
              </button>
              <button
                type="button"
                data-active={view === 'grid'}
                aria-pressed={view === 'grid'}
                title="Grid"
                onClick={() => setView('grid')}
              >
                <LayoutGrid size={14} />
              </button>
            </div>

            {/* One button, and no name to type. "Untitled" is a perfectly good
                first name for a thing, and asking for one before the thing
                exists is the only step in creating a map that is not optional. */}
            <button
              type="button"
              className="cc-btn"
              data-variant="primary"
              disabled={creating}
              onClick={() => void create()}
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              New map
            </button>
          </div>
        </div>

        {/* The search box is the largest thing on the page. It is the only way
            to find anything once there are more than a handful, so it is sized
            like a primary field rather than tucked into a corner. */}
        <div className="relative mb-5">
          <Search
            size={19}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            className="w-full rounded-xl border border-line bg-surface py-3.5 pl-12 pr-11 text-[15px] text-ink shadow-sm outline-none transition placeholder:text-muted hover:border-line-strong focus:border-brand focus:ring-2 focus:ring-brand/20"
            placeholder="Search maps"
            aria-label="Search maps"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {searching ? (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition hover:text-ink"
              title="Clear the search"
              aria-label="Clear the search"
              onClick={() => setQuery('')}
            >
              <X size={17} />
            </button>
          ) : null}
        </div>

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
            <h2 className="text-sm font-semibold text-ink">No maps yet</h2>
            <p className="mt-1 max-w-xs text-[13px] text-muted">
              A map holds as many pages of cards, tables, videos and links as your course needs.
            </p>
            <button
              type="button"
              className="cc-btn mt-4"
              data-variant="primary"
              disabled={creating}
              onClick={() => void create()}
            >
              <Plus size={14} /> New map
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
        ) : view === 'grid' ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map(({ document: doc, role }) => (
              <li key={doc.id}>
                <WorkspaceCard
                  doc={doc}
                  role={role}
                  onOpen={() => onOpenDocument(doc.id)}
                  onEdit={() => setEditingId(doc.id)}
                />
              </li>
            ))}
          </ul>
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

/**
 * The grid view's tile.
 *
 * A grid earns its place by showing the *colour and icon*, which a row can only
 * hint at. So on a tile they are the decoration rather than hidden — that is the
 * whole reason to switch to this view, and hiding them here as well would leave
 * two identical layouts.
 *
 * Editing is a separate mode reached from the row view, and a tile's edit button
 * switches to it rather than editing in place: a tile is too small to hold a
 * colour picker and a text field without becoming something else.
 */
function WorkspaceCard({
  doc,
  role,
  onOpen,
  onEdit,
}: {
  doc: SharedDocument['document']
  role: SharedDocument['role']
  onOpen: () => void
  onEdit: () => void
}) {
  const accent = getWorkspaceAccent(doc.accent)

  return (
    <div
      className="group relative flex h-full flex-col rounded-xl border border-line bg-surface p-3 text-left shadow-sm transition hover:border-line-strong hover:shadow-md"
      style={{ borderTopColor: accent.base, borderTopWidth: 2 }}
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
      <div className="mb-2 flex items-start justify-between gap-2">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
          style={{ background: accent.soft, color: accent.ink }}
          title={getWorkspaceIconLabel(doc.icon)}
        >
          <WorkspaceMark icon={doc.icon} accent={doc.accent} size={16} />
        </span>
        {role === 'owner' ? (
          <button
            type="button"
            className="cursor-pointer rounded p-1.5 text-muted transition hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            title="Rename, recolour and re-icon"
            aria-label={`Edit ${doc.title}`}
            onClick={(event) => {
              event.stopPropagation()
              onEdit()
            }}
          >
            <Pencil size={14} />
          </button>
        ) : null}
      </div>

      <span className="block min-w-0 flex-1 truncate text-sm font-semibold text-ink">
        {doc.title}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
        <DocTypeBadge kind={doc.kind} />
        {role === 'owner' ? null : (
          <span className="cc-tag" title={`Shared with you as ${role}`}>
            {role === 'editor' ? 'Can edit' : 'View only'}
          </span>
        )}
      </span>
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
