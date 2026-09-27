# ClassCards Architecture Documentation

## Overview

ClassCards is a real-time collaborative card-based canvas application built with React, TypeScript, and Supabase. It features a Google Docs-style workspace with real-time collaboration via WebSocket.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Canvas     │  │  Toolbar     │  │   Inspector          │  │
│  │  (Cards,     │  │  (Actions,   │  │   (Settings,         │  │
│  │   Groups,    │  │   Navigation)│  │    Properties)       │  │
│  │   Connections)│  │              │  │                      │  │
│  └──────┬───────┘  └──────┬────────┘  └──────────┬──────────┘  │
│         │                 │                        │            │
│         └─────────────────┼────────────────────────┘            │
│                           ▼                                     │
│              ┌─────────────────────────────────┐               │
│              │      Zustand Store              │               │
│              │  (Cards, Pages, Groups,         │               │
│              │   Connections, Selection,       │               │
│              │   Viewport, UI State)           │               │
│              └──────────────┬──────────────────┘               │
│                             │                                  │
│              ┌──────────────┴──────────────────┐               │
│              │      Supabase Client            │               │
│              │  (REST API + Realtime)          │               │
│              └──────────────┬──────────────────┘               │
└─────────────────────────────┼──────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌───────────────┐   ┌───────────────┐
            │  PostgreSQL   │   │   Realtime    │
            │  (REST API)   │   │  (WebSocket)  │
            └───────────────┘   └───────────────┘
```

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | React 19 + TypeScript | UI Framework |
| Build | Vite 6 | Build Tool |
| Styling | Tailwind CSS 4 | Styling |
| State | Zustand | State Management |
| Backend | Supabase | BaaS (PostgreSQL + Auth + Realtime) |
| Deployment | Vercel | Hosting |
| CI/CD | GitHub Actions | Automation |

## Data Model

### Core Entities

```
Document (1) ──< Pages (N)
Page (1) ──< Cards (N)
Page (1) ──< Groups (N)
Page (1) ──< Connections (N)
Group (1) ──< Cards (N) [memberCardIds]
Group (1) ──< Groups (N) [memberGroupIds]
Connection: source (Card|Group) → target (Card|Group)
UserSettings: theme, grid preferences per user
```

### Key Types

```typescript
// Unified position type for both cards and pages
type Position = {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

// Page contains cards, groups, connections
interface Page {
  id: string;
  title: string;
  position: Position;        // Page bounds on canvas
  viewport: Viewport;        // Pan/zoom state
  cards: Card[];
  groups: Group[];
  connections: Connection[];
  createdAt: string;
  updatedAt: string;
}
```

## Database Schema (PostgreSQL)

### Tables

```sql
-- Documents (workspaces)
documents (
  id text PRIMARY KEY,
  owner_id text REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled',
  settings jsonb NOT NULL DEFAULT '{}',   -- DocSettings: default card/link styles
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()     -- kept fresh by trg_documents_touch
)

-- Pages within documents
pages (
  id text PRIMARY KEY,                    -- generated in the app, e.g. page_1737…_a1b2c3
  document_id text REFERENCES documents(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled Page',
  ordinal integer NOT NULL DEFAULT 0,     -- position in the page list
  position jsonb NOT NULL,                -- Position (x, y, width, height, zIndex)
  viewport jsonb NOT NULL,                -- Viewport { x, y, zoom }
  cards jsonb NOT NULL DEFAULT '[]',
  groups jsonb NOT NULL DEFAULT '[]',
  connections jsonb NOT NULL DEFAULT '[]',
  version integer NOT NULL DEFAULT 0,     -- optimistic concurrency
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()     -- kept fresh by trg_pages_touch
)

-- User preferences — one row, created by trg_create_user_settings on signup
user_settings (
  user_id text PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme text CHECK (theme IN ('light', 'dark')),
  default_snap_to_grid boolean DEFAULT true,
  default_grid_pattern text CHECK (default_grid_pattern IN ('none', 'dots', 'lines')),
  default_grid_size integer DEFAULT 20,
  updated_at timestamptz DEFAULT now()
)

-- Sharing
document_collaborators (
  document_id text REFERENCES documents(id) ON DELETE CASCADE,
  user_id text REFERENCES auth.users(id) ON DELETE CASCADE,
  role text CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (document_id, user_id)
)

-- A safe mirror of auth.users for the share list
profiles (
  id text PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
```

### Triggers

| Trigger | Table | What it does |
| --- | --- | --- |
| `trg_create_default_page` | `documents` | `AFTER INSERT` — creates page #1, so a workspace is never empty |
| `trg_prevent_last_page_delete` | `pages` | `BEFORE DELETE` — refuses to remove the last page of a document |
| `trg_documents_touch` | `documents` | `BEFORE UPDATE` — refreshes `updated_at` |
| `trg_pages_touch` | `pages` | `BEFORE UPDATE` — refreshes `updated_at` |
| `trg_create_user_settings` | `auth.users` | `AFTER INSERT` — creates the one settings row |
| `trg_sync_profile` | `auth.users` | `AFTER INSERT/UPDATE` — mirrors name, email, avatar into `profiles` |

The first two are `SECURITY DEFINER`, so a client's own RLS policies cannot
block a write the database itself is required to make.

### Row Level Security (RLS)

Every table has RLS enabled. The interesting part is the recursion trap: a
`documents` policy that reads `document_collaborators` whose own policy reads
`documents` makes Postgres reject every query. Migration 008 breaks the cycle
with four `SECURITY DEFINER` helpers — `can_view_document`, `can_edit_document`,
`can_view_page`, `can_edit_page` — which run with the table owner's rights, so
the policies never nest.

The rules:

- an owner can do anything with their own document and its pages
- a collaborator can read, and can write only with the `editor` role
- a `viewer` is refused every write (the app shows a 403 toast)
- `user_settings` is readable and writable only by its owner
- `profiles` is readable for yourself and for people you share a document with;
  finding somebody by email goes through `find_profile_by_email`, an exact-match
  `SECURITY DEFINER` function, so accounts cannot be enumerated

## Realtime Architecture

### WebSocket Communication Flow

```
User A edits card
       │
       ▼
┌───────────────────────┐
│  Zustand Store        │  (local state update)
└───────────┬───────────┘
            │
            ├──► WebSocket broadcast  (private channel page:<id>, immediate)
            │       payload: { title, position, viewport, cards, groups,
            │                  connections, sentAt, origin }
            │            │
            │     ┌──────┴──────┐
            │     ▼             ▼
            │   User B       User C
            │     │             │
            │     ▼             ▼
            │   applySnapshot() — newer → replace, overlapping → union
            │
            └──► 1.2 s idle (max 4 s) → PATCH /pages?id=eq.<id>&version=eq.<n>
```

### Conflict Resolution

Server-side, via optimistic concurrency:

- `pages.version` increments on every accepted write
- `PATCH …?version=eq.<n>` only lands while the stored version is still `n`
- 0 rows updated means somebody else won the race: refetch, union the two
  states, write again against the fresh version

Client-side, for live edits:

- every broadcast carries the sender's `sentAt` clock and its `origin` id
- a snapshot newer than the local edit replaces the page, so deletions stick
- a snapshot that overlaps a local edit is unioned, so nothing is lost
- `origin` stops a client from echoing a snapshot back to the sender

### Data Persistence Strategy

| Operation | Transport | Timing |
|-----------|-----------|--------|
| Card/Group/Connection edits (live) | WebSocket broadcast | immediate |
| Page content → Postgres | REST PATCH | 1.2 s idle, 4 s ceiling |
| Leaving / hiding the tab | REST PATCH (`keepalive`) | on `pagehide` |
| Ctrl+S / toolbar Save | REST PATCH | immediate |
| Page create/rename/delete | REST POST / PATCH / DELETE | 250 ms after the change |
| Document create/rename/delete | REST | immediate |
| Settings change | REST UPSERT | 400 ms after the change |

The 1.2 s idle / 4 s ceiling is what keeps a long typing burst to a handful of
row writes instead of one per keystroke.

## Frontend Architecture

### State Management (Zustand)

```
useCanvasStore
├── doc: CanvasDoc          // Current document
├── activePageId: string    // Active page
├── selectedCardIds: string[]
├── selectedConnectionIds: string[]
├── selectedGroupId: string | null
├── viewport: Viewport
├── darkMode: boolean
├── snapToGrid: boolean
├── gridPattern: GridPattern
├── gridSize: number
├── actions: {
│   addCard, addGroup, addPage
│   updateCard, updateGroup, updatePage
│   deleteCards, deleteGroups, deleteConnections
│   selectCards, selectConnection, selectGroup
│   setViewport, centerSelection
│   setDocumentId, setDocumentTitle
│   hydrateDocument (load from Supabase)
│   applyRemotePage (realtime sync, no undo entry)
}
```

### Routing (hash-based)

Hash routing, so no server rewrite is needed on Vercel.

| Route | Component | Description |
|-------|-----------|-------------|
| `#` | `WorkspacePage` | Document list — owned and shared |
| `#workspace/<docId>` | `Canvas` | The editor for one workspace |
| `#settings` | `UserSettingsPage` | User preferences |

### Component Hierarchy

```
App
├── AuthGuard
│   ├── Toolbar
│   │   ├── Logo/Home
│   │   ├── Page Title (canvas)
│   │   ├── Canvas Actions (Card, Group, Undo, Zoom)
│   │   ├── Search, Import/Export, Save
│   │   ├── Share (head count + share dialog)
│   │   ├── Dark Mode Toggle
│   │   ├── Shortcuts
│   │   └── User Avatar Menu (Settings, Workspaces, Sign Out)
│   ├── WorkspacePage (route: #)
│   ├── Canvas (route: #workspace/:docId)
│   │   ├── ConnectionLayer (SVG edges)
│   │   ├── Card Nodes (draggable, resizable)
│   │   ├── Group Nodes (containers)
│   │   └── Connection Handles
│   ├── PageSidebar (pages + filters)
│   ├── Inspector (right sidebar)
│   │   ├── Content Tab (Markdown editor)
│   │   └── Settings Tab (styles, layout)
│   ├── SearchPanel (Cmd+K)
│   ├── ConnectionTree
│   ├── ShareDialog
│   ├── UserSettingsPage
│   ├── ContextMenu (right-click)
│   ├── ImportExportDialog
│   └── Toasts
```

## API Endpoints (Auto-generated by PostgREST)

All database operations use Supabase's auto-generated REST API. `API.md` has the
full list with bodies, triggers and call sites; the short version:

| Operation | Endpoint | Method |
|-----------|----------|--------|
| List owned + shared documents | `GET /rest/v1/documents?owner_id=eq.{uid}` and `GET /rest/v1/document_collaborators?user_id=eq.{uid}` | GET |
| Create document | `POST /rest/v1/documents` | POST |
| Get document | `GET /rest/v1/documents?id=eq.{id}` | GET |
| Rename / doc settings | `PATCH /rest/v1/documents?id=eq.{id}` | PATCH |
| Delete document | `DELETE /rest/v1/documents?id=eq.{id}` | DELETE |
| List pages | `GET /rest/v1/pages?document_id=eq.{id}&order=ordinal.asc` | GET |
| Create page | `POST /rest/v1/pages` | POST |
| Rename / reorder page | `PATCH /rest/v1/pages?id=eq.{id}` | PATCH |
| Save page content | `PATCH /rest/v1/pages?id=eq.{id}&version=eq.{n}` | PATCH |
| Delete page | `DELETE /rest/v1/pages?id=eq.{id}` | DELETE |
| Get user settings | `GET /rest/v1/user_settings?user_id=eq.{uid}` | GET |
| Update settings | `UPSERT /rest/v1/user_settings` | POST |
| Share list / add / role / remove | `/rest/v1/document_collaborators` | GET, POST, PATCH, DELETE |
| Find a user by email | `POST /rest/v1/rpc/find_profile_by_email` | POST |

## Authentication Flow

```
1. User clicks "Sign in with Google"
       │
       ▼
┌─────────────────────────────────┐
│  Supabase Auth                  │
│  - Google OAuth redirect        │
│  - JWT issued on callback       │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│  AuthGuard                      │
│  - Checks session               │
              │
              ▼
      ┌─────────────────┐
      │ Signed In       │ ──→ Canvas / Workspace
      └─────────────────┘
      ┌─────────────────┐
      │ Not Signed In   │ ──→ LoginPage (Google OAuth)
      └─────────────────┘
```

## Development Setup

```bash
# Install dependencies
npm install

# Local development
npm run dev          # Starts Vite dev server on :5173

# Type checking
npx tsc -b --noEmit

# Build for production
npm run build        # Outputs to /dist

# Preview production build
npm run preview
```

### Environment Variables

Create `.env` for local development:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Vercel Environment Variables

Set in Vercel Dashboard → Project → Settings → Environment Variables:

| Variable | Value | Environment |
|----------|-------|-------------|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | Production, Preview |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Production, Preview |
| `VERCEL_TOKEN` | From Vercel account | GitHub Actions |
| `VERCEL_ORG_ID` | From Vercel project settings | GitHub Actions |
| `VERCEL_PROJECT_ID` | From Vercel project settings | GitHub Actions |

## CI/CD Pipeline

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `deploy.yml` | Push to `main` | Typecheck → Build → Deploy to Vercel |
| `supabase-migrate.yml` | Push to `main` (migrations) | Run new migrations on Supabase |

### Migration Workflow

```yaml
# On push to main with migration changes:
1. Checkout code
2. Setup Supabase CLI
3. Link project (SUPABASE_PROJECT_REF)
4. Mark manual migrations as applied (repair)
4. Push new migrations (db push)
```

## Supabase Setup Checklist

### One-time Setup

1. **Create Project** at supabase.com
2. **Enable Google OAuth**: Authentication → Providers → Google, with the
   client id and secret Google gives you
3. **Set redirect URLs**: Authentication → URL Configuration
   - Site URL: your app (e.g. `https://your-app.vercel.app`)
   - Redirect URL: `https://<project-ref>.supabase.co/auth/v1/callback`
4. **Run the migrations** in order in the SQL Editor (Dashboard → SQL Editor),
   or push them with the CLI: `supabase link --project-ref <ref>` then
   `supabase db push`.

   Migrations are named `<timestamp>_<name>.sql` because the CLI takes the
   version from the filename prefix — that is what
   `supabase_migrations.schema_migrations` records and what `db push` compares
   against.

   | File | What it does |
   | ---- | ------------ |
   | `20260920090000_initial_schema.sql` | tables, RLS, indexes |
   | `20260920090100_user_settings.sql` | `user_settings` (idempotent; 001 already has it) |
   | `20260921091500_fix_rls_recursion.sql` | drops the mutually-recursive policies |
   | `20260921091600_fix_id_types.sql` | ids become `text` to match the app's ids |
   | `20260922093000_cleanup_and_realtime.sql` | `text` everywhere, `version`, Realtime, sane policies |
   | `20260927081500_enforce_business_rules.sql` | `position` jsonb, `ordinal`, default page trigger, last-page guard, `updated_at` triggers |
   | `20260927081600_user_settings_trigger.sql` | settings row created on signup (+ backfill) |
   | `20260928090000_sharing.sql` | `profiles`, email lookup, the `can_view_*` / `can_edit_*` helpers, collaborator write access |
   | `20260928090100_realtime_private_channels.sql` | `realtime.messages` policies so private channels are access-checked |

   Every file is written to be re-runnable (`IF EXISTS` / `IF NOT EXISTS` /
   `DROP POLICY IF EXISTS`), so applying one to a database that already has it
   is a no-op rather than an error. That matters here: the first two were
   originally run by hand in the SQL Editor, so they exist in the database but
   not in the history table. `db push` applies them again — harmlessly — and
   records them, so no repair step is needed.

5. **Check Realtime**: Database → Replication should list `documents`, `pages`
   and `user_settings` (the last migration adds them; verify in the dashboard)

6. **Stop applying migrations by hand.** Once the history table is populated,
   anything changed in the SQL Editor is invisible to `db push` and will be
   clobbered by the next migration. If you must edit by hand, record it:

   ```bash
   supabase migration repair <version> --status applied
   ```

### When history and files disagree

`db push` refuses to run if the remote history table holds a version with no
matching file, reporting `Remote migration versions not found in local
migrations directory`. That is not a fault in the migrations — it means a file
was renamed, or a version was recorded by hand. Two ways out, both through the
**Supabase Migration History Repair** workflow (manual, `workflow_dispatch`):

| Goal | `status` | Effect |
|------|----------|--------|
| A file was renamed, or the migration should run again | `reverted` | deletes those versions from the history table, so `db push` applies them again |
| The migration is already in the database | `applied` | inserts the versions, so `db push` skips them |

For renamed files, `reverted` is the safe choice *provided the migrations are
re-runnable* — as they are here, every statement is guarded, so applying one to
a database that already has it changes nothing and simply records it. That is
how this project's first two migrations, originally run by hand, get reconciled
without a hand-written `INSERT`.

`supabase db pull` is the third option the CLI suggests, and the wrong one here:
it captures the *remote* schema into a new migration file, which then has to be
reviewed and committed. It answers "what does the database look like now?", not
"which of my files has already run?".

### Environment Variables for Vercel

| Variable | Source |
|----------|--------|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API |

## Testing Checklist

- [ ] Sign in with Google works
- [ ] Workspace list loads (owned + shared)
- [ ] Create workspace → one page exists (created by the trigger, not the client)
- [ ] Open workspace → canvas loads with the right pages in order
- [ ] Create card, group, connection
- [ ] Wait 2 s → reload → the edit is still there
- [ ] Second browser, same workspace → the card appears without a reload
- [ ] Both browsers type at once → both sets of cards survive
- [ ] Share dialog: invite by email, change role, remove
- [ ] Viewer opens the workspace → read works, writes are refused
- [ ] Delete the only page → the error toast explains why
- [ ] Edit settings → persists across reload
- [ ] Dark mode toggle in the toolbar → persists
- [ ] Rename a page and a workspace → persists
- [ ] Import JSON (replace) → reload shows the imported pages

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Supabase not configured" | Check `.env` has VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY |
| "Infinite recursion in policy" | Migrations `003` and `008` replace those policies with the `can_view_*` / `can_edit_*` helpers |
| "Invalid UUID" | Run `20260921091600_fix_id_types.sql` |
| Broadcast never arrives | Private channels need the `realtime.messages` policies from `20260928090100_realtime_private_channels.sql` |
| "row-level security" on a write | The account is a `viewer`: change the role in the share dialog |
| "User not found" (Vercel) | Re-create `VERCEL_TOKEN` |
| Realtime not working | Enable tables in Supabase → Replication (migration 009 also does it) |
| Build fails | Run `npm ci` then `npm run build` |

## Future Enhancements

- [ ] Offline support (queue writes, replay on reconnect)
- [ ] Collaborative cursors
- [ ] Comments on cards
- [ ] Version history / time travel
- [ ] Templates marketplace
- [ ] Mobile responsive canvas
- [ ] Export to PDF/PNG
- [ ] Plugin system

---

*Last updated: 2026*