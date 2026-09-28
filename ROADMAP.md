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

## Notes

- Migrations are idempotent and `supabase/bootstrap.sql` is generated from them;
  run `npm run bootstrap` after adding one, or CI fails. The generator derives
  its drop list from the migrations, so a new table or function cannot be missed.
- `npm test` covers the drift detection and the generated bootstrap.
