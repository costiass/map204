import { useCanvasStore } from '@/store/useCanvasStore'
import { Section } from '@/components/EditorParts'
import { MAX_TABLE_COLUMNS, MIN_TABLE_COLUMNS, MIN_TABLE_ROWS } from '@/store/elementOps'
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
    case 'link':
      return <LinkInspector element={element} onChange={updateElement} onCommit={flushCommit} />
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

      {/* Was "Behaviour": it held a One card / Carousel choice that nothing read. */}
      <Section title="The answer">
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={element.hideAnswer}
            onChange={(event) => onChange(element.id, { hideAnswer: event.target.checked })}
          />
          Hide the answer until the card is turned over
        </label>
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
  const resizeTableRows = useCanvasStore((s) => s.resizeTableRows)
  const resizeTableColumns = useCanvasStore((s) => s.resizeTableColumns)

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      {/*
        Size, first, because it is what you reach for. Two steppers rather than a
        column list and a pair of buttons: with a list you can rename columns but
        not add one at all, which was the gap.

        Both go through the store's resize actions rather than `onChange`. Cells are
        stored column-major, so `rowCount` is the *stride* of the array and not its
        length -- patching it reinterprets every cell in the table. That is what the
        old "+ Row" button did, and it filled the table with the wrong answers
        rather than adding an empty row.
      */}
      <Section title="Size">
        <Stepper
          label="Columns"
          value={element.columns.length}
          min={MIN_TABLE_COLUMNS}
          max={MAX_TABLE_COLUMNS}
          onChange={(count) => resizeTableColumns(element.id, count)}
        />
        <Stepper
          label="Rows"
          value={element.rowCount}
          min={MIN_TABLE_ROWS}
          onChange={(count) => resizeTableRows(element.id, count)}
        />
      </Section>

      <Section title="How it shows">
        <Toggle
          label="Header row"
          hint="Style the first row as headings and repeat it if the table scrolls."
          checked={element.header}
          onChange={(header) => onChange(element.id, { header })}
        />
        <Toggle
          label="Borders"
          hint="Grid lines around every cell. Off leaves rules under the headings only."
          checked={element.borders}
          onChange={(borders) => onChange(element.id, { borders })}
        />
        <Toggle
          label="Striped rows"
          hint="Shade every other row, for reading across rather than down."
          checked={element.stripes}
          onChange={(stripes) => onChange(element.id, { stripes })}
        />
        <Toggle
          label="Editable on the canvas"
          hint="Type straight into the cells without opening the inspector."
          checked={element.editing}
          onChange={(editing) => onChange(element.id, { editing })}
        />
      </Section>

      <Section title="Columns">
        {element.columns.map((column, index) => (
          <label key={column.id} className="mb-1.5 block">
            <span className="cc-label">Column {index + 1}</span>
            <input
              className="cc-input mt-1 w-full"
              value={column.title}
              placeholder={`Column ${index + 1}`}
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
    </div>
  )
}

/**
 * A link, which had no inspector at all.
 *
 * `LinkElement` has had `display` and `show` since version 2 -- how the reference
 * is drawn, and whether a chip shows the host or the whole address. Neither was
 * editable, so they were fields with no way to reach them: a link that could only
 * ever look the way the default said.
 *
 * That is the same class of gap as the note's style being discarded at render time
 * (see `ElementNode`). A field nothing writes is not a feature, and an element you
 * cannot configure looks like it was not made by whoever made the others.
 */
function LinkInspector({
  element,
  onChange,
  onCommit,
}: {
  element: Extract<Element, { kind: 'link' }>
  onChange: Patch
  onCommit: Commit
}) {
  const safe = safeEmbedUrl(element.url)

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      <Section title="Link">
        <label className="block">
          <span className="cc-label">Address</span>
          <input
            className="cc-input mt-1 w-full"
            value={element.url}
            placeholder="https://example.com/lecture"
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
      </Section>

      <Section title="How it shows">
        <div className="grid grid-cols-3 gap-1.5">
          {(['preview', 'chip', 'open'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="cc-btn"
              data-variant={element.display === mode ? 'primary' : undefined}
              onClick={() => onChange(element.id, { display: mode })}
            >
              {mode === 'preview' ? 'Full' : mode === 'chip' ? 'Chip' : 'Text'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          Full shows the whole address. A chip is a small tag showing where it goes.
          Text is the address on its own, for a page of prose with links in it.
        </p>
      </Section>

      <Section title="In a chip">
        <div className="grid grid-cols-3 gap-1.5">
          {(['host', 'full', 'none'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="cc-btn"
              data-variant={element.show === mode ? 'primary' : undefined}
              onClick={() => onChange(element.id, { show: mode })}
            >
              {mode === 'host' ? 'Host' : mode === 'full' ? 'Full address' : 'Nothing'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          A long address is unreadable at chip size, so the host is the default.
        </p>
        {element.show === 'host' && !element.url.trim() ? (
          <p className="mt-1.5 text-[11px] text-slate-400">
            There is no address yet, so a chip will show nothing.
          </p>
        ) : null}
      </Section>

      <Section title="Note">
        <textarea
          className="cc-input mt-1 w-full"
          rows={3}
          value={element.note}
          placeholder="Shown under the link, and always available."
          onChange={(event) =>
            onChange(element.id, { note: event.target.value }, { silent: true })
          }
          onBlur={onCommit}
        />
      </Section>
    </div>
  )
}

/**
 * A count with a lower and an upper bound, as two buttons and the number.
 *
 * Buttons rather than a number input on purpose: a number field invites typing
 * 400, and the answer is then a table with 400 columns and 400 inputs in the
 * render tree. The bounds are visible in the disabled state instead of being a
 * clamp the user never sees happen.
 */
function Stepper({
  label,
  value,
  min,
  max = Number.MAX_SAFE_INTEGER,
  onChange,
}: {
  label: string
  value: number
  min: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="cc-label flex-1">{label}</span>
      <button
        type="button"
        className="cc-btn"
        aria-label={`One fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="w-6 text-center text-[11px] tabular-nums text-slate-600">{value}</span>
      <button
        type="button"
        className="cc-btn"
        aria-label={`One more ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  )
}

/** A checkbox with a line of explanation under it, for the display flags. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="mb-2 flex cursor-pointer items-start gap-2 text-xs text-slate-600">
      <input
        type="checkbox"
        className="mt-0.5 accent-indigo-500"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        <span className="mt-0.5 block text-[10.5px] leading-snug text-slate-400">{hint}</span>
      </span>
    </label>
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
