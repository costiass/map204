-- 001 · Schema
--
-- Two kinds of id, and keeping them straight is the whole point of this file:
--
--   * Everything the app creates — documents, pages — is `text`, because the
--     client generates readable ids like `page_1737…_a1b2c3` and must be able to
--     name a page before its row exists. (The Realtime topic *is* the page id.)
--
--   * Everything that refers to a person — `owner_id`, `user_id` — stays `uuid`,
--     matching `auth.users.id`. That gives real foreign keys, lets Postgres
--     infer joins for PostgREST, and means `auth.uid()` is never cast.
--
-- Getting this wrong in either direction is what produced the original
-- "operator does not exist: uuid = text" failures, so it is stated up front and
-- the rest of the schema depends on it.

-- ----------------------------------------------------------------
-- documents: a workspace
-- ----------------------------------------------------------------
create table if not exists public.documents (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled',

  -- The workspace's own look: a colour and an icon, so a subject can be
  -- recognised before its name is read. Both are *token names*, never hex, so
  -- they recolour with the reader's theme instead of carrying a fixed shade
  -- that reads wrong on a dark background.
  --
  -- Constrained, because an unrecognised value reaches the browser as an empty
  -- icon box or a colour nobody chose. The lists here are mirrored in
  -- src/theme.ts, and scripts/test-workspace-look.cjs fails the build if the two
  -- ever disagree.
  accent text not null default 'indigo',
  icon text not null default 'layout-grid',

  -- Document-wide defaults (DocSettings): default card and link styles.
  settings jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint documents_accent_check check (accent in (
    'indigo', 'violet', 'blue', 'teal', 'green', 'amber', 'rose', 'slate'
  )),
  constraint documents_icon_check check (icon in (
    'layout-grid', 'book-open', 'graduation-cap', 'flask-conical', 'globe',
    'calculator', 'microscope', 'languages', 'palette', 'music', 'code',
    'map', 'lightbulb', 'presentation', 'brain', 'library'
  ))
);

-- ----------------------------------------------------------------
-- pages: one row per page, its whole content stored as JSONB
-- ----------------------------------------------------------------
-- A page's cards, groups and connections are three JSONB values, not hundreds
-- of rows. That is a deliberate trade: a page is read and written as one unit,
-- so there is no per-card access check and no partial write to reconcile. The
-- cost is that two people editing *different* cards on the same page conflict
-- at page granularity — which is why the client merges by id rather than
-- overwriting.
create table if not exists public.pages (
  id text primary key default gen_random_uuid()::text,
  document_id text not null references public.documents (id) on delete cascade,
  title text not null default 'Untitled Page',
  -- Position in the page list. Ordered by this, never by insertion time.
  ordinal integer not null default 0,
  position jsonb not null default '{"x":0,"y":0,"width":1920,"height":1080,"zIndex":0}'::jsonb,
  viewport jsonb not null default '{"x":0,"y":0,"zoom":1}'::jsonb,
  cards jsonb not null default '[]'::jsonb,
  groups jsonb not null default '[]'::jsonb,
  connections jsonb not null default '[]'::jsonb,
  -- Optimistic concurrency: a write must match the version it read.
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pages_document_ordinal_idx
  on public.pages (document_id, ordinal);

-- ----------------------------------------------------------------
-- user_settings: exactly one row per account, created on signup
-- ----------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  -- Which neutral set to use: default | metallic | fluffy | contrast
  palette text not null default 'default'
    check (palette in ('default', 'metallic', 'fluffy', 'contrast')),
  -- Which colour carries emphasis: indigo | violet | blue | teal | green | amber | rose
  accent text not null default 'indigo'
    check (accent in ('indigo', 'violet', 'blue', 'teal', 'green', 'amber', 'rose')),
  card_radius integer not null default 12 check (card_radius between 0 and 40),
  reduce_motion boolean not null default false,
  default_snap_to_grid boolean not null default true,
  default_grid_pattern text not null default 'dots'
    check (default_grid_pattern in ('none', 'dots', 'lines')),
  default_grid_size integer not null default 20 check (default_grid_size between 4 and 200),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- profiles: a safe mirror of auth.users
-- ----------------------------------------------------------------
-- Declared before document_collaborators so that table can point its user_id
-- straight at it. A foreign key to auth.users alone would not do: PostgREST
-- resolves the `profile:profiles(...)` embed the share dialog uses only through
-- a direct relationship between the two tables.
--
-- It is a copy rather than a view because `auth.users` is not readable by
-- clients, and the share list has to show somebody's name and picture.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- document_collaborators: who else may open a workspace
-- ----------------------------------------------------------------
-- Note there is deliberately *no* row for the owner. `documents.owner_id` is the
-- single source of truth for ownership; this table holds only the people the
-- owner invited, so the two cannot disagree. An earlier schema had an
-- `add_document_owner` helper intended to add an owner row, and nothing ever
-- called it — dead code that made several places look for a row that never
-- existed. It is gone.
create table if not exists public.document_collaborators (
  document_id text not null references public.documents (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

create index if not exists document_collaborators_user_idx
  on public.document_collaborators (user_id);

-- ----------------------------------------------------------------
-- Turn row-level security on
-- ----------------------------------------------------------------
-- Every table above, without exception. A policy is inert until the table has RLS
-- enabled, and a table with policies but no RLS is *worse* than one with neither:
-- it reads as protected in review and is wide open at runtime. `create policy` in
-- 002 does not enable anything by itself.
--
-- scripts/test-rls-policies.cjs fails if this list and the tables in this file
-- ever disagree, precisely because the failure is invisible until somebody reads
-- another person's notes.
alter table public.documents enable row level security;
alter table public.pages enable row level security;
alter table public.user_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.document_collaborators enable row level security;
