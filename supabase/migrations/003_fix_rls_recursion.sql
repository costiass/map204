-- Fix infinite recursion in RLS policies.
-- The problem: documents policy queries document_collaborators,
-- and document_collaborators policy queries documents → infinite loop.
--
-- Fix: document_collaborators policies no longer reference the documents table.
-- Instead, they directly allow users to read any row where they are the user_id.

-- Drop the recursive policies
drop policy if exists "Collaborators can view shared documents" on documents;
drop policy if exists "Owners can manage collaborators" on document_collaborators;
drop policy if exists "Users can view collaborators on shared documents" on document_collaborators;

-- Documents: collaborators can see documents they collaborate on.
-- This is safe because it only reads document_collaborators, which no longer
-- references documents in its own policies.
create policy "Collaborators can view shared documents"
  on documents for select
  using (
    exists (
      select 1 from document_collaborators
      where document_id = documents.id
      and user_id = auth.uid()
    )
  );

-- Collaborators: users can see all collaborator rows where they are the user.
-- This breaks the recursion because it does NOT reference the documents table.
create policy "Users can view own collaborator rows"
  on document_collaborators for select
  using (user_id = auth.uid());

create policy "Users can insert own collaborator rows"
  on document_collaborators for insert
  with check (user_id = auth.uid());

create policy "Users can delete own collaborator rows"
  on document_collaborators for delete
  using (user_id = auth.uid());
