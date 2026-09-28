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
