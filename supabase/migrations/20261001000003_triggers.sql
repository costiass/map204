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
