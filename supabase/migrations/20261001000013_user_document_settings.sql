-- 013 · Per-user, per-document settings
--
-- One small JSON document per person per workspace, holding the things that are
-- theirs rather than the workspace's:
--
--   position   where each page was left, and which page was being looked at
--   defaults   the appearance and canvas defaults as they stood when they started
--
-- ## Why it is JSON and not columns
--
-- The shape is still moving. `position` grows a key per page, which is a map with
-- no fixed size, and `defaults` is a copy of `user_settings` that is deliberately
-- allowed to drift from it. A column per field would mean a migration for every
-- addition and a row that is mostly nulls, for data that is read as a whole and
-- written as a whole.
--
-- `user_settings` stays where it is and stays authoritative for appearance. This
-- table records what a person had chosen *when they arrived at a particular map*,
-- which is the thing a shared workspace cannot hold: it is not a property of the
-- map, and two people in the same map have two different ones.
--
-- ## Why not the browser
--
-- The camera used to live in `localStorage`, which is per-browser. A person signing
-- in on a phone and a laptop got two unrelated views of the same map, and neither
-- was reachable from the other. This is the reader's own state, so it belongs
-- beside the reader rather than inside the device they happened to be holding.
--
-- It is deliberately *not* on `pages` and *not* in the realtime broadcast. A saved
-- camera is somebody else's opinion about where a map should open, and the first
-- person to open it decided, for everyone, forever.

create table if not exists public.user_document_settings (
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id text not null references public.documents (id) on delete cascade,
  -- A whole settings document, not a row of columns. See the note above.
  data jsonb not null default '{"version":1}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  -- One person, one workspace: one file.
  primary key (user_id, document_id)
);

comment on table public.user_document_settings is
  'Per-user, per-workspace settings: their camera on each page, and the defaults they started with.';

create index if not exists user_document_settings_user_idx
  on public.user_document_settings (user_id);

-- ----------------------------------------------------------------
-- Row level security
-- ----------------------------------------------------------------
-- The whole point of the table is that `user_id` is the owner, so every policy is
-- `user_id = auth.uid()`. There is deliberately no `can_view_document` test on the
-- write side and none needed on the read side:
--
--   * read    a row only exists for somebody who was looking at the workspace, and
--             it says nothing about the workspace's contents. Reading your own
--             camera after being removed from a map is harmless; the map itself is
--             already closed to you.
--   * write   you are writing your own camera. There is nothing here to escalate
--             to, so requiring edit access would only stop a *viewer* from
--             remembering where they were standing -- which is the one person most
--             likely to want to.
--
alter table public.user_document_settings enable row level security;

create policy "read own document settings"
  on public.user_document_settings for select to authenticated
  using (user_id = auth.uid());

create policy "create own document settings"
  on public.user_document_settings for insert to authenticated
  with check (user_id = auth.uid());

create policy "update own document settings"
  on public.user_document_settings for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "delete own document settings"
  on public.user_document_settings for delete to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------
-- Kept current
-- ----------------------------------------------------------------
-- Two triggers, because the table has two kinds of client and they arrive by
-- different routes. `touch` covers PostgREST and the app; `adopt` covers a file
-- written by a trigger elsewhere, which arrives with no session.
create or replace function public.touch_user_document_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_document_settings_touch on public.user_document_settings;
create trigger user_document_settings_touch
  before update on public.user_document_settings
  for each row execute function public.touch_user_document_settings();

-- Deleting a workspace takes its readers' settings with it. There is a foreign key
-- cascade for this, and it is stated here as well only to make the intent obvious
-- to somebody reading the schema; the constraint is what actually enforces it.
--
-- The reverse is deliberately absent: signing out, or closing a tab, keeps your
-- settings. They are yours, and the next person to open the map is not going to
-- inherit them.
