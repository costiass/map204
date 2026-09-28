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

- [x] **A card can be more than text.** An **Insert** button in the toolbar,
      beside Share, offering card types beyond a Markdown body. Each type is a
      separate thing that does one job — not one embed field with a dropdown
      bolted on, which is how a single unreadable card type happens.
  - [x] **The toolbar, not the right-click menu.** A context menu is a place you
        have to already know to go, and the first thing a new card kind can do is
        *be noticed*. A button in the toolbar is on screen the whole time.
  - [x] Choosing a kind is one click, not a dialog. A note and a flash card need
        nothing else and appear at once; the two kinds that point at something
        open the link dialog already set to that kind.

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

## Notes

- Migrations are idempotent and `supabase/bootstrap.sql` is generated from them;
  run `npm run bootstrap` after adding one, or CI fails. The generator derives
  its drop list from the migrations, so a new table or function cannot be missed.
- Never edit an applied migration. Add a new one — `…90700` exists for exactly
  this reason.
- `npm test` covers the drift detection and the generated bootstrap.
