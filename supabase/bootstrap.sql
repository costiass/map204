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

drop function if exists public.add_document_owner(p_document_id text, p_user_id uuid) cascade;
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
drop function if exists public.tutorial_page_content() cascade;
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
-- ---- 20261001090000_initial_schema.sql ---------------------------------
-- ---- 20261001090100_access_control.sql ---------------------------------
-- ---- 20261001090200_triggers.sql ---------------------------------------
-- ---- 20261001090300_realtime.sql ---------------------------------------
-- ---- 20261001090400_sharing_functions.sql ------------------------------
-- ---- 20261001090500_welcome_workspace.sql ------------------------------
-- ---- 20261001090600_profile_repair.sql ---------------------------------
-- ---- 20261001090700_app_name.sql ---------------------------------------
-- ---- 20261001090800_workspace_look.sql ---------------------------------
-- ---- 20261001090900_tutorial_depth.sql ---------------------------------
-- ---- 20261001091000_delete_and_cascade.sql -----------------------------
-- ---- 20261001091100_profile_policy.sql ---------------------------------
-- ---- 20261001091200_import_pages.sql -----------------------------------

-- =============================================================================
-- 20261001090000_initial_schema.sql
-- =============================================================================
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

-- =============================================================================
-- 20261001090100_access_control.sql
-- =============================================================================
-- 002 · Access control
--
-- One rule governs this whole file: **a policy never queries another table that
-- also has RLS.** The first version of this schema did exactly that — a
-- `documents` policy read `document_collaborators` whose policy read
-- `documents` — and Postgres answered every single request with
--   42P17  infinite recursion detected in policy for relation "documents"
-- which is not a permissions problem, it is a dead application.
--
-- Cross-table access therefore always goes through a SECURITY DEFINER helper.
-- Those functions run with the table owner's rights, so RLS does not re-enter
-- when they read the tables, and the cycle cannot form.

-- ----------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------
-- STABLE + SECURITY DEFINER: read-only, cacheable, and invisible to RLS.

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
    where dc.document_id = p_document_id and dc.user_id = auth.uid()
  );
$$;

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

grant execute on function public.can_view_document(text) to authenticated;
grant execute on function public.can_edit_document(text) to authenticated;
grant execute on function public.can_view_page(text) to authenticated;
grant execute on function public.can_edit_page(text) to authenticated;

-- ----------------------------------------------------------------
-- Enable RLS
-- ----------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.pages enable row level security;
alter table public.user_settings enable row level security;
alter table public.document_collaborators enable row level security;
alter table public.profiles enable row level security;

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

-- A new page has no id yet, so the insert asks about the document instead.
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
    or exists (
      select 1
      from public.document_collaborators mine
      join public.document_collaborators theirs
        on theirs.document_id = mine.document_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

create policy "update own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- 20261001090200_triggers.sql
-- =============================================================================
-- 003 · Triggers
--
-- The business rules live in the database, so they hold no matter which client
-- writes:
--
--   * a workspace always has at least one page, created for you
--   * the last page of a workspace cannot be deleted
--   * an account always has a settings row and a profile
--   * updated_at is never stale
--
-- The first two are SECURITY DEFINER: they write rows on behalf of the caller,
-- and a caller's own RLS policy must not be able to veto a write the database
-- is required to make.

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
  -- Same shape the client uses, so ids read the same wherever they come from.
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
-- The last page cannot be deleted
-- ----------------------------------------------------------------
create or replace function public.prevent_deleting_last_page()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.pages p
    where p.document_id = old.document_id
      and p.id <> old.id
  ) then
    raise exception
      'A workspace must keep at least one page. Add another page before deleting this one.';
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
-- An account gets a profile
-- ----------------------------------------------------------------
create or replace function public.sync_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        avatar_url = excluded.avatar_url,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_profile on auth.users;
create trigger trg_sync_profile
  after insert or update of email, raw_user_meta_data on auth.users
  for each row
  execute function public.sync_profile();

-- ----------------------------------------------------------------
-- Backfill, in case any account predates the triggers
-- ----------------------------------------------------------------
insert into public.user_settings (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

insert into public.profiles (id, email, full_name, avatar_url)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
  coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
on conflict (id) do nothing;

-- =============================================================================
-- 20261001090300_realtime.sql
-- =============================================================================
-- 004 · Realtime
--
-- The collaboration channels are private, which means Supabase routes every
-- message through `realtime.messages` and the policies below decide who may
-- listen on `page:<pageId>` and who may publish to it. Without them, anybody
-- holding the public anon key could subscribe to somebody else's page.
--
--   page:<pageId>      page content sync  (broadcast + presence)
--   document:<docId>   who is in the workspace (presence)

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
-- Read the page id out of the topic
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
-- Listening: anyone who can already see it through REST
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
-- 20261001090400_sharing_functions.sql
-- =============================================================================
-- 005 · Sharing functions
--
-- Two small functions the share dialog needs, both of which deliberately cannot
-- be done with a plain table read.

-- ----------------------------------------------------------------
-- Find somebody by their email
-- ----------------------------------------------------------------
-- The dialog has to turn "sam@example.com" into a user id, but `profiles` is only
-- readable for yourself and your co-collaborators, so a plain SELECT would
-- return nothing. This is SECURITY DEFINER and matches the address exactly, so
-- it can be used to share *with* a known address without becoming a way to
-- enumerate every account that exists.
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
-- Record the owner as a collaborator
-- ----------------------------------------------------------------
-- `documents.owner_id` is the single source of truth for ownership; this exists
-- so a workspace also has an explicit owner row in the share list, without the
-- client being able to add one for somebody else's document.
create or replace function public.add_document_owner(p_document_id text, p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.document_collaborators (document_id, user_id, role)
  values (p_document_id, p_user_id, 'owner')
  on conflict (document_id, user_id)
  do update set role = 'owner';
$$;

revoke all on function public.add_document_owner(text, uuid) from public;
grant execute on function public.add_document_owner(text, uuid) to service_role;

-- =============================================================================
-- 20261001090500_welcome_workspace.sql
-- =============================================================================
-- 006 · A welcome workspace for every account
--
-- Signing up to an empty canvas is a bad first five minutes, so every account
-- gets a workspace called `tutorial` with a page that explains the app in
-- cards. It is created by the database, not by the client, so it exists no
-- matter which entry point made the account.
--
-- Re-importing this project's own export lands on the same page ids, so the
-- content is written with `on conflict` semantics rather than assuming the ids
-- are free.

-- ----------------------------------------------------------------
-- The tutorial content
-- ----------------------------------------------------------------
-- Written as JSONB and inserted straight into the page, because the alternative
-- is duplicating the client's card defaults here and letting the two drift.
create or replace function public.tutorial_page_content()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'cards', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut_welcome',
        'title', 'Welcome to ClassCards',
        'content',
          'This workspace is yours to change. Rename it, delete it, or add pages beside it.'
          || chr(10) || chr(10)
          || 'Everything you do is saved to your account and shared with whoever you invite.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 0, 'width', 300, 'height', 240, 'zIndex', 1),
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
        'position', jsonb_build_object('x', 340, 'y', 0, 'width', 300, 'height', 300, 'zIndex', 2),
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
        'id', 'tut_connect',
        'title', 'Connect ideas',
        'content',
          'Drag from one of the small dots on a card edge onto another card.'
          || chr(10) || chr(10)
          || 'The arrow picks the best side by itself. Click it to give the link a'
          || chr(10)
          || 'relationship, a colour, and a stroke.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 680, 'y', 0, 'width', 300, 'height', 240, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#ECFDF5', 'accentColor', '#16A34A', 'textColor', '#111827',
          'borderColor', '#BBF7D0', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
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
          || 'follow along.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 280, 'width', 300, 'height', 240, 'zIndex', 4),
        'style', jsonb_build_object(
          'backgroundColor', '#FFF7ED', 'accentColor', '#D97706', 'textColor', '#111827',
          'borderColor', '#FED7AA', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_note',
        'title', 'A note on cards',
        'content',
          'Card bodies are **Markdown**, so links, lists, tables and images all work.'
          || chr(10) || chr(10)
          || 'The arrow from *Connect ideas* is a real link between two cards, drawn'
          || chr(10)
          || 'from their positions rather than stored coordinates — so it follows'
          || chr(10)
          || 'them when you move them.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 340, 'y', 340, 'width', 300, 'height', 240, 'zIndex', 5),
        'style', jsonb_build_object(
          'backgroundColor', '#FDF2F8', 'accentColor', '#E11D48', 'textColor', '#111827',
          'borderColor', '#FBCFE8', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'connections', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut_link_1',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_basics'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_connect'),
        'sourceAnchor', null,
        'targetAnchor', null,
        'label', 'leads to',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_2',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_share'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_welcome'),
        'sourceAnchor', null,
        'targetAnchor', null,
        'label', 'next step',
        'relationshipType', 'related to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      )
    )
  );
$$;

-- ----------------------------------------------------------------
-- Create it for one account
-- ----------------------------------------------------------------
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

  insert into public.documents (owner_id, title)
  values (p_user_id, 'tutorial')
  returning id into new_document_id;

  -- trg_create_default_page has already made the first page by now.
  select id into first_page_id
  from public.pages
  where document_id = new_document_id
  order by ordinal
  limit 1;

  if first_page_id is null then
    insert into public.pages (id, document_id, title, ordinal)
    values ('page_tutorial_' || substr(md5(random()::text), 1, 8), new_document_id, 'Getting started', 0)
    returning id into first_page_id;
  else
    update public.pages
    set title = 'Getting started',
        cards = (tutorial_page_content() -> 'cards'),
        connections = (tutorial_page_content() -> 'connections')
    where id = first_page_id;
  end if;

  return new_document_id;
end;
$$;

-- ----------------------------------------------------------------
-- Fire it on signup
-- ----------------------------------------------------------------
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

-- ----------------------------------------------------------------
-- Backfill for accounts that signed up before this
-- ----------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in
    select id from auth.users a
    where not exists (select 1 from public.documents d where d.owner_id = a.id)
  loop
    perform public.create_tutorial_workspace(u.id);
  end loop;
end;
$$;

-- =============================================================================
-- 20261001090600_profile_repair.sql
-- =============================================================================
-- 007 · Repair profiles, and make the repair repeatable
--
-- A profile row could end up with no name and no picture, and once it did it
-- stayed that way:
--
--   * `trg_sync_profile` only fires on INSERT or on an UPDATE of auth.users, so
--     an account whose metadata arrived after the row was written kept its
--     blanks until something happened to touch auth.users.
--   * The backfill in 003 ended in `on conflict (id) do nothing`, so it could
--     only ever create a profile, never correct one. Every account that already
--     had a blank row was permanently stuck showing as "Unknown user" with no
--     avatar — which is exactly what the share dialog and the presence avatars
--     were reporting.
--
-- This migration makes the profile sync a function that can be called on demand
-- and re-runs it for every account with an update, so a blank row is repaired
-- rather than skipped. To do it by hand later:
--
--   select public.profiles_needing_resync();   -- how many are blank
--   select public.resync_all_profiles();        -- fix them all
--
-- Both are safe to run at any time.

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

-- The trigger now calls the function above, so signup, an email change and a
-- metadata change all take the same path — there is only one definition of what
-- a profile is derived from.
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

-- How many accounts would change if they were re-derived. A diagnostic, so you
-- can look before changing anything. `language sql`, because this body really is
-- a single query.
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

/**
 * Re-derive every profile from auth.users. Returns how many it touched.
 *
 * PL/pgSQL, not `language sql`: the body is a `declare` / `begin` / `end` block
 * with an `into` and a `perform`, none of which the SQL-language parser accepts.
 * Postgres rejects that combination at parse time, before it reads the body, so
 * a mismatched `language` here is a hard failure with a misleading message —
 * "syntax error at or near integer" points at the `declare`, not at the cause.
 */
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

grant execute on function public.sync_profile_for(uuid) to service_role;
grant execute on function public.profiles_needing_resync() to service_role;
grant execute on function public.resync_all_profiles() to service_role;

-- Repair the rows that are already wrong. An update, not a skip.
select public.sync_profile_for(id) from auth.users;

-- =============================================================================
-- 20261001090700_app_name.sql
-- =============================================================================
-- 008 · Name the app in its own welcome content
--
-- 005 shipped the tutorial workspace with the old product name in the card
-- titles. Editing 005 in place would be wrong if it has already been applied —
-- Postgres would never re-run it — so the text is corrected here instead, and
-- 005 is left as the immutable record of what first shipped.
--
-- The rename is deliberately narrow: only pages belonging to a workspace still
-- called `tutorial` that still carry the old copy. A tutorial the user has
-- renamed, deleted or edited is left exactly as they left it.

update public.pages p
set title = 'Welcome to Map204',
    cards = jsonb_set(
      jsonb_set(
        cards,
        '{0,title}',
        '"Welcome to Map204"'::jsonb
      ),
      '{0,content}',
      to_jsonb('This workspace is yours to change. Rename it, delete it, or add pages beside it.' || chr(10) || chr(10) || 'Everything you do is saved to your account and shared with whoever you invite.'::text)
    )
where exists (
        select 1 from public.documents d
        where d.id = p.document_id
          and d.title = 'tutorial'
      )
  and p.cards->0->>'id' = 'tut_welcome'
  and p.cards->0->>'title' = 'Welcome to ClassCards';

-- =============================================================================
-- 20261001090800_workspace_look.sql
-- =============================================================================
-- 009 · Give every workspace a colour and an icon
--
-- A workspace is a subject, and subjects are told apart by colour long before
-- they are told apart by name. The workspace list was a grid of identical grey
-- tiles, so twenty courses looked like twenty of the same thing.
--
-- Both values are chosen by the person who owns the workspace and are stored
-- per workspace, so the tile in the list and the dot beside the title in the
-- canvas chrome always agree.
--
-- The colour is a *token name*, not a hex value, for the same reason every
-- other colour in this app is: the theme owns the palette, so a workspace
-- recolours itself when the reader switches to dark mode instead of carrying a
-- fixed colour that reads wrong on the new background.

alter table public.documents
  add column if not exists accent text not null default 'indigo';

alter table public.documents
  add column if not exists icon text not null default 'layout-grid';

-- Both are constrained to the sets the client can actually draw. A check
-- constraint is the only thing that stops a bad value reaching the browser,
-- where an unknown icon would render as an empty box and an unknown accent
-- would fall back to a colour nobody chose.
--
-- The lists here are the single source of truth for what is offered; the client
-- reads them from `src/utils/workspaceLook.ts`, which is generated to match.
alter table public.documents
  drop constraint if exists documents_accent_check;
alter table public.documents
  add constraint documents_accent_check
  check (accent in (
    'indigo', 'violet', 'blue', 'teal', 'green', 'amber', 'rose', 'slate'
  ));

alter table public.documents
  drop constraint if exists documents_icon_check;
alter table public.documents
  add constraint documents_icon_check
  check (icon in (
    'layout-grid', 'book-open', 'graduation-cap', 'flask-conical', 'globe',
    'calculator', 'microscope', 'languages', 'palette', 'music', 'code',
    'map', 'lightbulb', 'presentation', 'brain', 'library'
  ));

-- Give the workspaces that already exist a colour, so opening the list after
-- this migration does not show a wall of identical indigo tiles. Chosen by
-- position rather than at random, so the same workspace keeps its colour.
with numbered as (
  select
    id,
    row_number() over (order by created_at, id) as n
  from public.documents
)
update public.documents d
set accent = case
      when (numbered.n - 1) % 8 = 0 then 'indigo'
      when (numbered.n - 1) % 8 = 1 then 'teal'
      when (numbered.n - 1) % 8 = 2 then 'amber'
      when (numbered.n - 1) % 8 = 3 then 'rose'
      when (numbered.n - 1) % 8 = 4 then 'green'
      when (numbered.n - 1) % 8 = 5 then 'violet'
      when (numbered.n - 1) % 8 = 6 then 'blue'
      else 'slate'
    end
from numbered
where numbered.id = d.id;

-- =============================================================================
-- 20261001090900_tutorial_depth.sql
-- =============================================================================
-- 010 Â· A tutorial that shows what the app can actually do
--
-- The first version of the welcome workspace was five cards in a row. That
-- demonstrated that cards exist and nothing else: no second page, no groups, no
-- variety in how links behave. Someone reading it could not tell that grouping,
-- page lists or connection styling were features rather than accidents.
--
-- So the tutorial is now two pages, and between them they use every part of the
-- data model the app has:
--
--   * page 1 "Start here"    â€” groups, a card grid, links between cards,
--                               links between a card and a group, and one of
--                               each relationship / stroke / routing / arrowhead
--   * page 2 "Making maps"   â€” a worked example: a real argument built as a
--                               chain of claims, with checklists and a
--                               contradicts link
--
-- Like 007, this replaces content rather than adding to it, and it only touches
-- a tutorial nobody has edited. Editing 005 in place would do nothing on any
-- database where 005 has already been applied.

-- ----------------------------------------------------------------
-- Page 1 Â· Start here
-- ----------------------------------------------------------------
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
          || 'together â€” useful for a section of an argument, or one week of notes.'
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
          || 'The three cards to the right are linked three different ways â€” a'
          || chr(10)
          || 'solid **supports**, a dashed **depends on**, and a dotted **contradicts**.',
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
          || '- **Can edit** â€” they can change anything'
          || chr(10)
          || '- **Can view** â€” they can look but not change'
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
          || 'There is a second page here â€” **Making maps** â€” with a worked example'
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
-- Page 2 Â· Making maps
-- ----------------------------------------------------------------
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
          || 'understood the topic yet â€” and neither has your reader.',
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
      -- Card into a group, the other way round from the one above: a card that
      -- is a *part of* the section it sits in.
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

-- ----------------------------------------------------------------
-- Apply it
-- ----------------------------------------------------------------
-- Page 1: only if it is still the untouched tutorial from 005. The `->0->>'id'`
-- test is the fingerprint of "we wrote this and nobody has touched it since".
do $$
declare
  target_page text;
begin
  for target_page in
    select p.id
    from public.pages p
    join public.documents d on d.id = p.document_id
    where d.title = 'tutorial'
      and p.ordinal = 0
      and p.cards->0->>'id' = 'tut_welcome'
  loop
    update public.pages
    set title = 'Start here',
        cards = tutorial_page_one() -> 'cards',
        groups = tutorial_page_one() -> 'groups',
        connections = tutorial_page_one() -> 'connections',
        viewport = '{"x":-60,"y":-40,"zoom":0.8}'::jsonb
    where id = target_page;
  end loop;
end;
$$;

-- Page 2: only where it does not already exist, so re-running is harmless.
insert into public.pages (id, document_id, title, ordinal, position, viewport, cards, groups, connections)
select
  'page_tutorial_maps',
  d.id,
  'Making maps',
  1,
  '{"x":0,"y":0,"width":1920,"height":1080,"zIndex":0}'::jsonb,
  '{"x":-40,"y":-40,"zoom":0.8}'::jsonb,
  tutorial_page_two() -> 'cards',
  tutorial_page_two() -> 'groups',
  tutorial_page_two() -> 'connections'
from public.documents d
where d.title = 'tutorial'
  and not exists (
    select 1 from public.pages p where p.id = 'page_tutorial_maps'
  );

-- =============================================================================
-- 20261001091000_delete_and_cascade.sql
-- =============================================================================
-- 010 · Make a workspace deletable again
--
-- ----------------------------------------------------------------
-- What was broken
-- ----------------------------------------------------------------
-- `pages.document_id` is `on delete cascade`, so deleting a workspace deletes
-- its pages. But `trg_prevent_last_page_delete` fires on that cascade too, and
-- the workspace's only page vetoes its own removal:
--
--   DELETE /documents?id=eq.…            400 Bad Request
--   P0001  A workspace must keep at least one page. Add another page before
--          deleting this one.
--
-- The rule is right — a workspace you can still open must have a page — but it
-- is the wrong rule for a workspace on its way out. The trigger could not tell
-- the two cases apart, so it applied the stricter one to both and made every
-- workspace undeletable.
--
-- ----------------------------------------------------------------
-- Why not fix it in the client
-- ----------------------------------------------------------------
-- The tempting workaround is to delete the pages first, then the workspace. That
-- would leave the rule in the database, which is where it belongs, but it
-- spreads one invariant across two writers: anything else deleting a workspace
-- would hit the same wall. The database should know the difference.
--
-- ----------------------------------------------------------------
-- How the two cases are told apart
-- ----------------------------------------------------------------
-- `pg_trigger_depth()`. A row deleted by a cascade runs with a deeper trigger
-- stack than one deleted by a direct statement, because the foreign key's own
-- trigger fires first. This is not a guess about depth: a `document_collaborators`
-- row also cascades, so the stack varies with the shape of the delete, which is
-- exactly why the check is "deeper than a plain delete" rather than a fixed
-- number.
--
-- `security definer` is also added here, and it matters. Without it the
-- trigger's own `select … from pages` runs as the calling user and is subject to
-- the `pages` RLS policies. A collaborator who can read the pages but holds only
-- `viewer` on the document could see zero rows from inside the trigger, and the
-- rule would then veto an ordinary page delete — the failure the trigger exists
-- to prevent, caused by the trigger itself. As a definer function it sees the
-- same rows the constraint is about.
--
-- The error code becomes `check_violation` (23514) rather than the default
-- `raise_exception` (P0001), so the client can tell "you asked for something
-- impossible" apart from "the server broke".

create or replace function public.prevent_deleting_last_page()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Removed as part of deleting the workspace that contains it, so that
  -- workspace is going too and will not be left without a page.
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

-- =============================================================================
-- 20261001091100_profile_policy.sql
-- =============================================================================
-- 011 · Give a profile a SECURITY DEFINER helper, so its policy stops reading
--        another RLS table
--
-- ----------------------------------------------------------------
-- The rule that was broken
-- ----------------------------------------------------------------
-- 001 states the rule this whole schema runs on:
--
--   **a policy never queries another table that also has RLS.**
--
-- ...because the first version did, and Postgres answered every request with
--   42P17  infinite recursion detected in policy for relation "documents"
-- which is not a permissions problem, it is a dead application.
--
-- Every other cross-table check in the schema honours that, through a
-- `security definer` helper: `can_view_document`, `can_edit_document`,
-- `can_view_page`, `can_edit_page`.
--
-- The `profiles` read policy did not:
--
--   create policy "can read profile" on public.profiles for select
--   using (
--     id = auth.uid()
--     or exists (
--       select 1 from public.document_collaborators mine
--       join public.document_collaborators theirs
--         on theirs.document_id = mine.document_id
--       where mine.user_id = auth.uid() and theirs.user_id = profiles.id
--     )
--   );
--
-- `document_collaborators` has RLS. So this policy's subquery is itself filtered
-- by `can_view_document`, and whether a profile is visible ends up depending on a
-- second, independent evaluation of the collaborator rules. It happens not to
-- recurse, because the helpers terminate the chain — but it is the shape that
-- caused 42P17 the first time, and it is one policy edit away from it again.
--
-- ----------------------------------------------------------------
-- The fix
-- ----------------------------------------------------------------
-- The question "do these two people share a workspace?" moves into a
-- `security definer` function, like every other cross-table question here. As a
-- definer it reads the tables with the owner's rights, so RLS does not re-enter
-- and the policy is a plain function call.

create or replace function public.shares_document_with(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- One self-join is the whole question: a row for each of the two people on a
  -- workspace they share. The owner counts, because `add_document_owner` gives
  -- them a row too, and a person compared with themselves is a row joining
  -- itself — which is why the caller checks `id = auth.uid()` separately.
  select exists (
    select 1
    from public.document_collaborators mine
    join public.document_collaborators theirs
      on theirs.document_id = mine.document_id
    where mine.user_id = p_a and theirs.user_id = p_b
  );
$$;

grant execute on function public.shares_document_with(uuid, uuid) to authenticated;

drop policy if exists "can read profile" on public.profiles;

create policy "can read profile"
  on public.profiles for select
  using (
    id = auth.uid()
    or public.shares_document_with(auth.uid(), profiles.id)
  );

-- =============================================================================
-- 20261001091200_import_pages.sql
-- =============================================================================
-- 012 · Import pages in one round trip, atomically, additively
--
-- ----------------------------------------------------------------
-- What this replaces
-- ----------------------------------------------------------------
-- The import used to be driven entirely from the browser:
--
--   for each page:  POST /rest/v1/pages
--   then:           DELETE /rest/v1/pages?id=eq.…   (the pages being replaced)
--   then:           GET  /rest/v1/pages             (read it back)
--
-- That is N + N + 1 requests, and it is **not atomic**. If the fourth insert
-- failed, the workspace was left holding three new pages *and* all of the old
-- ones, with no record of which state was intended. The client could only report
-- "something went wrong" and leave the user to work out what they now had.
--
-- The client also had to do the work: parse the file, renumber every id, hold
-- the whole document in memory, and reconcile the result. More code in the
-- client than the task needs.
--
-- ----------------------------------------------------------------
-- What this does instead
-- ----------------------------------------------------------------
-- One call, one transaction, one outcome:
--
--   select public.import_pages('<document id>', '[…]'::jsonb);
--
-- Postgres inserts the pages or it does not. A failure leaves the workspace
-- exactly as it was — the property the old version lacked.
--
-- ----------------------------------------------------------------
-- Additive by design: pages are added, never overwritten
-- ----------------------------------------------------------------
-- There is no "replace this workspace" any more. Every page in the file becomes
-- a new page in the workspace, and nothing already there is touched. That makes
-- import safe to run twice, safe to run over somebody else's work, and
-- impossible to get wrong by picking the wrong option — a destructive import is
-- a class of bug this no longer has.
--
-- ----------------------------------------------------------------
-- Permissions
-- ----------------------------------------------------------------
-- This function is `security definer`, so it bypasses RLS. The check inside it is
-- therefore the *only* thing between a signed-in user and a write to a workspace
-- they do not hold, so it is explicit and raises rather than inserting nothing.
-- Getting it wrong would hand every account a way to write into any workspace,
-- so it is the first statement and uses the same helper the policies use.
--
-- ----------------------------------------------------------------
-- On rewriting the ids
-- ----------------------------------------------------------------
-- Every id is re-issued here, and so is every reference to one:
--
--   cards[].id, cards[].parentId
--   groups[].id, groups[].memberCardIds, groups[].memberGroupIds
--   connections[].id, connections[].source.id, connections[].target.id
--
-- An earlier draft did this by casting each array to text, running `replace()`
-- over the old id, and casting back. That is short and it is wrong: the ids are
-- opaque strings that also appear in places they are not references — most
-- obviously inside a card's Markdown body, which `replace()` would rewrite and
-- silently corrupt. A card id is also not guaranteed to be free of being a
-- substring of another, so one rewrite could truncate another.
--
-- So each array is rebuilt field by field, touching the reference fields and
-- nothing else. Every other key — content, style, position, tags — is copied
-- through untouched, which is what "reproduce the document" requires.

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
  actor uuid := auth.uid();
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
  -- Permission. Not optional: the definer rights that let this insert at all
  -- are exactly what would make an unchecked version an open door.
  ----------------------------------------------------------------
  if actor is null then
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
  -- Imported pages land *after* the existing ones, so an import never
  -- interleaves with pages somebody is working on.
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
      select jsonb_object_agg(coalesce(c.value ->> 'id', ''), 'card_' || substr(md5(random()::text), 1, 10))
      from jsonb_array_elements(coalesce(page -> 'cards', '[]'::jsonb)) c(value)
    ), '{}'::jsonb);

    group_map := coalesce((
      select jsonb_object_agg(coalesce(g.value ->> 'id', ''), 'group_' || substr(md5(random()::text), 1, 10))
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb)) g(value)
    ), '{}'::jsonb);

    conn_map := coalesce((
      select jsonb_object_agg(coalesce(x.value ->> 'id', ''), 'connection_' || substr(md5(random()::text), 1, 10))
      from jsonb_array_elements(coalesce(page -> 'connections', '[]'::jsonb)) x(value)
    ), '{}'::jsonb);

    ----------------------------------------------------------------
    -- Cards: new id, and a new parentId that is looked up in the same map.
    -- Order is preserved so the canvas draws them in the same sequence.
    ----------------------------------------------------------------
    new_cards := coalesce((
      select jsonb_agg(
        c.value || jsonb_build_object(
          'id', coalesce(card_map ->> (c.value ->> 'id'), c.value ->> 'id'),
          'parentId', case
            when c.value -> 'parentId' is null or jsonb_typeof(c.value -> 'parentId') = 'null'
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
    -- in the page is dropped rather than left pointing at a card that is not
    -- here — the client would drop it on read anyway, and an explicit filter
    -- keeps the stored row honest.
    ----------------------------------------------------------------
    new_groups := coalesce((
      select jsonb_agg(
        g.value || jsonb_build_object(
          'id', coalesce(group_map ->> (g.value ->> 'id'), g.value ->> 'id'),
          'memberCardIds', coalesce((
            select jsonb_agg(coalesce(card_map ->> m, m) order by m.ord)
            from jsonb_array_elements_text(
              coalesce(g.value -> 'memberCardIds', '[]'::jsonb)
            ) with ordinality as m(id, ord)
            where card_map ? m.id
          ), '[]'::jsonb),
          'memberGroupIds', coalesce((
            select jsonb_agg(coalesce(group_map ->> m, m) order by m.ord)
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
    -- whichever kind it names. A connection to something that is not on the
    -- page is dropped, because an arrow to nothing is not a link.
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
      where (
        case when x.value -> 'source' ->> 'kind' = 'group'
          then group_map ? (x.value -> 'source' ->> 'id')
          else card_map ? (x.value -> 'source' ->> 'id')
        end
      ) and (
        case when x.value -> 'target' ->> 'kind' = 'group'
          then group_map ? (x.value -> 'target' ->> 'id')
          else card_map ? (x.value -> 'target' ->> 'id')
        end
      )
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

-- -----------------------------------------------------------------------------
-- 3. Record these as applied
-- -----------------------------------------------------------------------------
-- `supabase db push` compares its history table against supabase/migrations.
-- Left empty it would try to re-apply everything above, and fail on the first
-- `create policy`. These rows say: done.
do $$
begin
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[],
    inserted_at timestamptz not null default now()
  );
end;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values
    ('20261001090000', 'initial_schema'),
    ('20261001090100', 'access_control'),
    ('20261001090200', 'triggers'),
    ('20261001090300', 'realtime'),
    ('20261001090400', 'sharing_functions'),
    ('20261001090500', 'welcome_workspace'),
    ('20261001090600', 'profile_repair'),
    ('20261001090700', 'app_name'),
    ('20261001090800', 'workspace_look'),
    ('20261001090900', 'tutorial_depth'),
    ('20261001091000', 'delete_and_cascade'),
    ('20261001091100', 'profile_policy'),
    ('20261001091200', 'import_pages')
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
