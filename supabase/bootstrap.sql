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
drop table if exists public.document_invites cascade;
drop table if exists public.documents cascade;
drop table if exists public.pages cascade;
drop table if exists public.profiles cascade;
drop table if exists public.user_settings cascade;

drop function if exists public.can_edit_document(p_document_id text) cascade;
drop function if exists public.can_edit_page(p_page_id text) cascade;
drop function if exists public.can_view_document(p_document_id text) cascade;
drop function if exists public.can_view_page(p_page_id text) cascade;
drop function if exists public.claim_pending_invites(p_user_id uuid) cascade;
drop function if exists public.claim_pending_invites_on_signup() cascade;
drop function if exists public.create_default_page() cascade;
drop function if exists public.create_settings_for_new_user() cascade;
drop function if exists public.create_tutorial_workspace(p_user_id uuid) cascade;
drop function if exists public.create_tutorial_workspace_for_new_user() cascade;
drop function if exists public.find_profile_by_email(p_email text) cascade;
drop function if exists public.import_pages(p_document_id text, p_pages jsonb) cascade;
drop function if exists public.import_pages(p_document_id uuid, p_pages jsonb) cascade;
drop function if exists public.is_plausible_email(p_email text) cascade;
drop function if exists public.prevent_deleting_last_page() cascade;
drop function if exists public.profiles_needing_resync() cascade;
drop function if exists public.realtime_document_id() cascade;
drop function if exists public.realtime_page_id() cascade;
drop function if exists public.resync_all_profiles() cascade;
drop function if exists public.set_invited_by() cascade;
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
-- ---- 20261001000007_import_pages_elements.sql --------------------------
-- ---- 20261001000008_import_pages_single_signature.sql ------------------
-- ---- 20261001000009_second_account_can_sign_up.sql ---------------------
-- ---- 20261001000010_pending_invites.sql --------------------------------
-- ---- 20261001000011_invited_by_from_session.sql ------------------------
-- ---- 20261001000012_profile_readable_by_owner.sql ----------------------

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

-- =============================================================================
-- 20261001000007_import_pages_elements.sql
-- =============================================================================
-- Teach `import_pages` to read a version 2 document.
--
-- The import path was broken and broke silently, which is the worst way: the
-- function read its page contents from `page -> 'cards'`, and the client had
-- been sending `page -> 'elements'` since the element migration. `coalesce` with
-- a missing key yields an empty array, so every page imported **successfully and
-- empty**. No error, no warning, just a workspace full of blank pages and a
-- file that appeared to work.
--
-- This is a forward migration rather than an edit, because the rule is that an
-- applied migration is never rewritten — a database that has run the old file
-- must reach the same state as a fresh one, and editing history breaks that.
-- The database is being reset for version 2 anyway; this exists so the reset is
-- not the *first* time this is fixed.
--
-- What changes, and what deliberately does not:
--
--   * Elements are read from `elements`, falling back to `cards`. Both work, so
--     an old file and a new one take the same path.
--   * The id remapping, the ordering, the drop-dangling-connections rule and the
--     single-transaction guarantee are untouched. Those were right.
--   * `parentId` is gone, and so is the branch that remapped it. It was the only
--     reference field on an element that was not a group membership, and groups
--     carry that.
--   * The stored column is still `cards`. The client reads it under that name and
--     the value is a list of elements; the column is renamed in the same reset
--     that renames the model.
--
-- An element's `id` is remapped exactly as a card's was, and only the reference
-- fields are touched. An earlier draft rewrote ids by casting the array to text
-- and running `replace()` over it, which corrupts any id that also appears in
-- prose — a card's Markdown body being the obvious one.

create or replace function public.import_pages(
  p_document_id uuid,
  p_pages       jsonb
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
  -- The page's elements, under whichever name the file used.
  src_elements jsonb;
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

  select coalesce(max(ordinal) + 1, 0)
  into next_ordinal
  from public.pages p
  where p.document_id = p_document_id;

  for page in select value from jsonb_array_elements(p_pages)
  loop
    -- A page id is a primary key across every workspace, so it is always minted
    -- here rather than trusted from the file.
    page_id := 'page_' || floor(extract(epoch from now()) * 1000)::text
               || '_' || substr(md5(random()::text), 1, 6);

    -- The contents, under either name. A version 1 file says `cards`; a version
    -- 2 file says `elements`. Reading one and not the other is what made every
    -- import blank.
    src_elements := coalesce(
      case when jsonb_typeof(page -> 'elements') = 'array' then page -> 'elements' end,
      case when jsonb_typeof(page -> 'cards') = 'array' then page -> 'cards' end,
      '[]'::jsonb
    );

    card_map := coalesce((
      select jsonb_object_agg(
        coalesce(c.value ->> 'id', ''),
        'card_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(src_elements) c(value)
      where c.value ->> 'id' is not null
    ), '{}'::jsonb);

    group_map := coalesce((
      select jsonb_object_agg(
        coalesce(g.value ->> 'id', ''),
        'group_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb)) g(value)
      where g.value ->> 'id' is not null
    ), '{}'::jsonb);

    conn_map := coalesce((
      select jsonb_object_agg(
        coalesce(x.value ->> 'id', ''),
        'connection_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'connections', '[]'::jsonb)) x(value)
      where x.value ->> 'id' is not null
    ), '{}'::jsonb);

    ----------------------------------------------------------------
    -- Elements: a new id, nothing else.
    --
    -- The only reference an element carries is the group it is a member of, and
    -- that is rewritten below with the group. `parentId` was the other one and it
    -- is gone from the model, so there is nothing to remap here — which is the
    -- whole reason this block got shorter.
    --
    -- Order is preserved so the canvas draws them in the same sequence.
    ----------------------------------------------------------------
    new_cards := coalesce((
      select jsonb_agg(
        c.value || jsonb_build_object(
          'id', coalesce(card_map ->> (c.value ->> 'id'), c.value ->> 'id')
        )
        order by c.ord
      )
      from jsonb_array_elements(src_elements)
           with ordinality as c(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Groups: a new id, and the membership list re-pointed. A member that is not
    -- on the page is dropped rather than left pointing at an element that is not
    -- here — the client would drop it on read anyway, and filtering keeps the
    -- stored row honest.
    --
    -- `memberGroupIds` is read and dropped. A group can no longer contain a group,
    -- and keeping a field the model does not have would make the stored row
    -- disagree with the document it claims to be.
    --
    -- `m` is the table alias, so `m` alone is a row and `m.id` is the value.
    -- Writing `->> m` is a `jsonb ->> record`, which Postgres rejects.
    ----------------------------------------------------------------
    new_groups := coalesce((
      select jsonb_agg(
        g.value
        || jsonb_build_object(
          'id', coalesce(group_map ->> (g.value ->> 'id'), g.value ->> 'id'),
          'memberIds', coalesce((
            select jsonb_agg(coalesce(card_map ->> m.id, m.id) order by m.ord)
            from jsonb_array_elements_text(
              coalesce(
                -- Version 2 names it `memberIds`; version 1 named it
                -- `memberCardIds`. Both are read, because an old file is exactly
                -- what people have.
                case when jsonb_typeof(g.value -> 'memberIds') = 'array'
                  then g.value -> 'memberIds' end,
                case when jsonb_typeof(g.value -> 'memberCardIds') = 'array'
                  then g.value -> 'memberCardIds' end,
                '[]'::jsonb
              )
            ) with ordinality as m(id, ord)
            where card_map ? m.id
          ), '[]'::jsonb)
        )
        - 'memberCardIds'
        - 'memberGroupIds'
        - 'parentId'
        order by g.ord
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb))
           with ordinality as g(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Connections: a new id, and each endpoint re-pointed through the map for
    -- whichever kind it names. A connection to something absent is dropped,
    -- because an arrow to nothing is not a link.
    --
    -- The endpoint discriminator is `element` in version 2 and `card` in
    -- version 1. Anything that is not `group` is an element, so both spellings
    -- resolve the same way without needing the list written out twice.
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

    inserted := inserted || jsonb_build_array(
      jsonb_build_object(
        'id', page_id,
        'title', coalesce(nullif(page ->> 'title', ''), 'Imported page'),
        'ordinal', next_ordinal
      )
    );
    next_ordinal := next_ordinal + 1;
  end loop;

  return inserted;
end;
$$;

-- The signature did not change, but a `create or replace` on a function whose
-- return type moved needs the grant re-stated or the function comes back with
-- the default privileges, which for a `security definer` function is nobody.
grant execute on function public.import_pages(uuid, jsonb) to authenticated;

-- =============================================================================
-- 20261001000008_import_pages_single_signature.sql
-- =============================================================================
-- Un-break `import_pages`, which a previous migration overloaded.
--
-- Migration 7 taught this function to read a version 2 document, and did it by
-- changing the type of its first parameter from `text` to `uuid`. That was
-- wrong in a way nothing caught at the time. A function's identity is its whole
-- signature, so `create or replace` did not replace anything - it created a
-- *second* `import_pages`, and the original `(text, jsonb)` from migration 5
-- stayed exactly where it was.
--
-- PostgREST looks up an RPC by name and refuses to guess when a name is
-- overloaded. So importing a document stopped working outright:
--
--   PGRST203 Could not choose the best candidate function between:
--     public.import_pages(p_document_id => text,  p_pages => jsonb),
--     public.import_pages(p_document_id => uuid,  p_pages => jsonb)
--
-- Note what is not in that message: neither version was broken. The version 2
-- reader was correct and the original was correct; having both was the fault.
--
-- So this drops the `uuid` overload and restates the version 2 reader under the
-- `text` signature it was always meant to have. `text` is the type of
-- `pages.document_id` and the type `can_edit_document` takes, so it was never
-- a question of which was right.
--
-- The body below is migration 7's, unchanged, because that body was correct.
-- The one lesson worth writing down: a migration that alters a function's
-- parameter *type* is not a migration that alters that function. It is a
-- migration that adds one.

drop function if exists public.import_pages(uuid, jsonb);

-- Teach `import_pages` to read a version 2 document.
--
-- The import path was broken and broke silently, which is the worst way: the
-- function read its page contents from `page -> 'cards'`, and the client had
-- been sending `page -> 'elements'` since the element migration. `coalesce` with
-- a missing key yields an empty array, so every page imported **successfully and
-- empty**. No error, no warning, just a workspace full of blank pages and a
-- file that appeared to work.
--
-- This is a forward migration rather than an edit, because the rule is that an
-- applied migration is never rewritten — a database that has run the old file
-- must reach the same state as a fresh one, and editing history breaks that.
-- The database is being reset for version 2 anyway; this exists so the reset is
-- not the *first* time this is fixed.
--
-- What changes, and what deliberately does not:
--
--   * Elements are read from `elements`, falling back to `cards`. Both work, so
--     an old file and a new one take the same path.
--   * The id remapping, the ordering, the drop-dangling-connections rule and the
--     single-transaction guarantee are untouched. Those were right.
--   * `parentId` is gone, and so is the branch that remapped it. It was the only
--     reference field on an element that was not a group membership, and groups
--     carry that.
--   * The stored column is still `cards`. The client reads it under that name and
--     the value is a list of elements; the column is renamed in the same reset
--     that renames the model.
--
-- An element's `id` is remapped exactly as a card's was, and only the reference
-- fields are touched. An earlier draft rewrote ids by casting the array to text
-- and running `replace()` over it, which corrupts any id that also appears in
-- prose — a card's Markdown body being the obvious one.

create or replace function public.import_pages(
  p_document_id text,
  p_pages       jsonb
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
  -- The page's elements, under whichever name the file used.
  src_elements jsonb;
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

  select coalesce(max(ordinal) + 1, 0)
  into next_ordinal
  from public.pages p
  where p.document_id = p_document_id;

  for page in select value from jsonb_array_elements(p_pages)
  loop
    -- A page id is a primary key across every workspace, so it is always minted
    -- here rather than trusted from the file.
    page_id := 'page_' || floor(extract(epoch from now()) * 1000)::text
               || '_' || substr(md5(random()::text), 1, 6);

    -- The contents, under either name. A version 1 file says `cards`; a version
    -- 2 file says `elements`. Reading one and not the other is what made every
    -- import blank.
    src_elements := coalesce(
      case when jsonb_typeof(page -> 'elements') = 'array' then page -> 'elements' end,
      case when jsonb_typeof(page -> 'cards') = 'array' then page -> 'cards' end,
      '[]'::jsonb
    );

    card_map := coalesce((
      select jsonb_object_agg(
        coalesce(c.value ->> 'id', ''),
        'card_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(src_elements) c(value)
      where c.value ->> 'id' is not null
    ), '{}'::jsonb);

    group_map := coalesce((
      select jsonb_object_agg(
        coalesce(g.value ->> 'id', ''),
        'group_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb)) g(value)
      where g.value ->> 'id' is not null
    ), '{}'::jsonb);

    conn_map := coalesce((
      select jsonb_object_agg(
        coalesce(x.value ->> 'id', ''),
        'connection_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'connections', '[]'::jsonb)) x(value)
      where x.value ->> 'id' is not null
    ), '{}'::jsonb);

    ----------------------------------------------------------------
    -- Elements: a new id, nothing else.
    --
    -- The only reference an element carries is the group it is a member of, and
    -- that is rewritten below with the group. `parentId` was the other one and it
    -- is gone from the model, so there is nothing to remap here — which is the
    -- whole reason this block got shorter.
    --
    -- Order is preserved so the canvas draws them in the same sequence.
    ----------------------------------------------------------------
    new_cards := coalesce((
      select jsonb_agg(
        c.value || jsonb_build_object(
          'id', coalesce(card_map ->> (c.value ->> 'id'), c.value ->> 'id')
        )
        order by c.ord
      )
      from jsonb_array_elements(src_elements)
           with ordinality as c(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Groups: a new id, and the membership list re-pointed. A member that is not
    -- on the page is dropped rather than left pointing at an element that is not
    -- here — the client would drop it on read anyway, and filtering keeps the
    -- stored row honest.
    --
    -- `memberGroupIds` is read and dropped. A group can no longer contain a group,
    -- and keeping a field the model does not have would make the stored row
    -- disagree with the document it claims to be.
    --
    -- `m` is the table alias, so `m` alone is a row and `m.id` is the value.
    -- Writing `->> m` is a `jsonb ->> record`, which Postgres rejects.
    ----------------------------------------------------------------
    new_groups := coalesce((
      select jsonb_agg(
        g.value
        || jsonb_build_object(
          'id', coalesce(group_map ->> (g.value ->> 'id'), g.value ->> 'id'),
          'memberIds', coalesce((
            select jsonb_agg(coalesce(card_map ->> m.id, m.id) order by m.ord)
            from jsonb_array_elements_text(
              coalesce(
                -- Version 2 names it `memberIds`; version 1 named it
                -- `memberCardIds`. Both are read, because an old file is exactly
                -- what people have.
                case when jsonb_typeof(g.value -> 'memberIds') = 'array'
                  then g.value -> 'memberIds' end,
                case when jsonb_typeof(g.value -> 'memberCardIds') = 'array'
                  then g.value -> 'memberCardIds' end,
                '[]'::jsonb
              )
            ) with ordinality as m(id, ord)
            where card_map ? m.id
          ), '[]'::jsonb)
        )
        - 'memberCardIds'
        - 'memberGroupIds'
        - 'parentId'
        order by g.ord
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb))
           with ordinality as g(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Connections: a new id, and each endpoint re-pointed through the map for
    -- whichever kind it names. A connection to something absent is dropped,
    -- because an arrow to nothing is not a link.
    --
    -- The endpoint discriminator is `element` in version 2 and `card` in
    -- version 1. Anything that is not `group` is an element, so both spellings
    -- resolve the same way without needing the list written out twice.
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

    inserted := inserted || jsonb_build_array(
      jsonb_build_object(
        'id', page_id,
        'title', coalesce(nullif(page ->> 'title', ''), 'Imported page'),
        'ordinal', next_ordinal
      )
    );
    next_ordinal := next_ordinal + 1;
  end loop;

  return inserted;
end;
$$;

-- The signature did not change, but a `create or replace` on a function whose
-- return type moved needs the grant re-stated or the function comes back with
-- the default privileges, which for a `security definer` function is nobody.
grant execute on function public.import_pages(text, jsonb) to authenticated;

-- =============================================================================
-- 20261001000009_second_account_can_sign_up.sql
-- =============================================================================
-- Let the second account exist.
--
-- **This is the bug behind "Database error saving new user".** It is not an OAuth
-- problem and it is not Supabase's.
--
-- `create_tutorial_workspace` inserted the second welcome page with a hard-coded
-- primary key:
--
--   insert into public.pages (id, ...) values ('page_tutorial_maps', ...)
--
-- and `pages.id` is `text primary key` -- one namespace for every workspace on the
-- project, not per document. So the id was a singleton: the very first account to
-- sign up took it, and **every account after that hit a duplicate key**.
--
-- Why that reads as an authentication failure, three layers up:
--
--   1. GoTrue inserts the new person into `auth.users`.
--   2. `trg_create_tutorial_workspace` fires, in the same transaction, and raises
--      23505 on `pages_pkey`.
--   3. A trigger's exception rolls back the transaction that caused it. The
--      `auth.users` row is gone. GoTrue reports a database error instead of an
--      account, and the callback returns to the sign-in page.
--
-- Google behaved correctly throughout. Sign-in for an *existing* account never
-- inserts into `auth.users`, which is why people who already have an account are
-- unaffected and the fault looks intermittent.
--
-- Reproduced against a real Postgres: the first signup succeeds, the second fails
-- with `duplicate key value violates unique constraint "pages_pkey"`. That is what
-- `scripts/test-signup.cjs` asserts, and it failed on this.
--
-- Three changes, in order of how much they matter.

-- ----------------------------------------------------------------
-- 1. Mint the page id instead of hard-coding it
-- ----------------------------------------------------------------
--
-- The same shape `create_default_page` and `import_pages` already use, so ids read
-- the same wherever they come from. A random suffix rather than the timestamp alone
-- because two accounts signing up in the same millisecond is not the case to
-- optimise for, and a collision here is exactly the failure being fixed.

create or replace function public.create_tutorial_workspace(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_document_id text;
  first_page_id text;
  second_page_id text;
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

  -- Minted. It was 'page_tutorial_maps', and it was the only one of its name in
  -- the project, so the second account to arrive could not have one either.
  second_page_id := 'page_' || floor(extract(epoch from now()) * 1000)::text
                    || '_' || substr(md5(random()::text), 1, 6);

  insert into public.pages (
    id, document_id, title, ordinal, position, viewport, cards, groups, connections
  )
  values (
    second_page_id,
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

-- ----------------------------------------------------------------
-- 2. Make the welcome workspace non-fatal
-- ----------------------------------------------------------------
--
-- The change that stops this class of bug from ever again making the product
-- unusable, whatever the cause turns out to be.
--
-- A welcome map is a courtesy. Not having one costs a new person a tutorial they
-- can read later. Being unable to create an account at all costs them the product,
-- and there is no way for them to tell that a *tutorial* is why. So a failure here
-- is logged and the signup continues.
--
-- `raise warning`, not silence: it goes to the Postgres log, which is where
-- somebody debugging this will look, and it does not abort the transaction. A bare
-- `exception when others then null;` would have hidden the very thing that made
-- this hard to find.
--
-- The profile and the settings row are deliberately *not* wrapped. They are not
-- courtesies: RLS policies and the settings page depend on them existing, so a
-- failure there is a real failure and should stop the signup rather than leave an
-- account that cannot read or write anything.
create or replace function public.create_tutorial_workspace_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.create_tutorial_workspace(new.id);
  exception when others then
    raise warning
      'the welcome workspace for % could not be created (%); the account was created anyway',
      new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- ----------------------------------------------------------------
-- 3. Drop a leftover trigger the migrations did not create
-- ----------------------------------------------------------------
--
-- Not the cause of this report, but a second, independent way for the same symptom,
-- and it is on the same table. A Supabase project made from the dashboard's
-- profile template ships `on_auth_user_created` running `public.handle_new_user()`,
-- which inserts `raw_user_meta_data` into `public.profiles`. Map204's `profiles`
-- table has no such column, so that trigger cannot ever have worked, and it fails
-- every signup the same way this one did.
--
-- Dropped by "not one of ours" rather than by name, because a name is a guess and
-- "a trigger on auth.users that this schema did not put there" is the actual
-- condition. The notice reports what went, so nobody has to guess either.
--
-- Verified against a real Postgres: with that trigger present, signup fails with
-- `column "raw_user_meta_data" of relation "profiles" does not exist`.
do $$
declare
  ours constant text[] := array[
    'trg_create_settings',
    'trg_create_tutorial_workspace',
    'trg_sync_profile'
  ];
  stray record;
begin
  for stray in
    select t.tgname, p.proname as function_name
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and t.tgname <> all (ours)
  loop
    raise notice
      'dropping leftover trigger %() on auth.users (function public.%)',
      stray.tgname, stray.function_name;
    execute format('drop trigger %I on auth.users', stray.tgname);
  end loop;
end;
$$;

-- And the function behind it, only if nothing else now calls it.
do $$
declare
  still_used integer;
begin
  if exists (select 1 from pg_proc where proname = 'handle_new_user') then
    select count(*) into still_used
    from pg_trigger t
    where t.tgfoid = 'public.handle_new_user()'::regprocedure
      and not t.tgisinternal;

    if still_used = 0 then
      raise notice 'dropping the unused public.handle_new_user()';
      execute 'drop function public.handle_new_user()';
    end if;
  end if;
end;
$$;

-- ----------------------------------------------------------------
-- Accounts that already have no workspace
-- ----------------------------------------------------------------
--
-- A failed signup rolls back completely, so the people this migration unblocks
-- left nothing behind. This is for the other case: an account created before the
-- welcome trigger existed, which is a real account with an empty map list and no
-- way to tell that is why.
--
-- `create_tutorial_workspace` returns the existing workspace when there is one, so
-- running it over every account is safe. Migration 5 does the same thing; this
-- repeats it so applying 9 alone is enough.
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
-- What this cannot check
-- ----------------------------------------------------------------
--
-- The effect on a live database is not assertable from a migration. Run
-- `supabase/diagnose-signup.sql` afterwards: it is all selects, and it prints the
-- triggers now on `auth.users`, which should be exactly the three above.

-- =============================================================================
-- 20261001000010_pending_invites.sql
-- =============================================================================
-- Share a workspace with somebody who has not signed up yet.
--
-- **The gap this closes.** `ShareDialog` looked the address up with
-- `find_profile_by_email` and refused it when there was no row:
--
--   No Map204 account uses that email address.
--
-- So the only people a workspace could be shared with were people who already had
-- an account. That is backwards. Sharing is how somebody finds out Map204 exists,
-- and the person you most want to show a map to is, almost by definition, somebody
-- who has not made an account yet. The share flow was a closed loop that could only
-- reach people already inside it.
--
-- What it does now:
--
--   * An address with no account becomes a *pending invite* -- a row here, keyed on
--     the email rather than on a user id, because there is no user id yet.
--   * The invitation email goes out with a link to sign up.
--   * `claim_pending_invites` turns each matching invite into a real
--     `document_collaborators` row the moment somebody registers with that address,
--     so the workspace is already there when they arrive.
--
-- Keyed on the *email*, not on a token, and that is deliberate. An invite token in
-- the URL would be claimable by whoever forwarded the link, and would need storing,
-- hashing, expiry and a single-use flag. This way the only way to claim one is to
-- prove you own the address, which is exactly what signing in with Google does --
-- Google verifies the address, and Supabase will not hand out a session for an
-- address the person cannot prove.
--
-- A forward migration, because the rule is that an applied migration is never
-- rewritten. The database is being reset for version 2 anyway; this exists so the
-- reset is not the first time this is right.

-- ----------------------------------------------------------------
-- Is this an address at all?
-- ----------------------------------------------------------------
--
-- Deliberately loose: a full RFC 5322 grammar rejects addresses that work. This
-- only catches the two mistakes a typed address actually makes -- no `@`, or an `@`
-- with nothing on one side -- plus whitespace and a trailing full stop.
--
-- Declared here, before the table, because the table's CHECK constraint calls it.
-- The first version of this migration defined it at the bottom, after the table, and
-- as a consequence the column had *no* address check at all: `is_plausible_email`
-- existed, was correct, was referenced by nothing, and `not-an-email` was accepted
-- as an invitation and stored. A helper nobody calls is a comment with a return
-- type.
create or replace function public.is_plausible_email(p_email text)
returns boolean
language sql
immutable
as $$
  select p_email is not null
     and length(p_email) between 3 and 320
     and position('@' in p_email) > 1
     and position('@' in p_email) < length(p_email)
     and p_email !~ '[[:space:]]'
     and p_email !~ '[.,;:]@'
$$;

-- ----------------------------------------------------------------
-- document_invites: a share waiting for its recipient to exist
-- ----------------------------------------------------------------
create table if not exists public.document_invites (
  document_id text not null references public.documents (id) on delete cascade,
  -- Lower-cased on insert and by the check below, because `Bob@example.com` and
  -- `bob@example.com` are one person and two pending invites otherwise -- and the
  -- claim on signup would match only whichever spelling the person registered with.
  --
  -- This check is what makes the claim case-insensitive. `claim_pending_invites`
  -- compares this column against `lower(auth.users.email)`, which only works if
  -- both sides are already lower case. Enforcing it here is cheaper and far more
  -- robust than lower-casing on every comparison, and it fails at the point where
  -- somebody typed the address, which is where the mistake was.
  email text not null check (email = lower(email) and public.is_plausible_email(email)),
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  -- One pending invite per person per workspace. Without this, inviting somebody
  -- twice makes two rows, the claim inserts one collaborator row, and the second
  -- invite sits there forever describing a grant that already happened.
  primary key (document_id, email)
);

-- The claim looks up by email alone, across every workspace this person was invited
-- to, so that lookup is the access path and it needs its own index. The primary key
-- leads with `document_id`, which cannot serve it.
create index if not exists document_invites_email_idx
  on public.document_invites (email);

create index if not exists document_invites_document_idx
  on public.document_invites (document_id);

alter table public.document_invites enable row level security;

-- ----------------------------------------------------------------
-- Who can read and write a pending invite
-- ----------------------------------------------------------------
--
-- `can_edit_document` rather than a role check of its own: an invite *is* a grant
-- that has not landed yet, so exactly the people who could make that grant are the
-- people who may make this one. A viewer can do neither, which is why a viewer sees
-- nothing here.
--
-- RLS on a table the browser reads directly, so the policy is not optional: without
-- it the anon key could enumerate every pending invitation in the project, which is
-- a list of email addresses.
create policy document_invites_read on public.document_invites
  for select to authenticated
  using (public.can_edit_document(document_id));

create policy document_invites_write on public.document_invites
  for insert to authenticated
  with check (public.can_edit_document(document_id));

create policy document_invites_update on public.document_invites
  for update to authenticated
  using (public.can_edit_document(document_id))
  with check (public.can_edit_document(document_id));

create policy document_invites_delete on public.document_invites
  for delete to authenticated
  using (public.can_edit_document(document_id));

grant select, insert, update, delete on public.document_invites to authenticated;

-- ----------------------------------------------------------------
-- Claiming, on sign-up
-- ----------------------------------------------------------------
--
-- Turn every invite addressed to `p_email` into a real collaborator row, and drop
-- the invite so it cannot be claimed twice or read as outstanding.
--
-- `on conflict do nothing` because two paths can reach this at once: a person who
-- was already an editor *and* had a stale invite would otherwise fail the whole
-- claim on the conflict and leave their other invites unclaimed.
create or replace function public.claim_pending_invites(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  source_email text;
  claimed integer := 0;
  inv record;
begin
  select lower(a.email) into source_email
  from auth.users a
  where a.id = p_user_id;

  if source_email is null then
    return 0;
  end if;

  ----------------------------------------------------------------
  -- Make sure the profile exists first
  ----------------------------------------------------------------
  --
  -- `document_collaborators.user_id` references `public.profiles(id)`, and the
  -- profile is created by a *different* trigger on `auth.users` -- `trg_sync_profile`.
  --
  -- Postgres runs same-table triggers in name order, and this one is called
  -- `trg_claim_pending_invites`, which sorts before `trg_sync_profile`. So at the
  -- moment this runs the profile does not exist yet, the insert violates the foreign
  -- key, and -- because the caller catches exceptions and turns them into a warning
  -- -- the whole claim fails *silently*: the person signs up, sees no shared
  -- workspace, and nothing anywhere says why.
  --
  -- The obvious fix is to rename this trigger to sort later. That is the wrong fix:
  -- it makes correctness depend on a naming convention that nothing checks, and the
  -- day somebody adds a trigger that wants to run first it breaks again, silently.
  --
  -- So the function is made self-sufficient instead. `sync_profile_for` is an
  -- upsert, so calling it here is a no-op when the profile is already there, and
  -- the claim no longer cares what order the triggers fire in.
  perform public.sync_profile_for(p_user_id);

  -- One by one rather than set-based, because the role has to come from the invite
  -- and a `insert ... select` would have to trust it against the check constraint
  -- rather than read it back.
  for inv in
    select i.document_id, i.role
    from public.document_invites i
    where i.email = source_email
    for update
  loop
    insert into public.document_collaborators (document_id, user_id, role)
    values (inv.document_id, p_user_id, inv.role)
    on conflict (document_id, user_id) do nothing;

    if found then
      claimed := claimed + 1;
    end if;

    delete from public.document_invites i
    where i.document_id = inv.document_id and i.email = source_email;
  end loop;

  return claimed;
end;
$$;

create or replace function public.claim_pending_invites_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A failure here must not stop the account being created. A person whose invite
  -- cannot be claimed should still end up with an account and be able to fix it;
  -- refusing the sign-up over an invitation would be a far worse outcome than a
  -- share that arrives late.
  begin
    perform public.claim_pending_invites(new.id);
  exception when others then
    raise warning 'pending invites for % could not be claimed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_claim_pending_invites on auth.users;
create trigger trg_claim_pending_invites
  after insert on auth.users
  for each row
  execute function public.claim_pending_invites_on_signup();

-- ----------------------------------------------------------------
-- Invites already waiting, for accounts that exist
-- ----------------------------------------------------------------
--
-- Only for people who are already registered: an invite whose address now belongs
-- to an account should be a live collaborator row, not an outstanding email. This
-- is the case where somebody was invited, then signed up before the trigger above
-- was deployed.
do $$
declare
  inv record;
  claimant uuid;
begin
  for inv in
    select i.document_id, i.email, i.role
    from public.document_invites i
    join auth.users a on lower(a.email) = i.email
  loop
    select a.id into claimant
    from auth.users a
    where lower(a.email) = inv.email
    order by a.created_at
    limit 1;

    insert into public.document_collaborators (document_id, user_id, role)
    values (inv.document_id, claimant, inv.role)
    on conflict (document_id, user_id) do nothing;

    delete from public.document_invites
    where document_id = inv.document_id and email = inv.email;
  end loop;
end;
$$;

-- =============================================================================
-- 20261001000011_invited_by_from_session.sql
-- =============================================================================
-- Fill `invited_by` from the session instead of demanding it from the client.
--
-- **Why sharing with somebody who has no account failed.**
--
--   null value in column "invited_by" of relation "document_invites"
--   violates not-null constraint
--
-- The column was declared `not null references auth.users(id)` with no default, and
-- the client inserts the three fields it knows -- document, email, role -- and knows
-- nothing about `invited_by` at all. So every insert failed, which meant the
-- feature this migration was for did not work at all: sharing with an address that
-- has no account refused, with a database error rather than anything a person could
-- act on.
--
-- It is not fixed by having the client send the user id, and that is the more
-- interesting half.
--
-- `invited_by` is a fact about *who did this*, and the only trustworthy source for
-- it is the session the request arrives with. A client that supplies the value can
-- supply any value: an editor -- or anything holding the public anon key, since that
-- is public by design -- could record an invitation as having come from the owner,
-- and the share list would then name somebody who never invited anybody. A column
-- that answers "who?" must be answered by the database, and the session is the
-- database's own record of who is asking.
--
-- So the client sends three fields and never a fourth, and this trigger fills in the
-- rest. A `before insert` rather than a default, because `auth.uid()` is not allowed
-- in a `default` expression and the value has to come from the session rather than
-- from a constant.
--
-- A forward migration, because 010 has been applied -- the error above is how we
-- know.

create or replace function public.set_invited_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `auth.uid()` is null for the service role and for a direct psql session. Both
  -- are legitimate ways to put a row in -- a repair script, a migration backfill --
  -- so they are allowed through with the column left alone, and the NOT NULL below
  -- is what stops one arriving from a session-less *client* request, which is the
  -- case that actually happened.
  if auth.uid() is not null then
    new.invited_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_invited_by on public.document_invites;
create trigger trg_set_invited_by
  before insert on public.document_invites
  for each row
  execute function public.set_invited_by();

-- ----------------------------------------------------------------
-- Rows inserted before this, which could not have been
-- ----------------------------------------------------------------
--
-- There cannot be any: the column was NOT NULL, so every attempt failed and left
-- nothing behind. Stated rather than assumed, because a backfill here that assumed
-- it was wrong would insert rows nobody invited.

-- ----------------------------------------------------------------
-- And an explanation, for anybody who reads this column later
-- ----------------------------------------------------------------
comment on column public.document_invites.invited_by is
  'The account that sent the invitation. Filled from auth.uid() by trg_set_invited_by; '
  'clients do not supply it, so it cannot be forged by one.';

-- ----------------------------------------------------------------
-- What this cannot check
-- ----------------------------------------------------------------
--
-- That the trigger fires on a request from a signed-in editor. The signup test
-- inserts as the table owner with no session, which is the other branch -- and this
-- file's own purpose is that the first branch was missing.

-- =============================================================================
-- 20261001000012_profile_readable_by_owner.sql
-- =============================================================================
-- Let people read each other's profile, which the share list is made of.
--
-- **The bug: "Unknown user" on every shared row.**
--
-- `shares_document_with(a, b)` decided whether two accounts share a workspace by
-- joining `document_collaborators` against itself:
--
--   select 1 from document_collaborators mine
--   join document_collaborators theirs on theirs.document_id = mine.document_id
--   where mine.user_id = p_a and theirs.user_id = p_b
--
-- and the owner is *deliberately not in that table*. `document_collaborators` holds
-- only the people the owner invited, precisely so ownership and membership cannot
-- disagree -- there is an `add_document_owner` helper in the history that nothing
-- ever called, and several places looked for a row that never existed.
--
-- So the function could never relate the owner to anybody. Which means:
--
--   * `id = auth.uid() or shares_document_with(auth.uid(), profiles.id)` is false
--     for the owner reading an invited person, and
--   * false again for an invited person reading the owner.
--
-- RLS turns a false into no rows, and PostgREST turns a missing embedded row into a
-- null `profile`. So `ShareDialog` received rows with `profile: null`, both the name
-- and the email came out undefined, and every row rendered as the string
-- "Unknown user" -- including the owner's own row, and including the very row that
-- carries the edit/view chooser the person was looking at when they noticed.
--
-- Nobody had an account with a missing profile. The profiles were all there; the
-- policy was refusing to let anybody read them.
--
-- ## The fix
--
-- Ask about the *document*, not about two rows of a membership table. Two accounts
-- share a workspace when some document has one of them as its owner and the other as
-- a collaborator, or when both are collaborators on the same document. That reads
-- `documents.owner_id`, which is the single source of truth for ownership, so the
-- two tables can no longer disagree about who owns anything.

create or replace function public.shares_document_with(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- The owner and somebody they invited.
    exists (
      select 1
      from public.documents d
      join public.document_collaborators c on c.document_id = d.id
      where (d.owner_id = p_a and c.user_id = p_b)
         or (d.owner_id = p_b and c.user_id = p_a)
    )
    -- Two invited people, on the same document.
    or exists (
      select 1
      from public.document_collaborators mine
      join public.document_collaborators theirs
        on theirs.document_id = mine.document_id
      where mine.user_id = p_a and theirs.user_id = p_b
    );
$$;

grant execute on function public.shares_document_with(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------
-- A profile is readable by its owner, by somebody who shares a
-- workspace with them, and by the person whose workspace it is.
-- ----------------------------------------------------------------
--
-- Restated rather than amended, because the policy text is where a reader looks and
-- a comment two hundred lines away is not. `shares_document_with` is symmetric and
-- now reads `documents.owner_id`, so this covers all three relationships:
-- yours, theirs-with-yours-as-owner, and theirs-as-owner-with-yours.
--
-- Unchanged in what it allows: a stranger still cannot read a name or an email
-- address, which is the whole reason `profiles` is behind a policy at all.
--
-- Dropped first, because `create policy` has no `or replace` and this one already
-- exists from migration 2. `drop policy if exists` is the whole of the migration for
-- a fresh database and harmless on an applied one.
drop policy if exists "can read profile" on public.profiles;

create policy "can read profile"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or public.shares_document_with(auth.uid(), profiles.id)
  );

-- ----------------------------------------------------------------
-- What this cannot check
-- ----------------------------------------------------------------
--
-- RLS is evaluated with the requesting user's privileges, and the signup test inserts
-- as the table owner with no session, so it cannot exercise a policy from the
-- inside. The claim that is testable is the one underneath: that the owner is not in
-- `document_collaborators`, and that a function which ignores `documents.owner_id`
-- therefore cannot relate them. That is asserted in test-invite-claim.cjs.

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
    'claim_pending_invites',
    'claim_pending_invites_on_signup',
    'create_default_page',
    'create_settings_for_new_user',
    'create_tutorial_workspace',
    'create_tutorial_workspace_for_new_user',
    'find_profile_by_email',
    'import_pages',
    'is_plausible_email',
    'prevent_deleting_last_page',
    'profiles_needing_resync',
    'realtime_document_id',
    'realtime_page_id',
    'resync_all_profiles',
    'set_invited_by',
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
    ('20261001000006', 'tutorial_content'),
    ('20261001000007', 'import_pages_elements'),
    ('20261001000008', 'import_pages_single_signature'),
    ('20261001000009', 'second_account_can_sign_up'),
    ('20261001000010', 'pending_invites'),
    ('20261001000011', 'invited_by_from_session'),
    ('20261001000012', 'profile_readable_by_owner')
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
