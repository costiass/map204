import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'

import type { FlashElement } from '@/types'
import { useCanvasStore } from '@/store/useCanvasStore'
import { renderMarkdown } from '@/utils/markdown'

/**
 * How long a click waits for a second one before turning the card over.
 *
 * The browser's own double-click threshold is platform-dependent and this is not,
 * which matters: a card that turns over *and* opens the editor on a double click
 * is a card you cannot read.
 */
const DOUBLE_CLICK_MS = 260

/**
 * A flash **deck**, and the card currently showing on it.
 *
 * A deck is a list of cards, each with a question and an answer. This renders
 * one of them and lets you turn it over; stepping between cards is the deck's
 * business and lives in the store, because "which card am I on" is part of the
 * document and a component that kept it in local state would forget it on the
 * next repaint.
 *
 * The perspective is applied to an *inner* wrapper, never to the card root. The
 * card root is the element the canvas positions, measures and transforms, and
 * putting a 3D context on it would change its layout box — the card would stop
 * lining up with its own position, and dragging would drift. Contained here, the
 * flip is a local effect and the canvas sees an ordinary rectangle.
 */
export function FlashDeck({
  element,
  editable,
  onDoubleClick,
}: {
  element: FlashElement
  /** False in read-only and presentation, where a click is not a flip. */
  editable: boolean
  /** Opens the inspector, so the two sides can be typed into. */
  onDoubleClick?: () => void
}) {
  const stepFlashDeck = useCanvasStore((s) => s.stepFlashDeck)

  // A deck's own `showing` is the *stored* facing, so a step or a jump can ask
  // for the answer side. The flip below is the transient, user-driven one that
  // overrides it until the next step.
  const [flipped, setFlipped] = useState(element.showing === 'back')

  useEffect(() => {
    setFlipped(element.showing === 'back')
  }, [element.id, element.cardIndex, element.showing])

  // A deck with no cards is a broken file, and the normalizer gives it one empty
  // card, so this cannot be empty — but reading it defensively here would hide a
  // real bug rather than surface it.
  const pair = element.cards[element.cardIndex] ?? element.cards[0] ?? [
    { id: 'empty-front', text: '' },
    { id: 'empty-back', text: '' },
  ]
  const question = pair[0]
  const answer = pair[1]

  // A single click turns the card over, and a double click opens the editor.
  // Those overlap: a double click is *two* clicks, and firing both would turn the
  // card over twice — which is to say, not at all — while also opening the
  // inspector. So the flip waits to see whether a second click is coming, and
  // only happens if none arrives.
  const flipTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (flipTimer.current !== null) window.clearTimeout(flipTimer.current)
    }
  }, [])

  const hasBack = answer.text.trim().length > 0
  const backHtml = renderMarkdown(answer.text)
  const manyCards = element.cards.length > 1

  // Scrolling the answer is reading it, so it is allowed even while presenting.
  // A presentation is *read*; a card whose answer is taller than the card and
  // cannot be scrolled is a card that cannot be read from the back row.
  const canFlip = editable && hasBack

  const requestFlip = () => {
    if (!canFlip) return
    if (flipTimer.current !== null) window.clearTimeout(flipTimer.current)
    flipTimer.current = window.setTimeout(() => {
      flipTimer.current = null
      setFlipped((value) => !value)
    }, DOUBLE_CLICK_MS)
  }

  const cancelFlipAndEdit = () => {
    // A card with no back still has a front worth editing, so the edit is
    // offered even when there is nothing to turn over to.
    if (!editable) return
    // Just drop the pending flip — do not turn the card to "undo" it. A double
    // click always arrives within a few tens of milliseconds, well inside the
    // wait, so the flip cannot have happened yet and there is nothing to undo.
    // Toggling here would be a turn with no turn before it.
    if (flipTimer.current !== null) {
      window.clearTimeout(flipTimer.current)
      flipTimer.current = null
    }
    onDoubleClick?.()
  }

  return (
    <div
      // The 3D context, and nothing above it, so the card's own box is untouched.
      className="[perspective:900px]"
      style={{ height: '100%' }}
    >
      <div
        /* Marks this as a control rather than card body, which is what stops the
         * canvas calling `preventDefault` under a click. The card still drags
         * from here — the marker only suppresses the default, it does not opt
         * out of dragging — and suppressing it is what makes the click that
         * turns the card over reliable. */
        data-no-drag=""
        role={canFlip ? 'button' : undefined}
        tabIndex={canFlip ? 0 : undefined}
        aria-label={canFlip ? 'Turn this card over' : undefined}
        onDoubleClick={(event) => {
          // Two clicks in one spot is not a request to turn the card over. It is
          // somebody trying to edit it, so the pending flip is called off.
          event.stopPropagation()
          cancelFlipAndEdit()
        }}
        onClick={requestFlip}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            stepFlashDeck(element.id, -1)
            return
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            stepFlashDeck(element.id, 1)
            return
          }
          if (!canFlip) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            setFlipped((value) => !value)
          }
        }}
        className={`relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d] ${
          canFlip ? 'cursor-pointer' : 'cursor-default'
        } ${flipped ? '[transform:rotateY(180deg)]' : ''}`}
      >
        {/* Each face carries an *explicit* rotation, including the front one at
            0°. `backface-visibility: hidden` on a face with no transform of its
            own is not reliably culled: the face is only reliably recognised as
            having turned when it is unambiguously part of a rotated 3D subtree.
            Spelling out 0deg is the standard form, and it is what makes the
            front actually disappear instead of ghosting through the back. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 py-4 text-center [backface-visibility:hidden] [transform:rotateY(0deg)]">
          <p className="text-[15px] font-semibold leading-snug">
            {question.text || element.title || 'Untitled'}
          </p>
          {hasBack ? (
            <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] opacity-45">
              <RotateCcw size={10} /> click to turn over
            </span>
          ) : (
            <span className="mt-1 text-[10.5px] opacity-45">nothing on the back yet</span>
          )}
          {manyCards ? (
            <DeckControls element={element} />
          ) : null}
        </div>

        {/* Pre-rotated, so it is face-on once the card has turned — which is what
            lets one rotating element carry both sides. */}
        <div className="absolute inset-0 overflow-hidden [backface-visibility:hidden] [transform:rotateY(180deg)]">
          {/* Centred, like the front. A flash card's back is a short answer
              displayed to somebody at a distance, so left-aligned ragged text is
              the wrong shape for it.

              The Markdown sits inside one wrapper rather than being the flex
              container's own children: a flex row would put two paragraphs side
              by side, and a list's items along a line. Centring the block that
              *contains* the answer centres the answer without deciding anything
              about how the answer is laid out. */}
          <div
            className="flex h-full w-full items-center justify-center overflow-y-auto px-3 py-4 text-center cc-scroll"
            // Scrolling this is reading it, so the page must not scroll behind
            // it. Without this the wheel moves the canvas and the answer stays
            // exactly where it was.
            onWheel={(event) => event.stopPropagation()}
            data-no-drag=""
          >
            <div className="cc-markdown w-full" dangerouslySetInnerHTML={{ __html: backHtml }} />
            {manyCards ? (
              <div className="mt-2 shrink-0">
                <DeckControls element={element} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Which card of the deck, and the arrows to change it.
 *
 * Rendered on *both* faces, because the deck has to be steppable from whichever
 * side is facing you — a deck you can only advance from the question is a deck
 * you cannot revise.
 */
function DeckControls({ element }: { element: FlashElement }) {
  const stepFlashDeck = useCanvasStore((s) => s.stepFlashDeck)
  const at = element.cardIndex
  const total = element.cards.length

  return (
    <div
      className="mt-1.5 flex items-center gap-1.5 text-[10.5px] opacity-55"
      data-no-drag=""
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Previous card"
        className="grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-current opacity-70 hover:opacity-100"
        onClick={() => stepFlashDeck(element.id, -1)}
      >
        <ChevronLeft size={12} />
      </button>
      <span className="tabular-nums">
        {at + 1} / {total}
      </span>
      <button
        type="button"
        aria-label="Next card"
        className="grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-current opacity-70 hover:opacity-100"
        onClick={() => stepFlashDeck(element.id, 1)}
      >
        <ChevronRight size={12} />
      </button>
    </div>
  )
}
