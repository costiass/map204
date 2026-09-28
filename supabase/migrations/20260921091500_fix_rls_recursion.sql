-- Migration 003: break the RLS recursion
--
-- The problem: a `documents` policy queried `document_collaborators`, whose own
-- policy queried `documents`. Postgres detects the cycle and answers every
-- request on either table with 42P17 "infinite recursion detected in policy",
-- so the app is entirely dead — not just sharing.
--
-- The fix is four `SECURITY DEFINER` helper functions. They run with the table
-- owner's rights, so RLS on the tables they read does not apply and the
-- policies never nest.
--
-- They live here, at the first migration that needs them, so that *every*
-- intermediate state of a push is safe. An earlier version of this file created
-- the looping policy directly and relied on a later migration to remove it —
-- which meant a push that failed partway left the database unusable.

-- ============================================================
-- Helpers
-- ============================================================
create or replace function can_view_document(p_document_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from documents d
    where d.id = p_document_id and d.owner_id = auth.uid()::text
  ) or exists (
    select 1 from document_collaborators dc
    where dc.document_id = p_document_id and dc.user_id = auth.uid()::text
  );
$$;

create or replace function can_edit_document(p_document_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from documents d
    where d.id = p_document_id and d.owner_id = auth.uid()::text
  ) or exists (
    select 1 from document_collaborators dc
    where dc.document_id = p_document_id
      and dc.user_id = auth.uid()::text
      and dc.role in ('owner', 'editor')
  );
$$;

create or replace function can_view_page(p_page_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from pages pg
    join documents d on d.id = pg.document_id
    where pg.id = p_page_id and d.owner_id = auth.uid()::text
  ) or exists (
    select 1
    from pages pg
    join document_collaborators dc on dc.document_id = pg.document_id
    where pg.id = p_page_id and dc.user_id = auth.uid()::text
  );
$$;

create or replace function can_edit_page(p_page_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from pages pg
    join documents d on d.id = pg.document_id
    where pg.id = p_page_id and d.owner_id = auth.uid()::text
  ) or exists (
    select 1
    from pages pg
    join document_collaborators dc on dc.document_id = pg.document_id
    where pg.id = p_page_id
      and dc.user_id = auth.uid()::text
      and dc.role in ('owner', 'editor')
  );
$$;

grant execute on function can_view_document(text) to authenticated;
grant execute on function can_edit_document(text) to authenticated;
grant execute on function can_view_page(text) to authenticated;
grant execute on function can_edit_page(text) to authenticated;

-- ============================================================
-- Policies, expressed through the helpers
-- ============================================================
drop policy if exists "Collaborators can view shared documents" on documents;
create policy "Collaborators can view shared documents"
  on documents for select
  using (can_view_document(documents.id));

drop policy if exists "Users can view own collaborator rows" on document_collaborators;
create policy "Users can view own collaborator rows"
  on document_collaborators for select
  using (user_id = auth.uid()::text);

-- WITH CHECK is included so a collaborator cannot add themselves, or add
-- themselves as a second owner.
drop policy if exists "Owners can manage collaborators" on document_collaborators;
create policy "Owners can manage collaborators"
  on document_collaborators for all
  using (can_edit_document(document_collaborators.document_id))
  with check (can_edit_document(document_collaborators.document_id));

-- Pages reach the document through the helper rather than a nested query.
drop policy if exists "Collaborators can view pages in shared documents" on pages;
create policy "Collaborators can view pages in shared documents"
  on pages for select
  using (can_view_page(pages.id));
