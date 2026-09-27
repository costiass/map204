import { useEffect } from 'react'

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
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useCanvasStore.getState()
      const typing = isTypingTarget(event.target)
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (mod) {
        switch (key) {
          case 'z':
            event.preventDefault()
            if (event.shiftKey) store.redo()
            else store.undo()
            return
          case 'y':
            event.preventDefault()
            store.redo()
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
            store.selectAllCards()
            return
          case 'd':
            event.preventDefault()
            if (store.selectedCardIds.length > 0) {
              const created = store.duplicateCards(store.selectedCardIds)
              store.pushToast(
                created.length > 0 ? `Duplicated ${created.length} card(s).` : 'Nothing to duplicate.',
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
        if (store.selectedCardIds.length > 0) {
          const count = store.selectedCardIds.length
          store.deleteCards(store.selectedCardIds)
          store.pushToast(`Deleted ${count} card${count === 1 ? '' : 's'}.`, 'info')
        } else if (store.selectedConnectionIds.length > 0) {
          const count = store.selectedConnectionIds.length
          store.deleteConnections(store.selectedConnectionIds)
          store.pushToast(`Deleted ${count} connection${count === 1 ? '' : 's'}.`, 'info')
        }
        return
      }

      if (event.repeat) return

      switch (key) {
        case 'c':
          event.preventDefault()
          store.addCard()
          break
        case 'g':
          event.preventDefault()
          store.addGroup()
          break
        case 'f':
          event.preventDefault()
          store.requestFitView()
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
