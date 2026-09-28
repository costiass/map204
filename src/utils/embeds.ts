import type { CardEmbed, CardType } from '@/types'

/**
 * Everything a card that points at something else needs to know about that URL.
 *
 * The rule throughout: **never put an unchecked string into an `iframe src`.**
 * A card body is Markdown and is sanitised on render, but an embed is a live
 * third-party document loaded straight into the page, so `javascript:` and
 * `data:` are not merely invalid here — they are a way to run code in someone's
 * session by pasting a link into a card. Every path below therefore returns either
 * a string built from a known host, or nothing at all.
 */

/* ------------------------------------------------------------------ */
/* Generic URLs                                                         */
/* ------------------------------------------------------------------ */

const SAFE_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * A URL safe to put in an `iframe src`, or `null`.
 *
 * `new URL` throws on anything that is not a URL at all, which is most of what a
 * paste buffer contains — a relative path, a bare word, `javascript:alert(1)`.
 * The protocol allowlist then rejects the schemes that survive parsing.
 */
export function safeEmbedUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    // A bare domain with no scheme is the common paste; assume https rather than
    // rejecting it, because "example.com/a.pdf" is a reasonable thing to type.
    try {
      parsed = new URL(`https://${trimmed}`)
    } catch {
      return null
    }
  }

  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null
  if (!parsed.hostname.includes('.')) return null
  return parsed.toString()
}

/** The hostname, for a card to show where it points. */
export function embedHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Does this URL look like a PDF? Used to offer the right card kind. */
export function looksLikePdf(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return path.endsWith('.pdf') || url.toLowerCase().includes('.pdf?')
  } catch {
    return /\.pdf(\?|#|$)/i.test(url)
  }
}

/* ------------------------------------------------------------------ */
/* YouTube                                                              */
/* ------------------------------------------------------------------ */

// The one host an embed is ever built from. A YouTube card whose URL points
// anywhere else is shown as a link, not loaded.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

/** A YouTube id is exactly 11 characters from a fixed alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * The video id in a YouTube URL, or `null`.
 *
 * Handles the shapes a paste actually arrives in: a watch URL, a short
 * `youtu.be` link, an `/embed/` or `/shorts/` path, and any of them carrying
 * extra parameters. A bare 11-character id on its own is accepted too, since
 * that is what the insert field will have half-filled while you are typing.
 */
export function youtubeVideoId(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  if (VIDEO_ID.test(trimmed)) return trimmed

  let parsed: URL
  try {
    parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return null

  // youtu.be/<id>
  const short = parsed.pathname.split('/').filter(Boolean)[0]
  if (parsed.hostname.toLowerCase().endsWith('youtu.be') && short && VIDEO_ID.test(short)) {
    return short
  }

  // watch?v=<id>
  const v = parsed.searchParams.get('v')
  if (v && VIDEO_ID.test(v)) return v

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const segments = parsed.pathname.split('/').filter(Boolean)
  const marker = segments[0]
  if (
    (marker === 'embed' || marker === 'shorts' || marker === 'live' || marker === 'v') &&
    segments[1] &&
    VIDEO_ID.test(segments[1])
  ) {
    return segments[1]
  }

  return null
}

/** The `t=90` in a YouTube URL, in seconds, or `null`. */
export function youtubeStartSeconds(raw: string): number | null {
  try {
    const parsed = new URL(raw)
    const t = parsed.searchParams.get('t') ?? parsed.searchParams.get('start')
    if (!t) return null
    // Accept `1m30s` as well as a plain number.
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t)
    if (!match) return null
    const [, h, m, s] = match
    const total = Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)
    return total > 0 ? total : null
  } catch {
    return null
  }
}

/**
 * The player URL for a card, or `null` if this is not a YouTube link.
 *
 * Built from the *known* host and the extracted id, never from the pasted URL,
 * so the iframe can only ever point at YouTube.
 */
export function youtubeEmbedUrl(url: string, startSeconds?: number | null): string | null {
  const id = youtubeVideoId(url)
  if (!id) return null
  const start = startSeconds ?? youtubeStartSeconds(url)
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  })
  if (start) params.set('start', String(Math.floor(start)))
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`
}

/** A thumbnail for a video, which is far cheaper than loading the player. */
export function youtubeThumbnailUrl(url: string): string | null {
  const id = youtubeVideoId(url)
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
}

/** The watch URL, for "open on YouTube". */
export function youtubeWatchUrl(url: string): string {
  const id = youtubeVideoId(url)
  return id ? `https://www.youtube.com/watch?v=${id}` : url
}

/* ------------------------------------------------------------------ */
/* Choosing a kind                                                      */
/* ------------------------------------------------------------------ */

export const CARD_TYPES: Array<{ id: CardType; label: string; hint: string }> = [
  { id: 'note', label: 'Note', hint: 'A title and some Markdown' },
  { id: 'flash', label: 'Flash', hint: 'Two sides, turns over on click' },
  { id: 'youtube', label: 'Video', hint: 'A YouTube link, played in place' },
  { id: 'pdf', label: 'PDF', hint: 'A document, referenced by link' },
]

export function isCardType(value: unknown): value is CardType {
  return value === 'note' || value === 'flash' || value === 'youtube' || value === 'pdf'
}

/** The kind a pasted URL most likely wants to be. */
export function guessCardType(url: string): CardType {
  if (youtubeVideoId(url)) return 'youtube'
  if (looksLikePdf(url)) return 'pdf'
  return 'note'
}

/**
 * A card, ready to drop on the canvas, pointing at `url` as `type`.
 *
 * Called with whatever the user pasted, so the kind is inferred and a title is
 * taken from the URL when they did not give one.
 */
export function embedFor(type: CardType, rawUrl: string, title?: string): {
  type: CardType
  embed: CardEmbed | null
  title: string
} {
  if (type === 'note' || type === 'flash') {
    return { type, embed: null, title: title?.trim() || (type === 'flash' ? 'Question' : 'Untitled card') }
  }

  const url = (rawUrl ?? '').trim()
  const id = type === 'youtube' ? youtubeVideoId(url) : null

  if (type === 'youtube' && !id) {
    // Not a YouTube link, so it is not a video card. Falling back to a note keeps
    // the pasted link in the body rather than dropping it.
    return {
      type: 'note',
      embed: null,
      title: title?.trim() || 'Untitled card',
    }
  }

  const meta: Record<string, string | number | boolean> = {}
  const start = youtubeStartSeconds(url)
  if (type === 'youtube' && start) meta.start = start

  return {
    type,
    embed: { url, ...(Object.keys(meta).length > 0 ? { meta } : {}) },
    title: title?.trim() || (type === 'youtube' ? `Video ${id}` : embedHost(url) || 'Document'),
  }
}
