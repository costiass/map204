# Roadmap

Work to do, in the order it makes sense. Each item is checked off as it lands.

## Live collaboration

- [x] **Live cursors.** Broadcast each person's pointer over the `document:<docId>`
      channel and draw it for everyone else.
  - [x] Position is sent in **world** coordinates, so it lands in the same place
        on every screen regardless of each person's pan and zoom.
  - [x] **Never written to the page.** Cursors are ephemeral: broadcast only,
        never stored in `pages` content, never persisted, not part of undo.
  - [x] Every user has their own cursor. No linking, no shared position.
  - [x] Throttled to ~25 messages a second, so a mouse sweep cannot flood the
        channel.
  - [x] **Clicking someone's avatar follows them** — the local viewport tracks
        that person's pointer until you click again. Following pauses while
        Space is held, so it never fights your own panning.

## Workspace list

- [x] **A welcome workspace for everyone.** Every account gets a workspace called
      `tutorial`, created by a database trigger, with a page of cards that
      explains the app. Backfilled for accounts that predate it.

## Settings

- [x] **Settings is an overlay**, like Share — no longer a `/settings` page. A
      saved `/settings` link opens the overlay and tidies the address bar.
- [x] The toolbar's avatar falls back to the **first letter of the first name**,
      not the first character of the email address.
- [x] The share dialog and the settings panel do the same.

## Share

- [x] **Connected people appear as overlapping avatars next to Share**, the way
      Google Docs stacks them, capped at four with a `+n`, and clicking one
      follows them.

## Cards and pages

- [x] **Rename a page properly.** There is a pencil button next to the delete
      button (it used to be double-click only, so it was invisible and
      unreachable by keyboard), Enter and blur both commit, and the title is
      written directly instead of depending on the debounced content write.
- [x] **A new card starts empty.** Double-clicking to add a card no longer
      leaves `<p></p>` in the Markdown body.

## Import

- [x] **Importing a JSON file works.** Importing with no workspace open says so
      instead of queueing pages for whichever workspace is opened next, which is
      what produced the misleading `42501`.
- [x] **An import reproduces the file rather than copying it.** Every id is
      re-issued — page, card, group and connection — and all six places that
      reference them are rewritten. The user sees the same document; the result
      shares no identity with the file, so importing the same file twice gives
      two independent documents instead of one that silently overwrites the
      other. Positions, styling, text, tags and ordering are untouched.
  - [x] `npm run test:reissue` asserts the *shape* survives, not merely that
        the function runs: every connection still resolves, every group
        membership and parent link survives, nothing but ids moved, the input is
        not mutated, and two imports share no ids. The failure mode is silent —
        `normalizeDoc` drops references to unknown ids rather than throwing — so
        a check that only looked for exceptions would pass while a user's map
        quietly came apart.
  - [x] Verified by deliberately breaking it: deleting the `parentId` remap and
        dropping group membership each make the test fail. An earlier version of
        the test missed the group-membership case, which is what prompted the
        count assertions.

## Import, again

- [x] **Importing a file whose page ids belong to another workspace.** The first
      fix overwrote the colliding row, which tried to move a page between
      workspaces; RLS correctly answered `42501`, and the import still failed. A
      colliding page id is now renumbered on the way in, and the import applies
      the same renumbering to its local copy so both sides agree on the ids.

## Sharing and identity

- [x] **Other people appear at all.** Presence was published under camelCase keys
      and read under snake_case, so every remote row was discarded: no avatars, no
      cursors. Both formats are now explicit at each end.
- [x] **Google pictures show up.** The profile sync is a callable function, the
      trigger uses it, and a migration re-derives every existing profile. A blank
      profile used to be permanent, because the backfill ended in
      `on conflict do nothing` and could only ever create a row, never fix one.

## Naming

- [x] **The app is Map204.** Title, description, package name, login, 404, share
      dialog, toolbar wordmark and the exported filename. Migration `…90700`
      corrects the tutorial card title forward rather than editing `…90500`,
      which may already be applied.

## Sharing panel

- [x] **The invite box is the primary action.** The email field is full width and
      large; the role selector and button drop to a quiet row underneath. A
      person's name in the list is set large; the role control beside it is small.
      The `role` state is typed `'editor' | 'viewer'` rather than the stored
      union, so `'owner'` cannot be smuggled in through a cast.

## Workspace looks

- [x] **Every workspace has a colour and an icon**, chosen by its owner and shown
      consistently: the tile in the list, the dot on the tile, the badge beside
      the title in the chrome, and the email.
  - [x] Stored as a *token name*, never a hex, so it recolours with the theme.
  - [x] Constrained by check constraints in the database, so an unknown value
        cannot reach the browser and render as an empty box.
  - [x] Existing workspaces are assigned colours by position, so the list does
        not open as a wall of identical tiles.
  - [x] `npm run test:workspace-look` keeps the theme, the database constraints
        and the email's copy of both lists in agreement, hex values included.

## Sharing by email

- [x] **Inviting someone emails them a link**, in the site's own design, naming
      who shared, the workspace and the role.
  - [x] Sent by a Supabase Edge Function, because the Resend key cannot live in
        a browser and the anon key is public by design.
  - [x] The function re-checks the caller owns or edits the workspace before it
        will name it — without that it would be an open mail relay.
  - [x] A failed email never undoes the invite; the grant is written first and
        the dialog says so if the mail does not go out.
  - [x] `supabase/functions/README.md` has the setup.

## Tutorial

- [x] **The tutorial shows the full potential of the app** across two pages
      rather than five cards in a row: groups, a card-in-a-group, links between
      groups and cards, every relationship, all three strokes, all three
      routings, several arrowheads, checklists, and a worked argument on page 2.
  - [x] Cards are laid out with real breathing room and a working viewport.
  - [x] `npm run test:tutorial` checks the migration's hand-written JSONB for
        balance and for the features it is meant to demonstrate — a dropped comma
        in that file would otherwise only surface against a live database.

## Other kinds of card

- [x] **A card can be more than text.** An **Insert** button in the toolbar's
      tool row, beside Card and Group, offering card types beyond a Markdown
      body. Each type is a separate thing that does one job — not one embed field
      with a dropdown bolted on, which is how a single unreadable card type
      happens.
  - [x] **The toolbar is the place it is *discovered*.** A context menu is a
        place you have to already know to go, and the first thing a new card kind
        can do is *be noticed*. A button in the toolbar is on screen the whole
        time.
  - [x] **The right-click menu offers the same list.** Removing it when the
        button arrived was right about discovery and wrong about speed. The two
        routes are the same work, so they offer the same choices — and a
        right-click insert lands the card **where you clicked** rather than in the
        middle of the window, which a new card appearing elsewhere quietly denies.
  - [x] The menu is positioned against the **viewport**, not its parent. It lives
        in a row that scrolls sideways, which is what makes an absolutely
        positioned menu inside it wrong twice over: the scroller clips it, and it
        then scrolls away with the button.
  - [x] The icons and the "needs a link first" answer live in one module, typed
        against `CardType`. Three components each had their own copy, and a kind
        added to the list without adding it to a map is a runtime `undefined` in a
        menu — an entry that renders blank and looks like a bug in the app rather
        than in the code.
  - [x] Choosing a kind is one click, not a dialog. A note and a flash card need
        nothing else and appear at once; the two kinds that point at something
        open the link dialog already set to that kind.
  - [x] It sits beside the other two things you make, and is **not** the primary
        button — Share is the only primary action on the canvas, and a screen
        with three equally-weighted blue buttons has none.

  ### The types

  - [x] **YouTube video.** Holds the link and derives the video id from it, so
        the two cannot disagree. Shows a thumbnail with a play button and only
        loads the player when asked — every visible video on a page would
        otherwise be a live third-party iframe. A `t=90` in the link survives
        into the player, so a lecture can be linked at the moment it matters.
  - [x] **PDF.** A link, with an opt-in in-place preview. A preview needs the
        server to allow framing and many do not, so it is a button rather than a
        default, and the link is always there when framing is refused.
  - [x] **Flash card.** The title on one side, the body on the other, a click
        turns it over.
    - [x] It has no header and no title field, because the front *is* the title
          and a field above it would say the same thing twice.
    - [x] The perspective is on an inner wrapper, never the card root. The root
          is what the canvas positions, measures and transforms; a 3D context
          there would change its layout box and dragging would drift.
    - [x] **A click and a double click are told apart.** A double click is two
          clicks, and firing both would turn the card over twice — which is to
          say, not at all — while also opening the editor. The flip waits for a
          second click that never comes. A card you cannot read is worse than a
          card that opens an editor slightly late.
    - [x] A card with nothing on the back says so, and does not pretend a second
          side exists.
    - [x] The back is centred like the front. A flash card's back is a short
          answer shown to somebody at a distance; left-aligned ragged text is the
          wrong shape for that.
    - [x] **Both faces carry an explicit rotation**, the front one at 0°.
          `backface-visibility: hidden` on a face with no transform of its own is
          not reliably culled, and the symptom is the front ghosting faintly
          through the back. Spelling out 0deg is the standard form.
    - [x] It drags and resizes like any other card. The face is marked
          `data-no-drag`, which only suppresses the canvas's `preventDefault` —
          dragging still starts from it, and suppressing the default is what makes
          the click that turns the card over reliable.
  - [ ] **Google event.** A card that refers to an event on a connected person's
        Google Calendar, and can create one.

  ### Done so far

  - [x] A card has a `type`, and a document written before this existed needs no
        migration — a card with no type is a note.
  - [x] The kind is guessed from a pasted link, so pasting a YouTube URL and
        being asked which kind it is would be a question the form should answer.
  - [x] The kind and the link can be changed afterwards in the inspector, and
        switching to a note or a flash card keeps the link in the body rather
        than dropping it.
  - [x] **No unvalidated URL reaches an iframe.** A pasted `javascript:` or
        `data:` URL in a card is code execution in the reader's session, so every
        `src` is http(s)-checked, and a YouTube player URL is *built* from the
        extracted id — a card that claims to be a video but points elsewhere
        shows a link, not that somewhere. Asserted by `npm run test:embeds`.
  - [x] `npm run test:card-types` covers what has no other test: old documents
        open unchanged, every kind survives export and import with its payload,
        and hostile input in a file — an unknown kind, a non-string URL, a
        `start: 'nope'` — is rejected rather than trusted.

## Presenting

- [x] **Presentation mode.** The map with the camera moved. No toolbar, no
      sidebar, no inspector: the app hands the screen over, because a panel of
      controls is both something the audience should not be looking at and a way
      to change the map mid-sentence.
  - [x] `←` `→` `Space` move, `Esc` leaves, `1`–`9` jump, clicking the empty
        canvas advances and clicking a card does not, so reading a card is not a
        way to lose your place. The bar hides until the mouse goes near it.
  - [x] **The camera is eased and zoom is interpolated on a log scale.** A linear
        move reads as a mechanical jump between two stills, and a linear zoom
        from 0.5 to 2 barely moves for its first half.
  - [x] **It stops at the end** rather than wrapping, and a loop that silently
        restarts looks like the app forgetting which slide it was on.

- [x] **Steps.** Each one names a card, a group, or the whole page, and carries
      a zoom. They live in the document's own settings, so a presentation travels
      in an export and needs no migration.
  - [x] **A step's zoom is captured from the camera, not typed.** Frame a card
        the way you want it seen and add a step; the zoom is whatever the canvas
        was doing. Typing "1.4" says nothing about whether the card fits, and
        re-capturing is how a step gets retuned.
  - [x] **A step never crops its target.** The zoom is capped at what actually
        fits, because a step that shows the middle of the card you meant to point
        at is the one thing a presentation cannot do.
  - [x] The cap is computed separately from `fitViewport`, which stops at 1× on
        purpose — fitting a page should never magnify it, and a step is the
        opposite case.
  - [x] A step pointing at a card that has since been deleted falls back to an
        establishing shot rather than flying the camera nowhere.
  - [x] Steps are clamped on load: a zoom of `NaN` or 900, a duration of nine
        billion milliseconds, and a duplicate id are all dropped or bounded,
        because a bad step from a shared file would otherwise move the camera
        somewhere absurd on a keypress.

- [x] **View only is the same mechanism.** A viewer is locked out of editing by
      the same `readOnlyReason` a presenter sets, and the *reason* is kept
      because the two are not the same thing: one is a choice that can be ended,
      the other is a permission that cannot.
  - [x] Presenting must never overwrite the viewer's lock. It did, once, and
        `stopPresenting` then cleared the lot — so a viewer could present their
        way to an editable canvas. `npm run test:read-only` asserts it.
  - [x] The lock does not follow you to another workspace; the role for the new
        one sets it again.
  - [x] Panning and zooming still work, because being unable to look around a map
        you may not change is the one thing that would make the mode useless.
  - [x] An editing key a viewer presses says the workspace is view only, rather
        than doing nothing and looking like a broken key.
  - [x] A canvas that cannot be edited shows no inspector. A panel of controls
        that quietly do not work is worse than no panel, because it looks like it
        does.

- [x] **A presentation inspector.** Present menu → "Edit the steps…". The run is
      listed on the left and the chosen step's settings on the right, because the
      thing being configured *is* a step and hiding which one is selected is how
      settings get applied to the wrong thing.
  - [x] **No Save button**, because there is nothing to save: a step is part of
        the document and the document is written continuously. A separate save is
        a second place for a change to be forgotten.
  - [x] Sliders commit on release, not on every frame — one write per drag
        rather than one per pixel of travel.

  ### What a step can do

  - [x] **Transition.** `ease` in and out (the default — a linear camera move
        reads as a mechanical jump between two stills), `linear` at constant speed
        for when the *timing* of the arrival is the point, and `instant` for a
        step about something already on screen.
  - [x] **Trigger.** `manual` — you move on, the default for a talk somebody
        else is also speaking over. `timed` — it moves on by itself, with a
        one-second floor, because a step that flashes past is not a step.
        `hold` — nothing moves it, not even the arrow keys, for a step a
        discussion happens over.
  - [x] **Auto change.** The delay, shown as a bar emptying in the overlay's
        chrome. Re-armed when the delay changes, so a presenter tuning it mid-step
        sees the effect on the step they are looking at.
  - [x] **Everything else.** `none`, `dim` (the rest of the map goes dim) and
        `spotlight` (dimmed *and* the target ringed). A camera move says "look
        here"; dimming says "and nowhere else", which on a dense map is the
        stronger statement. The ring is outside the card's box on purpose — a
        shadow or a scale would change the very rectangle the camera aimed at.
  - [x] **A held step refuses the keys but not a deliberate jump.** Holding is
        about accidental keys, not about refusing to be taken somewhere the
        presenter asked for by name.
  - [x] **A dim never outlives its step.** A step that says nothing about focus
        clears it, and so does stopping. A dim left behind is the map going dark
        mid-sentence with nothing on screen saying why.
  - [x] Two fields depend on their neighbours and cannot be set independently: an
        instant step has no arrival to animate, and a manual step has nothing to
        count down. Storing those numbers anyway would keep a duration and a
        delay that the step ignores — which is worse than storing none.

  ### Still to decide

  - [ ] **What a presenter's notes are.** A step that reminds you what to say is
        more useful than one that only remembers where to look, and the field
        exists in the model with nothing able to write it. Either give it an
        editor, or take it out — a field no code can set is a field that will be
        wrong one day.
  - [ ] **Whether a viewer should be able to *be shown* a presentation without
        being able to start one.** Right now a viewer can start one, which is
        probably right — it changes no data — but it is a decision rather than an
        obvious one.
  - [ ] **Whether steps belong to the page rather than the document.** They live
        in `settings`, which is per document, so a two-page map shares one run
        and a step can point at a card that is not on the page it is presented
        from. That is a defect as much as a design: a step aimed at a card on
        page two, presented from page one, silently falls back to a wide shot.

## Character usage

- [x] **The keyboard shortcut hints are off the buttons and in the tooltips.** A
      letter in a chip on the face of a button reads as a label for the button —
      "button C" — rather than as a hint about what else the keyboard does. Three
      buttons also had three different single-letter chips and no way to tell what
      any of them made; each now has its own icon, and the letters are in the
      `?` panel and the tooltips.
- [x] **Both "add" buttons were a plus sign**, which made three buttons in a row
      look like the same button. Note, group and insert each have their own icon.
- [x] **A check for mojibake, in `npm test`.** A UTF-8 file read without being
      told it is UTF-8 — PowerShell's `Get-Content -Raw` on Windows, for one — is
      reinterpreted byte by byte in the local codepage and written back as UTF-8.
      Every non-ASCII character in the file is corrupted by the same edit that
      looks like a one-line change: an em dash becomes three characters, a `CO₂`
      becomes four, and a `⌘` becomes two.
  - [x] This was not hypothetical. Nine files were affected, five of them by
        edits made while building the features above, and the worst were in
        `sample.ts`, where `CO₂` and `30–32 ATP` were unreadable.
  - [x] Detection is a round trip, not a list of bad words, because the bad words
        are a list of symptoms: a run of characters from a Windows-1252 reading
        of UTF-8 decodes cleanly as UTF-8 when re-encoded to Windows-1252, and
        genuine accented letters do not.
  - [x] **Node's `latin1` is ISO-8859-1, not Windows-1252.** The first version
        used it and missed every em dash, because the euro sign in the mangled
        run encodes to `0xAC` rather than `0x80` and the round trip produced the
        wrong bytes. The table of the two code pages' difference is in the test,
        and the search pattern is *generated from that table* — writing the list
        twice is how the first version lost the tilde in `⌘`.
  - [x] `npm run fix:encoding` repairs, replacing only the corrupted runs.

## Addresses

- [x] **`/doc/<id>`, not `/w/<id>`.** `w` stands for *workspace*, which is the
      wrong word for a thing that will not be a workspace, and the second kind of
      document is coming.
  - [x] **`/w/` still opens the same document.** A route is not a string that
        happens to work: it ends up in a bookmark, in a message somebody sends,
        in a screenshot. A 404 for a link that used to work is how a rename costs
        somebody access to a document still sitting in the database, perfectly
        fine. `npm run test:routes` asserts both halves.
  - [x] The old address is **replaced**, not pushed, and the bar is tidied. A
        redirect that leaves a history entry means Back walks you to `/w/…`, which
        redirects again, which walks you back.
- [x] **Every document says what kind it is**, next to its title and on its tile.
  - [ ] **Not a column yet**, on purpose. There is one kind and nobody can choose
        another, so a `kind` column would be a migration to undo the day a second
        kind exists. What exists is the *place* for it: the badge, the lookup, and
        the optional `kind` field on `DocumentRow`, so the day the column lands
        nothing outside `supabase-sync.ts` changes. The list is the harder screen
        to retrofit — a tile is a component, and a badge rendering nothing for
        most rows is a badge nobody notices until it is needed.

## Presenting, again

- [x] **The camera curves were the harsh part, not the duration.** The default
      was a quadratic ease-in-out, whose acceleration never reaches a peak and
      whose deceleration starts too late — so the first tenth of a move looks like
      nothing is happening and the last tenth looks like a hard stop. At
      presentation speed, watched by a room, that is a lurch.
  - [x] Replaced with cubic in-out, which has a real peak. `npm run
        test:card-types` asserts every curve starts at 0, ends at exactly 1, and
        never wobbles — because a camera that overshoots and does not come back
        leaves the audience looking at the wrong thing until the presenter presses
        a key.
  - [x] **`drift`**, a new transition: ease, plus a 6% overshoot and a settle back,
        which reads as a hand carrying the view rather than a machine parking it.
        The overshoot is a *fraction of the distance*, so it is equally small on a
        50px move and a 5000px one, and it is resolved entirely within the last
        quarter so most of the move is the ordinary ease.
  - [x] The zoom was already interpolated on a log scale, which is why a move
        from 0.5 to 2 feels constant. Only the curve shape was wrong.

- [x] **Nothing pans or zooms while presenting.** A step's framing *is* the
      navigation, so a wheel or a stray drag is not "looking around" — it is
      abandoning the step.
  - [x] Blocked with one capture-phase listener above everything, not in the
        pointer handlers. Blocking it per-handler would leave a dozen paths — the
        wheel, a trackpad scroll, a pinch, a middle-drag — each of which has to be
        found and closed separately, and one missed is a map that wanders off
        while you talk.
  - [x] **Reading a card is still allowed.** Scrolling inside a card is reading
        it, and a step's card is often taller than the window. A presentation you
        cannot read is not a presentation. View-only is untouched: panning there
        is navigation you need, and the two are different modes for that reason.
- [x] **The chrome reappears on its own.** `hover` alone meant a presenter who
      moved the mouse to the button and then stopped had to move it *again* to get
      it back — and the obvious thing to do with a mouse that does nothing is try
      the keyboard, which then fires a step change as well, so the presentation
      skips. It now comes back on any pointer movement and hides again after a
      couple of seconds.
- [x] The keyboard hints are behind a `?` button rather than always on screen.

## Saving

- [x] **A small saving state in the top bar**, next to the document's name.
  - [x] **Four states, not two**, and the two extra ones are the whole point:
        `unsaved` (an edit is not on the server yet), `saving` (a write is in
        flight), `clean`, and `failed`.
  - [x] `unsaved` is the one that earns the space. The debounce is about a
        second, so it is visible for a second after every burst of typing — which
        is exactly when somebody glances up to check.
  - [x] It is set the moment an edit is *made*, not when the debounce fires. The
        gap between those is a second of a map that has already changed on screen
        but is not on the server, and that is the second somebody checks.
  - [x] A successful write reports `clean` **only if nothing arrived during it**,
        so an edit made mid-round-trip does not get reported as safe.
  - [x] `failed` is sticky and red, and clicking it retries. A failure that
        quietly reverts to "saved" is the most dangerous thing this could do.
  - [x] Mirrored from the write path rather than derived in the store: the thing
        that knows whether a write is in flight *is* the write. Deriving it would
        duplicate the debounce's timing, and the two would disagree exactly when
        it mattered.
  - [x] Deliberately near-invisible when clean. A permanent "Saved" in the corner
        is noise that trains people to stop reading it, and the one time it
        matters is the moment they are not looking.

## Notes

- Migrations are idempotent and `supabase/bootstrap.sql` is generated from them;
  run `npm run bootstrap` after adding one, or CI fails. The generator derives
  its drop list from the migrations, so a new table or function cannot be missed.
- Never edit an applied migration. Add a new one — `…90700` exists for exactly
  this reason.
- `npm test` covers the drift detection and the generated bootstrap.
