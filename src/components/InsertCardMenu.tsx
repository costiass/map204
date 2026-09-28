import { useEffect, useRef, useState } from 'react'
import { FileText, Layers, Play, Plus, StickyNote } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'
import type { CardType } from '@/types'
import { CARD_TYPES } from '@/utils/embeds'
import { openInsertCard } from '@/components/InsertCardDialog'

/**
 * The toolbar's one button for making a card, and the menu it opens.
 *
 * This replaced the right-click route, and the reason is not a preference: a
 * right-click menu is a place you have to already know to go, and the *first*
 * thing a new card kind can be â€” noticing it exists â€” only reaches people who
 * go looking. A button in the toolbar is on the screen the whole time.
 *
 * Choosing a kind is a single click, not a dialog. A note and a flash card need
 * nothing else and appear immediately; the two kinds that point at something need
 * a link, so they open the insert dialog, already set to that kind.
 */

const ICONS = { note: StickyNote, flash: Layers, youtube: Play, pdf: FileText }

/** The kinds that cannot be created without asking for a link first. */
const NEEDS_LINK: ReadonlySet<CardType> = new Set<CardType>(['youtube', 'pdf'])

let notifyInsertMenu: (() => void) | null = null

/** Open the menu from elsewhere â€” the `I` shortcut, currently. */
export function openInsertMenu(): void {
  notifyInsertMenu?.()
}

export function InsertCardMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const addCard = useCanvasStore((s) => s.addCard)
  const selectCards = useCanvasStore((s) => s.selectCards)
  const readOnlyReason = useCanvasStore((s) => s.readOnlyReason)

  useEffect(() => {
    notifyInsertMenu = () => setOpen((value) => !value)
    return () => {
      notifyInsertMenu = null
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (readOnlyReason !== null) return null

  const choose = (type: CardType) => {
    setOpen(false)
    if (NEEDS_LINK.has(type)) {
      // No position, so the dialog lets the card land wherever the canvas
      // chooses â€” the same place a `C` press would put it.
      openInsertCard(-1, -1, type)
      return
    }
    const id = addCard({ type })
    if (id) selectCards([id])
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className="cc-btn"
        data-variant="primary"
        title="Insert a card (I)"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={14} />
        <span className="hidden sm:inline">Insert</span>
      </button>

      {open ? (
        <div data-anchored="true" className="cc-menu absolute right-0 top-10 z-50 w-60" role="menu">
          {CARD_TYPES.map((option) => {
            const Icon = ICONS[option.id]
            return (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                onClick={() => choose(option.id)}
                title={option.hint}
              >
                <Icon size={15} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{option.label}</span>
                  <span className="block text-[11px] opacity-55">{option.hint}</span>
                </span>
              </button>
            )
          })}
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              useCanvasStore.getState().addGroup()
            }}
          >
            <span className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded border border-current opacity-70" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Group</span>
              <span className="block text-[11px] opacity-55">A frame to gather cards in</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
