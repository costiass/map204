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
