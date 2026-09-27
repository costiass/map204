# CardCanvas

An infinite canvas for turning class notes into connected idea maps. Drop in
cards, write Markdown, draw arrows between them, and keep the whole thing in
your browser. No account, no server, no network calls — everything is saved to
`localStorage` and can be exported as JSON.

Built with React 19, TypeScript, Vite, Tailwind CSS v4 and Zustand. The canvas
engine is hand-rolled (DOM + SVG) rather than pulled from a library, so dragging
and zooming never go through a framework re-render.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5173. A sample document (Photosynthesis + Cell
Respiration) loads on first run so there is something to drag around.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck, then produce a production build in `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc -b`, no emit |
| `npm run lint` | oxlint |
| `npm run smoke` | Render the app headlessly and assert the data layer behaves |

## Using the canvas

**Cards.** Click anywhere on a card — body, title, or header — to select it;
drag from any of those to move it, and drag the bottom-right corner to resize
(both dimensions snap to the grid when it is on). The title stays editable in
place: clicking it selects the card and puts a caret there, and dragging across
it picks out text instead of moving the card. Select a card and the inspector
opens on the right, taking 30–50% of the window; it slides in, and the canvas
shifts by half its new width so whatever was in the middle of the canvas stays in
the middle, easing across so the move reads as a slide. It has two tabs:

- **Content** — the card as a Markdown page. Write, split, or preview, with a
  formatting toolbar. Images go anywhere: `![a diagram](…)` from a URL, a
  dropped or pasted file (embedded as a data URL), or the separate banner image.
  Tags, checklist, and child cards live here too.
- **Settings** — colours, border (width, colour, radius), shadow, position,
  size, z-order, parent, and collapse. “Set as default style” makes every new
  card start from this look; “Reset defaults” undoes that.

**Default styles.** `Settings ▸ Defaults` stores a default card and connection
style on the document, so new objects match your conventions. Right-click a card
or an arrow for the same action on the current one. For links the default covers
the relationship as well as the look: a link with no relationship can be the
default, and then new links are drawn without a word on them.

**Connections.** Drag from one of the four anchor dots on a card edge onto
another card. The arrow re-routes live as you move either end, and can be styled
as straight, curved, or stepped with a solid, dashed, or dotted stroke. The
relationship is any of the presets, a value of your own, or **None** for a plain
line with no word on it; “Set as default for new links” remembers both the look
and the relationship. A connection only ever stores two card ids and two anchors,
so **collapsing a card never moves its links** — the arrow keeps pointing at where
the card really is while the card draws as a short header.

**Multi-select.** Shift-click cards, or hold `Shift` while dragging on empty
space to marquee-select. Bulk move, recolour, tag, align, stack, and delete from
the inspector.

**Navigation.** Drag empty space, use the middle mouse button, or hold `Space`
to pan. `Ctrl/Cmd` + scroll, pinch, or the zoom controls to zoom. `F` fits the
whole page. Hovering a card, the wheel scrolls that card's own content; once the
card is scrolled to its end the canvas takes the wheel again, and `Ctrl/Cmd` +
wheel always zooms. Scrolling never changes the selection — only a click opens
the inspector.

**Pages.** The sidebar holds multiple pages, each with its own cards,
connections, and saved viewport. Rename, duplicate, reorder, and delete them. It
starts closed so the canvas gets the whole window; the button at the far left of
the toolbar opens it.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `N` | New card |
| `Delete` / `Backspace` | Delete selection |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + S` | Write to the database now |
| `Ctrl/Cmd + A` | Select all cards |
| `Ctrl/Cmd + D` | Duplicate selection |
| `F` | Fit page to view |
| `Escape` | Close menus/dialogs, then clear selection |
| `Space` (hold) | Pan mode |

Single-key shortcuts are ignored while you are typing in a field, so `N` in a
card title stays an `N`.

## How it is put together

```
src/
  types.ts              Document model, presets, and hard limits
  data/sample.ts        The starter document
  store/
    useCanvasStore.ts   Single Zustand store: document, selection, UI, history
    database.ts         IndexedDB persistence: one record per page + settings
    persistence.ts      The old localStorage JSON, kept as fallback + migration
  utils/
    geometry.ts         World/screen conversion, fit, centre, snap
    edges.ts            Connection routing, arrowheads, dash patterns
    serialize.ts        Export, and a defensive import that repairs bad JSON
    markdown.ts         Markdown renderer, plain text, legacy HTML conversion
    filters.ts          Search and filter predicates
    image.ts            File → data URL, byte formatting
  components/           Canvas, cards, connections, inspector, dialogs
  hooks/                Global shortcuts and debounced autosave
  smoke.tsx             Headless checks: rendering, Markdown, storage, store
  smokeIndexedDB.ts     In-memory IndexedDB used only by the smoke suite
```

Two ideas carry most of the weight:

**The store is the single source of truth.** Components read slices with narrow
selectors and write through named actions, so every mutation passes one place.
Undo/redo snapshots the document on a 700 ms debounce (so a drag is one undo
step, not two hundred) with a history limit of 80.

**Cards and connections are separate.** A connection stores only
`sourceCardId`, `targetCardId`, and two anchors — never coordinates. Paths are
recomputed from live card rectangles every frame, which is why arrows follow
cards correctly, survive import/export, and need no repair when a card is
resized or moved.

### Card content is Markdown

A card body is stored as Markdown, which is also the export format for that body.
The renderer (`utils/markdown.ts`) escapes all input first and only emits tags it
built itself, so raw HTML in a card is shown as text and can never execute. Image
sources are limited to `http(s)`, relative paths, `data:image/*`, and `blob:`;
`javascript:` and `data:text/html` are refused. Older documents whose bodies were
HTML are converted to Markdown on import.

Emphasis follows the usual flanking rules, so `*italic*`, `**bold**`, and
`***both***` work — including nested — while `snake_case_name` and `2 * 3 * 4`
are left alone.

### Coordinate contract

Card `position.x/y` are **world** coordinates. The page viewport
(`{ x, y, zoom }`) is the transform from world to screen. Pan and zoom are
applied by writing the transform directly to the DOM inside a ref, avoiding a
re-render per frame; the ref is the live value that any later render reads.

### Persistence and import

The document lives in **IndexedDB**, not in one JSON blob. Two object stores:

| Store | Holds |
| --- | --- |
| `meta` | format version and the document settings (default styles, default relationship) |
| `pages` | one record per page, each tagged with its position in the page list |

Why not keep the single JSON string: it made every autosave re-serialise and
rewrite *everything* — every page, every card, every embedded image — no matter
how small the edit. A page is the natural unit, because the app only ever edits
the page you are looking at, so a keystroke in a card rewrites that one record and
touches nothing else.

Which pages changed is decided by object identity. Immer hands out a new page
object for exactly the pages it changed, so the check is a Map lookup per page and
costs no serialisation at all; a save with nothing edited performs no I/O. All the
changed records go out in one transaction, so the document is never half-written.
Autosave is debounced at 500 ms with a 2.5 s ceiling so a long burst of typing
still reaches disk, and it is flushed when the tab is hidden. The app also asks
the browser for persistent storage so the database is not evicted under pressure.

`store/persistence.ts` still holds the old `localStorage` JSON for two reasons: it
is the fallback for browsers that refuse IndexedDB, and a document saved by an
earlier version is migrated out of it into the database on first run. If the
fallback is in use the app says so in a toast.

Import is deliberately forgiving: missing fields get defaults (including document
settings, default relationship, and border widths), out-of-range numbers are
clamped, duplicate ids are reassigned (and any connection pointing at an old id is
re-pointed at the repaired card), and connections to cards that do not exist are
dropped. Every repair is reported as a warning rather than a failure, so a
hand-edited file still opens.

## Notes and limits

- Single document, single user, stored per browser. Clearing site data clears
  your work; export to JSON if it matters.
- Images are embedded as data URLs, so large photos are what fill the storage
  budget — far more of it than the old `localStorage` 5 MB, since IndexedDB is
  quota-based and typically allows a share of the free disk. The app reports a
  full database and offers export when it happens. Embedded images are
  downscaled on import.
- Two tabs open at once are not synchronised: each keeps its own copy, and the
  last write wins.
- Undo/redo covers document edits. Viewport, selection, and panel state are not
  part of history.
- The layout is tuned for desktop; below `md` the inspector becomes a bottom
  sheet and the sidebar a slide-over, which is usable on a tablet but not
  optimised for phones.
