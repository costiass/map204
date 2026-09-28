-- =============================================================================
-- Map204 — complete schema, generated from supabase/migrations
-- =============================================================================
-- DO NOT EDIT. Rebuild it with:  npm run bootstrap
--
-- A bootstrap for a database that is empty, or one built from an older set of
-- migrations. It drops what the project owns, clears the migration history so
-- `supabase db push` starts from a clean slate, then applies every migration
-- in order.
--
-- For an incremental change, do not use this file: add a migration and run
-- `supabase db push`. This file is the whole schema, not a delta.
--
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Remove anything a previous version of this schema left behind
-- -----------------------------------------------------------------------------
-- Both lists are read out of the migrations, so a new table or function cannot
-- slip through without a matching drop. Triggers live on their functions, so
-- CASCADE takes those with them.
drop table if exists public.document_collaborators cascade;
drop table if exists public.documents cascade;
drop table if exists public.pages cascade;
drop table if exists public.profiles cascade;
drop table if exists public.user_settings cascade;

drop function if exists public.can_edit_document(p_document_id text) cascade;
drop function if exists public.can_edit_page(p_page_id text) cascade;
drop function if exists public.can_view_document(p_document_id text) cascade;
drop function if exists public.can_view_page(p_page_id text) cascade;
drop function if exists public.create_default_page() cascade;
drop function if exists public.create_settings_for_new_user() cascade;
drop function if exists public.create_tutorial_workspace(p_user_id uuid) cascade;
drop function if exists public.create_tutorial_workspace_for_new_user() cascade;
drop function if exists public.find_profile_by_email(p_email text) cascade;
drop function if exists public.import_pages(p_document_id text, p_pages jsonb) cascade;
drop function if exists public.prevent_deleting_last_page() cascade;
drop function if exists public.profiles_needing_resync() cascade;
drop function if exists public.realtime_document_id() cascade;
drop function if exists public.realtime_page_id() cascade;
drop function if exists public.resync_all_profiles() cascade;
drop function if exists public.shares_document_with(p_a uuid, p_b uuid) cascade;
drop function if exists public.sync_profile() cascade;
drop function if exists public.sync_profile_for(p_user_id uuid) cascade;
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.tutorial_page_one() cascade;
drop function if exists public.tutorial_page_two() cascade;

-- -----------------------------------------------------------------------------
-- 1. Forget the old migration history
-- -----------------------------------------------------------------------------
-- The CLI refuses to push when the database records versions that are not in
-- the repository. Clearing the table lets `db push` apply everything from the
-- first migration and record it properly, so this never has to happen again.
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The schema
-- -----------------------------------------------------------------------------
-- ---- 20261001000001_schema.sql -----------------------------------------
-- ---- 20261001000002_access_control.sql ---------------------------------
-- ---- 20261001000003_triggers.sql ---------------------------------------
-- ---- 20261001000004_realtime.sql ---------------------------------------
-- ---- 20261001000005_app_functions.sql ----------------------------------
-- ---- 20261001000006_tutorial_content.sql -------------------------------

-- =============================================================================
-- 20261001000001_schema.sql
-- =============================================================================
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

-- =============================================================================
-- 20261001000002_access_control.sql
-- =============================================================================
-- 002 · Access control
--
-- One rule governs this file: **a policy never queries another table that also
-- has RLS.** The first version of this schema did exactly that — a `documents`
-- policy read `document_collaborators` whose policy read `documents` — and
-- Postgres answered every request with
--
--   42P17  infinite recursion detected in policy for relation "documents"
--
-- which is not a permissions problem, it is a dead application.
--
-- Every cross-table question therefore goes through a `security definer`
-- function. Those run with the table owner's rights, so RLS does not re-enter
-- when they read the tables and the cycle cannot form. scripts/test-rls-policies
-- reads this file and fails if any policy reaches an RLS table directly, because
-- the mistake is easy to make and quiet when it happens to terminate.

-- ----------------------------------------------------------------
-- Helpers — STABLE + SECURITY DEFINER: read-only, cacheable, invisible to RLS
-- ----------------------------------------------------------------

-- Can this account see the workspace at all?
create or replace function public.can_view_document(p_document_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document_id and d.owner_id = auth.uid()
  ) or exists (
    select 1 from public.document_collaborators dc
    where dc.document_id = p_document_id
      and dc.user_id = auth.uid()
  );
$$;

-- Can this account change the workspace? The owner always can, which is why
-- every rule below falls back to the first branch rather than relying on a
-- collaborator row for the owner.
create or replace function public.can_edit_document(p_document_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document_id and d.owner_id = auth.uid()
  ) or exists (
    select 1 from public.document_collaborators dc
    where dc.document_id = p_document_id
      and dc.user_id = auth.uid()
      and dc.role in ('owner', 'editor')
  );
$$;

-- A new page has no row yet, so its check is about the document it is going
-- into — see the "can insert" policy below.
create or replace function public.can_view_page(p_page_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pages pg
    join public.documents d on d.id = pg.document_id
    where pg.id = p_page_id and d.owner_id = auth.uid()
  ) or exists (
    select 1
    from public.pages pg
    join public.document_collaborators dc on dc.document_id = pg.document_id
    where pg.id = p_page_id and dc.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_page(p_page_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pages pg
    join public.documents d on d.id = pg.document_id
    where pg.id = p_page_id and d.owner_id = auth.uid()
  ) or exists (
    select 1
    from public.pages pg
    join public.document_collaborators dc on dc.document_id = pg.document_id
    where pg.id = p_page_id
      and dc.user_id = auth.uid()
      and dc.role in ('owner', 'editor')
  );
$$;

-- Do these two accounts share a workspace? Used by the profiles policy, which
-- would otherwise have to read document_collaborators from inside a policy —
-- the exact shape that produced 42P17.
create or replace function public.shares_document_with(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_collaborators mine
    join public.document_collaborators theirs
      on theirs.document_id = mine.document_id
    where mine.user_id = p_a and theirs.user_id = p_b
  );
$$;

grant execute on function public.can_view_document(text) to authenticated;
grant execute on function public.can_edit_document(text) to authenticated;
grant execute on function public.can_view_page(text) to authenticated;
grant execute on function public.can_edit_page(text) to authenticated;
grant execute on function public.shares_document_with(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------
-- documents
-- ----------------------------------------------------------------
create policy "owner can read"
  on public.documents for select
  using (owner_id = auth.uid());

create policy "collaborator can read"
  on public.documents for select
  using (public.can_view_document(documents.id));

create policy "owner can create"
  on public.documents for insert
  with check (owner_id = auth.uid());

create policy "owner can update"
  on public.documents for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "editor can update"
  on public.documents for update
  using (public.can_edit_document(documents.id))
  with check (public.can_edit_document(documents.id));

create policy "owner can delete"
  on public.documents for delete
  using (owner_id = auth.uid());

-- ----------------------------------------------------------------
-- pages
-- ----------------------------------------------------------------
create policy "can read"
  on public.pages for select
  using (public.can_view_page(pages.id));

-- A new page has no id of its own yet, so the check is about the document it is
-- going into. This is the policy that refuses an insert, and it is the only
-- thing standing between a signed-in user and a page in somebody's workspace.
create policy "can insert"
  on public.pages for insert
  with check (public.can_edit_document(pages.document_id));

create policy "can update"
  on public.pages for update
  using (public.can_edit_page(pages.id))
  with check (public.can_edit_page(pages.id));

create policy "can delete"
  on public.pages for delete
  using (public.can_edit_page(pages.id));

-- ----------------------------------------------------------------
-- document_collaborators
-- ----------------------------------------------------------------
create policy "can read"
  on public.document_collaborators for select
  using (public.can_view_document(document_collaborators.document_id));

-- WITH CHECK is what stops a collaborator adding themselves, or adding
-- themselves as a second owner.
create policy "owner can manage"
  on public.document_collaborators for all
  using (public.can_edit_document(document_collaborators.document_id))
  with check (public.can_edit_document(document_collaborators.document_id));

-- ----------------------------------------------------------------
-- user_settings: strictly your own row
-- ----------------------------------------------------------------
create policy "own settings"
  on public.user_settings for select
  using (user_id = auth.uid());

create policy "insert own settings"
  on public.user_settings for insert
  with check (user_id = auth.uid());

create policy "update own settings"
  on public.user_settings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------
-- profiles: yourself, and the people you share a workspace with
-- ----------------------------------------------------------------
create policy "can read profile"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.shares_document_with(auth.uid(), profiles.id)
  );

create policy "update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- 20261001000003_triggers.sql
-- =============================================================================
-- 003 · Triggers
--
-- The business rules live in the database, so they hold no matter which client
-- writes:
--
--   * a workspace always has at least one page, created for you
--   * a workspace that still exists cannot be emptied of pages
--   * an account always has a settings row and a profile
--   * updated_at is never stale
--
-- The triggers that *write* on the caller's behalf are `security definer`: a
-- caller's own RLS policy must not be able to veto a write the database is
-- required to make.

-- ----------------------------------------------------------------
-- A new workspace gets its first page
-- ----------------------------------------------------------------
create or replace function public.create_default_page()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_page_id text;
  next_ordinal integer;
begin
  -- The same shape the client uses, so ids read the same wherever they come from.
  new_page_id := 'page_' || floor(extract(epoch from now()) * 1000)::text
                 || '_' || substr(md5(random()::text), 1, 6);

  select coalesce(max(p.ordinal), -1) + 1 into next_ordinal
  from public.pages p
  where p.document_id = new.id;

  insert into public.pages (id, document_id, title, ordinal)
  values (new_page_id, new.id, 'Untitled Page', next_ordinal);

  return new;
end;
$$;

drop trigger if exists trg_create_default_page on public.documents;
create trigger trg_create_default_page
  after insert on public.documents
  for each row
  execute function public.create_default_page();

-- ----------------------------------------------------------------
-- A workspace that still exists must keep a page
-- ----------------------------------------------------------------
-- The subtle part: this trigger must not fire when the page is going because
-- its *workspace* is going. `pages.document_id` is `on delete cascade`, so
-- deleting a workspace deletes its pages, and without the check below the
-- workspace's only page vetoes its own removal:
--
--   DELETE /documents  400 Bad Request
--   P0001  A workspace must keep at least one page. Add another page before
--          deleting this one.
--
-- which made every workspace undeletable.
--
-- `pg_trigger_depth()` is how the two cases are told apart: a row removed by a
-- cascade runs with a deeper trigger stack than one removed by a direct
-- statement, because the foreign key's own trigger fires first. A fixed number
-- would not do — the depth varies with the shape of the delete.
--
-- `security definer` matters just as much. Without it the check's own
-- `select … from pages` runs as the calling user and is filtered by the `pages`
-- policies, so a collaborator who can read pages but not edit the document
-- could see zero rows from inside the trigger, and the rule would veto an
-- ordinary page delete — the failure it exists to prevent, caused by the
-- trigger itself.
create or replace function public.prevent_deleting_last_page()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Being removed because the workspace containing it is going too.
  if pg_trigger_depth() > 1 then
    return old;
  end if;

  if not exists (
    select 1 from public.pages p
    where p.document_id = old.document_id
      and p.id <> old.id
  ) then
    raise exception
      'A workspace must keep at least one page. Add another page before deleting this one.'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_prevent_last_page_delete on public.pages;
create trigger trg_prevent_last_page_delete
  before delete on public.pages
  for each row
  execute function public.prevent_deleting_last_page();

-- ----------------------------------------------------------------
-- updated_at
-- ----------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_documents on public.documents;
create trigger trg_touch_documents
  before update on public.documents
  for each row
  execute function public.touch_updated_at();

drop trigger if exists trg_touch_pages on public.pages;
create trigger trg_touch_pages
  before update on public.pages
  for each row
  execute function public.touch_updated_at();

drop trigger if exists trg_touch_profiles on public.profiles;
create trigger trg_touch_profiles
  before update on public.profiles
  for each row
  execute function public.touch_updated_at();

-- ----------------------------------------------------------------
-- An account gets its settings row
-- ----------------------------------------------------------------
create or replace function public.create_settings_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_create_settings on auth.users;
create trigger trg_create_settings
  after insert on auth.users
  for each row
  execute function public.create_settings_for_new_user();

-- ----------------------------------------------------------------
-- An account gets a profile, and keeps it current
-- ----------------------------------------------------------------
-- The logic is a `uuid` function rather than the trigger body, so it can also be
-- called by hand. That is not a convenience: an earlier version put the upsert
-- in the trigger and used `on conflict do nothing` in a backfill, which could
-- only ever *create* a profile and never correct one. Every account whose row
-- already existed with blanks kept them forever, and the share list showed them
-- as "Unknown user" with no picture, permanently. With the logic in a callable
-- function the same code path repairs a bad row.
--
-- `coalesce` covers both spellings of a Google profile: Supabase's own
-- `avatar_url` and Google's `picture`.
create or replace function public.sync_profile_for(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  source auth.users;
begin
  select * into source from auth.users where id = p_user_id;
  if not found then
    return;
  end if;

  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    source.id,
    source.email,
    nullif(coalesce(
      source.raw_user_meta_data ->> 'full_name',
      source.raw_user_meta_data ->> 'name'
    ), ''),
    nullif(coalesce(
      source.raw_user_meta_data ->> 'avatar_url',
      source.raw_user_meta_data ->> 'picture'
    ), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        avatar_url = excluded.avatar_url,
        updated_at = now();
end;
$$;

create or replace function public.sync_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_profile_for(new.id);
  return new;
end;
$$;

drop trigger if exists trg_sync_profile on auth.users;
create trigger trg_sync_profile
  after insert or update of email, raw_user_meta_data on auth.users
  for each row
  execute function public.sync_profile();

grant execute on function public.sync_profile_for(uuid) to service_role;

-- ----------------------------------------------------------------
-- Bring existing accounts in line
-- ----------------------------------------------------------------
-- Both are repairs, not just creates, so a row that already exists with blanks
-- is fixed rather than skipped.
insert into public.user_settings (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

select public.sync_profile_for(id) from auth.users;

-- =============================================================================
-- 20261001000004_realtime.sql
-- =============================================================================
-- 004 · Realtime
--
-- The collaboration channels are private, which means Supabase routes every
-- message through `realtime.messages` and the policies below decide who may
-- listen and who may publish. Without them, anybody holding the public anon key
-- could subscribe to somebody else's page.
--
--   page:<pageId>      page content, for the people on that page
--   document:<docId>   presence, live pointers, "pages were added"
--
-- Both matter equally and the split is deliberate: page *content* is per page,
-- because it is large and only the people looking at that page need it. A
-- pointer belongs to the workspace, because it carries which page it is on and
-- the person may move to another page without the channel changing.
--
-- Sending on one of these and listening on the other fails silently — the send
-- succeeds and the message arrives in a room nobody is in. So the pairing is
-- asserted by scripts/test-realtime-wiring.cjs against the client.

-- ----------------------------------------------------------------
-- The tables the client listens to
-- ----------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['documents', 'pages', 'user_settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------
-- Read the id out of the topic
-- ----------------------------------------------------------------
-- A channel's topic arrives as `realtime:page:<pageId>`.
create or replace function public.realtime_page_id()
returns text
language sql
stable
as $$
  select (regexp_match(realtime.topic(), 'page:([^:]+)$'))[1];
$$;

create or replace function public.realtime_document_id()
returns text
language sql
stable
as $$
  select (regexp_match(realtime.topic(), 'document:([^:]+)$'))[1];
$$;

grant execute on function public.realtime_page_id() to authenticated;
grant execute on function public.realtime_document_id() to authenticated;

grant select, insert on realtime.messages to authenticated;

-- ----------------------------------------------------------------
-- Listening: anyone who could already read it over REST
-- ----------------------------------------------------------------
create policy "can receive page broadcasts"
  on realtime.messages for select to authenticated
  using (
    public.realtime_page_id() is not null
    and public.can_view_page(public.realtime_page_id())
  );

create policy "can receive document presence"
  on realtime.messages for select to authenticated
  using (
    public.realtime_document_id() is not null
    and public.can_view_document(public.realtime_document_id())
  );

-- ----------------------------------------------------------------
-- Publishing: editors only, so a viewer cannot push a change
-- ----------------------------------------------------------------
create policy "can publish page broadcasts"
  on realtime.messages for insert to authenticated
  with check (
    public.realtime_page_id() is not null
    and public.can_edit_page(public.realtime_page_id())
  );

create policy "can publish document presence"
  on realtime.messages for insert to authenticated
  with check (
    public.realtime_document_id() is not null
    and public.can_edit_document(public.realtime_document_id())
  );

-- =============================================================================
-- 20261001000005_app_functions.sql
-- =============================================================================
-- 005 · Application functions
--
-- The things the app needs that a plain table read cannot do.

-- ----------------------------------------------------------------
-- Find somebody by their email address
-- ----------------------------------------------------------------
-- The share dialog has to turn "sam@example.com" into a user id, but `profiles`
-- is only readable for yourself and your co-collaborators, so a plain SELECT
-- returns nothing. This is `security definer` and matches exactly, so it can be
-- used to share *with* a known address without becoming a way to enumerate
-- every account that exists.
create or replace function public.find_profile_by_email(p_email text)
returns table (id uuid, email text, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.full_name, p.avatar_url
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.find_profile_by_email(text) from public;
grant execute on function public.find_profile_by_email(text) to authenticated;

-- ----------------------------------------------------------------
-- Import pages from a file
-- ----------------------------------------------------------------
-- One call, one transaction. Every page in the file is *added* to the
-- workspace; nothing already there is read, written or deleted.
--
-- Additive, not "replace the document". A destructive import is a class of bug
-- with no upside here: it is unsafe to run twice, unsafe to run over somebody
-- else's work, and possible to get wrong by choosing the wrong option. This way
-- importing the same file twice gives two independent sets of pages.
--
-- Atomic, which the client-driven version it replaced was not. That one did
-- N inserts, then N deletes, then a read, from the browser — so a failure
-- part-way through left a workspace holding both the old pages and some of the
-- new ones, with no record of which state it was in. One statement inside one
-- transaction is either the whole file or none of it.
--
-- The server also mints every id and rewires every reference, so the browser
-- does none of that work and cannot get it wrong.
create or replace function public.import_pages(
  p_document_id text,
  p_pages jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted jsonb := '[]'::jsonb;
  page jsonb;
  page_id text;
  next_ordinal integer;
  new_cards jsonb;
  new_groups jsonb;
  new_connections jsonb;
  card_map jsonb := '{}'::jsonb;
  group_map jsonb := '{}'::jsonb;
  conn_map jsonb := '{}'::jsonb;
begin
  ----------------------------------------------------------------
  -- Permission, and it is not optional. Being `security definer` is what lets
  -- this function insert at all; without an explicit check that would hand every
  -- account a way to write into any workspace. It is the first statement, and it
  -- uses the same helper the RLS policies use, so there is one definition of
  -- "may edit this".
  ----------------------------------------------------------------
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.can_edit_document(p_document_id) then
    raise exception 'You do not have edit access to that workspace.' using errcode = '42501';
  end if;

  if p_pages is null
     or jsonb_typeof(p_pages) <> 'array'
     or jsonb_array_length(p_pages) = 0 then
    raise exception 'The file contains no pages.' using errcode = '22023';
  end if;

  ----------------------------------------------------------------
  -- Imported pages land after the existing ones, so an import never interleaves
  -- with pages somebody is working on.
  ----------------------------------------------------------------
  select coalesce(max(p.ordinal), -1) + 1 into next_ordinal
  from public.pages p
  where p.document_id = p_document_id;

  for page in select value from jsonb_array_elements(p_pages)
  loop
    -- A page id is a primary key across every workspace, so it is always minted
    -- here rather than trusted from the file.
    page_id := 'page_' || floor(extract(epoch from now()) * 1000)::text
               || '_' || substr(md5(random()::text), 1, 6);

    card_map := coalesce((
      select jsonb_object_agg(
        coalesce(c.value ->> 'id', ''),
        'card_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'cards', '[]'::jsonb)) c(value)
    ), '{}'::jsonb);

    group_map := coalesce((
      select jsonb_object_agg(
        coalesce(g.value ->> 'id', ''),
        'group_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb)) g(value)
    ), '{}'::jsonb);

    conn_map := coalesce((
      select jsonb_object_agg(
        coalesce(x.value ->> 'id', ''),
        'connection_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'connections', '[]'::jsonb)) x(value)
    ), '{}'::jsonb);

    ----------------------------------------------------------------
    -- Cards: new id, and a new parentId looked up in the same map. Order is
    -- preserved so the canvas draws them in the same sequence.
    --
    -- Only the reference fields are touched. An earlier draft rewrote ids by
    -- casting each array to text and running `replace()` over it, which is
    -- short and wrong: ids are opaque strings that also appear in places they
    -- are not references — most obviously inside a card's Markdown body, which
    -- `replace()` would silently corrupt.
    ----------------------------------------------------------------
    new_cards := coalesce((
      select jsonb_agg(
        c.value || jsonb_build_object(
          'id', coalesce(card_map ->> (c.value ->> 'id'), c.value ->> 'id'),
          'parentId', case
            when c.value -> 'parentId' is null
              or jsonb_typeof(c.value -> 'parentId') = 'null'
              then null
            else coalesce(card_map ->> (c.value ->> 'parentId'), c.value ->> 'parentId')
          end
        )
        order by c.ord
      )
      from jsonb_array_elements(coalesce(page -> 'cards', '[]'::jsonb))
           with ordinality as c(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Groups: new id, and both membership lists re-pointed. A member that is not
    -- on the page is dropped rather than left pointing at a card that is not
    -- here — the client would drop it on read anyway, and filtering keeps the
    -- stored row honest.
    --
    -- `m` is the table alias, so `m` alone is a row and `m.id` is the value.
    -- Writing `->> m` is a `jsonb ->> record`, which Postgres rejects.
    ----------------------------------------------------------------
    new_groups := coalesce((
      select jsonb_agg(
        g.value || jsonb_build_object(
          'id', coalesce(group_map ->> (g.value ->> 'id'), g.value ->> 'id'),
          'memberCardIds', coalesce((
            select jsonb_agg(coalesce(card_map ->> m.id, m.id) order by m.ord)
            from jsonb_array_elements_text(
              coalesce(g.value -> 'memberCardIds', '[]'::jsonb)
            ) with ordinality as m(id, ord)
            where card_map ? m.id
          ), '[]'::jsonb),
          'memberGroupIds', coalesce((
            select jsonb_agg(coalesce(group_map ->> m.id, m.id) order by m.ord)
            from jsonb_array_elements_text(
              coalesce(g.value -> 'memberGroupIds', '[]'::jsonb)
            ) with ordinality as m(id, ord)
            where group_map ? m.id
          ), '[]'::jsonb)
        )
        order by g.ord
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb))
           with ordinality as g(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Connections: new id, and each endpoint re-pointed through the map for
    -- whichever kind it names. A connection to something absent is dropped,
    -- because an arrow to nothing is not a link.
    ----------------------------------------------------------------
    new_connections := coalesce((
      select jsonb_agg(
        x.value || jsonb_build_object(
          'id', coalesce(conn_map ->> (x.value ->> 'id'), x.value ->> 'id'),
          'source', (x.value -> 'source') || jsonb_build_object(
            'id', coalesce(
              case when x.value -> 'source' ->> 'kind' = 'group'
                then group_map ->> (x.value -> 'source' ->> 'id')
                else card_map ->> (x.value -> 'source' ->> 'id')
              end,
              x.value -> 'source' ->> 'id'
            )
          ),
          'target', (x.value -> 'target') || jsonb_build_object(
            'id', coalesce(
              case when x.value -> 'target' ->> 'kind' = 'group'
                then group_map ->> (x.value -> 'target' ->> 'id')
                else card_map ->> (x.value -> 'target' ->> 'id')
              end,
              x.value -> 'target' ->> 'id'
            )
          )
        )
        order by x.ord
      )
      from jsonb_array_elements(coalesce(page -> 'connections', '[]'::jsonb))
           with ordinality as x(value, ord)
      where (case when x.value -> 'source' ->> 'kind' = 'group'
                   then group_map ? (x.value -> 'source' ->> 'id')
                   else card_map ? (x.value -> 'source' ->> 'id') end)
        and (case when x.value -> 'target' ->> 'kind' = 'group'
                    then group_map ? (x.value -> 'target' ->> 'id')
                    else card_map ? (x.value -> 'target' ->> 'id') end)
    ), '[]'::jsonb);

    insert into public.pages (
      id, document_id, title, ordinal, position, viewport,
      cards, groups, connections, version
    )
    values (
      page_id,
      p_document_id,
      coalesce(nullif(page ->> 'title', ''), 'Imported page'),
      next_ordinal,
      coalesce(page -> 'position', '{"x":0,"y":0,"width":1920,"height":1080,"zIndex":0}'::jsonb),
      coalesce(page -> 'viewport', '{"x":0,"y":0,"zoom":1}'::jsonb),
      new_cards,
      new_groups,
      new_connections,
      0
    );

    next_ordinal := next_ordinal + 1;
    inserted := inserted || jsonb_build_object(
      'id', page_id,
      'title', coalesce(nullif(page ->> 'title', ''), 'Imported page')
    );
  end loop;

  return inserted;
end;
$$;

grant execute on function public.import_pages(text, jsonb) to authenticated;

-- ----------------------------------------------------------------
-- A welcome workspace for every account
-- ----------------------------------------------------------------
-- Created by the database, not the client, so it exists no matter which entry
-- point made the account. Two pages, and between them they use every part of
-- the data model: groups, a card inside a group, links between groups and cards,
-- every relationship, all three strokes, all three routings, several arrowheads,
-- and checklists.
--
-- A first version was five cards in a row, which demonstrated that cards exist
-- and nothing else — somebody reading it could not tell that grouping, page
-- lists or connection styling were features rather than accidents.
create or replace function public.create_tutorial_workspace(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_document_id text;
  first_page_id text;
begin
  -- One welcome workspace per account, ever. Re-running is harmless.
  if exists (select 1 from public.documents where owner_id = p_user_id) then
    select id into new_document_id
    from public.documents
    where owner_id = p_user_id
    order by created_at
    limit 1;
    return new_document_id;
  end if;

  insert into public.documents (owner_id, title, accent, icon)
  values (p_user_id, 'tutorial', 'violet', 'graduation-cap')
  returning id into new_document_id;

  -- trg_create_default_page has already made the first page by now.
  select id into first_page_id
  from public.pages
  where document_id = new_document_id
  order by ordinal
  limit 1;

  update public.pages
  set title = 'Start here',
      cards = tutorial_page_one() -> 'cards',
      groups = tutorial_page_one() -> 'groups',
      connections = tutorial_page_one() -> 'connections',
      viewport = '{"x":-60,"y":-40,"zoom":0.8}'::jsonb
  where id = first_page_id;

  insert into public.pages (
    id, document_id, title, ordinal, position, viewport, cards, groups, connections
  )
  values (
    'page_tutorial_maps',
    new_document_id,
    'Making maps',
    1,
    '{"x":0,"y":0,"width":1920,"height":1080,"zIndex":0}'::jsonb,
    '{"x":-40,"y":-40,"zoom":0.8}'::jsonb,
    tutorial_page_two() -> 'cards',
    tutorial_page_two() -> 'groups',
    tutorial_page_two() -> 'connections'
  );

  return new_document_id;
end;
$$;

create or replace function public.create_tutorial_workspace_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_tutorial_workspace(new.id);
  return new;
end;
$$;

drop trigger if exists trg_create_tutorial_workspace on auth.users;
create trigger trg_create_tutorial_workspace
  after insert on auth.users
  for each row
  execute function public.create_tutorial_workspace_for_new_user();

-- Accounts that already exist and have no workspace at all.
do $$
declare
  u record;
begin
  for u in
    select a.id from auth.users a
    where not exists (select 1 from public.documents d where d.owner_id = a.id)
  loop
    perform public.create_tutorial_workspace(u.id);
  end loop;
end;
$$;

-- ----------------------------------------------------------------
-- Admin repairs
-- ----------------------------------------------------------------
-- How many accounts would change if they were re-derived. A diagnostic, so you
-- can look before changing anything.
create or replace function public.profiles_needing_resync()
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
     or exists (
       select 1 from public.profiles p
       where p.id = u.id
         and (p.full_name is null or p.avatar_url is null)
     );
$$;

-- Re-derive every profile. Returns how many it touched. Safe to run whenever.
create or replace function public.resync_all_profiles()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  select count(*) into n from auth.users;
  perform public.sync_profile_for(id) from auth.users;
  return n;
end;
$$;

grant execute on function public.profiles_needing_resync() to service_role;
grant execute on function public.resync_all_profiles() to service_role;

-- =============================================================================
-- 20261001000006_tutorial_content.sql
-- =============================================================================
-- 006 · The welcome content
--
-- Kept apart from 005 because it is content, not behaviour: two large blocks of
-- JSONB with no logic in them. Separating them means a change to the wording is
-- a change to one obvious file, and a reader looking for how import works does
-- not have to wade through a worked example of a political theory map.

-- ----------------------------------------------------------------
-- Page 1 · Start here
-- ----------------------------------------------------------------
-- Between the two pages this exercises: groups, a card inside a group, links
-- between cards, links between a card and a group, every relationship that
-- appears in RELATIONSHIP_PRESETS, all three line styles, all three routings,
-- several arrowheads, and checklists. scripts/test-tutorial-content.cjs asserts
-- that, so the tutorial cannot quietly lose its point by being edited.
create or replace function public.tutorial_page_one()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'cards', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut_welcome',
        'title', 'Welcome to Map204',
        'content',
          'This workspace is yours to change. Rename it, delete it, or add pages beside it.'
          || chr(10) || chr(10)
          || 'Everything you do is saved to your account and shared with whoever you invite.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 0, 'width', 320, 'height', 250, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#EEF2FF', 'accentColor', '#6366F1', 'textColor', '#111827',
          'borderColor', '#C7D2FE', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_basics',
        'title', 'The basics',
        'content',
          '**C** drops a card where you are looking.'
          || chr(10) || chr(10)
          || '- **G** adds a group, a box you can gather cards into'
          || chr(10)
          || '- **F** fits everything in view'
          || chr(10)
          || '- **Delete** removes whatever you have selected'
          || chr(10) || chr(10)
          || 'Drag a card by its header to move it, and drag the corner to resize.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 320, 'width', 320, 'height', 320, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FFFFFF', 'accentColor', '#0EA5E9', 'textColor', '#111827',
          'borderColor', '#E5E7EB', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(
          jsonb_build_object('id', 'tut_task_1', 'text', 'Press C to add a card', 'done', false),
          jsonb_build_object('id', 'tut_task_2', 'text', 'Press G to add a group', 'done', false),
          jsonb_build_object('id', 'tut_task_3', 'text', 'Connect two things with a drag', 'done', false)
        ),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_groups',
        'title', 'Groups collect related cards',
        'content',
          'A group is a labelled box. Drop cards inside it and they belong to it'
          || chr(10)
          || 'together — useful for a section of an argument, or one week of notes.'
          || chr(10) || chr(10)
          || 'Groups can be linked to each other and to cards, so a box can be an'
          || chr(10)
          || 'argument in its own right.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 720, 'width', 320, 'height', 300, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#ECFDF5', 'accentColor', '#16A34A', 'textColor', '#111827',
          'borderColor', '#BBF7D0', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here', 'groups'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_links',
        'title', 'Links carry meaning',
        'content',
          'Drag from one of the small dots on a card edge onto another card.'
          || chr(10) || chr(10)
          || 'The arrow picks the best side by itself. Click it to give the link a'
          || chr(10)
          || 'relationship, a colour, and a stroke.'
          || chr(10) || chr(10)
          || 'The three cards below are linked three different ways — a solid'
          || chr(10)
          || '**supports**, a dashed **part of**, and a dotted **contradicts**.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 440, 'y', 0, 'width', 340, 'height', 340, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FFF7ED', 'accentColor', '#D97706', 'textColor', '#111827',
          'borderColor', '#FED7AA', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here', 'links'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_example_support',
        'title', 'Evidence',
        'content', 'The 1848 report gave the data.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 460, 'y', 420, 'width', 260, 'height', 170, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FEF9C3', 'accentColor', '#CA8A04', 'textColor', '#111827',
          'borderColor', '#FDE68A', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('example'),
        'collapsed', false,
        'parentId', 'tut_group_evidence',
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_example_claim',
        'title', 'Conclusion',
        'content', 'So the reform was caused by the harvest failure.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 460, 'y', 650, 'width', 260, 'height', 180, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#E0F2FE', 'accentColor', '#0284C7', 'textColor', '#111827',
          'borderColor', '#BAE6FD', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('example'),
        'collapsed', false,
        'parentId', 'tut_group_evidence',
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_example_caveat',
        'title', 'A caveat',
        'content', 'But the tax records tell a different story.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 460, 'y', 890, 'width', 260, 'height', 180, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FFF1F2', 'accentColor', '#E11D48', 'textColor', '#111827',
          'borderColor', '#FECDD3', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('example'),
        'collapsed', false,
        'parentId', 'tut_group_evidence',
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_share',
        'title', 'Work on it together',
        'content',
          '**Share** in the top bar invites someone by email.'
          || chr(10) || chr(10)
          || '- **Can edit** — they can change anything'
          || chr(10)
          || '- **Can view** — they can look but not change'
          || chr(10) || chr(10)
          || 'You will see their cursor move, and you can click their avatar to'
          || chr(10)
          || 'follow along. Every workspace also has a colour and an icon, so you'
          || chr(10)
          || 'can tell your subjects apart at a glance.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 880, 'y', 0, 'width', 340, 'height', 400, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FDF2F8', 'accentColor', '#DB2777', 'textColor', '#111827',
          'borderColor', '#FBCFE8', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here', 'sharing'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_pages',
        'title', 'Pages split a big subject',
        'content',
          'A workspace holds as many pages as you need. Use the panel on the left'
          || chr(10)
          || 'to add, rename, reorder and delete them.'
          || chr(10) || chr(10)
          || 'There is a second page here — **Making maps** — with a worked example'
          || chr(10)
          || 'of the whole thing put together.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 880, 'y', 470, 'width', 340, 'height', 320, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#F5F3FF', 'accentColor', '#7C3AED', 'textColor', '#111827',
          'borderColor', '#DDD6FE', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here', 'pages'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'groups', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut_group_evidence',
        'title', 'One argument, three cards',
        'position', jsonb_build_object('x', 430, 'y', 390, 'width', 320, 'height', 710, 'zIndex', 1),
        'color', '#0EA5E9',
        'memberCardIds', jsonb_build_array('tut_example_support', 'tut_example_claim', 'tut_example_caveat'),
        'memberGroupIds', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'connections', jsonb_build_array(
      -- Card to card, inside the group: the two links a reader will follow.
      jsonb_build_object(
        'id', 'tut_link_support',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_example_support'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_example_claim'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'supports',
        'relationshipType', 'supports',
        'style', jsonb_build_object(
          'color', '#16A34A', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_contradicts',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_example_caveat'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_example_claim'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'contradicts',
        'relationshipType', 'contradicts',
        'style', jsonb_build_object(
          'color', '#E11D48', 'width', 2, 'lineStyle', 'dotted', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'triangle', 'animated', false
        )
      ),
      -- Card to group: proves a group can take part in the link graph.
      jsonb_build_object(
        'id', 'tut_link_to_group',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_links'),
        'target', jsonb_build_object('kind', 'group', 'id', 'tut_group_evidence'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'see it here',
        'relationshipType', 'example of',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'dashed', 'routing', 'stepped',
          'arrowStart', 'none', 'arrowEnd', 'circle', 'animated', false
        )
      ),
      -- The reading order of the tutorial itself, so a new account can see the
      -- shape of a finished map before making one.
      jsonb_build_object(
        'id', 'tut_link_welcome_basics',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_welcome'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_basics'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'start with',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_basics_groups',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_basics'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_groups'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'next',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_groups_links',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_groups'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_links'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'then',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_links_pages',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_links'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_pages'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'then',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_pages_share',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_pages'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_share'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'and',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      )
    )
  );
$$;

-- ----------------------------------------------------------------
-- Page 2 · Making maps
-- ----------------------------------------------------------------
-- A worked example rather than a feature list: a claim, the evidence for it, the
-- strongest objection, the reply, and what is still missing. It is the shape an
-- essay actually takes, which is the point.
create or replace function public.tutorial_page_two()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'cards', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut2_thesis',
        'title', 'The thesis',
        'content',
          'Start from the one sentence you are trying to defend. Everything else'
          || chr(10)
          || 'on this page hangs off it.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 260, 'width', 300, 'height', 200, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#EEF2FF', 'accentColor', '#6366F1', 'textColor', '#111827',
          'borderColor', '#C7D2FE', 'borderWidth', 2, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_evidence_one',
        'title', 'Evidence A',
        'content', 'A primary source that backs the thesis.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 0, 'width', 280, 'height', 180, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FEF9C3', 'accentColor', '#CA8A04', 'textColor', '#111827',
          'borderColor', '#FDE68A', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(
          jsonb_build_object('id', 'tut2_task_a', 'text', 'Quote it', 'done', false)
        ),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_evidence_two',
        'title', 'Evidence B',
        'content', 'A second, independent source.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 540, 'width', 280, 'height', 180, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FEF9C3', 'accentColor', '#CA8A04', 'textColor', '#111827',
          'borderColor', '#FDE68A', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(
          jsonb_build_object('id', 'tut2_task_b', 'text', 'Check it is independent', 'done', false)
        ),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_objection',
        'title', 'The strongest objection',
        'content',
          'Write down the best argument against you. If you cannot, you have not'
          || chr(10)
          || 'understood the topic yet — and neither has your reader.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 400, 'y', 0, 'width', 300, 'height', 220, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#FFF1F2', 'accentColor', '#E11D48', 'textColor', '#111827',
          'borderColor', '#FECDD3', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_rebuttal',
        'title', 'Your reply',
        'content', 'And then the card that answers it.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 800, 'y', 0, 'width', 300, 'height', 220, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#ECFDF5', 'accentColor', '#16A34A', 'textColor', '#111827',
          'borderColor', '#BBF7D0', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_gaps',
        'title', 'What is still missing',
        'content',
          'The gaps are the useful part. Anything you could not source goes here,'
          || chr(10)
          || 'and it is obvious what your next hour of reading should be for.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 400, 'y', 300, 'width', 300, 'height', 220, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#F5F3FF', 'accentColor', '#7C3AED', 'textColor', '#111827',
          'borderColor', '#DDD6FE', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('method'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(
          jsonb_build_object('id', 'tut2_task_g1', 'text', 'Find a source for the claim', 'done', false),
          jsonb_build_object('id', 'tut2_task_g2', 'text', 'Ask about it in the seminar', 'done', false),
          jsonb_build_object('id', 'tut2_task_g3', 'text', 'Rewrite the conclusion', 'done', false)
        ),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'groups', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut2_group_evidence',
        'title', 'Your evidence',
        'position', jsonb_build_object('x', -30, 'y', -30, 'width', 340, 'height', 790, 'zIndex', 1),
        'color', '#CA8A04',
        'memberCardIds', jsonb_build_array('tut2_evidence_one', 'tut2_thesis', 'tut2_evidence_two'),
        'memberGroupIds', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut2_group_reply',
        'title', 'The objection and the reply',
        'position', jsonb_build_object('x', 370, 'y', -30, 'width', 760, 'height', 290, 'zIndex', 1),
        'color', '#E11D48',
        'memberCardIds', jsonb_build_array('tut2_objection', 'tut2_rebuttal'),
        'memberGroupIds', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'connections', jsonb_build_array(
      -- Group to card: the evidence box itself points at what it proves.
      jsonb_build_object(
        'id', 'tut2_link_evidence_group',
        'source', jsonb_build_object('kind', 'group', 'id', 'tut2_group_evidence'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'proves',
        'relationshipType', 'supports',
        'style', jsonb_build_object(
          'color', '#CA8A04', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_a',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_evidence_one'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'supports',
        'relationshipType', 'supports',
        'style', jsonb_build_object(
          'color', '#CA8A04', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_b',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_evidence_two'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'supports',
        'relationshipType', 'supports',
        'style', jsonb_build_object(
          'color', '#CA8A04', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_objection',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_objection'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'challenges',
        'relationshipType', 'contradicts',
        'style', jsonb_build_object(
          'color', '#E11D48', 'width', 2, 'lineStyle', 'dotted', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'triangle', 'animated', false
        )
      ),
      -- Card into a group, the other way round: a card that is a *part of* the
      -- section it sits in.
      jsonb_build_object(
        'id', 'tut2_link_objection_part',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_objection'),
        'target', jsonb_build_object('kind', 'group', 'id', 'tut2_group_reply'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'belongs to',
        'relationshipType', 'part of',
        'style', jsonb_build_object(
          'color', '#E11D48', 'width', 1, 'lineStyle', 'dotted', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'none', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_rebuttal',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_rebuttal'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_objection'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'answers',
        'relationshipType', 'related to',
        'style', jsonb_build_object(
          'color', '#16A34A', 'width', 2, 'lineStyle', 'dashed', 'routing', 'stepped',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut2_link_gaps',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut2_gaps'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut2_thesis'),
        'sourceAnchor', null, 'targetAnchor', null,
        'label', 'undermines',
        'relationshipType', 'depends on',
        'style', jsonb_build_object(
          'color', '#7C3AED', 'width', 2, 'lineStyle', 'dashed', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'circle', 'animated', false
        )
      )
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- 3. Check the schema is actually complete, then record it as applied
-- -----------------------------------------------------------------------------
-- `supabase db push` compares its history table against supabase/migrations.
-- Left empty it would try to re-apply everything above and fail on the first
-- `create policy`. These rows say: done.
--
-- **The check comes first, and it is the important part.**
--
-- Recording the history unconditionally is how this file produced a database
-- that reported "up to date" while missing functions the app called. The SQL
-- Editor continues past a failed statement, so a migration that errored halfway
-- left the objects after it uncreated — and the unconditional insert still
-- marked every version as applied. `db push` then reported nothing to do, and
-- the app got 404s for functions the history claimed were there.
--
-- So the rows are only written if every object this schema is supposed to
-- create actually exists. If something is missing, this raises, the transaction
-- unwinds, and the history stays empty — which is a *visible* failure, because
-- the next `db push` will try again and tell you what went wrong.
do $$
declare
  missing text;
begin
  select string_agg(name, ', ') into missing
  from unnest(array[
    'can_edit_document',
    'can_edit_page',
    'can_view_document',
    'can_view_page',
    'create_default_page',
    'create_settings_for_new_user',
    'create_tutorial_workspace',
    'create_tutorial_workspace_for_new_user',
    'find_profile_by_email',
    'import_pages',
    'prevent_deleting_last_page',
    'profiles_needing_resync',
    'realtime_document_id',
    'realtime_page_id',
    'resync_all_profiles',
    'shares_document_with',
    'sync_profile',
    'sync_profile_for',
    'touch_updated_at',
    'tutorial_page_one',
    'tutorial_page_two'
  ]) as name
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = name
  );

  if missing is not null then
    raise exception
      'Bootstrap incomplete — these functions do not exist: %. '
      'A statement above failed, and the SQL Editor carries on past an error. '
      'The migration history has NOT been recorded, so "supabase db push" will '
      'report the real problem.', missing;
  end if;
end;
$$;

-- The history table itself, which is normally created by the CLI. Needed here
-- because a bootstrap may be pasted into a database the CLI has never touched.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  statements text[],
  inserted_at timestamptz not null default now()
);

insert into supabase_migrations.schema_migrations (version, name)
values
    ('20261001000001', 'schema'),
    ('20261001000002', 'access_control'),
    ('20261001000003', 'triggers'),
    ('20261001000004', 'realtime'),
    ('20261001000005', 'app_functions'),
    ('20261001000006', 'tutorial_content')
on conflict (version) do nothing;

-- =============================================================================
-- Done. Check it worked:
--
--   select tablename from pg_tables where schemaname = 'public' order by 1;
--   -- document_collaborators, documents, pages, profiles, user_settings
--
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' order by 1, 2;
--
-- From here on, change the schema with a new migration and `supabase db push`.
-- This file is the whole schema, not a delta.
-- =============================================================================
