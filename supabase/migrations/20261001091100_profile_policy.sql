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
