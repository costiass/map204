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
