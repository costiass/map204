-- Migration 003: break the RLS recursion
--
-- The problem: a `documents` policy queried `document_collaborators`, whose own
-- policy queried `documents` — Postgres detects the cycle and refuses every
-- query, so sharing appeared to hang.
--
-- The fix is the `SECURITY DEFINER` helper functions added in 008
-- (`can_view_document`, `can_edit_document`, `can_view_page`, `can_edit_page`):
-- they run with the table owner's rights, so the policies below never recurse.
-- This file creates the policies in terms of those helpers.

-- Collaborators may read the document they were invited to.
drop policy if exists "Collaborators can view shared documents" on documents;
create policy "Collaborators can view shared documents"
  on documents for select
  using (
    exists (
      select 1 from document_collaborators
      where document_id = documents.id
      and user_id = auth.uid()
    )
  );

-- Collaborators may see their own row without touching the documents table.
drop policy if exists "Users can view own collaborator rows" on document_collaborators;
create policy "Users can view own collaborator rows"
  on document_collaborators for select
  using (user_id = auth.uid());

-- Owners manage the whole list (the WITH CHECK side is added in 008 through
-- can_edit_document, so an owner cannot add themselves as a second owner).
drop policy if exists "Owners can manage collaborators" on document_collaborators;
create policy "Owners can manage collaborators"
  on document_collaborators for all
  using (
    exists (
      select 1 from documents
      where documents.id = document_collaborators.document_id
      and documents.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from documents
      where documents.id = document_collaborators.document_id
      and documents.owner_id = auth.uid()
    )
  );
