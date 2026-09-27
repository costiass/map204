# ClassCards

An infinite canvas for turning class notes into connected idea maps. Drop in
cards, write Markdown, draw arrows between them, and share the result with the
people in your course.

Everything lives in Supabase: Google sign-in, PostgreSQL storage, and Realtime
for live collaboration. There is no local storage of any kind — sign in from two
browsers and an edit in one shows up in the other immediately.

Built with React 19, TypeScript, Vite, Tailwind CSS v4, Zustand and
`@supabase/supabase-js`. The canvas engine is hand-rolled (DOM + SVG) rather
than pulled from a library, so dragging and zooming never go through a framework
re-render.

## Getting started

```bash
npm install
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Then open http://localhost:5173 and sign in with Google.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck, then produce a production build in `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc -b`, no emit |
| `npm run lint` | oxlint |

## Shape of the app

| Route | What it is |
| --- | --- |
| `#` | Workspace list — everything you own plus everything shared with you |
| `#workspace/<docId>` | The canvas for one workspace |
| `#settings` | Theme and grid preferences, stored on your account |

A workspace always has at least one page: the database creates it, and the last
page cannot be deleted.

## Using the canvas

**Cards.** Click anywhere on a card — body, title, or header — to select it;
drag from any of those to move it, and drag the bottom-right corner to resize
(both dimensions snap to the grid when it is on). The title stays editable in
place. The inspector opens on the right, taking 30–50% of the window, with two
tabs:

- **Content** — the card as a Markdown page. Write, split, or preview, with a
  formatting toolbar. Images go anywhere: `![a diagram](…)` from a URL, a
  dropped or pasted file, or the separate banner image. Tags, checklist, and
  child cards live here too.
- **Settings** — colours, border (width, colour, radius), shadow, position,
  size, z-order, parent, and collapse. "Set as default style" makes every new
  card start from this look; "Reset defaults" undoes that.

**Default styles** are stored on the workspace, so new objects match your
conventions. For links the default covers the relationship as well as the look.

**Connections.** Drag from one of the four anchor dots on a card edge onto
another card or a group. The arrow re-routes live as you move either end, and
can be styled as straight, curved, or stepped with a solid, dashed, or dotted
stroke. A connection stores only two endpoints and two anchors, so **collapsing
a card never moves its links**.

**Multi-select.** Shift-click cards, or hold `Shift` while dragging on empty
space to marquee-select. Bulk move, recolour, tag, align, stack, and delete from
the inspector.

**Navigation.** Drag empty space, use the middle mouse button, or hold `Space`
to pan. `Ctrl/Cmd` + scroll, pinch, or the zoom controls to zoom. `F` fits the
whole page. Hovering a card, the wheel scrolls that card's own content; once the
card is scrolled to its end the canvas takes the wheel again, and `Ctrl/Cmd` +
wheel always zooms.

**Pages.** The sidebar holds multiple pages, each with its own cards,
connections, and saved viewport. Rename, reorder, and delete them.

**Sharing.** The Share button in the toolbar lists who has access. As the owner
you can invite somebody by email (they need a ClassCards account), give them
*Can edit* or *Can view*, and remove them. Editors change anything; viewers see
the canvas but their writes are refused by the database.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `C` | New card |
| `G` | New group |
| `Delete` / `Backspace` | Delete selection |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + S` | Write the page to the database now |
| `Ctrl/Cmd + A` | Select all cards |
| `Ctrl/Cmd + D` | Duplicate selection |
| `F` | Fit page to view |
| `Escape` | Close menus/dialogs, then clear selection |
| `Space` (hold) | Pan mode |

Single-key shortcuts are ignored while you are typing in a field.

## How it is put together

```
src/
  types.ts              Document model, presets, and hard limits
  data/sample.ts        The starter document
  lib/supabase.ts       Client, env guard, access token helper
  store/
    useCanvasStore.ts   Single Zustand store: document, selection, UI, history
    supabase-sync.ts    Every REST call (documents, pages, settings, sharing)
    userSettings.ts     Theme + grid preferences, backed by user_settings
    presence.ts         Who else is in this document
  hooks/
    usePageSync.ts      Realtime channels, debounced writes, conflict recovery
    useKeyboardShortcuts.ts
  utils/
    geometry.ts         World/screen conversion, fit, centre, snap
    edges.ts            Connection routing, arrowheads, dash patterns
    serialize.ts        Export, and a defensive import that repairs bad JSON
    merge.ts            Snapshot merge rules for collaboration
    markdown.ts         Markdown renderer, plain text, legacy HTML conversion
    filters.ts          Search and filter predicates
    image.ts            File → data URL, byte formatting
  components/           Canvas, cards, connections, inspector, share, dialogs
supabase/migrations/    Schema, triggers, RLS, Realtime policies
```

Two ideas carry most of the weight:

**The store is the single source of truth.** Components read slices with narrow
selectors and write through named actions, so every mutation passes one place.
Undo/redo snapshots the document on a 700 ms debounce (so a drag is one undo
step, not two hundred) with a history limit of 80.

**Cards and connections are separate.** A connection stores only its two
endpoints and two anchors — never coordinates. Paths are recomputed from live
card rectangles, which is why arrows follow cards correctly, survive
import/export, and need no repair when a card is resized or moved.

### Card content is Markdown

A card body is stored as Markdown, which is also the export format for that body.
The renderer escapes all input first and only emits tags it built itself, so raw
HTML in a card is shown as text and can never execute. Image sources are limited
to `http(s)`, relative paths, `data:image/*`, and `blob:`.

### Coordinate contract

Card `position.x/y` are **world** coordinates. The page viewport
(`{ x, y, zoom }`) is the transform from world to screen. Pan and zoom are
applied by writing the transform directly to the DOM inside a ref, avoiding a
re-render per frame.

### Storage and collaboration

Each page is one row in `pages`, its cards/groups/connections stored as JSONB.
That is the right unit because the app only ever edits the page you are looking
at, so a keystroke rewrites that one row and touches nothing else.

Writing is split in two:

- **Realtime, immediately.** Every local change is broadcast on the private
  channel `page:<pageId>`, so other people see it at once. Messages carry the
  sender's clock and client id, so nothing echoes and the newer snapshot wins.
- **Postgres, on idle.** 1.2 s after you stop typing (and at least every 4 s
  while you keep typing) the page is written with `PATCH /pages`. Ctrl+S, page
  switches, and hiding the tab flush immediately.

Writes use optimistic concurrency (`version` must still match), so two people
saving at the same instant cannot overwrite each other: the loser refetches,
unions the two states, and writes again.

### Import and export

Import is deliberately forgiving: missing fields get defaults, out-of-range
numbers are clamped, duplicate ids are reassigned (and any connection pointing at
an old id is re-pointed at the repaired card), and connections to cards that do
not exist are dropped. Every repair is reported as a warning rather than a
failure, so a hand-edited file still opens. "Replace document" rewrites the
workspace server-side so what you see is what was stored.

## Notes and limits

- Access is per account. Clearing site data does not touch your work; it is all
  in Postgres.
- Images are embedded as data URLs, so large photos are what fill the row.
  Embedded images are downscaled on import.
- A broadcast carries a whole page, so a page with very large embedded images
  can approach the 256 KB realtime message limit — keep images modest or link
  them by URL.
- Undo/redo covers document edits. Viewport, selection, and panel state are not
  part of history, and a remote edit is never something you can undo.
- The layout is tuned for desktop; below `md` the inspector becomes a bottom
  sheet and the sidebar a slide-over.
- There is no offline mode: edits made with the tab closed or the network down
  are not queued.

## Further reading

- `API.md` — every endpoint, channel, and write
- `ARCHITECTURE.md` — schema, triggers, RLS, data flow, setup checklist, testing checklist
- `PRODUCTION.md` — deploy and CI/CD
