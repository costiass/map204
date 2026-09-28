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
