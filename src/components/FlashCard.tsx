import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'

import type { Card } from '@/types'
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
 * A card with two sides: the title, and the body. A click turns it over.
 *
 * The perspective is applied to an *inner* wrapper, never to the card root. The
 * card root is the element the canvas positions, measures and transforms, and
 * putting a 3D context on it would change its layout box — the card would stop
 * lining up with its own position, and dragging would drift. Contained here, the
 * flip is a local effect and the canvas sees an ordinary rectangle.
 *
 * The two sides use the fields a note already has — `title` for the front and
 * `content` for the back — so a flash card needs no editing surface of its own,
 * and turning a note into a flash card keeps everything written in it.
 */
export function FlashCard({
  card,
  editable,
  onDoubleClick,
}: {
  card: Card
  /** False in read-only and presentation, where a click is not a flip. */
  editable: boolean
  /** Opens the inspector, so the two sides can be typed into. */
  onDoubleClick?: () => void
}) {
  const [flipped, setFlipped] = useState(false)

  // A single click turns the card over, and a double click opens the editor.
  // Those overlap: a double click is *two* clicks, and firing both would turn
  // the card over twice — which is to say, not at all — while also opening the
  // inspector. So the flip waits to see whether a second click is coming, and
  // only happens if none arrives.
  const flipTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (flipTimer.current !== null) window.clearTimeout(flipTimer.current)
    }
  }, [])

  const hasBack = card.content.trim().length > 0
  const backHtml = renderMarkdown(card.content)

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
        data-no-drag=""
        role={canFlip ? 'button' : undefined}
        tabIndex={canFlip ? 0 : undefined}
        aria-label={canFlip ? 'Turn this card over' : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          // Two clicks in one spot is not a request to turn the card over. It is
          // somebody trying to edit it, so the pending flip is called off.
          event.stopPropagation()
          cancelFlipAndEdit()
        }}
        onClick={requestFlip}
        onKeyDown={(event) => {
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
        {/* Front: the title. The back is pre-rotated so it is face-on once the
            card has turned, which is what makes a single element enough. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 py-4 text-center [backface-visibility:hidden]">
          <p className="text-[15px] font-semibold leading-snug">{card.title || 'Untitled'}</p>
          {hasBack ? (
            <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] opacity-45">
              <RotateCcw size={10} /> click to turn over
            </span>
          ) : (
            <span className="mt-1 text-[10.5px] opacity-45">nothing on the back yet</span>
          )}
        </div>

        <div className="absolute inset-0 overflow-hidden px-2 py-2 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div
            className="cc-markdown h-full overflow-y-auto cc-scroll text-left"
            dangerouslySetInnerHTML={{ __html: backHtml }}
          />
        </div>
      </div>
    </div>
  )
}
