import { useEffect, useRef, useState } from 'react'
import { FileText, Layers, Play, StickyNote } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'
import type { CardType } from '@/types'
import {
  CARD_TYPES,
  embedFor,
  guessCardType,
  isCardType,
  safeEmbedUrl,
  youtubeThumbnailUrl,
  youtubeVideoId,
} from '@/utils/embeds'

/**
 * Insert a card of a chosen kind.
 *
 * One dialog rather than three, because the work is the same for each: pick a
 * kind, give it a link, drop it on the canvas. Asking for the kind first and the
 * link second would mean three near-identical dialogs.
 *
 * The kind is *guessed* from whatever is pasted. Somebody pasting a YouTube link
 * has already said what they want, and being asked to choose a type first is
 * the kind of question a form should answer on its own.
 */

let request: { x: number; y: number; type: CardType | null } | null = null
let notify: (() => void) | null = null

/**
 * Ask the dialog to open.
 *
 * `type` is a suggestion, not a decision: the link still gets the last word, so
 * a YouTube URL pasted into a card meant to be a PDF turns it into a video. Only
 * `note` and `flash` are ever locked, because nothing about a link can make a
 * note a video.
 */
export function openInsertCard(x: number, y: number, type: CardType | null = null): void {
  request = { x, y, type }
  notify?.()
}

const ICONS = { note: StickyNote, flash: Layers, youtube: Play, pdf: FileText }

export function InsertCardDialog() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<CardType>('youtube')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const urlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    notify = () => {
      // A kind chosen on the way in wins over the previous value, so opening
      // "PDF" after a "Video" does not start from the wrong field.
      if (request?.type) setType(request.type)
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

  const guessed = url.trim() ? guessCardType(url.trim()) : null
  const effective: CardType = guessed ?? type
  const Icon = ICONS[effective]
  // A note and a flash card are made of text, so there is nothing to ask for.
  // Only the two kinds that point at something need a link to point with.
  const needsUrl = effective === 'youtube' || effective === 'pdf'
  const valid = !needsUrl || (effective === 'youtube' ? !!youtubeVideoId(url) : !!safeEmbedUrl(url))

  const insert = () => {
    const at = request
    request = null
    setOpen(false)
    setUrl('')
    setTitle('')

    const built = embedFor(effective, url, title)
    const store = useCanvasStore.getState()

    if (needsUrl && !valid) {
      store.pushToast(
        effective === 'youtube'
          ? 'That is not a YouTube link, so no video card was created.'
          : 'That is not a web address, so no card was created.',
        'error',
      )
      return
    }

    const id = store.addCard({
      type: built.type,
      title: built.title,
      content: '',
      embed: built.embed,
    })

    // A note or a flash card is nothing but text, so it starts empty and waits
    // to be typed into — selecting it means the next thing you do is type. A
    // video or PDF starts with its link in place, which is the only reason to
    // have made it, so it is left unselected rather than inviting typing.
    if (id && !needsUrl) {
      store.selectCards([id])
    }
    void at
  }

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
        aria-label="Insert a card"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Icon size={15} className="text-brand" />
          <h2 className="text-sm font-bold text-ink-strong">Insert a card</h2>
        </div>

        <div className="space-y-3 px-4 py-3">
          <div>
            <span className="cc-label">Kind</span>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              {CARD_TYPES.map((option) => {
                const OptionIcon = ICONS[option.id]
                const active = effective === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setType(option.id)
                      if (option.id === 'note') setUrl('')
                    }}
                    disabled={!!guessed && guessed !== option.id}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] transition disabled:opacity-40 ${
                      active
                        ? 'border-brand bg-brand-soft font-semibold text-brand-ink'
                        : 'border-line hover:bg-surface-alt'
                    }`}
                    title={guessed && guessed !== option.id ? `${option.label} — overridden by the link` : option.hint}
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
              <span className="cc-label">
                {effective === 'youtube' ? 'YouTube link' : 'PDF link'}
              </span>
              <input
                ref={urlRef}
                className="cc-input mt-1 w-full"
                placeholder={
                  effective === 'youtube'
                    ? 'https://youtube.com/watch?v=…'
                    : 'https://example.com/lecture.pdf'
                }
                value={url}
                onChange={(event) => {
                  const next = event.target.value
                  setUrl(next)
                  // Guessing while typing is only useful once there is enough to
                  // go on, and it must never fight the reader: a half-typed link
                  // that happens to parse should not change the kind under them.
                  if (next.trim().length > 8) {
                    const guess = guessCardType(next.trim())
                    if (isCardType(guess) && guess !== 'note') setType(guess)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && valid) insert()
                }}
              />
              {url.trim() && !valid ? (
                <p className="mt-1 text-[11px] text-danger">
                  {effective === 'youtube'
                    ? 'No video id found in that link.'
                    : 'That is not an http(s) address.'}
                </p>
              ) : null}
              {effective === 'youtube' && youtubeThumbnailUrl(url) ? (
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
              placeholder={effective === 'note' ? 'New card' : ''}
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
