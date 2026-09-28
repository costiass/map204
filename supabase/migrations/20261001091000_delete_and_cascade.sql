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
