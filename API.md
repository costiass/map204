# API Reference

Every request ClassCards makes. There is no custom server: REST goes through
PostgREST (`/rest/v1`) and collaboration goes through Supabase Realtime
(`/realtime/v1`). All of it is in the schema under `supabase/migrations/`.

| Property | Value |
|----------|-------|
| **REST Base URL** | `https://<project-ref>.supabase.co/rest/v1` |
| **Realtime URL** | `wss://<project-ref>.supabase.co/realtime/v1` |
| **Auth** | `Authorization: Bearer <jwt>` on every request |
| **apikey** | `VITE_SUPABASE_ANON_KEY` on every request |
| **Content-Type** | `application/json` |
| **Prefer** | `return=representation` on writes that read the row back |

The client code for all of this is `src/store/supabase-sync.ts` (REST),
`src/hooks/usePageSync.ts` (Realtime + the debounced writes) and
`src/components/ShareDialog.tsx` (the share UI).

---

## Auth

Google OAuth only. The session lives in the Supabase client
(`persistSession: true`), so it survives a reload; there is no password, no
email/password table and no session endpoint in this app.

| Step | Endpoint | Notes |
|------|----------|-------|
| Restore session | — | `supabase.auth.getSession()`, client-side only |
| Sign in | `POST /auth/v1/authorize?provider=google` | `signInWithOAuth({ provider: 'google' })` |
| Callback | — | `detectSessionInUrl: true` exchanges the code for a JWT |
| Sign out | `POST /auth/v1/logout` | `supabase.auth.signOut()` |
| Change listener | realtime `auth.onAuthStateChange` | drives `AuthGuard` |

---

## Tables

### `documents`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | client- or server-generated, e.g. `doc_…` |
| `owner_id` | `text` → `auth.users.id` | the person who created it |
| `title` | `text` | shown in the workspace list and share dialog |
| `settings` | `jsonb` | document-wide defaults (`DocSettings`), `{}` until changed |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` is kept fresh by `trg_documents_touch` |

### `pages`

One row per page; the page's whole content is stored as JSONB.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | generated in the app, e.g. `page_1737…_a1b2c3` |
| `document_id` | `text` → `documents.id` | `on delete cascade` |
| `title` | `text` | page name in the sidebar and toolbar |
| `ordinal` | `integer` | position in the page list |
| `position` | `jsonb` | page rect `{ x, y, width, height, zIndex }` |
| `viewport` | `jsonb` | `{ x, y, zoom }` |
| `cards` | `jsonb` | `Card[]` |
| `groups` | `jsonb` | `Group[]` |
| `connections` | `jsonb` | `Connection[]` |
| `version` | `integer` | optimistic-concurrency counter, see below |
| `created_at` / `updated_at` | `timestamptz` | `trg_pages_touch` keeps `updated_at` fresh |

### `user_settings`

Exactly one row per user, created by the signup trigger.

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `text` PK → `auth.users.id` | `on delete cascade` |
| `theme` | `text` | `light` \| `dark` |
| `default_snap_to_grid` | `boolean` | default for new pages |
| `default_grid_pattern` | `text` | `none` \| `dots` \| `lines` |
| `default_grid_size` | `integer` | pixels |
| `updated_at` | `timestamptz` | |

### `document_collaborators`

| Column | Type | Notes |
|--------|------|-------|
| `document_id` | `text` → `documents.id` | composite PK part |
| `user_id` | `text` → `auth.users.id` | composite PK part |
| `role` | `text` | `owner` \| `editor` \| `viewer` |
| `created_at` | `timestamptz` | list order |

### `profiles`

A safe mirror of `auth.users` (id, email, name, avatar), written by
`trg_sync_profile`. Used to label collaborators and to look somebody up by email.

---

## REST endpoints

### Documents

| Operation | Request | Called from | When |
|-----------|---------|-------------|------|
| List my workspaces | `GET /documents?owner_id=eq.<uid>&select=id,owner_id,title,created_at,updated_at&order=updated_at.desc` | `listDocuments` | workspace page |
| List shared with me | `GET /document_collaborators?user_id=eq.<uid>&select=role,document:documents(...)` | `listDocuments` | workspace page |
| Create workspace | `POST /documents` body `{ owner_id, title }` | `createDocument` | "Create" |
| Get one | `GET /documents?id=eq.<docId>&select=*` | `getDocument` | opening a workspace |
| Rename | `PATCH /documents?id=eq.<docId>` body `{ title }` | `renameDocument` | pencil in the workspace list |
| Save doc defaults | `PATCH /documents?id=eq.<docId>` body `{ settings }` | `saveDocumentSettings` | a default style changed |
| Delete | `DELETE /documents?id=eq.<docId>` | `deleteDocument` | trash in the workspace list |

Creating a workspace is **one** request: the `trg_create_default_page` trigger
adds the first page, so the client never inserts a page itself. The client then
reads that page back to learn its generated id.

### Pages

| Operation | Request | Called from | When |
|-----------|---------|-------------|------|
| List | `GET /pages?document_id=eq.<docId>&order=ordinal.asc` | `listPages` | opening a workspace |
| Get one | `GET /pages?id=eq.<pageId>&select=*` | `fetchPage` | resolving a write conflict |
| Create | `POST /pages` body `{ id, document_id, title, ordinal, position, viewport, cards, groups, connections, version }` | `createPage` | "New page", or a page an import added |
| Rename / reorder | `PATCH /pages?id=eq.<pageId>` body `{ title?, ordinal? }` | `updatePageMeta` | sidebar rename, page moved |
| Save content | `PATCH /pages?id=eq.<pageId>&version=eq.<n>` body `{ title, position, viewport, cards, groups, connections, version: n+1 }` | `savePageSnapshot` | debounced after an edit (see below) |
| Delete | `DELETE /pages?id=eq.<pageId>` | `deletePage` | trash in the sidebar |
| Replace all | mix of the above | `replaceDocumentPages` | "Replace document" in the import dialog |

The rename of the **open** page rides along with its content write, so the
metadata PATCH is skipped for it — one request instead of two.

Deleting the last page fails on purpose: `trg_prevent_last_page_delete` raises,
and the app surfaces the message.

### User settings

| Operation | Request | Called from | When |
|-----------|---------|-------------|------|
| Get | `GET /user_settings?user_id=eq.<uid>&select=*` | `loadSettings` | after sign-in |
| Upsert | `POST /user_settings` body `{ user_id, theme, default_snap_to_grid, default_grid_pattern, default_grid_size, updated_at }` with `on_conflict=user_id` | `saveSettings` | 400 ms after any change |

The row is created by `trg_create_user_settings` when the account is created.
`loadSettings` still upserts if the row is missing, so an account that predates
the trigger repairs itself on first sign-in.

### Sharing

| Operation | Request | Called from |
|-----------|---------|-------------|
| List | `GET /document_collaborators?document_id=eq.<docId>&select=...,profile:profiles(id,email,full_name,avatar_url)` | `ShareDialog` |
| Find by email | `POST /rpc/find_profile_by_email` body `{ p_email }` | `ShareDialog` |
| Add | `POST /document_collaborators` body `{ document_id, user_id, role }` (upsert) | `ShareDialog` |
| Change role | `PATCH /document_collaborators?document_id=eq.<docId>&user_id=eq.<uid>` body `{ role }` | `ShareDialog` |
| Remove | `DELETE /document_collaborators?document_id=eq.<docId>&user_id=eq.<uid>` | `ShareDialog` |
| Profile of one user | `GET /profiles?id=eq.<uid>` | `ShareDialog` (owner row) |

`find_profile_by_email` is `SECURITY DEFINER` and matches exactly, so nobody can
enumerate accounts by probing for near-misses.

---

## Realtime

Channels are **private** (`config: { private: true }`), so every message passes
through the policies in `009_realtime_private_channels.sql`: listening requires
`can_view_page` / `can_view_document`, publishing requires the editor role.

| Channel | Purpose | Events |
|---------|---------|--------|
| `page:<pageId>` | page content sync | `page-update` broadcast, presence |
| `document:<docId>` | who is here | presence |

### `page-update`

```jsonc
{
  "type": "broadcast",
  "event": "page-update",
  "payload": {
    "title": "Lecture 3",
    "position": { "x": 0, "y": 0, "width": 1920, "height": 1080, "zIndex": 0 },
    "viewport": { "x": 0, "y": 0, "zoom": 1 },
    "cards": "Card[]",
    "groups": "Group[]",
    "connections": "Connection[]",
    "sentAt": 1780000000000,   // sender's clock, decides who wins
    "origin": "c_3f8a91c2"    // sender's client id, so nobody echoes
  }
}
```

Sent on every local change (no debounce — this is the "instant" half) and
received by everyone else on the same page.

### Presence

```jsonc
{ "user_id": "...", "name": "Ada", "color": "#6366F1", "avatar_url": "https://…", "online_at": "…" }
```

Tracked on `document:<docId>`. The toolbar shows the head count and names the
other people on hover.

---

## Write cadence

Editing is split in two, the way a Google Doc is: realtime for people, Postgres
for durability. This keeps the server quiet — a two-minute typing burst costs
roughly one broadcast per keystroke and a handful of rows, not hundreds.

| Moment | Broadcast | `PATCH /pages` |
|--------|-----------|----------------|
| local edit | yes, immediately | scheduled |
| 1.2 s idle | — | yes |
| 4 s of continuous editing | — | yes (the ceiling) |
| Ctrl+S / toolbar Save | yes | yes |
| `pagehide` / tab hidden | — | yes, via `fetch(keepalive: true)` |

A page is written at most once every 1.2 s, and never more than once per 4 s of
continuous typing.

### Conflict resolution

Writes are optimistic: `PATCH …?version=eq.<n>` only matches while the stored
version is still `n`.

- **0 rows updated** → somebody else wrote first. The client refetches the row,
  unions the two states (dedupe by id, connections whose endpoints vanished are
  dropped) and writes again against the new version.
- **Broadcast** → the receiver compares `sentAt` with its own last edit. A newer
  snapshot replaces the page (deletions propagate); a snapshot that overlaps a
  local edit is unioned (nothing is lost) and the next write reconciles it.

Applying a remote snapshot never touches undo history, and selections pointing at
objects that no longer exist are dropped.

---

## Errors

| Code / event | Meaning | What the app does |
|--------------|---------|-------------------|
| 401 | session expired | Supabase client refreshes the token; on failure `AuthGuard` shows login |
| 403 | RLS refused (e.g. a viewer trying to write) | error toast, the edit stays local |
| 404 | document or page gone | "That workspace could not be opened" and back to the list |
| 409 / empty `PATCH` | version moved on | refetch, union, retry (see above) |
| trigger `RAISE EXCEPTION` | deleting the last page | error toast naming the reason |
| `phx_close` | socket dropped | supabase-js reconnects with backoff; the next edit rebroadcasts |

---

## Limits

| Thing | Limit |
|-------|-------|
| REST | 1000 requests/min per IP (Supabase plan) |
| Broadcast | 20 messages/s per channel (`eventsPerSecond: 20`) |
| Message size | 256 KB per broadcast (a full page snapshot must fit) |
| Realtime channels | 100 concurrent per client |
| Concurrent editors per page | unlimited; convergence is by version + union |

---

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | yes | public anon key; RLS is the only gate |

---

*Keep in sync with `supabase/migrations/` and the code.*
