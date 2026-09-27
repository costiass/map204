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
  id uuid PRIMARY KEY,
  owner_id uuid REFERENCES auth.users(id),
  title text,
  created_at timestamptz,
  updated_at timestamptz
)

-- Pages within documents
pages (
  id text PRIMARY KEY,
  document_id uuid REFERENCES documents(id),
  title text,
  position jsonb NOT NULL,      -- Position (x, y, width, height, zIndex)
  viewport jsonb NOT NULL,      -- Viewport { x, y, zoom }
  cards jsonb NOT NULL DEFAULT '[]',
  groups jsonb NOT NULL DEFAULT '[]',
  connections jsonb NOT NULL DEFAULT '[]',
  version integer DEFAULT 0,    -- For conflict resolution
  created_at timestamptz,
  updated_at timestamptz
)

-- User preferences
user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  theme text CHECK (theme IN ('light', 'dark')),
  default_snap_to_grid boolean DEFAULT true,
  default_grid_pattern text CHECK (pattern IN ('none', 'dots', 'lines')),
  default_grid_size integer DEFAULT 20,
  updated_at timestamptz
)

-- Collaboration
document_collaborators (
  document_id uuid REFERENCES documents(id),
  user_id uuid REFERENCES auth.users(id),
  role text CHECK (role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (document_id, user_id)
)
```

### Row Level Security (RLS)

All tables have RLS enabled with policies ensuring:
- Users can only access their own documents
- Collaborators can access shared documents
- Users can only modify their own settings
- No cross-user data leakage

## Realtime Architecture

### WebSocket Communication Flow

```
User A edits card
       │
       ▼
┌───────────────────────┐
│  Zustand Store        │  (local state update)
│  mergeDoc()           │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│  WebSocket Broadcast  │  (supabase.channel().send())
│  channel.send({       │
│   event: 'page-update',│
│   payload: { cards,    │
│     groups,            │
│     connections,       │
│     viewport,          │
│     version }          │
│ })                    │
└───────────┬───────────┘
            │
    ┌───────┴───────┐
    ▼               ▼
User B          User C
(Realtime)    (Realtime)
  │               │
  ▼               ▼
┌───────────────────────┐
│  Channel.on()         │  (receive broadcast)
│  mergeDoc()           │  (merge remote state)
└───────────────────────┘
```

### Conflict Resolution

- Each page has a `version` integer that increments on every save
- Realtime broadcasts include the version number
- Remote changes only applied if `remote.version > local.version`
- Prevents stale writes from overwriting newer changes

### Data Persistence Strategy

| Operation | Transport | Timing |
|-----------|-----------|--------|
| Card/Group/Connection edits | WebSocket broadcast | Immediate |
| Auto-save to Postgres | REST (PATCH) | 500ms debounce |
| Document creation | REST (POST) | Immediate |
| Settings change | REST (UPSERT) | Immediate |

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
│   mergeDoc (for realtime sync)
}
```

### Routing (Client-side)

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | WorkspacePage | Document list (Google Docs style) |
| `/canvas/:docId` | Canvas | Main editor with inspector |
| `/settings` | UserSettingsPage | User preferences overlay |

### Component Hierarchy

```
App
├── AuthGuard
│   ├── Toolbar
│   │   ├── Logo/Home
│   │   ├── Page Title (canvas)
│   │   ├── Canvas Actions (Card, Group, Undo, Zoom)
│   │   ├── Search, Import/Export, Save
│   │   ├── Dark Mode Toggle
│   │   ├── Shortcuts
│   │   └── User Avatar Menu (Settings, Workspaces, Sign Out)
│   ├── WorkspacePage (route: /)
│   ├── Canvas (route: /canvas/:docId)
│   │   ├── ConnectionLayer (SVG edges)
│   │   ├── Card Nodes (draggable, resizable)
│   │   ├── Group Nodes (containers)
│   │   └── Connection Handles
│   ├── Inspector (right sidebar)
│   │   ├── Content Tab (Markdown editor)
│   │   └── Settings Tab (styles, layout)
│   ├── SearchPanel (Cmd+K)
│   ├── UserSettingsPage (overlay, inspector-style)
│   ├── ContextMenu (right-click)
│   ├── ImportExportDialog
│   └── Toasts
```

## API Endpoints (Auto-generated by PostgREST)

All database operations use Supabase's auto-generated REST API:

| Operation | Endpoint | Method |
|-----------|----------|--------|
| List documents | `GET /rest/v1/documents?owner_id=eq.{uid}` | GET |
| Create document | `POST /rest/v1/documents` | POST |
| Get document | `GET /rest/v1/documents?id=eq.{id}` | GET |
| Update document | `PATCH /rest/v1/documents?id=eq.{id}` | PATCH |
| List pages | `GET /rest/v1/pages?document_id=eq.{id}` | GET |
| Create page | `POST /rest/v1/pages` | POST |
| Update page | `PATCH /rest/v1/pages?id=eq.{id}` | PATCH |
| Get user settings | `GET /rest/v1/user_settings?user_id=eq.{uid}` | GET |
| Update settings | `UPSERT /rest/v1/user_settings` | POST |

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
2. **Enable Google OAuth**: Authentication → Providers → Google
   - Add redirect URL: `https://<project-ref>.supabase.co/auth/v1/callback`
2. **Run Migrations**: Execute `supabase/migrations/001_initial_schema.sql` through `005_cleanup_and_realtime.sql` in SQL Editor
3. **Enable Realtime**: Database → Replication → Enable for `documents`, `pages`, `user_settings`
3. **Configure Auth**: Set Site URL in Authentication → URL Configuration

### Environment Variables for Vercel

| Variable | Source |
|----------|--------|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API |

## Testing Checklist

- [ ] Sign in with Google works
- [ ] Workspace list loads
- [ ] Create new workspace
- [ ] Open workspace → canvas loads
- [ ] Create card, group, connection
- [ ] Drag card → position persists
- [ ] Open in second browser → realtime sync
- [ ] Edit settings → persists
- [ ] Dark mode toggle works
- [ ] Grid snap works
- [ ] Import/Export JSON works

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Supabase not configured" | Check `.env` has VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY |
| "Infinite recursion in policy" | Run migration `003_fix_rls_recursion.sql` |
| "Invalid UUID" | Run migration `004_fix_id_types.sql` |
| "User not found" (Vercel) | Re-create `VERCEL_TOKEN` |
| Realtime not working | Enable tables in Supabase → Replication |
| Build fails | Run `npm ci` then `npm run build` |

## Future Enhancements

- [ ] Offline support with IndexedDB sync
- [ ] Collaborative cursors
- [ ] Comments on cards
- [ ] Version history / time travel
- [ ] Templates marketplace
- [ ] Mobile responsive canvas
- [ ] Export to PDF/PNG
- [ ] Plugin system

---

*Last updated: 2026*