-- Migration 001: initial schema
--
-- Written to be re-runnable: every statement is guarded, so applying it to a
-- database that already has some of it is a no-op rather than an error. Later
-- migrations (003–009) adjust the policies this file creates.

-- ============================================================
-- Tables
-- ============================================================
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade not null,
  title text not null default 'Untitled',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Each page stores its cards/groups/connections as JSONB.
create table if not exists pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade not null,
  title text not null default 'Page 1',
  position integer not null default 0,
  viewport jsonb not null default '{"x":0,"y":0,"zoom":1}',
  cards jsonb not null default '[]',
  groups jsonb not null default '[]',
  connections jsonb not null default '[]',
  version integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists user_settings (
  user_id uuid references auth.users(id) on delete cascade primary key,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  default_snap_to_grid boolean not null default true,
  default_grid_pattern text not null default 'dots' check (default_grid_pattern in ('none', 'dots', 'lines')),
  default_grid_size integer not null default 20,
  updated_at timestamptz default now()
);

create table if not exists document_collaborators (
  document_id uuid references documents(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  primary key (document_id, user_id)
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table documents enable row level security;
alter table pages enable row level security;
alter table user_settings enable row level security;
alter table document_collaborators enable row level security;

-- user_settings: strictly your own row
drop policy if exists "Users can view own settings" on user_settings;
create policy "Users can view own settings"
  on user_settings for select using (user_id = auth.uid()::text);

drop policy if exists "Users can update own settings" on user_settings;
create policy "Users can update own settings"
  on user_settings for update using (user_id = auth.uid()::text);

drop policy if exists "Users can insert own settings" on user_settings;
create policy "Users can insert own settings"
  on user_settings for insert with check (user_id = auth.uid()::text);

-- documents: the owner, plus anyone who is a collaborator
drop policy if exists "Users can view own documents" on documents;
create policy "Users can view own documents"
  on documents for select using (owner_id = auth.uid()::text);

drop policy if exists "Collaborators can view shared documents" on documents;
create policy "Collaborators can view shared documents"
  on documents for select using (
    exists (
      select 1 from document_collaborators
      where document_id = documents.id
      and user_id = auth.uid()::text
    )
  );

drop policy if exists "Users can create documents" on documents;
create policy "Users can create documents"
  on documents for insert with check (owner_id = auth.uid()::text);

drop policy if exists "Owners can update documents" on documents;
create policy "Owners can update documents"
  on documents for update using (owner_id = auth.uid()::text);

drop policy if exists "Owners can delete documents" on documents;
create policy "Owners can delete documents"
  on documents for delete using (owner_id = auth.uid()::text);

-- pages: reach the document through the page
drop policy if exists "Users can view pages in own documents" on pages;
create policy "Users can view pages in own documents"
  on pages for select using (
    exists (
      select 1 from documents
      where documents.id = pages.document_id
      and documents.owner_id = auth.uid()::text
    )
  );

drop policy if exists "Collaborators can view pages in shared documents" on pages;
create policy "Collaborators can view pages in shared documents"
  on pages for select using (
    exists (
      select 1 from document_collaborators dc
      where dc.document_id = pages.document_id
      and dc.user_id = auth.uid()::text
    )
  );

drop policy if exists "Users can create pages in own documents" on pages;
create policy "Users can create pages in own documents"
  on pages for insert with check (
    exists (
      select 1 from documents
      where documents.id = pages.document_id
      and documents.owner_id = auth.uid()::text
    )
  );

drop policy if exists "Users can update pages in own documents" on pages;
create policy "Users can update pages in own documents"
  on pages for update using (
    exists (
      select 1 from documents
      where documents.id = pages.document_id
      and documents.owner_id = auth.uid()::text
    )
  );

drop policy if exists "Users can delete pages in own documents" on pages;
create policy "Users can delete pages in own documents"
  on pages for delete using (
    exists (
      select 1 from documents
      where documents.id = pages.document_id
      and documents.owner_id = auth.uid()::text
    )
  );

-- document_collaborators: 003 and 008 replace the owner-side policies with
-- versions that do not recurse.
drop policy if exists "Owners can manage collaborators" on document_collaborators;
drop policy if exists "Users can view collaborators on shared documents" on document_collaborators;

-- ============================================================
-- Realtime publication (idempotent)
-- ============================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pages', 'documents'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_pages_document_id on pages(document_id);
create index if not exists idx_collaborators_document_id on document_collaborators(document_id);
create index if not exists idx_collaborators_user_id on document_collaborators(user_id);
