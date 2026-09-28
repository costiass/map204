import { useCanvasStore } from '@/store/useCanvasStore'
import { Section } from '@/components/EditorParts'
import { type Element } from '@/types'
import { safeEmbedUrl, youtubeThumbnailUrl, youtubeVideoId } from '@/utils/embeds'

/**
 * The inspector for a kind that is not a note.
 *
 * A note has a Markdown page, a checklist, tags, an image and a style, and
 * `CardContentTab` is built around all of that. None of it applies to a video, a
 * PDF, a flash deck or a table, so rather than showing six controls that do
 * nothing this asks the one question each of those kinds actually has.
 *
 * The note tabs are not hidden behind a flag — a kind that is not a note does not
 * have a body, a checklist or a style, and pretending otherwise is how an
 * inspector ends up writing fields no renderer reads.
 */
export function ElementInspectorTab({ element }: { element: Element }) {
  const updateElement = useCanvasStore((s) => s.updateElement)
  const flushCommit = useCanvasStore((s) => s.flushCommit)

  switch (element.kind) {
    case 'video':
      return <VideoInspector element={element} onChange={updateElement} onCommit={flushCommit} />
    case 'pdf':
      return <PdfInspector element={element} onChange={updateElement} onCommit={flushCommit} />
    case 'flash':
      return <FlashInspector element={element} onChange={updateElement} onCommit={flushCommit} />
    case 'table':
      return <TableInspector element={element} onChange={updateElement} onCommit={flushCommit} />
    default:
      return (
        <div className="cc-scroll flex-1 overflow-y-auto p-3">
          <p className="text-[12px] text-slate-500">
            A {element.kind} element is not implemented yet. Its title can be changed
            above.
          </p>
        </div>
      )
  }
}

type Patch = (id: string, patch: Record<string, unknown>, options?: { silent?: boolean }) => void
type Commit = () => void

function VideoInspector({
  element,
  onChange,
  onCommit,
}: {
  element: Extract<Element, { kind: 'video' }>
  onChange: Patch
  onCommit: Commit
}) {
  const id = youtubeVideoId(element.url)

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      <Section title="Video">
        <label className="block">
          <span className="cc-label">YouTube link</span>
          <input
            className="cc-input mt-1 w-full"
            value={element.url}
            placeholder="https://youtube.com/watch?v=…"
            onChange={(event) =>
              onChange(
                element.id,
                { url: event.target.value },
                { silent: event.target.value !== element.url },
              )
            }
            onBlur={onCommit}
          />
        </label>

        {/* A link that is not a video is the single most likely mistake here, and
            it is invisible until the element renders as an empty black box. So it
            is said here, where the link is being typed. */}
        {element.url.trim() && !id ? (
          <p className="mt-1.5 text-[11px] text-danger">
            No video id in that link, so this element has nothing to play. It will show
            the address instead.
          </p>
        ) : null}

        {id ? (
          <img
            src={youtubeThumbnailUrl(element.url) ?? ''}
            alt=""
            className="mt-2 h-20 w-36 rounded border border-line object-cover"
          />
        ) : null}

        {element.startSeconds ? (
          <p className="mt-1.5 text-[11px] text-slate-500">
            Starts at {Math.floor(element.startSeconds / 60)}:
            {String(element.startSeconds % 60).padStart(2, '0')}, from the link.
          </p>
        ) : null}
      </Section>

      <Section title="How it shows">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className="cc-btn"
            data-variant={element.display === 'thumbnail' ? 'primary' : undefined}
            onClick={() => onChange(element.id, { display: 'thumbnail' })}
          >
            Thumbnail
          </button>
          <button
            type="button"
            className="cc-btn"
            data-variant={element.display === 'player' ? 'primary' : undefined}
            onClick={() => onChange(element.id, { display: 'player' })}
          >
            Player
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          A thumbnail is a picture on the canvas. A player is a live YouTube frame, and
          a page of them is a page of third-party documents.
        </p>
      </Section>

      <Section title="Shape">
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={element.keepAspect}
            onChange={(event) => onChange(element.id, { keepAspect: event.target.checked })}
          />
          Keep the video's shape when resizing
        </label>
        {element.aspect ? (
          <p className="mt-1 text-[11px] text-slate-500">
            Currently {element.aspect.toFixed(2)}:1, learned from the link.
          </p>
        ) : null}
      </Section>
    </div>
  )
}

function PdfInspector({
  element,
  onChange,
  onCommit,
}: {
  element: Extract<Element, { kind: 'pdf' }>
  onChange: Patch
  onCommit: Commit
}) {
  const safe = safeEmbedUrl(element.url)

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      <Section title="Document">
        <label className="block">
          <span className="cc-label">Link</span>
          <input
            className="cc-input mt-1 w-full"
            value={element.url}
            placeholder="https://example.com/lecture.pdf"
            onChange={(event) =>
              onChange(element.id, { url: event.target.value }, { silent: true })
            }
            onBlur={onCommit}
          />
        </label>
        {element.url.trim() && !safe ? (
          <p className="mt-1.5 text-[11px] text-danger">
            That is not an http(s) address, so it will not be linked.
          </p>
        ) : null}
        <p className="mt-1.5 text-[11px] text-slate-500">
          An uploaded file takes this element's place when it is set. The link is kept
          as the fallback.
        </p>
      </Section>

      <Section title="How it shows">
        <div className="grid grid-cols-3 gap-1.5">
          {(['chip', 'preview', 'open'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="cc-btn"
              data-variant={element.display === mode ? 'primary' : undefined}
              onClick={() => onChange(element.id, { display: mode })}
            >
              {mode === 'chip' ? 'Link' : mode === 'preview' ? 'Preview' : 'Open'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Note">
        <textarea
          className="cc-input mt-1 w-full"
          rows={3}
          value={element.note}
          placeholder="Shown under the document, and always available."
          onChange={(event) => onChange(element.id, { note: event.target.value }, { silent: true })}
          onBlur={onCommit}
        />
      </Section>
    </div>
  )
}

function FlashInspector({
  element,
  onChange,
  onCommit,
}: {
  element: Extract<Element, { kind: 'flash' }>
  onChange: Patch
  onCommit: Commit
}) {
  const pair = element.cards[element.cardIndex] ?? element.cards[0]

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      <Section title={`Card ${element.cardIndex + 1} of ${element.cards.length}`}>
        <label className="block">
          <span className="cc-label">Question (front)</span>
          <textarea
            className="cc-input mt-1 w-full"
            rows={2}
            value={pair?.[0]?.text ?? ''}
            onChange={(event) =>
              onChange(
                element.id,
                { cards: replaceSide(element.cards, element.cardIndex, 0, event.target.value) },
                { silent: true },
              )
            }
            onBlur={onCommit}
          />
        </label>
        <label className="mt-2 block">
          <span className="cc-label">Answer (back)</span>
          <textarea
            className="cc-input mt-1 w-full"
            rows={4}
            value={pair?.[1]?.text ?? ''}
            onChange={(event) =>
              onChange(
                element.id,
                { cards: replaceSide(element.cards, element.cardIndex, 1, event.target.value) },
                { silent: true },
              )
            }
            onBlur={onCommit}
          />
        </label>
      </Section>

      <Section title="Deck">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className="cc-btn"
            onClick={() => onChange(element.id, { cards: [...element.cards, blankPair()] })}
          >
            + Add card
          </button>
          <button
            type="button"
            className="cc-btn"
            data-danger="true"
            disabled={element.cards.length <= 1}
            title={
              element.cards.length <= 1
                ? 'A deck needs at least one card, which cannot be stepped through'
                : 'Remove this card'
            }
            onClick={() =>
              onChange(element.id, {
                cards: element.cards.filter((_, i) => i !== element.cardIndex),
                cardIndex: Math.max(0, element.cardIndex - 1),
              })
            }
          >
            − Remove this card
          </button>
        </div>
        {element.cards.length <= 1 ? (
          <p className="mt-1.5 text-[11px] text-slate-500">
            A deck of one is a single card. Add a second to flick between them.
          </p>
        ) : null}
      </Section>

      <Section title="Behaviour">
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={element.hideAnswer}
            onChange={(event) => onChange(element.id, { hideAnswer: event.target.checked })}
          />
          Hide the answer until the card is turned over
        </label>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className="cc-btn"
            data-variant={element.presentation === 'single' ? 'primary' : undefined}
            onClick={() => onChange(element.id, { presentation: 'single' })}
          >
            One card
          </button>
          <button
            type="button"
            className="cc-btn"
            data-variant={element.presentation === 'carousel' ? 'primary' : undefined}
            onClick={() => onChange(element.id, { presentation: 'carousel' })}
          >
            Carousel
          </button>
        </div>
      </Section>
    </div>
  )
}

function TableInspector({
  element,
  onChange,
  onCommit,
}: {
  element: Extract<Element, { kind: 'table' }>
  onChange: Patch
  onCommit: Commit
}) {
  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      <Section title="Columns">
        {element.columns.map((column, index) => (
          <label key={column.id} className="mb-1.5 block">
            <span className="cc-label">Column {index + 1}</span>
            <input
              className="cc-input mt-1 w-full"
              value={column.title}
              onChange={(event) =>
                onChange(
                  element.id,
                  {
                    columns: element.columns.map((c, i) =>
                      i === index ? { ...c, title: event.target.value } : c,
                    ),
                  },
                  { silent: true },
                )
              }
              onBlur={onCommit}
            />
          </label>
        ))}
      </Section>

      <Section title="Rows">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="cc-btn"
            onClick={() => onChange(element.id, { rowCount: element.rowCount + 1 })}
          >
            + Row
          </button>
          <button
            type="button"
            className="cc-btn"
            disabled={element.rowCount <= 1}
            onClick={() => onChange(element.id, { rowCount: element.rowCount - 1 })}
          >
            − Row
          </button>
          <span className="text-[11px] text-slate-500">
            {element.rowCount} row{element.rowCount === 1 ? '' : 's'}
          </span>
        </div>
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Deck editing, kept out of the component above                       */
/* ------------------------------------------------------------------ */

function blankPair(): { id: string; text: string }[] {
  return [
    { id: `face_${Math.random().toString(36).slice(2, 10)}`, text: '' },
    { id: `face_${Math.random().toString(36).slice(2, 10)}`, text: '' },
  ]
}

/**
 * A deck with one side's text replaced, every other side untouched.
 *
 * Rebuilt rather than mutated because the store holds the deck inside an immer
 * draft, and a component that mutated the array it was handed would be editing
 * state behind the store's back — which does not mark the document dirty, so the
 * change would be lost on the next save.
 */
function replaceSide(
  cards: { id: string; text: string }[][],
  cardIndex: number,
  sideIndex: number,
  text: string,
): { id: string; text: string }[][] {
  return cards.map((pair, i) =>
    i === cardIndex
      ? pair.map((side, j) => (j === sideIndex ? { ...side, text } : side))
      : pair,
  )
}
