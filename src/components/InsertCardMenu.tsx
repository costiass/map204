import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

import { openInsertElement } from '@/components/InsertCardDialog'
import { insertableKinds, needsSource } from '@/elements/registry'
import { useCanvasStore } from '@/store/useCanvasStore'

/**
 * The toolbar's one button for making a card, and the menu it opens.
 *
 * This replaced the right-click route as the *primary* one, and the reason is
 * not a preference: a right-click menu is a place you have to already know to go,
 * and the first thing a new card kind can be — noticing it exists — only reaches
 * people who go looking. A button in the toolbar is on the screen the whole time.
 *
 * The right-click menu offers the same list, because the two routes being
 * different is worse than either one existing alone.
 *
 * Choosing a kind is a single click, not a dialog. A note and a flash card need
 * nothing else and appear immediately; the two kinds that point at something need
 * a link, so they open the insert dialog already set to that kind.
 */

let notifyInsertMenu: (() => void) | null = null

/** Open the menu from elsewhere — the `I` shortcut, currently. */
export function openInsertMenu(): void {
  notifyInsertMenu?.()
}

/**
 * Where the menu should open, when the caller knows.
 *
 * `null` means "wherever the button is", which is the right answer for the
 * button and the `I` key and the wrong one for a right click, which has a point.
 */
let anchorAt: { x: number; y: number } | null = null

/** Open the menu at a point on the canvas. Screen coordinates. */
export function openInsertMenuAt(x: number, y: number): void {
  anchorAt = { x, y }
  notifyInsertMenu?.()
}

export function InsertCardMenu() {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const addElement = useCanvasStore((s) => s.addElement)
  const selectElements = useCanvasStore((s) => s.selectElements)
  const readOnlyReason = useCanvasStore((s) => s.readOnlyReason)

  // Kept in a ref as well as state, so the click-away and the outside-click
  // handlers below see the same value the render did rather than a stale one.
  const openRef = useRef(false)
  openRef.current = open

  /**
   * Placed next to the button, and flipped when it would fall off the screen.
   *
   * The row this lives in scrolls sideways, which is what makes an absolutely
   * positioned menu inside it wrong twice over: the scroller clips the menu, and
   * the menu then scrolls away with the button. So it is positioned against the
   * viewport, like the context menu.
   */

  // The button's position is needed by the keyboard path, which has no pointer
  // to measure from. Kept in a ref, updated on every layout the browser tells us
  // about, so opening the menu with `I` places it where the button is even
  // though the keyboard handler has no idea where that is.
  const place = useCallback((anchor: { x: number; y: number } | null) => {
    const button = buttonRef.current
    if (!button) {
      setPosition(anchor ? { left: anchor.x, top: anchor.y } : null)
      return
    }
    if (anchor) {
      setPosition({ left: anchor.x, top: anchor.y })
      return
    }
    const rect = button.getBoundingClientRect()
    // The menu's own size, measured once from the element when it exists, and
    // guessed before that. Guessing is enough to keep it on screen, which is all
    // this is for.
    const menu = menuRef.current?.getBoundingClientRect()
    const width = menu?.width ?? 15 * 16
    const height = menu?.height ?? 8 * 4 * 16
    setPosition({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top:
        rect.bottom + 6 + height > window.innerHeight
          ? Math.max(8, rect.top - height - 6)
          : rect.bottom + 6,
    })
  }, [])

  useEffect(() => {
    notifyInsertMenu = () => {
      if (openRef.current) {
        setOpen(false)
        return
      }
      place(anchorAt)
      anchorAt = null
      setOpen(true)
    }
    return () => {
      notifyInsertMenu = null
    }
  }, [place])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    // A scroll or a resize moves the button out from under a menu that was
    // placed against the viewport, which is the same bug as the sidebar and the
    // zoom percentage: the number is right and the thing it describes has moved.
    const onReflow = () => setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReflow)
    window.addEventListener('wheel', onReflow, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('wheel', onReflow)
    }
  }, [open])

  if (readOnlyReason !== null) return null

  const choose = (kindId: string) => {
    setOpen(false)
    if (needsSource(kindId)) {
      // No position, so the dialog lets it land wherever the canvas chooses —
      // the same place a `C` press would put it.
      openInsertElement(-1, -1, kindId)
      return
    }
    // The kind comes straight from the registry, so there is no cast and nothing
    // to get wrong: whatever the menu showed is what gets made.
    const id = addElement(kindId)
    if (id) selectElements([id])
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="cc-btn shrink-0"
        title="Insert a card of a chosen kind (I)"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          place(null)
          setOpen((value) => !value)
        }}
      >
        <Plus size={14} />
        <span className="hidden md:inline">Insert</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          className="cc-menu z-[95] w-60"
          style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
          role="menu"
        >
          <p className="cc-menu-label">Insert</p>
          {insertableKinds().map((option) => {
            const OptionIcon = option.icon
            return (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                onClick={() => choose(option.id)}
                title={option.blurb}
              >
                <OptionIcon size={15} className="shrink-0 opacity-70" />
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
              <span className="block text-[11px] opacity-55">A frame that holds other things</span>
            </span>
          </button>
        </div>
      ) : null}
    </>
  )
}
