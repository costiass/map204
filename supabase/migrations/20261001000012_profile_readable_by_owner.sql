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
