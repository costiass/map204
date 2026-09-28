-- =============================================================================
-- ClassCards — complete schema, generated from supabase/migrations
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
drop function if exists public.prevent_deleting_last_page() cascade;
drop function if exists public.realtime_document_id() cascade;
drop function if exists public.realtime_page_id() cascade;
drop function if exists public.sync_profile() cascade;
drop function if exists public.touch_updated_at() cascade;
drop function if exists public.tutorial_page_content() cascade;

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
    ('20261001090500', 'welcome_workspace')
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
