import { useEffect } from 'react'

import { openInsertMenu } from '@/components/InsertCardMenu'
import { openPresentMenu } from '@/components/PresentMenu'
import { flushPageNow } from '@/hooks/usePageSync'
import { useCanvasStore } from '@/store/useCanvasStore'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Global shortcuts. Modifier combos work even while a field has focus;
 * single-letter shortcuts are ignored so typing in a card never triggers them.
 *
 * Two modes are handled here rather than in each shortcut, because both have to
 * hold for *every* editing key and one missed key is a broken promise:
 *
 *   presenting  the keyboard belongs to the presentation. Arrows move between
 *               steps, Escape leaves. Nothing else fires, because a presenter
 *               pressing `C` should not create a card on the projector.
 *   read-only   the same, minus the navigation. A viewer has no edit to undo and
 *               nothing to delete, so those keys do nothing rather than firing
 *               writes the database will refuse.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useCanvasStore.getState()
      const typing = isTypingTarget(event.target)
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      /* --- presenting: the keyboard is the remote control ---------------- */
      if (store.presenting) {
        switch (event.key) {
          case 'Escape':
            event.preventDefault()
            store.stopPresenting()
            return
          case 'ArrowRight':
          case 'ArrowDown':
          case 'PageDown':
          case ' ':
          case 'Enter':
            event.preventDefault()
            if (!event.repeat) store.nextStep()
            return
          case 'ArrowLeft':
          case 'ArrowUp':
          case 'PageUp':
          case 'Backspace':
            event.preventDefault()
            if (!event.repeat) store.prevStep()
            return
          case 'Home':
            event.preventDefault()
            store.goToStep(0)
            return
          case 'End':
            event.preventDefault()
            store.goToStep(store.steps().length - 1)
            return
          default:
            break
        }

        // A number jumps straight to that step, which is the shortcut people
        // reach for when a question comes from the back of the room.
        if (!mod && !typing && /^[0-9]$/.test(event.key)) {
          const n = Number(event.key)
          const total = store.steps().length
          // `1` is the first step, but `0` is the tenth, so the first digit has
          // to be read as `0` when it stands alone.
          const target = n === 0 ? 9 : n - 1
          if (target < total) {
            event.preventDefault()
            store.goToStep(target)
          }
          return
        }
        return
      }

      if (mod) {
        switch (key) {
          case 'z':
            event.preventDefault()
            if (store.canEdit()) {
              if (event.shiftKey) store.redo()
              else store.undo()
            }
            return
          case 'y':
            event.preventDefault()
            if (store.canEdit()) store.redo()
            return
          case 's':
            event.preventDefault()
            store.flushCommit()
            void flushPageNow().then(() => {
              useCanvasStore.getState().pushToast('Saved', 'success')
            })
            return
          case 'a':
            if (typing) return
            event.preventDefault()
            store.selectAllElements()
            return
          case 'd':
            event.preventDefault()
            if (!store.canEdit()) return
            if (store.selectedElementIds.length > 0) {
              const created = store.duplicateElements(store.selectedElementIds)
              store.pushToast(
                created.length > 0
                  ? `Duplicated ${created.length} element${created.length === 1 ? '' : 's'}.`
                  : 'Nothing to duplicate.',
                'info',
              )
            }
            return
          default:
            return
        }
      }

      if (typing) return

      if (event.key === 'Escape') {
        if (store.dialog) {
          store.setDialog(null)
          return
        }
        if (store.contextMenu) {
          store.setContextMenu(null)
          return
        }
        if (store.searchOpen) {
          store.setSearchOpen(false)
          return
        }
        store.clearSelection()
        return
      }

      if (event.code === 'Space') {
        // Space is the pan modifier; stop the page from scrolling behind us.
        if (!store.spacePressed) {
          event.preventDefault()
          store.setSpacePressed(true)
        }
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (!store.canEdit()) return
        if (store.selectedElementIds.length > 0) {
          const count = store.selectedElementIds.length
          store.deleteElements(store.selectedElementIds)
          store.pushToast(`Deleted ${count} element${count === 1 ? '' : 's'}.`, 'info')
        } else if (store.selectedConnectionIds.length > 0) {
          const count = store.selectedConnectionIds.length
          store.deleteConnections(store.selectedConnectionIds)
          store.pushToast(`Deleted ${count} connection${count === 1 ? '' : 's'}.`, 'info')
        }
        return
      }

      if (event.repeat) return

      // Everything below changes the document. A viewer pressing one of these
      // gets a word about why nothing happened, rather than silence that looks
      // like a broken key.
      if (!store.canEdit()) {
        if (key === 'c' || key === 'g' || key === 'i' || key === 'p') {
          event.preventDefault()
          store.pushToast('This workspace is view only.', 'info')
        }
        return
      }

      switch (key) {
        case 'c':
          event.preventDefault()
          // A note, specifically — the fast path. `I` opens the menu for the
          // other kinds.
          store.addElement('note')
          break
        case 'g':
          event.preventDefault()
          store.addGroup()
          break
        case 'f':
          event.preventDefault()
          store.requestFitView()
          break
        case 'i':
          event.preventDefault()
          openInsertMenu()
          break
        case 'p':
          event.preventDefault()
          openPresentMenu()
          break
        default:
          break
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        useCanvasStore.getState().setSpacePressed(false)
      }
    }

    const onBlur = () => {
      useCanvasStore.getState().setSpacePressed(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
