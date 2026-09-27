import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { createSampleDoc } from '@/data/sample'
import {
  COLLAPSED_HEADER_HEIGHT,
  createDefaultSettings,
  MAX_CARD_HEIGHT,
  MAX_CARD_WIDTH,
  MIN_CARD_HEIGHT,
  MIN_CARD_WIDTH,
  type Anchor,
  type Card,
  type CardImage,
  type CardStyle,
  type CanvasDoc,
  type Connection,
  type ConnectionEndpoint,
  type ConnectionStyle,
  type Group,
  type Page,
  type Point,
  type Viewport,
} from '@/types'
import { centerOn, clamp, screenToWorld } from '@/utils/geometry'
import { clone, uid } from '@/utils/id'
import { createCard, createConnection, createGroup, normalizeDoc } from '@/utils/serialize'

const HISTORY_LIMIT = 80
const COMMIT_DELAY_MS = 700

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'success' | 'error'
}

export type DialogKind = 'import' | 'export' | null

export interface ContextMenuState {
  x: number
  y: number
  cardId: string | null
  connectionId: string | null
  groupId: string | null
}

export type ZOrderMode = 'front' | 'back' | 'forward' | 'backward'

export interface CanvasStore {
  /* --- document ---------------------------------------------------- */
  doc: CanvasDoc
  activePageId: string
  /** The Supabase document ID (for saving). */
  documentId: string | null
  /** The Supabase document title, kept in step with `documents.title`. */
  documentTitle: string
  setDocumentId: (id: string | null) => void
  setDocumentTitle: (title: string) => void
  setDarkMode: (enabled: boolean) => void
  setGridSize: (size: number) => void

  /* --- selection --------------------------------------------------- */
  selectedCardIds: string[]
  selectedConnectionIds: string[]
  selectedGroupId: string | null

  /* --- ui ---------------------------------------------------------- */
  searchOpen: boolean
  sidebarOpen: boolean
  dialog: DialogKind
  contextMenu: ContextMenuState | null
  searchQuery: string
  filterTags: string[]
  filterColor: string | null
  snapToGrid: boolean
  gridPattern: 'none' | 'dots' | 'lines'
  gridSize: number
  spacePressed: boolean
  viewportSize: { width: number; height: number }
  /** Bumped by the toolbar / `F` shortcut; the canvas reacts to the change. */
  fitViewToken: number
  darkMode: boolean
  toggleDarkMode: () => void
  toasts: Toast[]

  /* --- history ----------------------------------------------------- */
  past: CanvasDoc[]
  future: CanvasDoc[]
  pendingSnapshot: CanvasDoc | null
  /**
   * Swaps in the document read from the database at boot, before the first
   * paint. History is dropped on purpose: there is nothing for the user to undo
   * back to a state they never saw.
   */
  hydrateDocument: (doc: CanvasDoc) => void
  /**
   * Applies a page state that arrived from another user. History is left
   * untouched: an undo should not be able to revert somebody else's edit.
   */
  applyRemotePage: (pageId: string, page: Page) => void

  /* --- pages ------------------------------------------------------- */
  activePage: () => Page | undefined
  setActivePage: (pageId: string) => void
  addPage: (title?: string) => string
  renamePage: (pageId: string, title: string) => void
  deletePage: (pageId: string) => void
  setViewport: (viewport: Viewport) => void
  setViewportForPage: (pageId: string, viewport: Viewport) => void
  resetViewport: () => void
  requestFitView: () => void
  /** Which tab the card inspector opens on. */
  inspectorTab: 'content' | 'settings'
  setInspectorTab: (tab: 'content' | 'settings') => void

  /* --- cards ------------------------------------------------------- */
  addCard: (input?: Partial<Card>, options?: { select?: boolean; silent?: boolean }) => string
  updateCard: (cardId: string, patch: Partial<Omit<Card, 'id'>>, options?: { silent?: boolean }) => void
  updateCardStyle: (cardId: string, patch: Partial<CardStyle>, options?: { silent?: boolean }) => void
  commitCardPositions: (entries: Array<{ id: string; x: number; y: number }>) => void
  resizeCard: (cardId: string, size: { width: number; height: number }) => void
  duplicateCards: (cardIds: string[]) => string[]
  deleteCards: (cardIds: string[]) => void
  applyZOrder: (cardIds: string[], mode: ZOrderMode) => void
  toggleCollapsed: (cardIds: string[]) => void
  setCardParent: (cardId: string, parentId: string | null) => void
  setCardImage: (cardId: string, image: CardImage) => void
  addChecklistItem: (cardId: string, text?: string) => void
  updateChecklistItem: (cardId: string, itemId: string, patch: { text?: string; done?: boolean }) => void
  removeChecklistItem: (cardId: string, itemId: string) => void
  addTag: (cardId: string, tag: string) => void
  removeTag: (cardId: string, tag: string) => void

  /* --- document settings -------------------------------------------- */
  /** Stores the look of `style` as the default for every new card. */
  setDefaultCardStyle: (style: Partial<CardStyle>) => void
  /**
   * Stores a link's look and/or relationship as the default for every new link.
   * `relationshipType: ''` is a valid default and means new links carry no
   * relationship word.
   */
  setDefaultConnectionPreset: (preset: {
    style?: Partial<ConnectionStyle>
    relationshipType?: string
  }) => void
  resetDefaultStyles: () => void

  /* --- connections ------------------------------------------------- */
  addConnection: (input: {
    source: ConnectionEndpoint
    target: ConnectionEndpoint
    sourceAnchor?: Anchor | null
    targetAnchor?: Anchor | null
    label?: string
    relationshipType?: string
    style?: Partial<ConnectionStyle>
  }) => string | null
  updateConnection: (
    connectionId: string,
    patch: Partial<Omit<Connection, 'id'>>,
    options?: { silent?: boolean },
  ) => void
  updateConnectionStyle: (
    connectionId: string,
    patch: Partial<ConnectionStyle>,
    options?: { silent?: boolean },
  ) => void
  deleteConnections: (connectionIds: string[]) => void

  /* --- groups ------------------------------------------------------ */
  addGroup: (input?: Partial<Group>, options?: { select?: boolean }) => string
  updateGroup: (groupId: string, patch: Partial<Omit<Group, 'id'>>, options?: { silent?: boolean }) => void
  commitGroupPositions: (entries: Array<{ id: string; x: number; y: number }>) => void
  deleteGroups: (groupIds: string[]) => void
  addCardToGroup: (groupId: string, cardId: string) => void
  removeCardFromGroup: (groupId: string, cardId: string) => void
  addGroupToGroup: (parentGroupId: string, childGroupId: string) => void
  removeGroupFromGroup: (parentGroupId: string, childGroupId: string) => void
  selectGroup: (groupId: string | null) => void

  /* --- selection ---------------------------------------------------- */
  selectCards: (cardIds: string[], additive?: boolean) => void
  toggleCardSelection: (cardId: string) => void
  selectConnection: (connectionId: string | null) => void
  selectAllCards: () => void
  clearSelection: () => void
  deleteSelection: () => void

  /* --- viewport memory --------------------------------------------- */
  centerSelection: () => void
  /** Animate the viewport to center a world point in the visible canvas. */
  animateToCenter: (center: Point, zoom?: number) => void

  /* --- ui actions --------------------------------------------------- */
  setSearchOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setDialog: (dialog: DialogKind) => void
  setContextMenu: (menu: ContextMenuState | null) => void
  setSearchQuery: (query: string) => void
  toggleFilterTag: (tag: string) => void
  setFilterColor: (color: string | null) => void
  clearFilters: () => void
  setSnapToGrid: (enabled: boolean) => void
  toggleSnapToGrid: () => void
  setGridPattern: (pattern: 'none' | 'dots' | 'lines') => void
  setSpacePressed: (pressed: boolean) => void
  setViewportSize: (size: { width: number; height: number }) => void
  pushToast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (toastId: string) => void

  /* --- history ------------------------------------------------------ */
  pushHistory: () => void
  scheduleCommit: () => void
  flushCommit: () => void
  undo: () => void
  redo: () => void

  /* --- document level ----------------------------------------------- */
  replaceDoc: (doc: CanvasDoc) => void
  mergeDoc: (doc: CanvasDoc) => void
  resetToSample: () => void
}

let commitTimer: ReturnType<typeof setTimeout> | null = null

/**
 * There is no browser storage any more: Supabase is the only home for the
 * document. Until the signed-in user has loaded a document (or created one) the
 * canvas shows the bundled sample, so the first paint is never blank.
 */
const initialDoc = createSampleDoc()

function nextZIndex(page: Page): number {
  return page.cards.reduce((max, card) => Math.max(max, card.position.zIndex), 0) + 1
}

function lowestZIndex(page: Page): number {
  return page.cards.reduce((min, card) => Math.min(min, card.position.zIndex), 1) - 1
}

export const useCanvasStore = create<CanvasStore>()(
  immer((set, get) => {
    /* -------------------------------------------------------------- */
    /* history helpers                                               */
    /* -------------------------------------------------------------- */

    /**
     * Records the current document as an undo step. Call this *before* a
     * mutation runs. When a burst of "silent" edits is in flight (typing,
     * dragging a slider) the pre-edit snapshot captured at the start of the
     * burst is stored instead, so one undo reverts the whole burst.
     */
    const pushHistory = () => {
      const state = get()
      if (state.pendingSnapshot) {
        const snapshot = state.pendingSnapshot
        set((draft) => {
          draft.past = [...draft.past, snapshot].slice(-HISTORY_LIMIT)
          draft.future = []
          draft.pendingSnapshot = null
        })
        return
      }
      const snapshot = clone(state.doc)
      set((draft) => {
        draft.past = [...draft.past, snapshot].slice(-HISTORY_LIMIT)
        draft.future = []
      })
    }

    /** Prepares an undo step for a silent edit, without pushing it yet. */
    const markDirty = () => {
      if (!get().pendingSnapshot) {
        const snapshot = clone(get().doc)
        set({ pendingSnapshot: snapshot })
      }
      get().scheduleCommit()
    }

    const withPage = (fn: (page: Page, doc: CanvasDoc) => void) => {
      set((state) => {
        const page = state.doc.pages.find((p) => p.id === state.activePageId)
        if (page) fn(page, state.doc)
      })
    }

    const touchCard = (page: Page, cardId: string, fn: (card: Card) => void) => {
      const card = page.cards.find((c) => c.id === cardId)
      if (!card) return false
      fn(card)
      card.updatedAt = new Date().toISOString()
      return true
    }

    return {
      doc: initialDoc,
      activePageId: initialDoc.pages[0]?.id ?? '',
      documentId: null,
      documentTitle: '',

      selectedCardIds: [],
      selectedConnectionIds: [],
      selectedGroupId: null,

      searchOpen: false,
      // Closed on boot: the canvas is the work surface, and the page list is
      // one click away in the toolbar.
      sidebarOpen: false,
      dialog: null,
      contextMenu: null,
      searchQuery: '',
      filterTags: [],
      filterColor: null,
      snapToGrid: true,
      gridPattern: 'dots',
      gridSize: 20,
      spacePressed: false,
      viewportSize: { width: 1200, height: 800 },
      fitViewToken: 0,
      darkMode: false,
      inspectorTab: 'content',
      toasts: [],

      past: [],
      future: [],
      pendingSnapshot: null,

      hydrateDocument: (doc) => {
        set((state) => {
          state.doc = doc
          state.past = []
          state.future = []
          state.pendingSnapshot = null
          // The page that was active before the read may not exist any more.
          if (!doc.pages.some((page) => page.id === state.activePageId)) {
            state.activePageId = doc.pages[0]?.id ?? ''
          }
        })
      },

      applyRemotePage: (pageId, page) => {
        set((state) => {
          const existing = state.doc.pages.find((p) => p.id === pageId)
          if (!existing) return
          existing.title = page.title
          existing.position = page.position
          existing.viewport = page.viewport
          existing.cards = page.cards
          existing.groups = page.groups
          existing.connections = page.connections
          existing.updatedAt = page.updatedAt
          // Selections may point at objects that no longer exist.
          const cardIds = new Set(page.cards.map((c) => c.id))
          const groupIds = new Set(page.groups.map((g) => g.id))
          state.selectedCardIds = state.selectedCardIds.filter((id) => cardIds.has(id))
          if (state.selectedGroupId && !groupIds.has(state.selectedGroupId)) {
            state.selectedGroupId = null
          }
          state.selectedConnectionIds = []
        })
      },

      setDocumentId: (id) => set({ documentId: id }),

      setDocumentTitle: (title) => set({ documentTitle: title }),

      setDarkMode: (enabled) => set({ darkMode: enabled }),

      setGridSize: (size) => set({ gridSize: size }),

      /* ------------------------------------------------------------ */
      /* pages                                                        */
      /* ------------------------------------------------------------ */

      activePage: () => get().doc.pages.find((p) => p.id === get().activePageId),

      setActivePage: (pageId) => {
        if (get().activePageId === pageId) return
        if (!get().doc.pages.some((p) => p.id === pageId)) return
        set((state) => {
          state.activePageId = pageId
          state.selectedCardIds = []
          state.selectedConnectionIds = []
          state.contextMenu = null
        })
      },

      addPage: (title) => {
        pushHistory()
        const pageId = uid('page')
        const page: Page = {
          id: pageId,
          title: title?.trim() || `Page ${get().doc.pages.length + 1}`,
          position: { x: 0, y: 0, width: 1920, height: 1080, zIndex: 0 },
          viewport: { x: 0, y: 0, zoom: 1 },
          cards: [],
          groups: [],
          connections: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        set((state) => {
          state.doc.pages.push(page)
          state.activePageId = pageId
          state.selectedCardIds = []
          state.selectedConnectionIds = []
        })
        return pageId
      },

      renamePage: (pageId, title) => {
        set((state) => {
          const page = state.doc.pages.find((p) => p.id === pageId)
          if (page) page.title = title
        })
      },

      deletePage: (pageId) => {
        const state = get()
        if (state.doc.pages.length <= 1) {
          get().pushToast('A document needs at least one page.', 'error')
          return
        }
        pushHistory()
        set((draft) => {
          draft.doc.pages = draft.doc.pages.filter((p) => p.id !== pageId)
          if (draft.activePageId === pageId) {
            draft.activePageId = draft.doc.pages[0].id
            draft.selectedCardIds = []
            draft.selectedConnectionIds = []
          }
        })
      },

      setViewport: (viewport) => {
        // Viewport lives on the page; it is deliberately not an undoable
        // document edit, so it never triggers a history entry.
        withPage((page) => {
          page.viewport = viewport
        })
      },

      setViewportForPage: (pageId, viewport) => {
        set((state) => {
          const page = state.doc.pages.find((p) => p.id === pageId)
          if (page) page.viewport = viewport
        })
      },

      resetViewport: () => {
        get().setViewport({ x: 0, y: 0, zoom: 1 })
      },

      requestFitView: () => {
        set((state) => {
          state.fitViewToken += 1
        })
      },

      setInspectorTab: (tab) => set({ inspectorTab: tab }),

      toggleDarkMode: () => set((state) => { state.darkMode = !state.darkMode }),

      /* ------------------------------------------------------------ */
      /* cards                                                        */
      /* ------------------------------------------------------------ */

      addCard: (input, options) => {
        const silent = options?.silent ?? false
        if (!silent) pushHistory()

        const state = get()
        const page = state.doc.pages.find((p) => p.id === state.activePageId)
        if (!page) return ''

        const center = screenToWorld(
          { x: state.viewportSize.width / 2, y: state.viewportSize.height / 2 },
          page.viewport,
        )

        // Nudge new cards so repeated presses do not stack them exactly.
        let x = input?.position?.x ?? Math.round(center.x - 140)
        let y = input?.position?.y ?? Math.round(center.y - 110)
        if (!input?.position) {
          const occupied = page.cards.some(
            (card) => Math.abs(card.position.x - x) < 24 && Math.abs(card.position.y - y) < 24,
          )
          if (occupied) {
            for (let i = 1; i <= 8; i++) {
              x = Math.round(center.x - 140) + i * 32
              y = Math.round(center.y - 110) + i * 28
              const clash = page.cards.some(
                (card) => Math.abs(card.position.x - x) < 24 && Math.abs(card.position.y - y) < 24,
              )
              if (!clash) break
            }
          }
        }

        const card = createCard({
          ...input,
          style: { ...state.doc.settings.defaultCardStyle, ...input?.style },
          position: {
            x,
            y,
            width: input?.position?.width ?? 280,
            height: input?.position?.height ?? 220,
            zIndex: input?.position?.zIndex ?? nextZIndex(page),
          },
        })

        set((draft) => {
          const target = draft.doc.pages.find((p) => p.id === draft.activePageId)
          target?.cards.push(card)
        })

        if (options?.select !== false) {
          set((draft) => {
            draft.selectedCardIds = [card.id]
            draft.selectedConnectionIds = []
          })
        }
        return card.id
      },

      updateCard: (cardId, patch, options) => {
        const silent = options?.silent ?? false
        if (silent) markDirty()
        else pushHistory()

        withPage((page) => {
          touchCard(page, cardId, (card) => {
            Object.assign(card, patch)
          })
        })
      },

      updateCardStyle: (cardId, patch, options) => {
        const existing = findCard(get(), cardId)
        if (!existing) return
        get().updateCard(cardId, { style: { ...existing.style, ...patch } }, options)
      },

      commitCardPositions: (entries) => {
        if (entries.length === 0) return
        pushHistory()
        withPage((page) => {
          for (const entry of entries) {
            touchCard(page, entry.id, (card) => {
              card.position.x = entry.x
              card.position.y = entry.y
            })
          }
        })
      },

      resizeCard: (cardId, size) => {
        pushHistory()
        withPage((page) => {
          touchCard(page, cardId, (card) => {
            card.position.width = clamp(size.width, MIN_CARD_WIDTH, MAX_CARD_WIDTH)
            card.position.height = card.collapsed
              ? COLLAPSED_HEADER_HEIGHT
              : clamp(size.height, MIN_CARD_HEIGHT, MAX_CARD_HEIGHT)
          })
        })
      },

      duplicateCards: (cardIds) => {
        pushHistory()
        const created: string[] = []
        set((state) => {
          const page = state.doc.pages.find((p) => p.id === state.activePageId)
          if (!page) return
          for (const id of cardIds) {
            const source = page.cards.find((c) => c.id === id)
            if (!source) continue
            const copy = clone(source)
            copy.id = uid('card')
            copy.title = `${source.title} copy`
            copy.position.x += 32
            copy.position.y += 32
            copy.position.zIndex = nextZIndex(page)
            copy.createdAt = new Date().toISOString()
            copy.updatedAt = copy.createdAt
            copy.parentId = null
            copy.checklist = copy.checklist.map((item) => ({ ...item, id: uid('item') }))
            page.cards.push(copy)
            created.push(copy.id)
          }
        })
        if (created.length > 0) {
          set((state) => {
            state.selectedCardIds = created
            state.selectedConnectionIds = []
          })
        }
        return created
      },

      deleteCards: (cardIds) => {
        if (cardIds.length === 0) return
        pushHistory()
        const doomed = new Set(cardIds)
        set((state) => {
          const page = state.doc.pages.find((p) => p.id === state.activePageId)
          if (!page) return
          page.cards = page.cards.filter((card) => !doomed.has(card.id))
          // Connections are stored by id, so removing a card must remove the
          // edges that referenced it.
          page.connections = page.connections.filter(
            (conn) =>
              !(
                (conn.source.kind === 'card' && doomed.has(conn.source.id)) ||
                (conn.target.kind === 'card' && doomed.has(conn.target.id))
              ),
          )
          // Remove deleted cards from group memberships.
          for (const group of page.groups) {
            group.memberCardIds = group.memberCardIds.filter((id) => !doomed.has(id))
          }
          state.selectedCardIds = []
          state.selectedConnectionIds = []
          state.contextMenu = null
        })
      },

      applyZOrder: (cardIds, mode) => {
        if (cardIds.length === 0) return
        pushHistory()
        withPage((page) => {
          if (mode === 'front') {
            let z = nextZIndex(page)
            for (const id of cardIds) {
              touchCard(page, id, (card) => {
                card.position.zIndex = z
                z += 1
              })
            }
            return
          }
          if (mode === 'back') {
            let z = lowestZIndex(page)
            for (const id of cardIds) {
              touchCard(page, id, (card) => {
                card.position.zIndex = z
                z += 1
              })
            }
            return
          }
          const ordered = [...page.cards].sort((a, b) => a.position.zIndex - b.position.zIndex)
          const selected = new Set(cardIds)
          if (mode === 'forward') {
            for (let i = ordered.length - 2; i >= 0; i--) {
              if (selected.has(ordered[i].id) && !selected.has(ordered[i + 1].id)) {
                const tmp = ordered[i].position.zIndex
                ordered[i].position.zIndex = ordered[i + 1].position.zIndex
                ordered[i + 1].position.zIndex = tmp
              }
            }
          } else {
            for (let i = 1; i < ordered.length; i++) {
              if (selected.has(ordered[i].id) && !selected.has(ordered[i - 1].id)) {
                const tmp = ordered[i].position.zIndex
                ordered[i].position.zIndex = ordered[i - 1].position.zIndex
                ordered[i - 1].position.zIndex = tmp
              }
            }
          }
        })
      },

      toggleCollapsed: (cardIds) => {
        pushHistory()
        withPage((page) => {
          const shouldCollapse = cardIds.some((id) => {
            const card = page.cards.find((c) => c.id === id)
            return card ? !card.collapsed : false
          })
          for (const id of cardIds) {
            touchCard(page, id, (card) => {
              card.collapsed = shouldCollapse
            })
          }
        })
      },

      setCardParent: (cardId, parentId) => {
        pushHistory()
        withPage((page) => {
          touchCard(page, cardId, (card) => {
            card.parentId = parentId === cardId ? null : parentId
          })
        })
      },

      setCardImage: (cardId, image) => {
        pushHistory()
        withPage((page) => {
          touchCard(page, cardId, (card) => {
            card.image = image
          })
        })
      },

      addChecklistItem: (cardId, text) => {
        pushHistory()
        withPage((page) => {
          touchCard(page, cardId, (card) => {
            card.checklist.push({ id: uid('item'), text: text ?? '', done: false })
          })
        })
      },

      updateChecklistItem: (cardId, itemId, patch) => {
        pushHistory()
        withPage((page) => {
          const item = page.cards.find((c) => c.id === cardId)?.checklist.find((i) => i.id === itemId)
          if (!item) return
          if (patch.text !== undefined) item.text = patch.text
          if (patch.done !== undefined) item.done = patch.done
        })
      },

      removeChecklistItem: (cardId, itemId) => {
        pushHistory()
        withPage((page) => {
          touchCard(page, cardId, (card) => {
            card.checklist = card.checklist.filter((item) => item.id !== itemId)
          })
        })
      },

      addTag: (cardId, tag) => {
        const clean = tag.trim().toLowerCase().replace(/\s+/g, '-')
        if (!clean) return
        pushHistory()
        withPage((page) => {
          touchCard(page, cardId, (card) => {
            if (!card.tags.includes(clean)) card.tags.push(clean)
          })
        })
      },

      removeTag: (cardId, tag) => {
        pushHistory()
        withPage((page) => {
          touchCard(page, cardId, (card) => {
            card.tags = card.tags.filter((t) => t !== tag)
          })
        })
      },

      /* ------------------------------------------------------------ */
      /* connections                                                  */
      /* ------------------------------------------------------------ */

      addConnection: (input) => {
        const state = get()
        const page = state.doc.pages.find((p) => p.id === state.activePageId)
        if (!page) return null
        if (
          input.source.kind === input.target.kind &&
          input.source.id === input.target.id
        ) {
          return null
        }
        const exists = page.connections.some(
          (c) =>
            (c.source.kind === input.source.kind &&
              c.source.id === input.source.id &&
              c.target.kind === input.target.kind &&
              c.target.id === input.target.id) ||
            (c.source.kind === input.target.kind &&
              c.source.id === input.target.id &&
              c.target.kind === input.source.kind &&
              c.target.id === input.source.id),
        )
        if (exists) {
          get().pushToast('Those are already connected.', 'info')
          return null
        }

        pushHistory()
        const settings = get().doc.settings
        const connection = createConnection({
          ...input,
          // New links start from the document defaults, relationship included,
          // so setting a default (including "no relationship") sticks.
          relationshipType: settings.defaultRelationshipType,
          style: { ...settings.defaultConnectionStyle, ...input.style },
        })
        set((draft) => {
          const target = draft.doc.pages.find((p) => p.id === draft.activePageId)
          target?.connections.push(connection)
        })
        return connection.id
      },

      updateConnection: (connectionId, patch, options) => {
        const silent = options?.silent ?? false
        if (silent) markDirty()
        else pushHistory()

        withPage((page) => {
          const connection = page.connections.find((c) => c.id === connectionId)
          if (connection) Object.assign(connection, patch)
          page.updatedAt = new Date().toISOString()
        })
      },

      updateConnectionStyle: (connectionId, patch, options) => {
        const existing = findConnection(get(), connectionId)
        if (!existing) return
        get().updateConnection(
          connectionId,
          { style: { ...existing.style, ...patch } },
          options,
        )
      },

      deleteConnections: (connectionIds) => {
        if (connectionIds.length === 0) return
        pushHistory()
        const doomed = new Set(connectionIds)
        set((state) => {
          const page = state.doc.pages.find((p) => p.id === state.activePageId)
          if (!page) return
          page.connections = page.connections.filter((conn) => !doomed.has(conn.id))
          state.selectedConnectionIds = []
          state.contextMenu = null
        })
      },

      /* ------------------------------------------------------------ */
      /* groups                                                        */
      /* ------------------------------------------------------------ */

      addGroup: (input, options) => {
        pushHistory()
        const state = get()
        const page = state.doc.pages.find((p) => p.id === state.activePageId)
        if (!page) return ''

        const center = screenToWorld(
          { x: state.viewportSize.width / 2, y: state.viewportSize.height / 2 },
          page.viewport,
        )

        const group = createGroup({
          ...input,
          position: {
            x: input?.position?.x ?? Math.round(center.x - 200),
            y: input?.position?.y ?? Math.round(center.y - 150),
            width: input?.position?.width ?? 400,
            height: input?.position?.height ?? 300,
            zIndex: input?.position?.zIndex ?? nextZIndex(page),
          },
        })

        set((draft) => {
          const target = draft.doc.pages.find((p) => p.id === draft.activePageId)
          target?.groups.push(group)
        })

        if (options?.select !== false) {
          set((draft) => {
            draft.selectedGroupId = group.id
            draft.selectedCardIds = []
            draft.selectedConnectionIds = []
          })
        }
        return group.id
      },

      updateGroup: (groupId, patch, options) => {
        const silent = options?.silent ?? false
        if (silent) markDirty()
        else pushHistory()

        withPage((page) => {
          const group = page.groups.find((g) => g.id === groupId)
          if (!group) return
          Object.assign(group, patch)
          group.updatedAt = new Date().toISOString()
        })
      },

      commitGroupPositions: (entries) => {
        if (entries.length === 0) return
        pushHistory()
        withPage((page) => {
          for (const entry of entries) {
            const group = page.groups.find((g) => g.id === entry.id)
            if (group) {
              group.position.x = entry.x
              group.position.y = entry.y
              group.updatedAt = new Date().toISOString()
              // Auto-detect cards fully inside the group bounds.
              const gx = group.position.x
              const gy = group.position.y
              const gw = group.position.width
              const gh = group.position.height
              for (const card of page.cards) {
                const cx = card.position.x
                const cy = card.position.y
                const cw = card.position.width
                const ch = card.position.height
                const fullyInside =
                  cx >= gx && cy >= gy && cx + cw <= gx + gw && cy + ch <= gy + gh
                if (fullyInside && !group.memberCardIds.includes(card.id)) {
                  group.memberCardIds.push(card.id)
                } else if (!fullyInside && group.memberCardIds.includes(card.id)) {
                  group.memberCardIds = group.memberCardIds.filter((id) => id !== card.id)
                }
              }
            }
          }
        })
      },

      deleteGroups: (groupIds) => {
        if (groupIds.length === 0) return
        pushHistory()
        const doomed = new Set(groupIds)
        set((state) => {
          const page = state.doc.pages.find((p) => p.id === state.activePageId)
          if (!page) return
          page.groups = page.groups.filter((g) => !doomed.has(g.id))
          // Remove connections referencing deleted groups.
          page.connections = page.connections.filter(
            (conn) =>
              !(
                (conn.source.kind === 'group' && doomed.has(conn.source.id)) ||
                (conn.target.kind === 'group' && doomed.has(conn.target.id))
              ),
          )
          // Remove deleted groups from other groups' member lists.
          for (const g of page.groups) {
            g.memberGroupIds = g.memberGroupIds.filter((id) => !doomed.has(id))
          }
          state.selectedGroupId = null
          state.contextMenu = null
        })
      },

      addCardToGroup: (groupId, cardId) => {
        pushHistory()
        withPage((page) => {
          const group = page.groups.find((g) => g.id === groupId)
          if (group && !group.memberCardIds.includes(cardId)) {
            group.memberCardIds.push(cardId)
            group.updatedAt = new Date().toISOString()
          }
        })
      },

      removeCardFromGroup: (groupId, cardId) => {
        pushHistory()
        withPage((page) => {
          const group = page.groups.find((g) => g.id === groupId)
          if (group) {
            group.memberCardIds = group.memberCardIds.filter((id) => id !== cardId)
            group.updatedAt = new Date().toISOString()
          }
        })
      },

      addGroupToGroup: (parentGroupId, childGroupId) => {
        if (parentGroupId === childGroupId) return
        pushHistory()
        withPage((page) => {
          const parent = page.groups.find((g) => g.id === parentGroupId)
          if (parent && !parent.memberGroupIds.includes(childGroupId)) {
            parent.memberGroupIds.push(childGroupId)
            parent.updatedAt = new Date().toISOString()
          }
        })
      },

      removeGroupFromGroup: (parentGroupId, childGroupId) => {
        pushHistory()
        withPage((page) => {
          const parent = page.groups.find((g) => g.id === parentGroupId)
          if (parent) {
            parent.memberGroupIds = parent.memberGroupIds.filter((id) => id !== childGroupId)
            parent.updatedAt = new Date().toISOString()
          }
        })
      },

      selectGroup: (groupId) => {
        set((state) => {
          state.selectedGroupId = groupId
          if (groupId) {
            state.selectedCardIds = []
            state.selectedConnectionIds = []
          }
        })
      },

      /* ------------------------------------------------------------ */
      /* viewport memory                                              */
      /* ------------------------------------------------------------ */

      centerSelection: () => {
        const state = get()
        const page = state.doc.pages.find((p) => p.id === state.activePageId)
        if (!page) return

        let rect: { x: number; y: number; width: number; height: number } | null = null

        if (state.selectedGroupId) {
          const group = page.groups.find((g) => g.id === state.selectedGroupId)
          if (group) rect = group.position
        } else if (state.selectedCardIds.length === 1) {
          const card = page.cards.find((c) => c.id === state.selectedCardIds[0])
          if (card) rect = card.position
        }

        if (!rect) return
        const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        state.setViewport(centerOn(center, state.viewportSize, 1))
      },

      animateToCenter: (center: Point, zoom = 1) => {
        const state = get()
        state.setViewport(centerOn(center, state.viewportSize, zoom))
      },

      /* ------------------------------------------------------------ */
      /* document settings                                            */
      /* ------------------------------------------------------------ */

      setDefaultCardStyle: (style) => {
        pushHistory()
        set((state) => {
          state.doc.settings.defaultCardStyle = {
            ...state.doc.settings.defaultCardStyle,
            ...style,
          }
        })
      },

      setDefaultConnectionPreset: (preset) => {
        pushHistory()
        set((state) => {
          if (preset.style) {
            state.doc.settings.defaultConnectionStyle = {
              ...state.doc.settings.defaultConnectionStyle,
              ...preset.style,
            }
          }
          if (preset.relationshipType !== undefined) {
            state.doc.settings.defaultRelationshipType = preset.relationshipType
          }
        })
      },

      resetDefaultStyles: () => {
        pushHistory()
        set((state) => {
          state.doc.settings = createDefaultSettings()
        })
      },

      /* ------------------------------------------------------------ */
      /* selection                                                    */
      /* ------------------------------------------------------------ */

      selectCards: (cardIds, additive = false) => {
        set((state) => {
          if (additive) {
            const merged = new Set([...state.selectedCardIds, ...cardIds])
            state.selectedCardIds = [...merged]
          } else {
            state.selectedCardIds = cardIds
          }
          state.selectedConnectionIds = []
        })
      },

      toggleCardSelection: (cardId) => {
        set((state) => {
          const index = state.selectedCardIds.indexOf(cardId)
          if (index === -1) {
            state.selectedCardIds = [...state.selectedCardIds, cardId]
          } else {
            state.selectedCardIds = state.selectedCardIds.filter((id) => id !== cardId)
          }
          state.selectedConnectionIds = []
        })
      },

      selectConnection: (connectionId) => {
        set((state) => {
          state.selectedConnectionIds = connectionId ? [connectionId] : []
          if (connectionId) state.selectedCardIds = []
        })
      },

      selectAllCards: () => {
        const state = get()
        const page = state.doc.pages.find((p) => p.id === state.activePageId)
        const ids = page?.cards.map((card) => card.id) ?? []
        set((draft) => {
          draft.selectedCardIds = ids
          draft.selectedConnectionIds = []
        })
      },

      clearSelection: () => {
        set((state) => {
          state.selectedCardIds = []
          state.selectedConnectionIds = []
          state.selectedGroupId = null
          state.contextMenu = null
        })
      },

      deleteSelection: () => {
        const { selectedCardIds, selectedConnectionIds, selectedGroupId, deleteCards, deleteConnections, deleteGroups } = get()
        if (selectedCardIds.length > 0) deleteCards(selectedCardIds)
        else if (selectedConnectionIds.length > 0) deleteConnections(selectedConnectionIds)
        else if (selectedGroupId) deleteGroups([selectedGroupId])
      },

      /* ------------------------------------------------------------ */
      /* ui                                                           */
      /* ------------------------------------------------------------ */

      setSearchOpen: (open) => set({ searchOpen: open }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setDialog: (dialog) => set({ dialog, contextMenu: null }),
      setContextMenu: (menu) => set({ contextMenu: menu }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilterColor: (color) => set({ filterColor: color }),

      toggleFilterTag: (tag) => {
        set((state) => {
          state.filterTags = state.filterTags.includes(tag)
            ? state.filterTags.filter((t) => t !== tag)
            : [...state.filterTags, tag]
        })
      },

      clearFilters: () => set({ searchQuery: '', filterTags: [], filterColor: null }),
      setSnapToGrid: (enabled) => set({ snapToGrid: enabled }),
      toggleSnapToGrid: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
      setGridPattern: (pattern) => set({ gridPattern: pattern }),
      setSpacePressed: (pressed) => set({ spacePressed: pressed }),
      setViewportSize: (size) => {
        const current = get().viewportSize
        if (current.width === size.width && current.height === size.height) return
        set({ viewportSize: size })
      },

      pushToast: (message, tone = 'info') => {
        // Repeating the same message means a retry loop, not new information:
        // refresh the existing toast instead of stacking copies of it.
        const existing = get().toasts.find((t) => t.message === message)
        if (existing) return
        const id = uid('toast')
        set((state) => {
          state.toasts = [...state.toasts.slice(-3), { id, message, tone }]
        })
        setTimeout(() => {
          set((state) => {
            state.toasts = state.toasts.filter((t) => t.id !== id)
          })
        }, 4000)
      },

      dismissToast: (toastId) => {
        set((state) => {
          state.toasts = state.toasts.filter((t) => t.id !== toastId)
        })
      },

      /* ------------------------------------------------------------ */
      /* history                                                      */
      /* ------------------------------------------------------------ */

      pushHistory,
      scheduleCommit: () => {
        if (commitTimer) clearTimeout(commitTimer)
        commitTimer = setTimeout(() => {
          commitTimer = null
          get().flushCommit()
        }, COMMIT_DELAY_MS)
      },

      flushCommit: () => {
        if (commitTimer) {
          clearTimeout(commitTimer)
          commitTimer = null
        }
        const snapshot = get().pendingSnapshot
        if (!snapshot) return
        set((state) => {
          state.past = [...state.past, snapshot].slice(-HISTORY_LIMIT)
          state.future = []
          state.pendingSnapshot = null
        })
      },

      undo: () => {
        const state = get()
        if (state.pendingSnapshot) {
          // Fold an in-flight edit burst into a single undo step.
          state.flushCommit()
        }
        const after = get()
        if (after.past.length === 0) return
        const previous = after.past[after.past.length - 1]
        const current = clone(after.doc)
        set((draft) => {
          draft.doc = previous
          draft.past = after.past.slice(0, -1)
          draft.future = [current, ...after.future].slice(0, HISTORY_LIMIT)
          draft.pendingSnapshot = null
          if (!draft.doc.pages.some((p) => p.id === draft.activePageId)) {
            draft.activePageId = draft.doc.pages[0]?.id ?? ''
          }
          draft.selectedCardIds = draft.selectedCardIds.filter((id) =>
            previous.pages.some((p) => p.cards.some((c) => c.id === id)),
          )
          draft.selectedConnectionIds = draft.selectedConnectionIds.filter((id) =>
            previous.pages.some((p) => p.connections.some((c) => c.id === id)),
          )
        })
      },

      redo: () => {
        const state = get()
        if (state.future.length === 0) return
        const next = state.future[0]
        const current = clone(state.doc)
        set((draft) => {
          draft.doc = next
          draft.future = state.future.slice(1)
          draft.past = [...draft.past, current].slice(-HISTORY_LIMIT)
          draft.pendingSnapshot = null
          if (!draft.doc.pages.some((p) => p.id === draft.activePageId)) {
            draft.activePageId = draft.doc.pages[0]?.id ?? ''
          }
        })
      },

      /* ------------------------------------------------------------ */
      /* document level                                               */
      /* ------------------------------------------------------------ */

      replaceDoc: (next) => {
        pushHistory()
        set((state) => {
          state.doc = next
          state.activePageId = next.pages[0]?.id ?? ''
          state.selectedCardIds = []
          state.selectedConnectionIds = []
          state.past = []
          state.future = []
          state.pendingSnapshot = null
        })
      },

      mergeDoc: (next) => {
        pushHistory()
        set((state) => {
          const stamp = new Date().toISOString()
          for (const page of next.pages) {
            const existing = state.doc.pages.find((p) => p.id === page.id)
            if (!existing) {
              state.doc.pages.push(page)
              continue
            }
            const cardIds = new Set(existing.cards.map((c) => c.id))
            for (const card of page.cards) {
              if (cardIds.has(card.id)) continue
              existing.cards.push(card)
              cardIds.add(card.id)
            }
            const groupIds = new Set(existing.groups.map((g) => g.id))
            for (const group of page.groups) {
              if (groupIds.has(group.id)) continue
              existing.groups.push(group)
              groupIds.add(group.id)
            }
            const connectionIds = new Set(existing.connections.map((c) => c.id))
            for (const connection of page.connections) {
              if (connectionIds.has(connection.id)) continue
              const sourceExists =
                (connection.source.kind === 'card' && cardIds.has(connection.source.id)) ||
                (connection.source.kind === 'group' && groupIds.has(connection.source.id))
              const targetExists =
                (connection.target.kind === 'card' && cardIds.has(connection.target.id)) ||
                (connection.target.kind === 'group' && groupIds.has(connection.target.id))
              if (!sourceExists || !targetExists) continue
              existing.connections.push(connection)
              connectionIds.add(connection.id)
            }
            existing.updatedAt = stamp
          }
          state.pendingSnapshot = null
        })
      },

      resetToSample: () => {
        pushHistory()
        const sample = normalizeDoc(createSampleDoc()).doc
        set((state) => {
          state.doc = sample
          state.activePageId = sample.pages[0].id
          state.selectedCardIds = []
          state.selectedConnectionIds = []
        })
      },
    }
  }),
)

/* ------------------------------------------------------------------ */
/* Read-only helpers                                                   */
/* ------------------------------------------------------------------ */

function findCard(state: CanvasStore, cardId: string): Card | undefined {
  const page = state.doc.pages.find((p) => p.id === state.activePageId)
  return page?.cards.find((c) => c.id === cardId)
}

function findConnection(state: CanvasStore, connectionId: string): Connection | undefined {
  const page = state.doc.pages.find((p) => p.id === state.activePageId)
  return page?.connections.find((c) => c.id === connectionId)
}
