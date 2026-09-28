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

- [x] **Importing a JSON file works.** Re-importing a file this workspace
      exported reuses its page ids, which collided with rows that already
      existed; a duplicate page id now overwrites the row instead of failing. The
      error toast points at the console, where the reason is logged.

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

## Notes

- Migrations are idempotent and `supabase/bootstrap.sql` is generated from them;
  run `npm run bootstrap` after adding one, or CI fails. The generator derives
  its drop list from the migrations, so a new table or function cannot be missed.
- Never edit an applied migration. Add a new one — `…90700` exists for exactly
  this reason.
- `npm test` covers the drift detection and the generated bootstrap.
