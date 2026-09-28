# Production Architecture — GitHub, Vercel, Supabase

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         DEVELOPER                                │
│                                                                 │
│   git push origin main                                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      GITHUB ACTIONS                             │
│                                                                 │
│  1. Checkout code                                                │
│  2. Install dependencies (npm ci)                               │
│  3. Type check (tsc)                                            │
│  4. Build (vite build)                                          │
│  5. Deploy to Vercel (vercel-action)                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        VERCEL                                   │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Edge Network (CDN)                                       │  │
│  │  → Serves static files (HTML, JS, CSS, favicon)           │  │
│  │  → Global distribution, cached at edge locations          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Build output: /dist                                            │
│    ├── index.html                                               │
│    ├── assets/index-*.js (React app bundle)                     │
│    ├── assets/index-*.css (Tailwind + custom styles)            │
│    └── favicon.svg                                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────────────┐
│   SUPABASE AUTH  │ │  SUPABASE    │ │      SUPABASE           │
│                  │ │  POSTGREST   │ │      REALTIME            │
│  Google OAuth    │ │  (REST API)  │ │      (WebSocket)         │
│  → JWT session   │ │              │ │                          │
│  → RLS policies  │ │  CRUD on     │ │  Broadcasts DB changes   │
│                  │ │  documents,  │ │  to all connected        │
│                  │ │  pages       │ │  clients                 │
└──────────────────┘ └──────────────┘ └──────────────────────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │       SUPABASE POSTGRES      │
              │                              │
              │  ┌──────────────────────┐    │
              │  │ documents            │    │
              │  │  id (uuid, PK)       │    │
              │  │  owner_id (uuid, FK) │    │
              │  │  title               │    │
              │  └──────────────────────┘    │
              │                              │
              │  ┌──────────────────────┐    │
              │  │ pages                │    │
              │  │  id (uuid, PK)       │    │
              │  │  document_id (FK)    │    │
              │  │  title               │    │
              │  │  viewport (jsonb)    │    │
              │  │  cards (jsonb)       │    │
              │  │  groups (jsonb)      │    │
              │  │  connections (jsonb) │    │
              │  └──────────────────────┘    │
              │                              │
              │  ┌──────────────────────┐    │
              │  │ document_collaborators│    │
              │  │  document_id (FK)    │    │
              │  │  user_id (FK)        │    │
              │  │  role                │    │
              │  └──────────────────────┘    │
              └──────────────────────────────┘
```

## Complete Request Flow

### 1. User visits the website

```
Browser → https://your-app.vercel.app
  │
  ▼
Vercel Edge Network
  │  Serves static files (cached at CDN edge)
  │
  ▼
index.html loads → React app boots
  │
  ▼
AuthGuard checks Supabase session
  │
  ├── No session → LoginPage (Google OAuth)
  │     │
  │     ▼
  │   User clicks "Continue with Google"
  │     │
  │     ▼
  │   Supabase Auth → Google OAuth redirect
  │     │
  │     ▼
  │   Google authenticates → returns to Supabase callback
  │     │
  │     ▼
  │   Supabase creates JWT → stored in localStorage
  │     │
  │     ▼
  │   App reloads → AuthGuard sees session → Canvas accessible
  │
  └── Session exists → App loads
        │
        ▼
      main.tsx bootstrap()
        │
        ▼
      loadDocumentFromSupabase(userId)
        │
        ├── Supabase JS → PostgREST API
        │     GET /rest/v1/documents?owner_id=eq.<userId>&order=updated_at.desc&limit=1
        │     (with JWT in Authorization header)
        │
        ▼
      Supabase Postgres → returns document row
        │
        ▼
      GET /rest/v1/pages?document_id=eq.<docId>&order=position.asc
        │
        ▼
      Pages with cards/groups/connections as JSONB
        │
        ▼
      hydrateDocument() → Zustand store updated
        │
        ▼
      Canvas renders cards, groups, connections
```

### 2. Real-time collaboration (WebSocket)

```
User A moves a card
  │
  ▼
Zustand store → savePageToSupabase(page)
  │
  ▼
Supabase JS → PostgREST API
  PATCH /rest/v1/pages?id=eq.<pageId>
  Body: { cards: [...], updated_at: "..." }
  │
  ▼
Postgres UPDATE → WAL (Write-Ahead Log)
  │
  ▼
Supabase Realtime → broadcasts to the private channel "page:<pageId>"
  │
  ├──→ User B receives the broadcast → applySnapshot() → UI updates
  ├──→ User C receives the broadcast → applySnapshot() → UI updates
  └──→ User D receives the broadcast → applySnapshot() → UI updates
```

### 3. Persistence flow (realtime + debounced write)

```
User types in a card title
  │
  ▼
Zustand store updates
  │
  ├──► channel.send({ event: 'page-update' })  → every other client, now
  │
  ▼
usePageSync schedules a write
  │
  ├── idle 1.2 s        → PATCH /rest/v1/pages?id=eq.<id>&version=eq.<n>
  ├── 4 s of typing     → PATCH (the ceiling, so long bursts still land)
  ├── Ctrl+S / Save     → PATCH
  └── pagehide / hidden → PATCH via fetch(keepalive: true)
  │
  ├── rows updated → done
  └── 0 rows (version moved) → refetch, union with local, PATCH again
```

Realtime carries the live experience; the debounced PATCH is what survives a
reload. Keeping the write path idle-debounced is what stops a typing burst from
hammering the database.

## CI/CD Pipeline (GitHub Actions)

```yaml
Trigger: git push to main (or PR to main)

┌─────────────────────────────────────────────────────┐
│  GitHub Actions Runner (ubuntu-latest)             │
│                                                     │
│  1. actions/checkout@v4                            │
│     └─ Clones repository at the pushed commit      │
│                                                     │
│  2. actions/setup-node@v4 (Node 20)                │
│     └─ Sets up Node.js + npm cache                 │
│                                                     │
│  3. npm ci                                          │
│     └─ Installs exact dependencies from lockfile   │
│                                                     │
│  4. npx tsc -b --noEmit                            │
│     └─ Type checking (fails build on type error)   │
│                                                     │
│  5. npm run build                                  │
│     └─ tsc -b && vite build                        │
│     └─ Output: /dist (static files)                │
│     └─ Uses secrets: VITE_SUPABASE_URL,            │
│        VITE_SUPABASE_ANON_KEY (injected at build)  │
│                                                     │
│  6. amondnet/vercel-action@v25                     │
│     └─ Deploys /dist to Vercel production          │
│     └─ Uses secrets: VERCEL_TOKEN,                 │
│        VERCEL_ORG_ID, VERCEL_PROJECT_ID            │
└─────────────────────────────────────────────────────┘
```

## Database migrations in CI

A push that touches `supabase/migrations/**` runs `supabase-migrate.yml`. Applying
pending migrations is one command:

```yaml
- supabase/setup-cli@v1
- supabase link --project-ref …
- compare: git's versions against the ones recorded in the database
- supabase db push --dry-run
- supabase db push
- supabase migration list
```

`db push` applies every migration whose version is not yet in
`supabase_migrations.schema_migrations`, in ascending order, and records each one.

### When the two sides have drifted

Renaming, squashing or rebuilding the migrations leaves the database holding
versions that no longer exist in git, and `db push` refuses to guess — it exits
with `Remote migration versions not found in local migrations directory`. There
are three legitimate answers, so the workflow offers all three as a `mode` input
rather than only the safe one:

| Mode | What it does | Data |
| --- | --- | --- |
| `push` | applies what is pending | kept |
| `reconcile` | forgets the stale versions, then pushes | kept |
| `rebuild` | `db reset --linked`: drops what this project created, replays every migration | **dropped** |

`push` is the default and the only mode a git push can reach. It **never**
rewrites history: on drift it fails and names the other two. `rebuild` also
requires typing `YES` into a confirmation field, because it destroys data —
`auth.users` survives, so Google sign-in keeps working.

Drift is detected by reading the recorded versions with
`supabase db query --linked "select string_agg(version, ' ') …"`, not by parsing
the table `supabase migration list` prints. Both version lists and the orphans
go into the job summary.

### Two things it depends on

- **Filenames are the version.** `<14-digit-timestamp>_<name>.sql` — the prefix is
  the key in the history table, so renaming a migration makes `db push` think it
  is new. The length matters too: the drift check matches 14 digits specifically,
  because the CLI's own output contains a timestamp column beginning with the
  year, which a looser pattern reads as a version called `2026`.
  `scripts/test-drift-detection.cjs` covers that case.
- **A Docker daemon.** The CLI validates pending migrations against a shadow
  database in a container before touching the remote. GitHub's `ubuntu-latest`
  has one.

`db pull` is deliberately not in the workflow. It captures the *remote* schema
into a new migration file, which then has to be reviewed and committed; it
answers "what does the database look like now?", not "which of my files has
already run?".

If a migration is ever applied by hand, `db push` cannot see it and the next
migration may undo it. Record it instead:

```bash
supabase migration repair 20261001090000 --status applied
```

A `concurrency` group means two runs can never race each other on the history
table.

## Environment Variables

| Variable | Where Set | Purpose |
|----------|-----------|---------|
| `VITE_SUPABASE_URL` | GitHub Secrets + Vercel | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | GitHub Secrets + Vercel | Public anon key (safe for client) |
| `VERCEL_TOKEN` | GitHub Secrets | Vercel API token |
| `VERCEL_ORG_ID` | GitHub Secrets | Vercel team/user ID |
| `VERCEL_PROJECT_ID` | GitHub Secrets | Vercel project ID |
| `SUPABASE_ACCESS_TOKEN` | GitHub Secrets | Personal access token, `sbp_…` |
| `SUPABASE_PROJECT_REF` | GitHub Secrets | Project ref, e.g. `ofpbdzqnszupgtjkncgv` |
| `SUPABASE_DB_PASSWORD` | GitHub Secrets | Database password — without it the CLI prompts and the job hangs |

**Note:** `VITE_*` variables are inlined into the JS bundle at build time. The `SUPABASE_ANON_KEY` is public by design — security is enforced by Row Level Security (RLS) in Postgres, not by hiding the key. The Supabase secrets are only read by the migration workflow, never shipped to the browser.

## Security Model

```
┌─────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                       │
│                                                         │
│  1. Vercel Edge — HTTPS only, no direct DB access      │
│                                                         │
│  2. Supabase Auth — Google OAuth → JWT session         │
│     └─ JWT contains user ID (sub claim)                │
│                                                         │
│  3. Supabase RLS — Row Level Security                   │
│  4. Supabase RLS — Row Level Security                   │
│     └─ Every query checks auth.uid() against the row     │
│     └─ Owners can do anything with their documents       │
│     └─ Collaborators read; only editors can write        │
│     └─ A viewer is refused every write                   │
│                                                         │
│  5. Supabase Realtime — private channels only            │
│     └─ realtime.messages policies gate listen and send   │
│     └─ can_view_page / can_edit_page decide access      │
└─────────────────────────────────────────────────────────┘
```

## Data Flow Summary

| Step | From | To | Protocol | Data |
|------|------|----|----------|------|
| 1 | Browser | Vercel | HTTPS | GET / (static files) |
| 2 | Browser | Supabase Auth | HTTPS | Google OAuth flow |
| 3 | Supabase Auth | Browser | HTTPS | JWT token |
| 4 | Browser | Supabase PostgREST | HTTPS | GET documents/pages |
| 5 | Supabase | Browser | HTTPS | JSON (cards, groups, connections) |
| 6 | Browser | Supabase Realtime | WSS | `page-update` broadcast (live) |
| 7 | Browser | Supabase PostgREST | HTTPS | PATCH pages (debounced, versioned) |
| 8 | Supabase Realtime | Browser | WSS | other people's snapshots |
| 9 | GitHub | GitHub Actions | HTTPS | push triggers the workflows |
| 10 | GitHub Actions | Vercel | HTTPS | Deploy static files |
| 11 | Vercel | DNS/Edge | HTTPS | New version live |

## Troubleshooting

| Issue | Check |
|-------|-------|
| Build fails | GitHub Actions → Actions tab → check logs |
| Deploy fails | Check VERCEL_* secrets match dashboard values |
| Auth fails | Supabase → Authentication → check Google provider config |
| Data not saving | Supabase → Table Editor → check RLS policies |
| Realtime not working | Browser console → check WebSocket connection status |
| CORS errors | Supabase → Settings → API → check allowed origins |
