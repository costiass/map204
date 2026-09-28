# Map204 — roadmap

What is built, what is being built, and what is not yet decided.

This is organised by **area**, not by the order things were done. Where an item
records *why* rather than *what*, the reason is kept because it stops the next
person from "simplifying" it back into the bug it fixed.

- [x] done
- [ ] not started
- **No box** — a decision that has not been made yet. These are collected in
  [Open questions](#open-questions) rather than left as loose checkboxes.

---

## Now

The editor works: maps, pages, cards of four kinds, links between things,
live collaboration, sharing, and presentation. The data model is version 1 —
every object is a `Card` with a `type` string and optional fields.

Two things are mid-flight:

1. **The element model (v2)** is written and tested but not adopted. See
   [The element system](#the-element-system).
2. **The database is about to be reset.** Not a problem — nothing worth keeping
   is in it — but the order matters: finish the element renderers *before* the
   reset, or the first run of the new code has nothing to prove itself against.

---

## The element system

Everything on a page stops being a "card with a type" and becomes an **element**:
a discriminated union with a common base, a per-type payload, and a per-type
view, settings and inspector.

### Why

Version 1 stores one shape and tags it. A video card has a `title` and an
`image` field that nothing reads; a note has an `embed` that is always null. The
`type` is a string rather than a union, so **nothing checks it** — every renderer
starts with a chain of `if` asking what it is actually holding, and `CardNode` is
four hundred lines of those conditionals. The types are not separate anywhere
except in a `switch`.

The fix is to make the type the *shape*. A `NoteElement` has nowhere to put a
video id, because there is no field for it. **A wrong shape becomes
unrepresentable rather than validated**, and adding a type makes every
exhaustive `switch` fail to compile until it is handled.

### Done

- [x] **The registry** (`src/elements/registry.ts`) — one list of element kinds,
      read by the toolbar menu, the context menu and the keyboard. Three
      components each had their own copy of the icons and their own opinion
      about which kinds need a link, and they had already drifted: the insert
      button was broken for exactly that reason.
  - [x] A kind is either `supported` or it is not, and unsupported kinds are
        declared but not offered. `link` and `table` are in the registry with
        `supported: false`. The alternative was casting the id to `CardType` at
        every call site, which compiles cleanly and lies at runtime — a table
        element that writes a card row with a `type` field fails *after* the
        click, which is worse than not offering it.
  - [x] Containers and layers are properties of a kind, not a hard-coded check
        for the string `"group"` in the middle of the store.
- [x] **The schema** (`src/elements/schema.ts`) — the union, per-type payloads,
      and the page/document around it. Geometry is flattened onto `ElementBase`,
      because nesting it inside a `position` object meant every type repeated the
      same five fields and two elements could disagree about where they were.
- [x] **The defaults** (`src/elements/defaults.ts`) — one place, because there
      are three ways to make an element and three copies of "what does a new note
      look like" is three places for them to disagree.
- [x] **The migration** (`src/elements/migrate.ts`) — version 1 to 2, for
      import. This is the only reason a format change is survivable: it stands
      between an export somebody took months ago and a file the app can open.
  - [x] Every kind becomes its own element **with nothing extra**. A video with a
        leftover `image` field is the old model wearing a new name.
  - [x] A v1 flash card was a *title* on the front and a body on the back, which
        is what the renderer drew. v2's shape is a deck, so it becomes a deck of
        one — an exact translation, and it means no single-card shape has to be
        supported forever. Getting the faces backwards was a real bug the test
        caught: every migrated card would have had its answer on the front.
  - [x] Groups and connections are re-pointed at the re-issued ids. A group
        pointing at an id that no longer exists draws an empty frame, and a
        connection pointing at nothing is a line into the void.
  - [x] **Anything untranslatable is dropped loudly.** A `hologram` card, or a
        "video" pointing at a Vimeo link, produces a warning rather than an
        invented note. A file that gained a plausible-looking element for a card
        it could not read is worse than a file that says so.
  - [x] A file already at the current version is left alone. Re-running the
        migration on it would double-convert.

### Not done

- [ ] **One folder per type**, each holding its own view, settings and
      inspector:
      ```
      src/elements/
        registry.ts      the list, and the properties every kind has
        schema.ts        the union
        defaults.ts      what a new element starts as
        migrate.ts       v1 → v2
        base.ts          ElementBase, the link and interaction systems
        note/            NoteView, NoteSettings, the note inspector
        video/           VideoView, VideoSettings
        flash/           FlashView, FlashSettings, the deck editor
        pdf/             PdfView, PdfSettings
        link/            LinkView, LinkSettings
        table/           TableView, TableSettings
        group/           GroupView — drawn behind, holds other elements
      ```
      Reading one type should mean reading one directory.
- [ ] **The store, canvas and inspector speak v2.** Right now they speak v1 and
      nothing reads the schema except the migration and its test. This is the
      bulk of the work, and it cannot be verified until it exists.
- [ ] **Per-type behaviour**, all of which is in the schema and none of which is
      in the app:
  - [ ] **Video keeps its aspect ratio** on resize, using the captured `aspect`.
        A video resized to a different shape looks broken rather than chosen.
  - [ ] **Flash cards are a deck** — arrows step through it, a counter says where
        you are, and the element resizes to the largest card rather than
        clipping. A deck of one is a flash card, so there is one shape.
  - [ ] **PDF and link each choose their own display** — a chip, a preview, or
        opened. A preview needs the server to allow framing and many do not, so
        the link is always available when framing is refused.
  - [ ] **PDF upload**, up to 50Mb per map. A storage bucket, an RLS policy keyed
        to document ownership, and a signed-URL endpoint. The quota is checked in
        the upload function *and* by the bucket policy, because one enforced only
        in a browser is one that can be skipped. Files are stored as a path, never
        as base64 in the page's JSONB: base64 is a third larger, it is rewritten
        on every autosave, and two people editing one page would each upload the
        whole document to move a cell.
  - [ ] **A table is a thing in its own right**, not a table inside a card.
        Customisable columns, and clicking a cell enters editing deliberately
        rather than the default state of something on a canvas.
  - [ ] **Groups contain.** Moving a group moves everything in it, and elements
        snap to a group rather than landing near one. `memberIds` exists; no
        interaction does anything with it yet.
  - [ ] **Cards collapse**, and stay selectable and linkable while collapsed.

### Order

1. Renderers, one type at a time, each behind the registry.
2. Store and inspector, so the new types are editable at all.
3. **Then reset the database.** Doing it earlier means the first run of the new
   code has nothing to prove itself against, and the migration only helps at
   import — not for what is in the database now.
4. Wire the migration into import so old exports keep working.

---

## Open questions

Decisions not yet made. Each one is a real fork, not a task.

- [ ] **What a presenter's notes are.** A step that reminds you what to say is
      more useful than one that only remembers where to look. The field was in the
      model with nothing able to write it, and it was removed rather than shipped
      — a field no code can set is a field that will be wrong one day. Either give
      it an editor or leave it out.
- [ ] **Whether steps belong to the page rather than the document.** They live in
      `settings`, which is per document, so a two-page map shares one run and a
      step can point at a card that is not on the page it is presented from. That
      is a defect as much as a design: the step silently falls back to a wide
      shot.
- [ ] **Whether a viewer can be shown a presentation without being able to start
      one.** Right now a viewer can start one, which is probably right — it
      changes no data — but it is a decision rather than an obvious one.
- [ ] **Whose calendar, for a shared workspace.** If one person creates a Google
      event element and shares the map, does the collaborator see the event —
      which means sharing it with *their* account or making it public — or only a
      reference to something they cannot open? A privacy question, and the first
      thing to answer about that type.
- [ ] **What a calendar connection costs.** OAuth, a refresh token at rest, expiry
      and renewal, and revocation on disconnect. Larger than the element itself,
      and the only part of that list which can fail in ways the others cannot.
- [ ] **Whether `link` and `table` are worth the storage they cost**, or whether
      the useful subset is small enough to fold into a note. Both are declared in
      the registry and neither is built; this is the question of whether to build
      them at all.

---

## The canvas

- [x] **Panning, zooming, marquee select, snapping, grid.** The viewport lives in
      a ref and is written straight to the DOM, because a store-held viewport
      would re-render the tree sixty times a second. React never re-renders a
      pan.
- [x] **Connections** between cards and groups: three strokes, three routings,
      several arrowheads, and a relationship written on the line.
- [x] **Renaming a page** has a visible button, not just double-click, and
      Enter and blur both commit. The title is written directly rather than
      riding on the debounced content write — a rename that depends on an
      unrelated write succeeding can silently vanish.
- [x] **A new card starts empty.** Double-clicking used to leave `<p></p>` behind.
- [x] **Groups sit in a layer behind every card**, and moving one moves its
      members.
- [x] **Child cards** and checklists.

### Insert

- [x] **One Insert button**, in the tool row beside Card and Group, offering every
      kind.
  - [x] **Not the primary button.** Share is the only primary action on the
        canvas, and a screen with three equally-weighted blue buttons has none.
  - [x] **The right-click menu offers the same list.** Removing it when the button
        arrived was right about discovery and wrong about speed: the two routes
        are the same work, so they offer the same choices. And a right-click
        insert lands the card **where you clicked**, not in the middle of the
        window.
  - [x] The menu is positioned against the **viewport**, not its parent. It lives
        in a row that scrolls sideways, which makes an absolutely positioned menu
        inside it wrong twice over: the scroller clips it, and it then scrolls
        away with the button.
  - [x] Choosing a kind is one click. A note and a flash card need nothing else
        and appear at once; a kind that points at something opens the link dialog
        already set to that kind.
- [x] **The kind is guessed from a pasted link.** Pasting a YouTube URL and then
      being asked which kind it is would be a question the form should answer.
- [x] **The kind and link can be changed afterwards**, and switching to a text
      kind keeps the link in the body rather than dropping it.

### Card kinds (version 1)

- [x] **Note** — a title and Markdown.
- [x] **Flash** — two sides, a click turns it over.
  - [x] No header and no title field, because the front *is* the title and a field
        above it says the same thing twice.
  - [x] The 3D perspective is on an inner wrapper, never the card root. The root
        is what the canvas positions, measures and transforms; a 3D context there
        changes its layout box and dragging drifts.
  - [x] **A click and a double click are told apart.** A double click is two
        clicks, and firing both turns the card over twice — which is to say, not
        at all — while also opening the editor. The flip waits to see whether a
        second click is coming. A card you cannot read is worse than one that
        opens an editor slightly late.
  - [x] Both faces carry an **explicit** rotation, the front at 0°.
        `backface-visibility: hidden` on a face with no transform of its own is
        not reliably culled, and the symptom is the front ghosting through the
        back.
  - [x] Drags and resizes like any other card. The face is marked
        `data-no-drag`, which only suppresses the canvas's `preventDefault`;
        dragging still starts from it, and suppressing the default is what makes
        the click that turns the card reliable.
- [x] **YouTube** — holds the link and *derives* the video id from it, so the two
      cannot disagree. Thumbnail with a play button, and the player only loads
      when asked: every visible video as a live iframe is a dozen third-party
      documents, each running a player, on a canvas meant to stay light. A
      `t=90` in the link survives into the player.
- [x] **PDF** — a link, with an opt-in in-place preview. Preview needs the server
      to allow framing and many do not, so it is a button rather than a default,
      and the link is always there when framing is refused.
- [ ] **Google event** — blocked on the calendar questions above.

### Safety

- [x] **No unvalidated URL reaches an iframe.** A pasted `javascript:` or `data:`
      URL is code execution in the reader's session, not a broken card. Every
      `src` is http(s)-checked, and a YouTube player URL is *built* from the
      extracted id — a card that claims to be a video but points elsewhere shows a
      link, not that somewhere.
  - [x] `npm run test:embeds`. The test was wrong first: `javascript:alert(1)`
        has an empty hostname, so the "has a dot" rule rejected it too, and the
        test passed with the protocol allowlist *deleted*. It now includes
        `javascript://example.com/alert(1)`, which has a valid hostname and can
        only be stopped by the protocol check.

---

## Collaboration

- [x] **Live cursors**, broadcast over the `document:<docId>` channel.
  - [x] Sent in **world** coordinates, so they land in the same place on every
        screen regardless of each person's pan and zoom.
  - [x] **Never written to the page.** Ephemeral: broadcast only, never stored,
        never part of undo.
  - [x] Throttled to ~25 a second, so a mouse sweep cannot flood the channel.
  - [x] **Clicking someone's avatar follows them.** Following pauses while Space
        is held, so it never fights your own panning.
- [x] **Presence is published in camelCase and read in snake_case.** They were not
      the same, so every remote row was discarded and nobody appeared at all.
- [x] **Writes are versioned and merged.** A conflict unions the two states and
      writes again, rather than one side clobbering the other.
- [x] **The saving indicator** in the top bar.
  - [x] **Four states, not two**, and the two extra ones are the point: `unsaved`
        (an edit is not on the server yet), `saving`, `clean`, and `failed`.
  - [x] It is set the moment an edit is *made*, not when the debounce fires. The
        gap between those is a second of a map that has changed on screen but is
        not on the server, and that is the second somebody checks.
  - [x] A successful write reports clean **only if nothing arrived during it**, so
        an edit made mid-round-trip is not reported as safe.
  - [x] `failed` is sticky and red, and clicking it retries. A failure that
        quietly reverts to "saved" is the most dangerous thing it could do.
  - [x] Mirrored from the write path rather than derived in the store: the thing
        that knows whether a write is in flight *is* the write.
  - [x] Near-invisible when clean. A permanent "Saved" in the corner trains people
        to stop reading it, and the one time it matters is the moment they are not
        looking.

---

## Sharing

- [x] **Three roles** — owner, editor, viewer — and a viewer is locked out of
      editing by the same mechanism a presenter uses, with the *reason* kept,
      because the two are not the same thing: one is a choice that can be ended,
      the other is a permission that cannot.
  - [x] Presenting must never overwrite a viewer's lock. It did, once, and
        `stopPresenting` then cleared the lot — so a viewer could present their way
        to an editable canvas. `npm run test:read-only` asserts it.
  - [x] The lock does not follow you to another map; the role for the new one
        sets it again.
  - [x] Panning and zooming still work while locked. Being unable to look around
        a map you may not change is the one thing that would make the mode
        useless.
  - [x] An editing key a viewer presses says the map is view only, rather than
        doing nothing and looking like a broken key.
  - [x] A canvas that cannot be edited shows no inspector. A panel of controls
        that quietly do not work is worse than no panel, because it looks like it
        does.
- [x] **Connected people as stacked avatars** next to Share, capped at four with a
      `+n`, and clicking one follows them.
- [x] **Invites are emailed** from an Edge Function, because the Resend key cannot
      live in a browser. The function re-checks the caller owns or edits the map —
      without that it would be an open mail relay. A failed email never undoes the
      invite; the grant is written first and the dialog says so.
- [x] **The invite box is the primary action** in the dialog. The `role` state is
      typed `'editor' | 'viewer'` rather than the stored union, so `'owner'`
      cannot be smuggled in through a cast.
- [x] **Every map has a colour and an icon**, stored as a *token name* rather than
      a hex so it recolours with the theme, and constrained by check constraints
      in the database so an unknown value cannot render as an empty box.
  - [x] `npm run test:workspace-look` keeps the theme, the database constraints
        and the email's copy of both lists in agreement, hex values included.

---

## Presentation

- [x] **Presentation mode** — the map with the camera moved. No toolbar, no
      sidebar, no inspector: a panel of controls is both something the audience
      should not be looking at and a way to change the map mid-sentence.
  - [x] **The camera moves.** This reverses an earlier decision — everything was
        locked — and the reversal is deliberate. A camera that cannot be moved is
        fine right up until somebody asks about the part of the map you are *not*
        showing, and then it is the worst possible thing on screen. Leaving to
        look loses the step you were on; re-entering re-runs the camera move.
  - [x] Pinch-zoom stays blocked, because on a trackpad it is two fingers
        dragging and someone reaching over to point would zoom the map out from
        under the audience.
  - [x] Scrolling a card still scrolls the card. Reading is not navigating.
  - [x] **No grid.** Dots and lines are for arranging cards; they are the first
        thing in the way when a map is shown to a room. The grid element is not
        rendered at all rather than rendered with no background — a full-canvas
        element that paints nothing is still something the browser composites.
  - [x] The per-frame camera loop reads `presenting` from the store rather than
        closing over it, so starting a presentation and immediately panning shows
        a blank background on the *first* frame.
  - [x] `←` `→` `Space` move, `Esc` or Finish leaves, `1`–`9` jump. Clicking the
        empty canvas advances and clicking a card does not, so reading a card is
        not a way to lose your place.
  - [x] **The chrome reappears on its own.** `hover` alone meant a presenter who
        moved the mouse to the button and then stopped had to move it *again* —
        and the obvious response to a dead mouse is the keyboard, which then fires
        a step change too, so the presentation skips.
  - [x] **It stops at the end** rather than wrapping. A loop that silently
        restarts looks like the app forgetting which slide it was on.
- [x] **The outline replaces the inspector** while presenting — the one panel that
      helps rather than edits. Nothing in it can be typed into.
  - [x] Jumping from it is **instant**, because somebody reading a list should not
        have it vanish under their eye on every click. The animation is the point
        of *advancing*, not of *navigating*.
  - [x] A step whose target has been deleted says so rather than showing a blank
        row.
- [x] **Steps** live in the document's settings, so a presentation travels in an
      export and needs no migration.
  - [x] **A step's zoom is captured from the camera, not typed.** Frame a card the
        way you want it seen and add a step. Typing "1.4" says nothing about
        whether the card fits.
  - [x] **A step never crops its target.** The zoom is capped at what actually
        fits, because a step showing the middle of the card you meant to point at
        is the one thing a presentation cannot do. The cap is computed separately
        from `fitViewport`, which stops at 1× on purpose — fitting a page should
        never magnify it, and a step is the opposite case.
  - [x] Steps are clamped on load: a zoom of `NaN` or 900, a duration of nine
        billion milliseconds, and a duplicate id are all dropped or bounded.
- [x] **A step inspector**: the run on the left, the chosen step on the right,
      because the thing being configured *is* a step and hiding which one is
      selected is how settings get applied to the wrong thing.
  - [x] **No Save button.** A step is part of the document and the document is
        written continuously; a separate save is a second place for a change to be
        forgotten. Sliders commit on release — one write per drag, not one per
        pixel of travel.
  - [x] **Transition** — `ease`, `linear`, `drift`, `instant`. The old default was
        a quadratic ease-in-out, whose acceleration never reaches a peak and whose
        deceleration starts too late, so the first tenth of a move looks like
        nothing happens and the last tenth looks like a hard stop. Replaced with
        cubic in-out, plus `drift`: a 6% overshoot and a settle back, which reads
        as a hand carrying the view rather than a machine parking it. The
        overshoot is a *fraction of the distance*, so it is equally small on a
        50px move and a 5000px one. `npm run test:card-types` asserts every curve
        starts at 0, ends at exactly 1, and never wobbles.
  - [x] **Trigger** — `manual`, `timed` (with a one-second floor; a step that
        flashes past is not a step), and `hold` (nothing moves it, not even the
        arrow keys). A held step refuses accidental keys but not a deliberate
        jump — holding is about accidents, not about refusing to be taken
        somewhere by name.
  - [x] **Focus** — `none`, `dim`, `spotlight`. A camera move says "look here";
        dimming says "and nowhere else", which on a dense map is the stronger
        statement. The ring is outside the card's box on purpose: a shadow or a
        scale would change the very rectangle the camera aimed at. A dim never
        outlives its step.
  - [x] Two fields depend on their neighbours and cannot be set independently: an
        instant step has no arrival to animate and a manual step has nothing to
        count down. Storing those anyway keeps a duration and a delay the step
        ignores.

---

## The map list

- [x] **A search bar, and the largest thing on the page.** The old grid was fine
      at four maps and useless at forty. Search is what makes a growing list
      usable, so it is sized like a primary field.
  - [x] No results says so, and says how many there are. An empty list with no
        explanation looks like the documents have gone.
  - [x] Search also matches the kind, so a word that matches nothing returns
        nothing rather than everything.
- [x] **List or grid, your choice.** A list is better for *finding* — you scan
      names. A grid is better for *recognising* — you scan colour and icon, which
      is what someone looking for a map they half-remember is doing. The grid
      shows the colour and the icon, because that is the reason to switch to it.
- [x] **One button creates a map.** No name, no colour, no icon: the title is
      *omitted* from the insert so the column's own default names it, and both
  identities are one edit away. Asking for a name before the thing exists was the
      only step in creating a map that was not optional.
- [x] **Colour and icon are hidden until you edit.** They were on every tile all
      the time, which made the list a wall of coloured squares you had to read
      *past*. They are identity, and identity is only interesting when you are
      doing something to the map. The icon still tints the row's edge, so it
      works as a cue without being decoration.
- [x] **One edit button, not four.** Rename, recolour and re-icon were three
      affordances appearing on hover, competing with the title for the same
      corner. One button opens one place with all three in it, and the row's
      contents are *replaced* while editing, so the colour you are changing is the
      one in front of you.
- [x] **The whole row opens the map, not the title.** A row is one thing and it
      does one thing; making the title the only clickable part means aiming at a
      target the size of a word, and the empty space either side does nothing,
      which reads as the row being broken. It is a real button, so Enter and Space
      both work.
- [x] **A welcome map for everyone**, created by a database trigger, with two
      pages that show the app's actual range: groups, links between groups and
      cards, every relationship, all strokes, all routings, checklists, and a
      worked argument on page two.
  - [x] `npm run test:tutorial` checks the migration's hand-written JSONB for
        balance and for the features it claims to demonstrate. A dropped comma in
        that file would otherwise only surface against a live database.

---

## Import and export

- [x] **One RPC, one transaction.** `import_pages` re-issues every id *in SQL* —
      the browser does none of it — and rewires all six places that reference
      them. The old client-driven version was not atomic.
  - [x] **Additive only.** No delete, no overwrite.
  - [x] **A colliding page id is renumbered on the way in**, and the import
        applies the same renumbering to its local copy so both sides agree. The
        first fix overwrote the row, which tried to move a page between maps; RLS
        correctly answered `42501`.
  - [x] Importing with no map open says so, instead of queueing pages for
        whichever map is opened next — which is what produced a misleading
        `42501`.
  - [x] A version 1 file goes through [the migration](#the-element-system).
        `npm run test:migrate-v2`.
- [x] **Round-trip tests** for what has no other test: old documents open
      unchanged, every kind survives export and import with its payload, and
      hostile input in a file — an unknown kind, a non-string URL, a
      `start: 'nope'` — is rejected rather than trusted. `npm run test:card-types`.

---

## Addresses and naming

- [x] **The app is Map204**, in the title, login, 404, share dialog, wordmark and
      the exported filename. Migration `…90700` corrects the tutorial title
      forward rather than editing `…90500`, which may already be applied.
- [x] **`/doc/<id>`, not `/w/<id>`.** `w` stands for *workspace*, which is the
      wrong word for a thing that will not be a workspace.
  - [x] **`/w/` still opens the same map.** A route is not a string that happens to
        work: it ends up in a bookmark, in a message somebody sends, in a
        screenshot. A 404 for a link that used to work is how a rename costs
        somebody access to a document still sitting in the database, perfectly
        fine. `npm run test:routes` asserts both halves.
  - [x] The old address is **replaced**, not pushed, and the bar is tidied. A
        redirect that leaves a history entry means Back walks you to `/w/…`,
        which redirects again, which walks you back.
- [x] **Every map says what kind it is**, beside its title and on its tile.
  - [ ] **Not a column yet.** One kind, and nobody can choose another, so a `kind`
        column would be a migration to undo the day a second kind exists. What
        exists is the *place* for it: the badge, the lookup, and an optional
        field on the row type, so the day the column lands nothing outside the
        sync module changes.
- [x] **Real paths with a 404 page.** Settings is an overlay, not a route, so a
      saved `/settings` link opens the overlay and tidies the address bar.

---

## Character usage

- [x] **Shortcut hints are off the buttons and in the tooltips.** A letter in a
      chip on the face of a button reads as a label for the button — "button C" —
      rather than as a hint about the keyboard. Each button also has its own icon:
      two of them were a plus sign, which made three buttons in a row look like
      one.
- [x] **A check for mojibake, in `npm test`.** A UTF-8 file read without being
      told it is UTF-8 — PowerShell's `Get-Content -Raw` on Windows, for one — is
      reinterpreted byte by byte in the local codepage and written back as UTF-8.
      **Every non-ASCII character in the file is corrupted by the same edit that
      looks like a one-line change.** An em dash becomes three characters, a `CO₂`
      becomes four, a `⌘` becomes two.
  - [x] Not hypothetical. Nine files were affected, five of them by edits made
        while building the features on this page, and the worst were in
        `sample.ts`, where `CO₂` and `30–32 ATP` were unreadable.
  - [x] Detection is a round trip, not a list of bad words, because bad words are
        a list of symptoms. A run of characters from a Windows-1252 reading of
        UTF-8 decodes cleanly as UTF-8 when re-encoded to Windows-1252; genuine
        accented letters do not.
  - [x] **Node's `latin1` is ISO-8859-1, not Windows-1252.** The first version
        used it and missed every em dash, because the euro sign in a mangled run
        encodes to `0xAC` rather than `0x80`. The table of the difference is in the
        test and the search pattern is *generated from that table* — writing the
        list out twice is how the first version lost the tilde in `⌘`.
  - [x] `npm run fix:encoding` repairs, replacing only the corrupted runs.

---

## Project structure

- [x] **`src/elements/`** holds the registry, the schema, the defaults and the
      migration. A directory of empty type folders would be a promise with nothing
      in it; a registry three menus already read is a seam the migration widens.
- [ ] **Split by feature, not by file kind.** `src/components` has 44 files in it,
      which is a symptom rather than a disease: everything is flat because there
      is one kind of thing. The element split is the natural moment — each type
      folder will have files worth putting in it, and the flat directory stops
      being a problem once features have their own places.
  - [ ] **`useCanvasStore.ts` is 61KB and `Canvas.tsx` is 44KB.** Both need
        cutting *by feature* rather than by line. The store's presentation and
        saving slices are already separable, and the canvas's camera is a
        self-contained concern with its own animation loop.

---

## House rules

Things that must keep holding. Each one exists because breaking it was a bug
that looked fine.

- **Never edit an applied migration.** Add a forward one — `…90700` exists for
  exactly this reason. `supabase/bootstrap.sql` is generated; run
  `npm run bootstrap` after adding a migration, or CI fails.
- **No policy queries another RLS table directly.** Cross-table access goes
  through a `security definer` helper. `npm run test:policies`.
- **Every write is re-issued, never overwritten.** Import reproduces a file
  rather than copying it, so importing the same file twice gives two independent
  documents instead of one that silently replaces the other.
- **A guard is worthless if it passes vacuously.** Several of the checks here
  silently tested nothing on their first run, and one passed while the code it
  guarded was deliberately deleted. Every guard is verified by breaking the thing
  it guards.
- **Do not assert a cause you have not verified.** Two messages in this app's
  history named a cause that turned out to be wrong, and both had to be taken
  back.
- **Do not edit files with a shell pipeline.** That is how nine files lost their
  non-ASCII characters. Use the editor, and let `npm run test:encoding` check.

---

## Checks

`npm test` runs fourteen of them. Each guards a failure that is silent, late, or
both.

| Check | Guards |
| --- | --- |
| `typecheck` | The build. |
| `test:drift` | The database matching the migrations. |
| `test:bootstrap` | The generated bootstrap matching the migrations. |
| `test:migrations` | Hand-written SQL that is only wrong at runtime. |
| `test:policies` | No policy reading another RLS table; RLS on every table. |
| `test:realtime` | Every broadcast sent and received on the same channel. |
| `test:embeds` | Unvalidated URLs reaching an iframe. |
| `test:card-types` | Round-tripping, and the camera curves. |
| `test:read-only` | The read-only state machine, and the step run. |
| `test:routes` | Old addresses still opening what they named. |
| `test:migrate-v2` | v1 files surviving the format change. |
| `test:encoding` | Mojibake. |
| `test:workspace-look` | Theme, database and email agreeing on the same list. |
| `test:tutorial` | Hand-written JSONB in a migration. |
| `fix:encoding` | Not a check — it repairs. |
