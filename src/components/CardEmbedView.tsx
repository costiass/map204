import { useState } from 'react'
import { ExternalLink, FileText, Play } from 'lucide-react'

import type { Card } from '@/types'
import {
  embedHost,
  safeEmbedUrl,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
  youtubeVideoId,
} from '@/utils/embeds'

/**
 * The body of a card that points at something: a YouTube video, or a PDF.
 *
 * Two rules, both about not trusting a pasted URL:
 *
 *   * a URL is only ever loaded in an iframe after `safeEmbedUrl` has confirmed
 *     it is http(s). `javascript:` and `data:` parse as URLs, and putting either
 *     in an `src` is code execution in the reader's session.
 *   * a YouTube player URL is *built* from the extracted video id, never taken
 *     from the card. A card that says it is a video but points somewhere else
 *     shows a link, not that somewhere.
 *
 * A note renders neither, so this is only mounted for the other two kinds.
 */
export function CardEmbedView({ card }: { card: Card }) {
  if (card.type === 'youtube') return <YouTubeEmbed card={card} />
  if (card.type === 'pdf') return <PdfEmbed card={card} />
  return null
}

function YouTubeEmbed({ card }: { card: Card }) {
  const url = card.embed?.url ?? ''
  const [playing, setPlaying] = useState(false)

  const player = youtubeEmbedUrl(url, Number(card.embed?.meta?.start) || null)
  const thumbnail = youtubeThumbnailUrl(url)
  const videoId = youtubeVideoId(url)

  if (!videoId) {
    return (
      <BrokenLink
        card={card}
        reason="That does not look like a YouTube link."
        fallback={url}
      />
    )
  }

  // A thumbnail first, and the player only once asked for. Every visible video
  // on a page would otherwise be a live YouTube iframe — a dozen third-party
  // documents, each running its own player, on a canvas that is meant to stay
  // light.
  if (!playing) {
    return (
      <button
        type="button"
        data-no-drag=""
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setPlaying(true)}
        className="group relative block w-full cursor-pointer overflow-hidden rounded-lg border border-line bg-black"
        style={{ aspectRatio: '16 / 9' }}
        title="Play this video"
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            draggable={false}
            className="h-full w-full object-cover opacity-85 transition group-hover:opacity-100"
          />
        ) : null}
        <span className="absolute inset-0 grid place-items-center">
          <span
            className="grid h-11 w-11 place-items-center rounded-full"
            style={{ background: '#e11d48' }}
          >
            <Play size={20} className="ml-0.5 text-white" fill="currentColor" />
          </span>
        </span>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          Watch on YouTube
        </span>
      </button>
    )
  }

  return (
    <div
      data-no-drag=""
      className="w-full overflow-hidden rounded-lg border border-line bg-black"
      style={{ aspectRatio: '16 / 9' }}
    >
      <iframe
        src={player ?? undefined}
        title={card.title || 'YouTube video'}
        className="h-full w-full"
        allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
        allowFullScreen
        // The thumbnail was ours; the player is not. Saying so keeps the app out
        // of the reader's business about what they watch.
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

function PdfEmbed({ card }: { card: Card }) {
  const url = card.embed?.url ?? ''
  const safe = safeEmbedUrl(url)
  const [inline, setInline] = useState(false)

  if (!safe) {
    return (
      <BrokenLink card={card} reason="That does not look like a web address." fallback={url} />
    )
  }

  return (
    <div data-no-drag="" className="space-y-1.5">
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(event) => event.stopPropagation()}
        className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[12px] no-underline transition hover:bg-surface-sunken"
        style={{ color: 'inherit' }}
        title={safe}
      >
        <FileText size={15} className="shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate font-medium">{embedHost(safe)}</span>
        <ExternalLink size={13} className="shrink-0 opacity-50" />
      </a>

      {/* Reading a PDF in a frame needs the server to allow it, and many do
          not. So the preview is opt-in and a refusal falls back to the link
          rather than an empty box. */}
      {inline ? (
        <iframe
          src={safe}
          title={card.title || 'PDF'}
          className="h-56 w-full rounded-lg border border-line"
          onError={() => setInline(false)}
        />
      ) : (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setInline(true)}
          className="w-full cursor-pointer rounded-md border border-line px-2 py-1 text-[11px] opacity-70 transition hover:opacity-100"
          style={{ color: 'inherit' }}
        >
          Preview here
        </button>
      )}
    </div>
  )
}

function BrokenLink({
  card,
  reason,
  fallback,
}: {
  card: Card
  reason: string
  fallback: string
}) {
  const safe = safeEmbedUrl(fallback)
  return (
    <div
      data-no-drag=""
      className="rounded-lg border border-dashed border-line px-2.5 py-2 text-[12px]"
    >
      <p className="font-medium opacity-80">{reason}</p>
      {safe ? (
        <a
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={(event) => event.stopPropagation()}
          className="mt-0.5 block truncate no-underline opacity-60 underline"
          style={{ color: 'inherit' }}
        >
          {safe}
        </a>
      ) : (
        <p className="mt-0.5 opacity-50">
          {card.title ? 'Open the inspector to set a link for this card.' : 'No link set.'}
        </p>
      )}
    </div>
  )
}
