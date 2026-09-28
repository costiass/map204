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

- [ ] **A card can be more than text.** An insert button, beside the existing
      card controls, offering card types beyond a Markdown body. Each type is a
      separate thing that does one job — not one embed field with a dropdown
      bolted on, which is how a single unreadable card type happens.

  ### The types

  - [x] **YouTube video.** Holds the link and derives the video id from it, so
        the two cannot disagree. Shows a thumbnail with a play button and only
        loads the player when asked — every visible video on a page would
        otherwise be a live third-party iframe. A `t=90` in the link survives
        into the player, so a lecture can be linked at the moment it matters.
  - [x] **PDF.** A link, with an opt-in in-place preview. A preview needs the
        server to allow framing and many do not, so it is a button rather than a
        default, and the link is always there when framing is refused.
  - [ ] **Google event.** A card that refers to an event on a connected person's
        Google Calendar, and can create one.

  ### Done so far

  - [x] A card has a `type`, and a document written before this existed needs no
        migration — a card with no type is a note.
  - [x] The kind is guessed from a pasted link, so pasting a YouTube URL and
        being asked which kind it is would be a question the form should answer.
  - [x] The kind and the link can be changed afterwards in the inspector, and
        switching to a note keeps the link in the body rather than dropping it.
  - [x] **No unvalidated URL reaches an iframe.** A pasted `javascript:` or
        `data:` URL in a card is code execution in the reader's session, so every
        `src` is http(s)-checked, and a YouTube player URL is *built* from the
        extracted id — a card that claims to be a video but points elsewhere
        shows a link, not that somewhere. Asserted by `npm run test:embeds`.

  ### Decided before any of it is built

  - [ ] **What a card type is in the data model.** A `type` plus a payload that
        only that type reads, rather than new columns for every type. Everything
        else follows from this, and it is cheaper to answer now than after three
        types exist.
  - [ ] **The self-contained types and the account-backed type are different
        products.** A video and a PDF work for anyone, offline, from the file
        alone. A Google event only exists on somebody's calendar. They should not
        share a mental model, and an export containing one of each is two
        different questions.
  - [ ] **Whose calendar, for a shared workspace.** If one person creates a Google
        event card and shares the workspace, does the collaborator see the event —
        which means sharing it with *their* account or making it public — or only
        a reference to something on the creator's calendar they cannot open? This
        is a privacy question, not a UI one, and it is the first thing to answer.
  - [ ] **What a calendar connection actually costs.** OAuth, a refresh token
        held at rest, token expiry and renewal, and revocation when somebody
        disconnects. That is a larger piece of work than the card, and it is the
        only part of this list that can fail in ways the other two cannot.
  - [ ] **What an exported file containing one of these means.** A video card
        still works. A calendar card is a reference that may resolve to nothing.

## Notes

- Migrations are idempotent and `supabase/bootstrap.sql` is generated from them;
  run `npm run bootstrap` after adding one, or CI fails. The generator derives
  its drop list from the migrations, so a new table or function cannot be missed.
- Never edit an applied migration. Add a new one — `…90700` exists for exactly
  this reason.
- `npm test` covers the drift detection and the generated bootstrap.
