import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import type { FlashElement, FlashSide } from '@/types'
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
 * How far a pointer may travel and still count as a click.
 *
 * The face used to carry `data-no-drag`, which is how the canvas is told "this
 * is a control, do not start a drag here". The comment claimed the card still
 * dragged from it, and it did not: the canvas returns before capturing the
 * pointer, so a flash deck could not be moved at all. Which is the whole reason
 * this number exists instead — a click is a click *because* it did not become a
 * drag, and the deck can tell the difference itself.
 */
const CLICK_SLOP_PX = 4

/**
 * A flash **deck**, and the card currently showing on it.
 *
 * Three things here are less obvious than they look.
 *
 * **The controls are outside the turning element.** They were inside it, so the
 * arrows and the counter were carried round with the card and appeared on the
 * back face, upside down, whenever the deck was turned over.
 *
 * **The faces settle flat.** A 3D transform on an element that contains text
 * makes the browser rasterise that text at the transformed angle, so the text is
 * measurably softer afterwards and stays that way. The turn is animated in 3D
 * and then the transform is *removed* and the visible face rendered flat — the
 * animation is 500ms and the softness would have been permanent.
 *
 * **Changing card slides.** The old cards stayed where they were while the new
 * one replaced them, so a turn shortly after a step showed the previous answer
 * for a frame. Each card is keyed by its own id, so React moves one out and the
 * other in rather than swapping the text in place.
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

  const [flipped, setFlipped] = useState(element.showing === 'back')
  // Whether the 3D turn is still running. False once it has settled, which is
  // when the transform comes off.
  const [turning, setTurning] = useState(false)

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

  const hasBack = answer.text.trim().length > 0 || Boolean(answer.image?.src)
  // Scrolling the answer is reading it, so it is allowed even while presenting.
  // A presentation is *read*; a card whose answer is taller than the card and
  // cannot be scrolled is a card that cannot be read from the back row.
  const canFlip = editable && hasBack
  const manyCards = element.cards.length > 1

  /* --- the click-versus-drag distinction -------------------------------- */
  // Tracked here rather than delegated to `data-no-drag`, so the face can be
  // dragged from anywhere and still turn over when it is genuinely clicked.
  const downAt = useRef<{ x: number; y: number } | null>(null)
  const dragTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (dragTimer.current !== null) window.clearTimeout(dragTimer.current)
    }
  }, [])

  const turn = () => {
    setTurning(true)
    setFlipped((value) => !value)
    // The transform comes off when the turn is over, so the text is crisp while
    // the card is just sitting there.
    window.setTimeout(() => setTurning(false), 520)
  }

  const requestFlip = (event: React.PointerEvent) => {
    if (!canFlip) return
    downAt.current = { x: event.clientX, y: event.clientY }
    // A double click is two clicks, and firing both turns the card over twice —
    // which is to say not at all — while also opening the inspector. So the turn
    // waits to see whether a second one is coming.
    if (dragTimer.current !== null) window.clearTimeout(dragTimer.current)
    dragTimer.current = window.setTimeout(() => {
      dragTimer.current = null
      if (downAt.current === null) return
      turn()
    }, DOUBLE_CLICK_MS)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const start = downAt.current
    if (start === null) return
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved > CLICK_SLOP_PX) {
      // A drag, not a click. Drop the pending turn — and do not *undo* one,
      // because the turn cannot have happened yet: it is still waiting out the
      // double-click window.
      downAt.current = null
      if (dragTimer.current !== null) {
        window.clearTimeout(dragTimer.current)
        dragTimer.current = null
      }
    }
  }

  const cancelFlipAndEdit = () => {
    // A card with no back still has a front worth editing, so the edit is
    // offered even when there is nothing to turn over to.
    if (!editable) return
    if (dragTimer.current !== null) {
      window.clearTimeout(dragTimer.current)
      dragTimer.current = null
    }
    downAt.current = null
    onDoubleClick?.()
  }

  // The face that is showing. Keyed by its own id so that changing card slides
  // the two apart rather than swapping the text inside one element.
  const visible = flipped ? answer : question

  return (
    <div className="relative h-full w-full" onPointerMove={onPointerMove}>
      <div
        className="[perspective:900px] h-full w-full"
        style={{ height: '100%' }}
      >
        {/*
          The turning element. `transform` is only present while the turn is
          running — see the note above on why.
        */}
        <div
          className={[
            'absolute inset-0',
            turning
              ? 'transition-transform duration-500 [transform-style:preserve-3d] ' +
                (flipped ? '[transform:rotateY(180deg)]' : '')
              : '',
            canFlip ? 'cursor-pointer' : 'cursor-default',
          ].join(' ')}
          role={canFlip ? 'button' : undefined}
          tabIndex={canFlip ? 0 : undefined}
          aria-label={canFlip ? 'Turn this card over' : undefined}
          onPointerDown={requestFlip}
          onDoubleClick={(event) => {
            // Two clicks in one spot is not a request to turn the card over, it
            // is somebody trying to edit it.
            event.stopPropagation()
            cancelFlipAndEdit()
          }}
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
              turn()
            }
          }}
        >
          {/* The two faces, each with an *explicit* rotation including the front
              at 0°. A face with no transform of its own is not reliably culled
              by `backface-visibility`, and both would show at once.

              `showing` is which one is up. `turning` is only true while the
              animation runs, and it is what decides whether the 3D transform is
              applied at all — so at rest the visible face is flat and its text is
              not rasterised at an angle. */}
          <Face
            key={`front-${question.id}`}
            side={question}
            role="front"
            showing={!flipped}
            turning={turning}
            className="[transform:rotateY(0deg)]"
          />
          <Face
            key={`back-${answer.id}`}
            side={answer}
            role="back"
            showing={flipped}
            turning={turning}
            className="[transform:rotateY(180deg)]"
            fit={element.answerFit}
          />
        </div>
      </div>

      {/*
        The deck controls, outside the element that turns.

        They were inside it, which meant the arrows rotated with the card and
        appeared mirrored on the back face. Controls that do not belong to a face
        belong to the element.
      */}
      {manyCards ? (
        <DeckControls element={element} onPointerDown={(e) => e.stopPropagation()} />
      ) : null}

      {/* The prompt, also outside, for the same reason. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[10.5px] opacity-45">
        {hasBack
          ? canFlip
            ? 'click to turn over'
            : 'answer hidden'
          : 'nothing on the back yet'}
      </span>
      <span className="sr-only" aria-live="polite">
        Card {element.cardIndex + 1} of {element.cards.length}
        {flipped ? ', showing the answer' : ', showing the question'}
      </span>
      {/* Used by the class above; kept as data so a test can read it. */}
      <span data-face={visible.id} className="hidden" />
    </div>
  )
}

/**
 * One face.
 *
 * `fit` is what keeps a long answer readable: `center` is for a question read
 * across a room, `top` starts an answer at the top and scrolls it. Neither
 * shrinks the text, because a face whose text has been made small enough to fit
 * is a face nobody can read.
 */
function Face({
  side,
  role,
  showing,
  turning,
  className,
  fit = 'center',
}: {
  side: FlashSide
  role: 'front' | 'back'
  /** Is this the face currently showing? Decides visibility, not the transform. */
  showing: boolean
  /** Is the 3D turn running? Decides the transform, which is why text is crisp at
   *  rest. */
  turning: boolean
  className: string
  fit?: 'center' | 'top'
}) {
  const html = useMemoHtml(side.text)
  const hasImage = Boolean(side.image?.src)

  return (
    <div
      className={[
        'absolute inset-0 flex flex-col px-3 py-4 [backface-visibility:hidden]',
        fit === 'center' ? 'items-center justify-center text-center' : 'items-stretch',
        className,
      ].join(' ')}
      /*
        The bug this replaces.

        The face used to be hidden with `opacity: 0` unless it was *mid-turn*, so
        at rest neither face was visible: the content blinked out when the turn
        ended and back when the next one began. "Turning" is not "showing" — the
        two happen to coincide for 500ms and then diverge forever.

        Visibility now follows `showing`, which is the only thing that describes
        it. The face that is not showing is `display: none` rather than
        transparent, so it is genuinely not on screen and cannot be seen through.
      */
      style={
        showing
          ? turning
            ? undefined
            : { transform: undefined }
          : { display: 'none' }
      }
      aria-hidden={!showing}
      data-face-role={role}
      data-face-id={side.id}
    >
      {hasImage ? (
        <img
          src={side.image!.src ?? ''}
          alt={side.image!.alt || ''}
          draggable={false}
          className={
            fit === 'center'
              ? 'mb-1.5 max-h-[42%] max-w-full object-contain opacity-90'
              : 'mb-2 max-h-[38%] w-full object-contain opacity-90'
          }
        />
      ) : null}
      <div
        className={
          fit === 'center'
            ? 'cc-markdown w-full text-[15px] font-semibold leading-snug'
            : 'cc-markdown cc-scroll w-full flex-1 overflow-y-auto text-[13px] leading-snug'
        }
        onWheel={(event) => event.stopPropagation()}
        // The question centres even when it is long, because a question is read
        // at a glance. An answer scrolls instead, and is the only face allowed
        // to be taller than the card.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

/** Markdown, recomputed only when the text actually changes. */
function useMemoHtml(text: string): string {
  const [html, setHtml] = useState(() => renderMarkdown(text))
  useEffect(() => {
    setHtml(renderMarkdown(text))
  }, [text])
  return html
}

/**
 * Which card of the deck, and the arrows to change it.
 *
 * Rendered once, outside the faces, so it is the same control whichever side is
 * showing and it does not turn with the card.
 */
function DeckControls({
  element,
  onPointerDown,
}: {
  element: FlashElement
  onPointerDown: (event: React.PointerEvent) => void
}) {
  const stepFlashDeck = useCanvasStore((s) => s.stepFlashDeck)
  const at = element.cardIndex
  const total = element.cards.length

  return (
    <div
      className="pointer-events-auto absolute bottom-6 left-0 right-0 flex items-center justify-center gap-1.5 text-[10.5px] opacity-70"
      data-no-drag=""
      onPointerDown={onPointerDown}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Previous card"
        className="grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-current transition hover:opacity-100"
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
        className="grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-current transition hover:opacity-100"
        onClick={() => stepFlashDeck(element.id, 1)}
      >
        <ChevronRight size={12} />
      </button>
    </div>
  )
}

/** Kept out of the render path; the icon is used by the element chrome. */
