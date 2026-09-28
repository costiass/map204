import { useState } from 'react'
import { ExternalLink, FileText, Play } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'

import type { PdfElement, VideoElement } from '@/types'
import {
  embedHost,
  safeEmbedUrl,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
  youtubeThumbnailUrlFor,
  youtubeVideoId,
  aspectFromThumbnail,
} from '@/utils/embeds'

/**
 * The body of an element that points at something: a YouTube video, or a PDF.
 *
 * In version 1 a card carried an optional `embed`, and *this component* decided
 * what to draw from the card's `type`. In version 2 a video and a PDF are kinds
 * in their own right with their own payloads, so there is no embed to interpret
 * and no type to switch on here — the caller already knows which it has.
 *
 * Two rules, both about not trusting a pasted URL:
 *
 *   * a URL is only ever loaded in an iframe after `safeEmbedUrl` has confirmed
 *     it is http(s). `javascript:` and `data:` parse as URLs, and putting either
 *     in an `src` is code execution in the reader's session.
 *   * a YouTube player URL is *built* from the extracted video id, never taken
 *     from the element. A video element that points somewhere that is not a
 *     video shows a link, not that somewhere.
 */
export function CardEmbedView({ element }: { element: VideoElement | PdfElement }) {
  if (element.kind === 'video') return <VideoView element={element} />
  return <PdfView element={element} />
}

function VideoView({ element }: { element: VideoElement }) {
  const [playing, setPlaying] = useState(false)

  // The element's own `display` says whether it wants a live player. A document
  // set to "player" starts playing; the default is a thumbnail, because a page
  // of ten videos is ten third-party iframes and a canvas that is meant to stay
  // light.
  const wantsPlayer = element.display === 'player'

  const player = youtubeEmbedUrl(element.url, element.startSeconds)
  const videoId = youtubeVideoId(element.url)
  // `maxresdefault` is the video's own shape; the older sizes are 4:3 with
  // letterbox bars, which is how the element used to end up 4:3 and cropping
  // every video in it. The image falls back on its own if that size does not
  // exist for this video.
  const thumbnail = youtubeThumbnailUrlFor(element.url) ?? youtubeThumbnailUrl(element.url)
  const learnVideoAspect = useCanvasStore((s) => s.learnVideoAspect)

  if (!videoId) {
    return (
      <BrokenLink
        title={element.title}
        reason="That does not look like a YouTube link."
        fallback={element.url}
      />
    )
  }

  if (!playing && !wantsPlayer) {
    return (
      <button
        type="button"
        data-no-drag=""
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setPlaying(true)}
        // No padding, no border, no radius: the video *is* the element, edge to
        // edge. Anything inset turns it into "a video inside a card", which is
        // what the padding did — a grey frame around a picture, with the element's
        // own colour in a stripe you could not remove.
        className="group relative block h-full w-full cursor-pointer overflow-hidden bg-black"
        style={element.aspect ? { aspectRatio: `${element.aspect}` } : undefined}
        title="Play this video"
      >
        {/*
          `object-cover`, and that is only safe because the box is the video's
          shape.

          Cover crops whatever does not fit, which is why it was wrong before: the
          element was a fixed 16:9 and the thumbnail was letterboxed inside it, so
          cover cut the sides off. Now the element's aspect is the video's real
          aspect, learned from the thumbnail, and the two agree — so cover fills
          without cropping anything.

          If the aspect is not yet known there is no `aspect-ratio` on the box, so
          the image's own shape sizes it and there is nothing to crop against.
        */}
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            draggable={false}
            // The real shape, learned from the thumbnail. `onLoad` because the
            // dimensions are not knowable before it has loaded, and reading the
            // element's own size would just measure the box we are trying to fix.
            onLoad={(event) => {
              const measured = aspectFromThumbnail(event.currentTarget)
              if (measured && Math.abs(measured - (element.aspect ?? 0)) > 0.02) {
                // Written straight to the element rather than through the store:
                // this is a correction to a derived fact, not an edit the person
                // made, and it must not land in the undo history.
                learnVideoAspect(element.id, measured)
              }
            }}
            className="h-full w-full object-cover opacity-95 transition group-hover:opacity-100"
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
      style={{ aspectRatio: `${element.aspect || 16 / 9}` }}
    >
      <iframe
        src={player ?? undefined}
        title={element.title || 'YouTube video'}
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

function PdfView({ element }: { element: PdfElement }) {
  const safe = safeEmbedUrl(element.url)
  // `display: 'preview'` is the element's own standing instruction to show the
  // document rather than only link to it. The toggle below is for the rest.
  const [inline, setInline] = useState(element.display === 'preview')

  if (!safe) {
    return (
      <BrokenLink
        title={element.title}
        reason="That does not look like a web address."
        fallback={element.url}
      />
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
          title={element.title || 'PDF'}
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

/**
 * Something was expected here and there is nothing to show.
 *
 * The URL is shown as *text* when it is safe to link, and never loaded — a
 * `javascript:` url that was pasted is worth seeing, because knowing what a file
 * tried to do is the whole point of showing it.
 */
function BrokenLink({
  title,
  reason,
  fallback,
}: {
  title: string
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
          {title ? 'Open the inspector to set a link for this element.' : 'No link set.'}
        </p>
      )}
    </div>
  )
}
