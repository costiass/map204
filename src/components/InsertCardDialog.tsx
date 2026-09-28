import { useEffect, useMemo, useRef, useState } from 'react'

import { useCanvasStore } from '@/store/useCanvasStore'
import { elementKind, insertableKinds } from '@/elements/registry'
import { guessKind, safeEmbedUrl, youtubeThumbnailUrl, youtubeVideoId } from '@/utils/embeds'

/**
 * Insert an element of a chosen kind.
 *
 * One dialog rather than one per kind, because the work is the same for each:
 * pick a kind, give it a link, drop it on the canvas. Asking for the kind first
 * and the link second would mean several near-identical dialogs.
 *
 * The kinds come from `elements/registry` — the same list the toolbar, the
 * context menu and the keyboard read — so this dialog cannot offer something the
 * canvas cannot store. That was the whole reason for moving the list out of this
 * codebase and into one place, and it is why the dialog has no icons of its own.
 *
 * The kind is *guessed* from whatever is pasted. Somebody pasting a YouTube link
 * has already said what they want, and being asked to choose a type first is the
 * kind of question a form should answer on its own.
 */

type InsertKind = string

let request: { x: number; y: number; kind: InsertKind | null } | null = null
let notify: (() => void) | null = null

/**
 * Ask the dialog to open.
 *
 * `kind` is a suggestion, not a decision: the link still gets the last word, so a
 * YouTube URL pasted where a PDF was going turns it into a video. Only a kind
 * that needs no link is ever locked, because nothing about a URL can make a note
 * a video.
 */
export function openInsertElement(x: number, y: number, kind: InsertKind | null = null): void {
  request = { x, y, kind }
  notify?.()
}

export function InsertCardDialog() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<InsertKind>('video')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const urlRef = useRef<HTMLInputElement>(null)

  // Only the kinds the model can actually store, and only the ones that are
  // *made* rather than containing. A menu that offers a table the data layer
  // cannot write is worse than a menu without it: it fails after the click.
  const kinds = useMemo(() => insertableKinds(), [])

  useEffect(() => {
    notify = () => {
      // A kind chosen on the way in wins over the previous value, so opening
      // "PDF" after a "Video" does not start from the wrong field.
      if (request?.kind) setKind(request.kind)
      setOpen(true)
      // Focus after paint, so the field is there to receive it.
      requestAnimationFrame(() => urlRef.current?.focus())
    }
    return () => {
      notify = null
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const guessed = url.trim() ? guessKind(url.trim()) : null
  const effective: InsertKind = guessed ?? kind
  const meta = elementKind(effective)
  const Icon = meta.icon

  // A kind that needs a source has nothing to show without one, so the form asks
  // for it. The registry knows which those are, rather than this file repeating
  // the list.
  const needsUrl = meta.needsSource

  const valid = !needsUrl || (effective === 'video' ? !!youtubeVideoId(url) : !!safeEmbedUrl(url))

  const insert = () => {
    request = null
    setOpen(false)
    setUrl('')
    setTitle('')

    const store = useCanvasStore.getState()

    if (needsUrl && !valid) {
      store.pushToast(
        effective === 'video'
          ? 'That is not a YouTube link, so no video was created.'
          : 'That is not a web address, so nothing was created.',
        'error',
      )
      return
    }

    // A title is only offered when there is a sensible default to suggest — a
    // video's comes from its id, a PDF's from its host, and both are better than
    // a blank field the reader has to fill in.
    const trimmedTitle = title.trim()
    const id = store.addElement(effective, {
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
      ...(needsUrl ? { url: url.trim() } : {}),
    })

    // A note or a flash deck is nothing but text, so it starts empty and waits to
    // be typed into — selecting it means the next thing you do is type. A video
    // or PDF starts with its link in place, which is the only reason to have made
    // it, so it is left unselected rather than inviting typing.
    if (id && !needsUrl) store.selectElements([id])
  }

  const urlLabel =
    effective === 'video' ? 'YouTube link' : effective === 'pdf' ? 'Document link' : 'Link'
  const urlPlaceholder =
    effective === 'video'
      ? 'https://youtube.com/watch?v=…'
      : 'https://example.com/lecture.pdf'

  return (
    <div
      className="cc-modal-backdrop"
      onPointerDown={() => {
        request = null
        setOpen(false)
      }}
    >
      <div
        className="cc-panel w-full max-w-md overflow-hidden"
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Insert an element"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Icon size={15} className="text-brand" />
          <h2 className="text-sm font-bold text-ink-strong">Insert an element</h2>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div>
            <span className="cc-label">Kind</span>
            <div
              className="mt-1 grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${Math.min(kinds.length, 4)}, minmax(0, 1fr))` }}
            >
              {kinds.map((option) => {
                const OptionIcon = option.icon
                const active = effective === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setKind(option.id)
                      if (!elementKind(option.id).needsSource) setUrl('')
                    }}
                    disabled={!!guessed && guessed !== option.id}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] transition disabled:opacity-40 ${
                      active
                        ? 'border-brand bg-brand-soft font-semibold text-brand-ink'
                        : 'border-line hover:bg-surface-alt'
                    }`}
                    title={
                      guessed && guessed !== option.id
                        ? `${option.label} — overridden by the link`
                        : option.blurb
                    }
                  >
                    <OptionIcon size={15} />
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          {needsUrl ? (
            <label className="block">
              <span className="cc-label">{urlLabel}</span>
              <input
                ref={urlRef}
                className="cc-input mt-1 w-full"
                placeholder={urlPlaceholder}
                value={url}
                onChange={(event) => {
                  const next = event.target.value
                  setUrl(next)
                  // Guessing while typing is only useful once there is enough to
                  // go on, and it must never fight the reader: a half-typed link
                  // that happens to parse should not change the kind under them.
                  if (next.trim().length > 8) {
                    const guess = guessKind(next.trim())
                    if (guess) setKind(guess)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && valid) insert()
                }}
              />
              {url.trim() && !valid ? (
                <p className="mt-1 text-[11px] text-danger">
                  {effective === 'video'
                    ? 'No video id found in that link.'
                    : 'That is not an http(s) address.'}
                </p>
              ) : null}
              {effective === 'video' && youtubeThumbnailUrl(url) ? (
                <img
                  src={youtubeThumbnailUrl(url) ?? ''}
                  alt=""
                  className="mt-2 h-20 w-36 rounded border border-line object-cover"
                />
              ) : null}
            </label>
          ) : null}

          <label className="block">
            <span className="cc-label">Title (optional)</span>
            <input
              className="cc-input mt-1 w-full"
              placeholder={needsUrl ? '' : 'Untitled'}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && valid) insert()
              }}
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            className="cc-btn"
            onClick={() => {
              request = null
              setOpen(false)
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cc-btn"
            data-variant="primary"
            disabled={!valid}
            onClick={insert}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  )
}
