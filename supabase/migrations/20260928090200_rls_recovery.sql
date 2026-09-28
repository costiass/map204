-- Migration 010: RLS recovery — assert the final, non-recursive policy set
--
-- Why this file exists: migration 003 used to create a policy on
-- `document_collaborators` that read `documents`, while a policy on `documents`
-- read `document_collaborators`. Postgres answers every query on either table
-- with 42P17 "infinite recursion detected in policy", so the app is dead, not
-- just sharing. 003 and 008 are now fixed, but a database that already ran the
-- old 003 keeps the broken policies, because `db push` will not re-apply a
-- migration it believes is already done.
--
-- This migration is therefore a full, idempotent re-assertion of the policy set:
-- it drops every policy on the three tables and recreates the intended ones. It
-- is safe to run repeatedly and safe to paste into the SQL Editor directly.
--
-- Note the shape that avoids recursion: policies never query another RLS table
-- directly. Cross-table access always goes through a SECURITY DEFINER helper,
-- which executes with the table owner's rights, so RLS does not re-enter.

-- ============================================================
-- Helpers (already defined by 003; re-asserted so this file stands alone)
-- ============================================================
create or replace function can_view_document(p_document_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents d
    where d.id = p_document_id and d.owner_id = auth.uid()
  ) or exists (
    select 1 from document_collaborators dc
    where dc.document_id = p_document_id and dc.user_id = auth.uid()
  );
$$;

create or replace function can_edit_document(p_document_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents d
    where d.id = p_document_id and d.owner_id = auth.uid()
  ) or exists (
    select 1 from document_collaborators dc
    where dc.document_id = p_document_id
      and dc.user_id = auth.uid()
      and dc.role in ('owner', 'editor')
  );
$$;

create or replace function can_view_page(p_page_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pages pg
    join documents d on d.id = pg.document_id
    where pg.id = p_page_id and d.owner_id = auth.uid()
  ) or exists (
    select 1 from pages pg
    join document_collaborators dc on dc.document_id = pg.document_id
    where pg.id = p_page_id and dc.user_id = auth.uid()
  );
$$;

create or replace function can_edit_page(p_page_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pages pg
    join documents d on d.id = pg.document_id
    where pg.id = p_page_id and d.owner_id = auth.uid()
  ) or exists (
    select 1 from pages pg
    join document_collaborators dc on dc.document_id = pg.document_id
    where pg.id = p_page_id
      and dc.user_id = auth.uid()
      and dc.role in ('owner', 'editor')
  );
$$;

grant execute on function can_view_document(text) to authenticated;
grant execute on function can_edit_document(text) to authenticated;
grant execute on function can_view_page(text) to authenticated;
grant execute on function can_edit_page(text) to authenticated;

-- ============================================================
-- Drop everything, then recreate the intended set
-- ============================================================
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['documents', 'pages', 'document_collaborators', 'user_settings'] loop
    -- A nested loop is required: EXECUTE runs one statement, and a table has
    -- several policies.
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute 'drop policy if exists ' || quote_ident(p.policyname) || ' on ' || quote_ident(t);
    end loop;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- documents
-- ------------------------------------------------------------
create policy "Users can view own documents" on documents
  for select using (owner_id = auth.uid());

create policy "Users can create documents" on documents
  for insert with check (owner_id = auth.uid());

create policy "Owners can update documents" on documents
  for update using (owner_id = auth.uid());

create policy "Owners can delete documents" on documents
  for delete using (owner_id = auth.uid());

create policy "Collaborators can view shared documents" on documents
  for select using (can_view_document(documents.id));

create policy "Collaborators can update shared documents" on documents
  for update using (can_edit_document(documents.id));

-- ------------------------------------------------------------
-- pages
-- ------------------------------------------------------------
create policy "Users can view pages in own documents" on pages
  for select using (
    exists (
      select 1 from documents
      where documents.id = pages.document_id
        and documents.owner_id = auth.uid()
    )
  );

create policy "Users can insert pages in own documents" on pages
  for insert with check (
    exists (
      select 1 from documents
      where documents.id = pages.document_id
        and documents.owner_id = auth.uid()
    )
  );

create policy "Users can update pages in own documents" on pages
  for update using (
    exists (
      select 1 from documents
      where documents.id = pages.document_id
        and documents.owner_id = auth.uid()
    )
  );

create policy "Users can delete pages in own documents" on pages
  for delete using (
    exists (
      select 1 from documents
      where documents.id = pages.document_id
        and documents.owner_id = auth.uid()
    )
  );

create policy "Collaborators can view pages in shared documents" on pages
  for select using (can_view_page(pages.id));

-- A brand new page has no id yet, so this asks about the document.
create policy "Collaborators can insert pages in shared documents" on pages
  for insert with check (can_edit_document(pages.document_id));

create policy "Collaborators can update pages in shared documents" on pages
  for update using (can_edit_page(pages.id));

create policy "Collaborators can delete pages in shared documents" on pages
  for delete using (can_edit_page(pages.id));

-- ------------------------------------------------------------
-- document_collaborators
-- ------------------------------------------------------------
create policy "Users can view own collaborator rows" on document_collaborators
  for select using (user_id = auth.uid());

create policy "Collaborators can view collaborator lists" on document_collaborators
  for select using (can_view_document(document_collaborators.document_id));

-- WITH CHECK stops a collaborator adding themselves, or adding themselves as a
-- second owner.
create policy "Owners can manage collaborators" on document_collaborators
  for all
  using (can_edit_document(document_collaborators.document_id))
  with check (can_edit_document(document_collaborators.document_id));

-- ------------------------------------------------------------
-- user_settings
-- ------------------------------------------------------------
create policy "Users can view own settings" on user_settings
  for select using (user_id = auth.uid());

create policy "Users can insert own settings" on user_settings
  for insert with check (user_id = auth.uid());

create policy "Users can update own settings" on user_settings
  for update using (user_id = auth.uid());

-- ============================================================
-- Realtime: private channels are access-checked
-- ============================================================
grant select, insert on realtime.messages to authenticated;

create or replace function realtime_page_id()
returns text language sql stable as $$
  select (regexp_match(realtime.topic(), 'page:([^:]+)$'))[1];
$$;

create or replace function realtime_document_id()
returns text language sql stable as $$
  select (regexp_match(realtime.topic(), 'document:([^:]+)$'))[1];
$$;

do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
  loop
    execute 'drop policy if exists ' || quote_ident(r.policyname) || ' on realtime.messages';
  end loop;
end;
$$;

create policy "Read page broadcasts" on realtime.messages
  for select to authenticated
  using (realtime_page_id() is not null and can_view_page(realtime_page_id()));

create policy "Read document presence" on realtime.messages
  for select to authenticated
  using (realtime_document_id() is not null and can_view_document(realtime_document_id()));

create policy "Publish page broadcasts" on realtime.messages
  for insert to authenticated
  with check (realtime_page_id() is not null and can_edit_page(realtime_page_id()));

create policy "Publish document presence" on realtime.messages
  for insert to authenticated
  with check (realtime_document_id() is not null and can_edit_document(realtime_document_id()));

-- ============================================================
-- Settings: the new appearance preferences
-- ============================================================
alter table user_settings
  add column if not exists accent text not null default 'indigo',
  add column if not exists card_radius integer not null default 12,
  add column if not exists reduce_motion boolean not null default false;
