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
