-- 001 · Initial schema
--
-- Two kinds of id, and keeping them straight is the whole point:
--
--   * Everything the app creates — documents, pages — is `text`, because the
--     client generates readable ids like `page_1737…_a1b2c3` and must be able to
--     reference them before the row exists (the Realtime topic is the page id).
--   * Everything that refers to a person — `owner_id`, `user_id` — stays `uuid`,
--     matching `auth.users.id`. That gives real foreign keys, lets Postgres
--     infer joins for PostgREST, and means no `auth.uid()` cast is ever needed.
--
-- Getting this wrong in either direction is what produced the earlier
-- "operator does not exist: uuid = text" failures, so it is stated up front.

-- ----------------------------------------------------------------
-- documents: a workspace
-- ----------------------------------------------------------------
create table if not exists public.documents (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled',
  -- Document-wide defaults (DocSettings): default card and link styles.
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- pages: one row per page, its content stored as JSONB
-- ----------------------------------------------------------------
create table if not exists public.pages (
  id text primary key default gen_random_uuid()::text,
  document_id text not null references public.documents (id) on delete cascade,
  title text not null default 'Untitled Page',
  -- Position in the page list. The list is ordered by this, never by insertion.
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
-- profiles: a safe mirror of auth.users for the share list
-- ----------------------------------------------------------------
-- Defined before document_collaborators so that table can point its user_id
-- straight at it. A foreign key to auth.users alone would not do: PostgREST
-- resolves `profile:profiles(...)` only through a direct relationship between
-- the two tables, and the share list embeds it on every row.
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
create table if not exists public.document_collaborators (
  document_id text not null references public.documents (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

create index if not exists document_collaborators_user_idx
  on public.document_collaborators (user_id);
