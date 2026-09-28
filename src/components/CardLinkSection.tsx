import { FileText, Play, StickyNote } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'
import type { Card, CardType } from '@/types'
import { CARD_TYPES, safeEmbedUrl, youtubeVideoId } from '@/utils/embeds'

const ICONS = { note: StickyNote, youtube: Play, pdf: FileText }

/**
 * The kind of a card, and what it points at.
 *
 * Editing the link matters as much as setting it: a card is usually created
 * before you know the video, or created with the wrong one, and a card whose
 * only remedy is "delete it and start again" loses whatever else was on it.
 *
 * Switching a card to a note keeps the link in the body rather than dropping it,
 * so nothing disappears on a misclick.
 */
export function CardLinkSection({ card }: { card: Card }) {
  const updateCard = useCanvasStore((s) => s.updateCard)
  const pushToast = useCanvasStore((s) => s.pushToast)

  const setType = (type: CardType) => {
    if (type === card.type) return
    if (type === 'note') {
      const body = card.embed?.url ? `\`\`\`\n${card.embed.url}\n\`\`\`` : card.content
      updateCard(card.id, { type: 'note', embed: null, content: body || card.content })
      return
    }
    updateCard(card.id, { type, embed: card.embed ?? { url: '' } })
  }

  const url = card.embed?.url ?? ''
  const valid =
    card.type === 'note' ||
    (card.type === 'youtube' ? !!youtubeVideoId(url) : !!safeEmbedUrl(url))

  return (
    <section className="border-b border-line px-3 py-2.5">
      <p className="cc-label">Kind</p>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {CARD_TYPES.map((option) => {
          const Icon = ICONS[option.id]
          const active = card.type === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setType(option.id)}
              className={`flex flex-col items-center gap-0.5 rounded-md border px-1.5 py-1.5 text-[11px] transition ${
                active
                  ? 'border-brand bg-brand-soft font-semibold text-brand-ink'
                  : 'border-line hover:bg-surface-alt'
              }`}
            >
              <Icon size={13} />
              {option.label}
            </button>
          )
        })}
      </div>

      {card.type !== 'note' ? (
        <div className="mt-2">
          <p className="cc-label">{card.type === 'youtube' ? 'YouTube link' : 'PDF link'}</p>
          <input
            className="cc-input mt-1 w-full text-xs"
            placeholder={card.type === 'youtube' ? 'https://youtube.com/watch?v=…' : 'https://…/file.pdf'}
            defaultValue={url}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const next = event.currentTarget.value.trim()
              updateCard(card.id, { embed: { ...(card.embed ?? { url: '' }), url: next } })
            }}
            onBlur={(event) => {
              const next = event.currentTarget.value.trim()
              if (next === url) return
              updateCard(card.id, { embed: { ...(card.embed ?? { url: '' }), url: next } })
            }}
          />
          {url && !valid ? (
            <button
              type="button"
              className="mt-1 text-[11px] text-danger"
              onClick={() => pushToast('That link is not a valid address for this kind.', 'error')}
            >
              {card.type === 'youtube'
                ? 'No video id in that link — the card will show a link instead.'
                : 'Not an http(s) address — the card will show a link instead.'}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
