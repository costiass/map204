-- Read this in the Supabase SQL editor. It changes nothing.
--
-- "Database error saving new user" is what GoTrue says when the row it was
-- inserting into `auth.users` failed. A trigger's failure rolls that whole
-- transaction back, which is why the account is never created, why signing in
-- never reaches the database, and why the browser appears to blame Google. None of
-- those three is the fault.
--
-- So the question is only ever: what is on `auth.users`, and what is on
-- `public.profiles` that those triggers write to.
--
-- Everything below is a select. Run all of it and paste the output.

--------------------------------------------------------------------------------
-- 1. Triggers on auth.users
--------------------------------------------------------------------------------
-- Map204 installs exactly three, and they are the only ones that should be here:
--
--   trg_create_settings             a user_settings row
--   trg_create_tutorial_workspace   a welcome workspace, two pages
--   trg_sync_profile                a profiles row, kept current on update
--
-- Anything else is a leftover. The dashboard's profile template adds
-- `on_auth_user_created` running `public.handle_new_user()`, which inserts a
-- `raw_user_meta_data` column this schema does not have. That alone reproduces
-- this error exactly.
select
  t.tgname as trigger_name,
  p.proname as function_name,
  p.pronamespace::regnamespace::text as schema,
  case
    when t.tgname in ('trg_create_settings', 'trg_create_tutorial_workspace', 'trg_sync_profile')
      then 'ours'
    else 'LEFTOVER -- the likely cause'
  end as verdict
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass
  and not t.tgisinternal
order by t.tgname;

--------------------------------------------------------------------------------
-- 2. The functions those triggers call, and whether they still exist
--------------------------------------------------------------------------------
-- A trigger whose function was dropped is not the problem; a trigger calling a
-- function that is missing is. `present` says which of the three bodies a new
-- sign-in depends on.
-- Written as a values list rather than `unnest(array[...])` so the names are
-- visible in the order they matter, and so the join has one obvious key. The
-- earlier version aliased both sides and `name` became ambiguous -- a diagnostic
-- that errors is a diagnostic nobody runs.
with wanted(name, what_it_does) as (
  values
    ('create_settings_for_new_user',    'a user_settings row'),
    ('create_tutorial_workspace',       'a workspace and two pages'),
    ('sync_profile',                    'a profiles row'),
    ('tutorial_page_one',               'the content of page one'),
    ('tutorial_page_two',               'the content of page two'),
    ('handle_new_user',                 'LEFTOVER from the dashboard template')
)
select
  wanted.name,
  (found.name is not null) as function_exists,
  wanted.what_it_does
from wanted
left join (
  select p.proname as name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
) found on found.name = wanted.name
order by wanted.name;

--------------------------------------------------------------------------------
-- 3. The columns those triggers write into
--------------------------------------------------------------------------------
-- `handle_new_user` writes `raw_user_meta_data`. If that column is absent, the
-- trigger cannot run and every signup fails.
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
order by ordinal_position;

--------------------------------------------------------------------------------
-- 4. Whether signup is broken right now, and has been
--------------------------------------------------------------------------------
-- If any account exists with no profiles row, a signup half-succeeded at some
-- point, which narrows it to the trigger that was failing at the time. If every
-- account has a profile and a workspace, then signup has been failing for every
-- account created since the break.
select
  (select count(*) from auth.users)                                   as accounts,
  (select count(*) from public.profiles)                              as profiles,
  (select count(*) from public.user_settings)                         as settings_rows,
  (select count(*) from public.documents)                             as workspaces,
  (select count(*) from auth.users a
     where not exists (select 1 from public.profiles p where p.id = a.id)
  )                                                                   as accounts_without_a_profile,
  (select count(*) from auth.users a
     where not exists (select 1 from public.documents d where d.owner_id = a.id)
  )                                                                   as accounts_without_a_workspace;

--------------------------------------------------------------------------------
-- 5. Has `import_pages` been overloaded?
--------------------------------------------------------------------------------
-- Unrelated to signup, but the same class of mistake, and it breaks importing.
-- Two live signatures under one name is why PostgREST answers PGRST203. There
-- should be exactly one row, and it should take `text`.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  count(*) over () as live_signatures_for_this_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'import_pages'
order by arguments;

--------------------------------------------------------------------------------
-- How to read the answers
--------------------------------------------------------------------------------
--
-- 1 says LEFTOVER            -> migration 9 fixes it. Apply it.
-- 2 says function_exists = f -> the migration chain is incomplete; re-apply the
--                               missing file. 005 brings the workspace, 006 the
--                               tutorial content.
-- 3 has no raw_user_meta_data + 1 lists on_auth_user_created
--                            -> same as the first case, confirmed.
-- 4 shows accounts_without_a_profile > 0
--                            -> some accounts predate the break and are fine;
--                               new ones cannot be created at all.
-- 5 shows live_signatures > 1 -> apply migration 8, or 9, which drops the uuid one.
--
-- Migrations 1-9, in order, are in supabase/migrations. bootstrap.sql is all nine
-- concatenated, for a database that is being reset rather than repaired.
