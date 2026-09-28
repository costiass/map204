import { useCallback, useEffect, useState } from 'react'

import { IconTrash, IconUserPlus } from '@/components/Icons'
import { initialOf } from '@/store/presence'
import {
  addCollaborator,
  findProfileByEmail,
  getProfile,
  listCollaborators,
  notifyShare,
  removeCollaborator,
  updateCollaboratorRole,
  type CollaboratorRow,
  type DocumentRow,
  type ProfileRow,
} from '@/store/supabase-sync'
import { useCanvasStore } from '@/store/useCanvasStore'

interface ShareDialogProps {
  document: DocumentRow
  currentUserId: string
  onClose: () => void
}

interface Entry {
  userId: string
  role: CollaboratorRow['role']
  email: string | null
  name: string | null
  avatarUrl: string | null
  locked: boolean
}

const ROLES: Array<CollaboratorRow['role']> = ['editor', 'viewer']

/**
 * Share dialog — the four `document_collaborators` endpoints:
 * list, add, change role, remove. The owner is shown first and cannot be edited.
 */
export function ShareDialog({ document, currentUserId, onClose }: ShareDialogProps) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  // Only the two roles that can be *granted*. 'owner' is not a choice here — it
  // is whatever the document already has — so the type says so, rather than
  // widening to the stored role and letting a cast smuggle it through later.
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pushToast = useCanvasStore((s) => s.pushToast)

  const isOwner = document.owner_id === currentUserId

  const reload = useCallback(async () => {
    setLoading(true)
    const [collaborators, owner] = await Promise.all([
      listCollaborators(document.id),
      getProfile(document.owner_id),
    ])

    const next: Entry[] = [
      {
        userId: document.owner_id,
        role: 'owner',
        email: owner?.email ?? null,
        name: owner?.full_name ?? null,
        avatarUrl: owner?.avatar_url ?? null,
        locked: true,
      },
      ...collaborators
        .filter((row) => row.user_id !== document.owner_id)
        .map((row) => ({
          userId: row.user_id,
          role: row.role,
          email: row.profile?.email ?? null,
          name: row.profile?.full_name ?? null,
          avatarUrl: row.profile?.avatar_url ?? null,
          locked: false,
        })),
    ]

    setEntries(next)
    setLoading(false)
  }, [document.id, document.owner_id])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const invite = async () => {
    if (!isOwner) return
    const address = email.trim()
    if (!address) return

    setBusy(true)
    setInviteError(null)

    const profile: ProfileRow | null = await findProfileByEmail(address)
    if (!profile) {
      setInviteError('No Map204 account uses that email address.')
      setBusy(false)
      return
    }
    if (profile.id === document.owner_id) {
      setInviteError('That is you — you already own this workspace.')
      setBusy(false)
      return
    }
    if (entries.some((entry) => entry.userId === profile.id)) {
      setInviteError('That person already has access.')
      setBusy(false)
      return
    }

    const result = await addCollaborator(document.id, profile.id, role)
    setBusy(false)

    if (!result.ok) {
      setInviteError(result.error ?? 'Could not share this workspace.')
      return
    }
    setEmail('')

    // The grant is already stored, so the mail is a follow-up rather than part
    // of the operation. A failure is reported but never undoes the share, and
    // the dialog closes either way.
    pushToast(`Shared with ${profile.full_name ?? profile.email}.`, 'success')
    await reload()

    const sent = await notifyShare(document.id, address, role)
    if (!sent.ok) {
      pushToast(
        `${profile.full_name ?? profile.email} has access, but the email did not send: ${sent.error}`,
        'error',
      )
    }
  }

  const changeRole = async (userId: string, next: CollaboratorRow['role']) => {
    const result = await updateCollaboratorRole(document.id, userId, next)
    if (!result.ok) {
      pushToast(result.error ?? 'Could not change that role.', 'error')
      return
    }
    setEntries((current) =>
      current.map((entry) => (entry.userId === userId ? { ...entry, role: next } : entry)),
    )
  }

  const remove = async (userId: string) => {
    const result = await removeCollaborator(document.id, userId)
    if (!result.ok) {
      pushToast(result.error ?? 'Could not remove that person.', 'error')
      return
    }
    setEntries((current) => current.filter((entry) => entry.userId !== userId))
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="flex-1" />
      <aside
        className="flex h-full w-[clamp(20rem,28vw,26rem)] flex-col border-l border-line bg-surface shadow-lg bg-surface"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Share this workspace"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-ink-strong">
              Share “{document.title}”
            </h2>
            <p className="text-xs text-muted">
              {entries.length === 1 ? 'Only you have access' : `${entries.length} people have access`}
            </p>
          </div>
          <button type="button" className="cc-btn px-1.5 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {isOwner ? (
          <div className="border-b border-line px-5 py-4">
            <label
              htmlFor="share-invite-email"
              className="mb-2 block text-[13px] font-semibold text-ink"
            >
              Invite someone
            </label>

            {/* The email address is the only field a person has to think about,
                so it gets the size and the prominence. The role is a refinement
                with a sensible default, so it stays a quiet control underneath
                rather than competing for attention beside it. */}
            <input
              id="share-invite-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              className="cc-input w-full px-3 py-2.5 text-sm"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setInviteError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void invite()
              }}
            />

            <div className="mt-2 flex items-center gap-2">
              <select
                className="cc-input w-auto py-1 text-xs"
                value={role}
                onChange={(event) => setRole(event.target.value as 'editor' | 'viewer')}
                aria-label="What they can do"
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {value === 'editor' ? 'Can edit' : 'Can view'}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="cc-btn ml-auto"
                data-variant="primary"
                disabled={busy || !email.trim()}
                onClick={() => void invite()}
              >
                <IconUserPlus size={14} />
                {busy ? 'Inviting…' : 'Invite'}
              </button>
            </div>

            {inviteError ? (
              <p className="mt-2 text-xs text-danger">{inviteError}</p>
            ) : (
              <p className="mt-2 text-xs text-muted">
                They need an account already. We'll email them a link.
              </p>
            )}
          </div>
        ) : null}

        <ul className="cc-scroll flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <li className="px-2 py-4 text-sm text-muted">Loading…</li>
          ) : (
            entries.map((entry) => (
              <li
                key={entry.userId}
                className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-surface-alt"
              >
                {entry.avatarUrl ? (
                  <img
                    src={entry.avatarUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-[var(--cc-on-brand)]">
                    {initialOf(entry.name, entry.email)}
                  </div>
                )}

                {/* Who this is, is the point of the row — so it is set large and
                    the controls beside it are set small. */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink-strong">
                    {entry.name ?? entry.email ?? 'Unknown user'}
                    {entry.userId === currentUserId ? ' (you)' : ''}
                  </p>
                  {entry.email ? (
                    <p className="truncate text-xs text-muted">{entry.email}</p>
                  ) : null}
                </div>

                {entry.locked ? (
                  <span className="cc-tag shrink-0">Owner</span>
                ) : isOwner ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <select
                      className="cc-input w-auto py-0.5 text-[11px]"
                      value={entry.role}
                      onChange={(event) =>
                        void changeRole(entry.userId, event.target.value as CollaboratorRow['role'])
                      }
                      aria-label={`What ${entry.name ?? entry.email ?? 'this person'} can do`}
                    >
                      {ROLES.map((value) => (
                        <option key={value} value={value}>
                          {value === 'editor' ? 'Can edit' : 'Can view'}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="cursor-pointer rounded p-1 text-muted transition hover:bg-danger-soft hover:text-danger dark:hover:bg-danger-soft"
                      title="Remove access"
                      aria-label={`Remove ${entry.name ?? entry.email ?? 'this person'}`}
                      onClick={() => void remove(entry.userId)}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                ) : (
                  <span className="cc-tag shrink-0">{entry.role}</span>
                )}
              </li>
            ))
          )}
        </ul>

        <footer className="border-t border-line px-4 py-3 text-xs text-muted">
          {isOwner
            ? 'Editors can change everything on every page. Viewers can only look.'
            : 'Only the owner can add or remove people.'}
        </footer>
      </aside>
    </div>
  )
}
