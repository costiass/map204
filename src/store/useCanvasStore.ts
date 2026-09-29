import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { createSampleDoc } from '@/data/sample'
import {
  COLLAPSED_HEADER_HEIGHT,
  createDefaultSettings,
  createDefaultStep,
  type Anchor,
  type CardImage,
  type CardStyle,
  type CanvasDoc,
  type Connection,
  type ConnectionEndpoint,
  type ConnectionStyle,
  type Group,
  type Page,
  type Point,
  type PresentationStep,
  type Rect,
  type StepFocus,
  type StepTransition,
  type Viewport,
} from '@/types'
import {
  createConnection,
  createElement,
  createGroup,
  normalizeDoc,
} from '@/elements/serialize'
import {
  addElementToGroup as addElementToGroupOps,
  applyZOrder as applyZOrderOps,
  applyPatch,
  deleteElements as deleteElementsOps,
  duplicateElements as duplicateElementsOps,
  editNote,
  editTable as editTableOps,
  findElement,
  moveElements as moveElementsOps,
  moveGroupWithMembers,
  nextZIndex as nextZIndexOps,
  placeElement,
  removeElementFromGroup as removeElementFromGroupOps,
  resizeElement as resizeElementOps,
  resizeGroupMembers,
  setTableCell as setTableCellOps,
  resizeTableRows as resizeTableRowsOps,
  resizeTableColumns as resizeTableColumnsOps,
  toggleCollapsed as toggleCollapsedOps,
  type ZOrderMode,
} from '@/store/elementOps'
import { centerOn, screenToWorld, stepViewport } from '@/utils/geometry'
import { DEFAULT_WORKSPACE_ACCENT, DEFAULT_WORKSPACE_ICON } from '@/theme'
import { ELEMENT_HEADER_HEIGHT } from '@/elements/defaults'
import { recallViewport, rememberViewport, fallbackViewport } from '@/store/viewportStore'
import { MIN_CARD_HEIGHT } from '@/types'
import { clone, uid } from '@/utils/id'

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

// `ZOrderMode` is re-exported from `elementOps` above rather than declared here.
// The order the four modes actually perform is the store's business, but the
// *set* of them belongs with the operation, and two lists drift.

export interface CanvasStore {
  /* --- document ---------------------------------------------------- */
  doc: CanvasDoc
  activePageId: string
  /** The Supabase document ID (for saving). */
  documentId: string | null
  /** The Supabase document title, kept in step with `documents.title`. */
  documentTitle: string
  /** The workspace's own colour and icon, shown beside the title. */
  documentAccent: string
  documentIcon: string
  /**
   * What the signed-in account may do here, read from the database rather than
   * guessed from a failed write. `null` until it is known, and `null` for an
   * account with no access at all.
   */
  documentRole: 'owner' | 'editor' | 'viewer' | null
  setDocumentId: (id: string | null) => void
  setDocumentTitle: (title: string) => void
  setDocumentLookState: (look: { accent?: string; icon?: string }) => void
  setDocumentRole: (role: 'owner' | 'editor' | 'viewer' | null) => void
  setDarkMode: (enabled: boolean) => void
  setGridSize: (size: number) => void

  /**
   * A line of text along the bottom of the canvas for work that is in progress.
   *
   * A status, not a message: it appears when something starts and disappears
   * when it ends, so it cannot be misread for a toast that has already faded.
   */
  status: { message: string; detail?: string; busy?: boolean } | null
  setStatus: (status: { message: string; detail?: string; busy?: boolean } | null) => void

  /* --- selection --------------------------------------------------- */
  selectedElementIds: string[]
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
  /**
   * Why the canvas cannot be edited, if it cannot.
   *
   * The reason is stored rather than just a boolean because the two cases are
   * not the same and the difference matters to the reader:
   *
   *   'presenting'  the owner or an editor chose to present, and can stop
   *   'viewing'     this account only has `viewer` on this workspace, so the
   *                 mode is not theirs to leave
   *
   * A viewer was previously able to open a shared workspace and try to edit it,
   * with every write refused by the database and no explanation. Being told
   * "view only" up front is the honest version, and it is the same mechanism a
   * presenter uses — one thing doing both jobs rather than two features.
   */
  readOnlyReason: 'presenting' | 'viewing' | null
  setReadOnlyReason: (reason: 'presenting' | 'viewing' | null) => void
  /** True when the canvas must not be edited, for whatever reason. */
  canEdit: () => boolean
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

  /* --- saving ------------------------------------------------------- */
  /**
   * Whether everything on screen is on the server.
   *
   * Mirrored from the write path rather than derived here, because the thing
   * that knows whether a write is in flight is the write. Deriving it in the
   * store would mean duplicating the debounce's timing, and the two would
   * disagree exactly when it mattered — showing "saved" while an edit is still
   * in the timer.
   */
  saveState: 'clean' | 'unsaved' | 'saving' | 'failed'
  setSaveState: (state: 'clean' | 'unsaved' | 'saving' | 'failed') => void
  /** Wall clock of the last successful write, for "saved a moment ago". */
  savedAt: number
  setSavedAt: (at: number) => void

  /* --- presentation ------------------------------------------------- */
  /** The steps of the active page's document, in order. */
  steps: () => PresentationStep[]
  addStep: (input?: Partial<Omit<PresentationStep, 'id'>>) => string
  updateStep: (stepId: string, patch: Partial<Omit<PresentationStep, 'id'>>) => void
  removeStep: (stepId: string) => void
  moveStep: (stepId: string, delta: number) => void
  /** True while a presentation is running, whether by choice or by permission. */
  presenting: boolean
  /** Index into `steps()`, or -1 before the first step. */
  stepIndex: number
  startPresenting: (fromStepId?: string) => void
  stopPresenting: () => void
  /**
   * Move to a step.
   *
   * `instant` puts the camera at the destination instead of travelling to it.
   * Not the default, because the animation is the point of a step — but the
   * outline needs it, since somebody reading a list should not have it vanish
   * under their eye every time they click a row.
   */
  goToStep: (index: number, options?: { instant?: boolean }) => void
  nextStep: () => void
  prevStep: () => void
  /**
   * The card or group a running step is pointing at, when it wants everything
   * else dimmed. `null` means nothing is dimmed.
   *
   * Separate from `steps` because it is a property of the *presentation being
   * watched right now*, not of the document: a step says what it wants, and
   * this says which one is live.
   */
  focusTargetId: string | null
  /** How the target is marked while everything else is dimmed. */
  focusMode: StepFocus
  setFocus: (id: string | null, mode: StepFocus) => void
  /**
   * A camera move the canvas should carry out.
   *
   * The canvas owns the viewport in a ref, written straight to the DOM each
   * frame, so it cannot be driven by a state value — a store-held viewport would
   * re-render the whole tree sixty times a second. Instead the store says *where
   * to go* and bumps a token; the canvas animates to it and acknowledges.
   */
  cameraRequest: { viewport: Viewport; durationMs: number; transition: StepTransition; token: number }
  requestCamera: (viewport: Viewport, durationMs: number, transition?: StepTransition) => void

  /** The presentation inspector, which replaces the card inspector when open. */
  presentationOpen: boolean
  setPresentationOpen: (open: boolean) => void

  /** Which tab the card inspector opens on. */
  inspectorTab: 'content' | 'settings'
  setInspectorTab: (tab: 'content' | 'settings') => void

  /* --- elements ----------------------------------------------------- */
  /**
   * Makes an element of `kind` and returns its id, or `''` if there is no page.
   *
   * `kind` is a plain `string` rather than the union on purpose. The registry is
   * what says which kinds exist and which are implemented, and a menu that
   * iterates it produces a `string` — so typing this as the union would mean
   * every such call site needs a cast, and the cast is where a `table` from a
   * half-migrated menu would quietly become a note.
   *
   * The alternative is enforced where it matters: `createElement` has a
   * `default` case that refuses a kind it does not implement rather than
   * inventing one.
   */
  addElement: (
    kind: string,
    input?: Record<string, unknown>,
    options?: { select?: boolean; silent?: boolean; atScreen?: Point },
  ) => string
  updateElement: (
    elementId: string,
    patch: Record<string, unknown>,
    options?: { silent?: boolean },
  ) => void
  moveElements: (entries: Array<{ id: string; x: number; y: number }>) => void
  /**
   * `aspect` is a video's shape and is read from the element when left out.
   * `leading` is which dimension the pointer is describing — 'width' unless a
   * handle that moves the height was dragged.
   */
  resizeElement: (
    elementId: string,
    size: { width: number; height: number },
    options?: { aspect?: number | null; leading?: 'width' | 'height' },
  ) => void
  duplicateElements: (elementIds: string[]) => string[]
  deleteElements: (elementIds: string[]) => void
  applyElementZOrder: (elementIds: string[], mode: ZOrderMode) => void
  toggleElementCollapsed: (elementIds: string[]) => void

  /**
   * Merges a patch into a note's style.
   *
   * Not the same as `updateElement(id, { style })`, which *replaces* the whole
   * style object and would drop every field the caller did not mention. Every
   * caller here means "change this one colour", so this is the action they want
   * and the one that cannot be got wrong by forgetting a field.
   *
   * Note-only: a video or a table has no style to change.
   */
  updateElementStyle: (
    elementId: string,
    patch: Partial<CardStyle>,
    options?: { silent?: boolean },
  ) => void

  /** Note-only. Each of these refuses a non-note rather than writing a field
   *  no renderer reads - a checklist item on a video is a thing that cannot
   *  happen, and the type says so before it runs. */
  setNoteImage: (elementId: string, image: CardImage) => void
  addChecklistItem: (elementId: string, text?: string) => void
  updateChecklistItem: (
    elementId: string,
    itemId: string,
    patch: { text?: string; done?: boolean },
  ) => void
  removeChecklistItem: (elementId: string, itemId: string) => void
  addTag: (elementId: string, tag: string) => void
  removeTag: (elementId: string, tag: string) => void

  setTableCell: (elementId: string, row: number, column: number, value: string) => void
  editTable: (elementId: string, patch: Record<string, unknown>) => void
  /** Row count. Rewrites `cells`, so it deliberately is not a patch. */
  resizeTableRows: (elementId: string, rowCount: number) => void
  /** Column count. Rewrites `columns` and `cells`, so it deliberately is not a patch. */
  resizeTableColumns: (elementId: string, columnCount: number) => void

  /** A flash deck. A deck of one is a single card, and always has been. */
  stepFlashDeck: (elementId: string, delta: number) => void
  setFlashFacing: (elementId: string, facing: 'front' | 'back') => void

  /**
   * Records a video's real aspect once its thumbnail has loaded.
   *
   * A *derived fact*, not an edit. It must not push undo — otherwise undo after
   * opening a document lands on "the video's aspect changed" instead of on the
   * person's last actual change — and it must not mark the document dirty, so
   * merely looking at a map does not start a save.
   *
   * The element's *height* is not changed here either. Resizing a video because
   * its shape was learned would move everything below it, which is a surprise
   * for something the person did not do. The aspect is used for the next resize,
   * and the box on screen already shows the whole frame because the renderer
   * contains rather than covers.
   */
  learnVideoAspect: (elementId: string, aspect: number) => void
  addFlashCard: (elementId: string) => void
  removeFlashCard: (elementId: string, at: number) => void

  /* --- document settings -------------------------------------------- */
  /** Stores the look of `style` as the default for every new note. */
  setDefaultNoteStyle: (style: Partial<CardStyle>) => void
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
  /** Moves each group *and what is inside it*. A group is a container, not a
   *  frame drawn around its contents. */
  moveGroups: (entries: Array<{ id: string; x: number; y: number }>) => void
  /**
   * Rescales members relative to where the group's corner *was*, so the contents
   * keep their arrangement rather than staying the same size inside a different
   * box. One scale, not per-axis: a video keeps its aspect.
   */
  resizeGroup: (groupId: string, size: { width: number; height: number }) => void
  deleteGroups: (groupIds: string[]) => void
  addElementToGroup: (groupId: string, elementId: string) => void
  removeElementFromGroup: (groupId: string, elementId: string) => void
  selectGroup: (groupId: string | null) => void

  /* --- selection ---------------------------------------------------- */
  selectElements: (elementIds: string[], additive?: boolean) => void
  toggleElementSelection: (elementId: string) => void
  selectConnection: (connectionId: string | null) => void
  selectAllElements: () => void
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

// `nextZIndex` and `lowestZIndex` live in `elementOps`, where they are covered by
// `test:element-ops`. Two copies of "the next z-index" is one of them wrong.

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

    return {
      doc: initialDoc,
      activePageId: initialDoc.pages[0]?.id ?? '',
      documentId: null,
      documentTitle: '',
      documentAccent: DEFAULT_WORKSPACE_ACCENT,
      documentIcon: DEFAULT_WORKSPACE_ICON,
      documentRole: null,
      status: null,

      selectedElementIds: [],
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
      readOnlyReason: null,
      presenting: false,
      stepIndex: -1,
      cameraRequest: { viewport: { x: 0, y: 0, zoom: 1 }, durationMs: 0, transition: 'ease', token: 0 },
      focusTargetId: null,
      focusMode: 'none',
      presentationOpen: false,
      saveState: 'clean',
      savedAt: 0,
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
          // Opening a workspace replaces the document, so nothing about the
          // previous one carries over — including the lock. Being a viewer of
          // one map says nothing about the one you just opened, and keeping the
          // lock would leave somebody stuck in a document they can edit. The
          // role for the *new* workspace sets it again as soon as it is read.
          state.presenting = false
          state.stepIndex = -1
          state.readOnlyReason = null
          // A dim belongs to the run that asked for it, and the run is over.
          state.focusTargetId = null
          state.focusMode = 'none'
        })
      },

      applyRemotePage: (pageId, page) => {
        set((state) => {
          const existing = state.doc.pages.find((p) => p.id === pageId)
          if (!existing) return
          existing.title = page.title
          existing.viewport = page.viewport
          existing.elements = page.elements
          existing.groups = page.groups
          existing.connections = page.connections
          existing.updatedAt = page.updatedAt
          // Selections may point at objects that no longer exist.
          const cardIds = new Set(page.elements.map((c) => c.id))
          const groupIds = new Set(page.groups.map((g) => g.id))
          state.selectedElementIds = state.selectedElementIds.filter((id) => cardIds.has(id))
          if (state.selectedGroupId && !groupIds.has(state.selectedGroupId)) {
            state.selectedGroupId = null
          }
          state.selectedConnectionIds = []
        })
      },

      setDocumentId: (id) => set({ documentId: id }),

      setDocumentTitle: (title) => set({ documentTitle: title }),

      setDocumentLookState: (look) =>
        set({
          ...(look.accent !== undefined ? { documentAccent: look.accent } : null),
          ...(look.icon !== undefined ? { documentIcon: look.icon } : null),
        }),

      setDocumentRole: (documentRole) =>
        set((state) => {
          state.documentRole = documentRole
          // A viewer is locked out of editing here and only here, so the reason
          // follows the role. Note the asymmetry with 'presenting': that one is
          // dropped when the mode ends, this one must not be — the permission
          // that set it is still in force.
          if (documentRole === 'viewer') {
            state.readOnlyReason = 'viewing'
          } else if (state.readOnlyReason === 'viewing') {
            state.readOnlyReason = null
          }
        }),

      setStatus: (status) => set({ status }),

      setDarkMode: (enabled) => set({ darkMode: enabled }),

      setReadOnlyReason: (readOnlyReason) => set({ readOnlyReason }),

      canEdit: () => get().readOnlyReason === null,

      setGridSize: (size) => set({ gridSize: size }),

      /* ------------------------------------------------------------ */
      /* pages                                                        */
      /* ------------------------------------------------------------ */

      activePage: () => get().doc.pages.find((p) => p.id === get().activePageId),

      setActivePage: (pageId) => {
        if (get().activePageId === pageId) return
        const page = get().doc.pages.find((p) => p.id === pageId)
        if (!page) return
        set((state) => {
          state.activePageId = pageId
          state.selectedElementIds = []
          state.selectedConnectionIds = []
          state.contextMenu = null
          /*
            This reader's own camera for this page, from their own browser.
           *
            Not the one in the document. Two people in one map are looking at two
            different places, and taking the camera out of the document is what stops
            the last person to have opened it from deciding where everybody else
            starts.
           *
            `page.viewport` still holds *something* -- it is the in-memory camera the
            canvas reads every frame -- so it has to be replaced with this reader's
            remembered one here, or the page would open on whoever's camera was last
            written into a column nothing writes any more.
           *
            `fallbackViewport` rather than the raw value, so a document written by an
            older build, or hand-edited in the database, cannot open at a zoom of
            `NaN`.
           */
          page.viewport =
            rememberViewport(state.documentId ?? 'local', pageId) ?? fallbackViewport(page.viewport)
        })
      },

      addPage: (title) => {
        pushHistory()
        const pageId = uid('page')
        const page: Page = {
          id: pageId,
          title: title?.trim() || `Page ${get().doc.pages.length + 1}`,
          // Page order. This replaces v1's `position`, which held an x/y/width/
          // height nothing ever read — the sidebar sorted by array order and the
          // database has always had an `ordinal` column. The real field finally
          // made it into the document.
          ordinal: get().doc.pages.length,
          viewport: { x: 0, y: 0, zoom: 1 },
          elements: [],
          groups: [],
          connections: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        set((state) => {
          state.doc.pages.push(page)
          state.activePageId = pageId
          state.selectedElementIds = []
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
            draft.selectedElementIds = []
            draft.selectedConnectionIds = []
          }
        })
      },

      setViewport: (viewport) => {
        // The camera lives on the page in memory, and in this browser between
        // visits. It is deliberately not an undoable document edit, so it never
        // triggers a history entry -- and it is not in `pageSignature`, so it never
        // triggers a write or a broadcast either.
        //
        // That last part is the change. Panning used to be an edit: it changed the
        // signature, so every wheel tick queued a save and told the room. Two people
        // in one map have two cameras, and syncing them made the last person to move
        // decide where the other was looking.
        withPage((page) => {
          page.viewport = viewport
          // `recallViewport` is the only exit. It writes the browser cache and then
          // hands the camera to whoever has registered a sink -- currently the
          // per-workspace settings file. See the note on `setCameraSink` for why that
          // is a callback and not an import.
          recallViewport(get().documentId ?? 'local', page.id, viewport)
        })
      },

      setViewportForPage: (pageId, viewport) => {
        set((state) => {
          const page = state.doc.pages.find((p) => p.id === pageId)
          if (!page) return
          page.viewport = viewport
          recallViewport(state.documentId ?? 'local', page.id, viewport)
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

      /* ------------------------------------------------------------ */
      /* presentation                                                  */
      /* ------------------------------------------------------------ */

      steps: () => get().doc.settings.steps,

      addStep: (input) => {
        const id = uid('step')
        pushHistory()
        set((state) => {
          // The defaults live in one function, so a step created from the
          // toolbar, the inspector or a shortcut is the same shape every time.
          state.doc.settings.steps.push({ ...createDefaultStep(input), id })
        })
        return id
      },
      updateStep: (stepId, patch) => {
        pushHistory()
        set((state) => {
          const step = state.doc.settings.steps.find((s) => s.id === stepId)
          if (!step) return
          Object.assign(step, patch)
          // Two fields depend on their neighbours, and editing one of them must
          // not leave the other lying. An instant step has no time to spend
          // arriving, and a manual step has nothing to count down — keeping
          // those numbers would store a duration and a delay the step ignores,
          // which is worse than storing none.
          if (step.transition === 'instant') step.durationMs = 0
          if (step.trigger !== 'timed') step.autoAdvanceMs = 0
        })
      },

      removeStep: (stepId) => {
        pushHistory()
        set((state) => {
          state.doc.settings.steps = state.doc.settings.steps.filter((s) => s.id !== stepId)
          // The running index is a position, not a key, so deleting a step before
          // the current one has to move it back or the presentation jumps a step
          // ahead and lands somewhere the presenter never chose.
          const index = state.stepIndex
          const count = state.doc.settings.steps.length
          if (index >= count) state.stepIndex = count - 1
        })
      },

      moveStep: (stepId, delta) => {
        pushHistory()
        set((state) => {
          const steps = state.doc.settings.steps
          const from = steps.findIndex((s) => s.id === stepId)
          if (from < 0) return
          const to = from + delta
          if (to < 0 || to >= steps.length) return
          const [step] = steps.splice(from, 1)
          steps.splice(to, 0, step)
        })
      },

      startPresenting: (fromStepId) => {
        const steps = get().doc.settings.steps
        const index = fromStepId ? steps.findIndex((s) => s.id === fromStepId) : -1
        set((state) => {
          state.presenting = true
          state.stepIndex = index >= 0 ? index : 0
          // Presenting is also a read-only reason: the whole point is that the
          // thing on the projector cannot be dragged off mid-sentence.
          //
          // But it must never *replace* 'viewing'. A viewer who presents would
          // otherwise have their permission-based lock overwritten by a
          // mode-based one, and `stopPresenting` would then clear the lot and
          // leave them editing a document they are only allowed to read. The
          // stronger reason wins, and the weaker one is never written.
          if (state.readOnlyReason === null) state.readOnlyReason = 'presenting'
        })
        get().goToStep(index >= 0 ? index : 0)
      },

      stopPresenting: () => {
        const state = get()
        set({ presenting: false, stepIndex: -1, focusTargetId: null, focusMode: 'none' })
        // Only clear the reason if presenting is what set it. A viewer whose
        // permission is the reason must still be locked after they stop.
        if (state.readOnlyReason === 'presenting') {
          set({ readOnlyReason: null })
        }
      },

      goToStep: (index, options) => {
        const state = get()
        const steps = state.doc.settings.steps
        if (steps.length === 0) {
          set({ stepIndex: -1 })
          return
        }
        const clamped = Math.max(0, Math.min(index, steps.length - 1))
        const step = steps[clamped]
        set({ stepIndex: clamped })

        // The target is resolved *now*, from the live document, rather than
        // stored on the step. A step pointing at an element that was since
        // deleted then falls back to an establishing shot instead of flying the
        // camera to nowhere.
        const page = state.doc.pages.find((p) => p.id === state.activePageId)
        let bounds: Rect | null = null
        if (page && step.targetKind === 'element' && step.targetId) {
          const element = page.elements.find((c) => c.id === step.targetId)
          // A collapsed element presents as its title bar, so the camera frames
          // what is on screen rather than the full height it would occupy
          // expanded.
          if (element) {
            bounds = {
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.collapsed ? COLLAPSED_HEADER_HEIGHT : element.height,
            }
          }
        } else if (page && step.targetKind === 'group' && step.targetId) {
          const group = page.groups.find((g) => g.id === step.targetId)
          if (group) bounds = { x: group.x, y: group.y, width: group.width, height: group.height }
        }

        const viewport = stepViewport(bounds, state.viewportSize, step.zoom)

        // What the step does to everything that is not its target. `none` clears
        // it, which is what stops a dim from one step outliving the step that
        // asked for it.
        state.setFocus(step.focus === 'none' ? null : (step.targetId ?? null), step.focus)

        state.requestCamera(
          viewport,
          // An instant step has no arrival to animate, and neither does a jump
          // the caller asked to be instant. Zero is a real value the canvas
          // handles by writing the viewport in one go, not a missing one.
          step.transition === 'instant' || options?.instant ? 0 : step.durationMs,
          step.transition,
        )
      },

      nextStep: () => {
        const state = get()
        const total = state.doc.settings.steps.length
        if (total === 0) return
        const step = state.doc.settings.steps[state.stepIndex]
        // A held step ignores the keys on purpose. The presenter left it up while
        // somebody asked a question, and a stray spacebar yanking the screen away
        // is worse than a key that does nothing.
        if (step?.trigger === 'hold') return
        // Stopping at the end rather than wrapping: a loop that silently
        // restarts looks like the app forgot what slide it was on.
        if (state.stepIndex >= total - 1) {
          state.stopPresenting()
          return
        }
        state.goToStep(state.stepIndex + 1)
      },

      prevStep: () => {
        const state = get()
        if (state.stepIndex <= 0) return
        const step = state.doc.settings.steps[state.stepIndex]
        if (step?.trigger === 'hold') return
        state.goToStep(state.stepIndex - 1)
      },

      requestCamera: (viewport, durationMs, transition) => {
        set((state) => {
          state.cameraRequest = {
            viewport,
            durationMs,
            transition: transition ?? 'ease',
            token: state.cameraRequest.token + 1,
          }
        })
      },

      setFocus: (id, mode) => set({ focusTargetId: id, focusMode: mode }),

      setPresentationOpen: (presentationOpen) => set({ presentationOpen }),

      setSaveState: (saveState) => {
        set({ saveState })
        if (saveState === 'clean') set({ savedAt: Date.now() })
      },
      setSavedAt: (savedAt) => set({ savedAt }),

      toggleDarkMode: () => set((state) => { state.darkMode = !state.darkMode }),

      /* ------------------------------------------------------------ */
      /* elements                                                     */
      /* ------------------------------------------------------------ */

      addElement: (kind, input, options) => {
        const silent = options?.silent ?? false
        if (!silent) pushHistory()

        const state = get()
        const page = state.doc.pages.find((p) => p.id === state.activePageId)
        if (!page) return ''

        // A right-click insert means *here* — the point clicked, not the middle
        // of the window. A new element appearing somewhere else is a small lie
        // about where it was asked for.
        const anchor = options?.atScreen
          ? screenToWorld(options.atScreen, page.viewport)
          : screenToWorld(
              { x: state.viewportSize.width / 2, y: state.viewportSize.height / 2 },
              page.viewport,
            )

        // A new note starts from the document's own default, so "set as default"
        // sticks for what is made after it and not for what already exists.
        const built = createElement(
          kind,
          kind === 'note'
            ? {
                ...input,
                style: {
                  ...state.doc.settings.defaultNoteStyle,
                  ...((input as { style?: object } | undefined)?.style as object),
                },
              }
            : input,
          { x: anchor.x, y: anchor.y },
        )

        let id = ''
        set((draft) => {
          const target = draft.doc.pages.find((p) => p.id === draft.activePageId)
          if (!target) return
          id = placeElement(target, built, { x: anchor.x, y: anchor.y }).id
        })
        if (!id) return ''

        if (options?.select !== false) {
          set((draft) => {
            draft.selectedElementIds = [id]
            draft.selectedConnectionIds = []
          })
        }
        return id
      },

      updateElement: (elementId, patch, options) => {
        if (options?.silent ?? false) markDirty()
        else pushHistory()

        withPage((page) => {
          const element = findElement(page, elementId)
          if (element) applyPatch(element, patch)
          page.updatedAt = new Date().toISOString()
        })
      },

      moveElements: (entries) => {
        if (entries.length === 0) return
        pushHistory()
        withPage((page) => {
          moveElementsOps(page, entries)
        })
      },

      /**
       * A video keeps its aspect; `leading` is which dimension the pointer is
       * describing, because dragging a left handle means the *width* is the one
       * being asked for. Left out, `resizeElement` falls back to the video's own
       * aspect, so a caller that does not care does not have to know.
       */
      resizeElement: (elementId, size, options) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          // A collapsed element's height is the title bar. Resizing it open to
          // some other height would leave an element whose height nobody chose.
          const target =
            element?.collapsed === true
              ? { width: size.width, height: COLLAPSED_HEADER_HEIGHT }
              : size
          resizeElementOps(
            page,
            elementId,
            target,
            options?.aspect != null ? { aspect: options.aspect } : {},
            options?.leading ?? 'width',
          )
        })
      },

      duplicateElements: (elementIds) => {
        if (elementIds.length === 0) return []
        pushHistory()
        const created: string[] = []
        set((state) => {
          const page = state.doc.pages.find((p) => p.id === state.activePageId)
          if (!page) return
          created.push(...duplicateElementsOps(page, elementIds, uid))
        })
        if (created.length > 0) {
          set((state) => {
            state.selectedElementIds = created
            state.selectedConnectionIds = []
          })
        }
        return created
      },

      deleteElements: (elementIds) => {
        if (elementIds.length === 0) return
        pushHistory()
        set((state) => {
          const page = state.doc.pages.find((p) => p.id === state.activePageId)
          if (!page) return
          // Takes the connections and the group memberships with it. Both are
          // stored by id, and would otherwise point at nothing — which shows up
          // as a line drawn to nowhere with nothing on screen to explain it.
          deleteElementsOps(page, elementIds)
          state.selectedElementIds = []
          state.selectedConnectionIds = []
          state.contextMenu = null
        })
      },

      applyElementZOrder: (elementIds, mode) => {
        if (elementIds.length === 0) return
        pushHistory()
        withPage((page) => {
          applyZOrderOps(page, elementIds, mode)
        })
      },

      toggleElementCollapsed: (elementIds) => {
        if (elementIds.length === 0) return
        pushHistory()
        withPage((page) => {
          toggleCollapsedOps(page, elementIds)
        })
      },

      /* --- note-only -------------------------------------------------- */
      //
      // Each of these refuses a non-note rather than writing a field no renderer
      // reads. Adding a checklist item to a video is a thing that cannot happen,
      // and the type says so before it runs.

      updateElementStyle: (elementId, patch, options) => {
        if (options?.silent ?? false) markDirty()
        else pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'note') return
          // Merged, not assigned. Assigning would replace the whole style with
          // the two fields the caller mentioned.
          element.style = { ...element.style, ...patch }
          element.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
        })
      },

      setNoteImage: (elementId, image) => {
        pushHistory()
        withPage((page) => {
          editNote(page, elementId, { image })
        })
      },

      addChecklistItem: (elementId, text) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'note') return
          element.checklist.push({ id: uid('item'), text: text ?? '', done: false })
          element.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
        })
      },

      updateChecklistItem: (elementId, itemId, patch) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'note') return
          const item = element.checklist.find((i) => i.id === itemId)
          if (!item) return
          if (patch.text !== undefined) item.text = patch.text
          if (patch.done !== undefined) item.done = patch.done
          element.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
        })
      },

      removeChecklistItem: (elementId, itemId) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'note') return
          element.checklist = element.checklist.filter((item) => item.id !== itemId)
          element.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
        })
      },

      addTag: (elementId, tag) => {
        const clean = tag.trim().toLowerCase().replace(/\s+/g, '-')
        if (!clean) return
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'note') return
          if (!element.tags.includes(clean)) element.tags.push(clean)
          element.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
        })
      },

      removeTag: (elementId, tag) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'note') return
          element.tags = element.tags.filter((t) => t !== tag)
          element.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
        })
      },

      setTableCell: (elementId, row, column, value) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'table') return
          setTableCellOps(element, row, column, value)
          page.updatedAt = new Date().toISOString()
        })
      },

      /** Headers, borders, stripes — anything that is display rather than content. */
      editTable: (elementId, patch) => {
        pushHistory()
        withPage((page) => {
          editTableOps(page, elementId, patch)
        })
      },

      /**
       * Row and column counts go through their own actions rather than
       * `editTable`, because they have to rewrite `cells` and a patch cannot.
       *
       * `rowCount` is the stride of the column-major `cells` array, so setting it
       * as a field reinterprets every cell in the table. That is what the old
       * "+ Row" button did.
       */
      resizeTableRows: (elementId, rowCount) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'table') return
          resizeTableRowsOps(element, rowCount)
          page.updatedAt = new Date().toISOString()
        })
      },

      resizeTableColumns: (elementId, columnCount) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'table') return
          resizeTableColumnsOps(element, columnCount, uid)
          page.updatedAt = new Date().toISOString()
        })
      },

      /* --- flash decks ------------------------------------------------ */

      stepFlashDeck: (elementId, delta) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'flash') return
          if (element.cards.length === 0) return
          // Wraps: a deck is something you flick through, and a deck that
          // stopped at the end would need a key to get back from.
          element.cardIndex =
            (element.cardIndex + delta + element.cards.length) % element.cards.length
          // Stepping shows the question again. Staying on the answer after moving
          // on means the next card is never asked.
          element.showing = 'front'
          element.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
        })
      },

      setFlashFacing: (elementId, facing) => {
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'flash') return
          element.showing = facing
          element.updatedAt = new Date().toISOString()
        })
      },

      learnVideoAspect: (elementId, aspect) => {
        // Guarded twice: a nonsense aspect would collapse every later resize,
        // and an element that is not a video has no aspect to learn.
        if (!Number.isFinite(aspect) || aspect <= 0.05 || aspect > 10) return
        // `set` rather than `withPage`, so no `updatedAt` is stamped and the
        // document is not marked dirty. See the note on the interface.
        set((draft) => {
          const page = draft.doc.pages.find((p) => p.id === draft.activePageId)
          const element = page?.elements.find((e) => e.id === elementId)
          if (!element || element.kind !== 'video') return
          if (Math.abs((element.aspect ?? 0) - aspect) < 0.02) return
          element.aspect = aspect

          /*
           * Bring the height with it.
           *
           * The whole point of learning a video's real shape is that the element
           * *is* that shape -- edge to edge, no padding, nothing letterboxed or
           * cropped. Recording the aspect and leaving the height alone gives an
           * element whose box is the old assumed 16:9 and whose video is now
           * something else, so the video is cropped or padded instead. The element
           * is resized rather than re-derived from scratch, because only the width
           * is the author's business; the height was never a choice, it was the
           * aspect's arithmetic.
           *
           * Only while `keepAspect`, which is the flag that says the height is not
           * independently the author's. A video whose height was set deliberately
           * keeps it.
           */
          if (element.keepAspect) {
            const height = Math.round(ELEMENT_HEADER_HEIGHT + element.width / aspect)
            if (height >= MIN_CARD_HEIGHT) element.height = height
          }
        })
      },

      addFlashCard: (elementId) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'flash') return
          element.cards.push([
            { id: uid('face'), text: '' },
            { id: uid('face'), text: '' },
          ])
          element.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
        })
      },

      removeFlashCard: (elementId, at) => {
        pushHistory()
        withPage((page) => {
          const element = findElement(page, elementId)
          if (!element || element.kind !== 'flash') return
          // A deck with no cards cannot be stepped through, and an element that
          // renders as an empty frame is not a useful starting point.
          if (element.cards.length <= 1) return
          element.cards.splice(at, 1)
          if (element.cardIndex >= element.cards.length) element.cardIndex = 0
          element.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
        })
      },
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

        // Flat, not a nested `position`. In v1 the geometry sat behind an
        // object that every element and group repeated identically, and two of
        // them could disagree about where something was.
        const group = createGroup({
          ...input,
          x: input?.x ?? Math.round(center.x - 200),
          y: input?.y ?? Math.round(center.y - 150),
          width: input?.width ?? 400,
          height: input?.height ?? 300,
          zIndex: input?.zIndex ?? nextZIndexOps(page),
        })

        set((draft) => {
          const target = draft.doc.pages.find((p) => p.id === draft.activePageId)
          target?.groups.push(group)
        })

        if (options?.select !== false) {
          set((draft) => {
            draft.selectedGroupId = group.id
            draft.selectedElementIds = []
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

      /**
       * Moves each group *and what is inside it*.
       *
       * The old code moved the rectangle and left the contents where they were,
       * which is a frame drawn around things rather than a container. Moving a
       * group that visibly does not move its contents reads as a bug even when
       * the members are only implied by their position.
       */
      moveGroups: (entries) => {
        if (entries.length === 0) return
        pushHistory()
        withPage((page) => {
          for (const entry of entries) {
            moveGroupWithMembers(page, entry.id, entry.x, entry.y)
          }
        })
      },

      /**
       * Rescales members relative to where the group's corner *was*.
       *
       * One scale rather than one per axis, so a video inside a group keeps its
       * aspect instead of being stretched into the group's proportions.
       */
      resizeGroup: (groupId, size) => {
        pushHistory()
        withPage((page) => {
          const group = page.groups.find((g) => g.id === groupId)
          if (!group) return
          // The old bounds have to be captured *before* they change, because the
          // scale is defined as how much the box grew.
          const before = { x: group.x, y: group.y, width: group.width, height: group.height }
          group.width = size.width
          group.height = size.height
          group.updatedAt = new Date().toISOString()
          page.updatedAt = new Date().toISOString()
          resizeGroupMembers(page, group, before)
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
          state.selectedGroupId = null
          state.contextMenu = null
        })
      },

      addElementToGroup: (groupId, elementId) => {
        pushHistory()
        withPage((page) => {
          addElementToGroupOps(page, groupId, elementId)
        })
      },

      removeElementFromGroup: (groupId, elementId) => {
        pushHistory()
        withPage((page) => {
          removeElementFromGroupOps(page, groupId, elementId)
        })
      },

      selectGroup: (groupId) => {
        set((state) => {
          state.selectedGroupId = groupId
          if (groupId) {
            state.selectedElementIds = []
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
          if (group) rect = { x: group.x, y: group.y, width: group.width, height: group.height }
        } else if (state.selectedElementIds.length === 1) {
          const element = page.elements.find((c) => c.id === state.selectedElementIds[0])
          if (element) {
            rect = { x: element.x, y: element.y, width: element.width, height: element.height }
          }
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

      setDefaultNoteStyle: (style) => {
        pushHistory()
        set((state) => {
          state.doc.settings.defaultNoteStyle = {
            ...state.doc.settings.defaultNoteStyle,
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

      selectElements: (elementIds, additive = false) => {
        set((state) => {
          state.selectedElementIds = additive
            ? [...new Set([...state.selectedElementIds, ...elementIds])]
            : elementIds
          state.selectedConnectionIds = []
        })
      },

      toggleElementSelection: (elementId) => {
        set((state) => {
          state.selectedElementIds = state.selectedElementIds.includes(elementId)
            ? state.selectedElementIds.filter((id) => id !== elementId)
            : [...state.selectedElementIds, elementId]
          state.selectedConnectionIds = []
        })
      },

      selectConnection: (connectionId) => {
        set((state) => {
          state.selectedConnectionIds = connectionId ? [connectionId] : []
          if (connectionId) state.selectedElementIds = []
        })
      },

      selectAllElements: () => {
        const state = get()
        const page = state.doc.pages.find((p) => p.id === state.activePageId)
        const ids = page?.elements.map((element) => element.id) ?? []
        set((draft) => {
          draft.selectedElementIds = ids
          draft.selectedConnectionIds = []
        })
      },

      clearSelection: () => {
        set((state) => {
          state.selectedElementIds = []
          state.selectedConnectionIds = []
          state.selectedGroupId = null
          state.contextMenu = null
        })
      },

      deleteSelection: () => {
        const {
          selectedElementIds,
          selectedConnectionIds,
          selectedGroupId,
          deleteElements,
          deleteConnections,
          deleteGroups,
        } = get()
        if (selectedElementIds.length > 0) deleteElements(selectedElementIds)
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
          draft.selectedElementIds = draft.selectedElementIds.filter((id) =>
            previous.pages.some((p) => p.elements.some((c) => c.id === id)),
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
          state.selectedElementIds = []
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
            const cardIds = new Set(existing.elements.map((c) => c.id))
            for (const card of page.elements) {
              if (cardIds.has(card.id)) continue
              existing.elements.push(card)
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
                (connection.source.kind === 'element' && cardIds.has(connection.source.id)) ||
                (connection.source.kind === 'group' && groupIds.has(connection.source.id))
              const targetExists =
                (connection.target.kind === 'element' && cardIds.has(connection.target.id)) ||
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
        const sample = normalizeDoc(createSampleDoc())
        set((state) => {
          state.doc = sample
          state.activePageId = sample.pages[0].id
          state.selectedElementIds = []
          state.selectedConnectionIds = []
        })
      },
    }
  }),
)

/* ------------------------------------------------------------------ */
/* Read-only helpers                                                   */
/* ------------------------------------------------------------------ */

function findConnection(state: CanvasStore, connectionId: string): Connection | undefined {
  const page = state.doc.pages.find((p) => p.id === state.activePageId)
  return page?.connections.find((c) => c.id === connectionId)
}
