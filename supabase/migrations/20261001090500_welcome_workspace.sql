-- 006 · A welcome workspace for every account
--
-- Signing up to an empty canvas is a bad first five minutes, so every account
-- gets a workspace called `tutorial` with a page that explains the app in
-- cards. It is created by the database, not by the client, so it exists no
-- matter which entry point made the account.
--
-- Re-importing this project's own export lands on the same page ids, so the
-- content is written with `on conflict` semantics rather than assuming the ids
-- are free.

-- ----------------------------------------------------------------
-- The tutorial content
-- ----------------------------------------------------------------
-- Written as JSONB and inserted straight into the page, because the alternative
-- is duplicating the client's card defaults here and letting the two drift.
create or replace function public.tutorial_page_content()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'cards', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut_welcome',
        'title', 'Welcome to ClassCards',
        'content',
          'This workspace is yours to change. Rename it, delete it, or add pages beside it.'
          || chr(10) || chr(10)
          || 'Everything you do is saved to your account and shared with whoever you invite.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 0, 'width', 300, 'height', 240, 'zIndex', 1),
        'style', jsonb_build_object(
          'backgroundColor', '#EEF2FF', 'accentColor', '#6366F1', 'textColor', '#111827',
          'borderColor', '#C7D2FE', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_basics',
        'title', 'The basics',
        'content',
          '**C** drops a card where you are looking.'
          || chr(10) || chr(10)
          || '- **G** adds a group, a box you can gather cards into'
          || chr(10)
          || '- **F** fits everything in view'
          || chr(10)
          || '- **Delete** removes whatever you have selected'
          || chr(10) || chr(10)
          || 'Drag a card by its header to move it, and drag the corner to resize.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 340, 'y', 0, 'width', 300, 'height', 300, 'zIndex', 2),
        'style', jsonb_build_object(
          'backgroundColor', '#FFFFFF', 'accentColor', '#0EA5E9', 'textColor', '#111827',
          'borderColor', '#E5E7EB', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(
          jsonb_build_object('id', 'tut_task_1', 'text', 'Press C to add a card', 'done', false),
          jsonb_build_object('id', 'tut_task_2', 'text', 'Press G to add a group', 'done', false),
          jsonb_build_object('id', 'tut_task_3', 'text', 'Connect two things with a drag', 'done', false)
        ),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_connect',
        'title', 'Connect ideas',
        'content',
          'Drag from one of the small dots on a card edge onto another card.'
          || chr(10) || chr(10)
          || 'The arrow picks the best side by itself. Click it to give the link a'
          || chr(10)
          || 'relationship, a colour, and a stroke.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 680, 'y', 0, 'width', 300, 'height', 240, 'zIndex', 3),
        'style', jsonb_build_object(
          'backgroundColor', '#ECFDF5', 'accentColor', '#16A34A', 'textColor', '#111827',
          'borderColor', '#BBF7D0', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_share',
        'title', 'Work on it together',
        'content',
          '**Share** in the top bar invites someone by email.'
          || chr(10) || chr(10)
          || '- **Can edit** — they can change anything'
          || chr(10)
          || '- **Can view** — they can look but not change'
          || chr(10) || chr(10)
          || 'You will see their cursor move, and you can click their avatar to'
          || chr(10)
          || 'follow along.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 0, 'y', 280, 'width', 300, 'height', 240, 'zIndex', 4),
        'style', jsonb_build_object(
          'backgroundColor', '#FFF7ED', 'accentColor', '#D97706', 'textColor', '#111827',
          'borderColor', '#FED7AA', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      ),
      jsonb_build_object(
        'id', 'tut_note',
        'title', 'A note on cards',
        'content',
          'Card bodies are **Markdown**, so links, lists, tables and images all work.'
          || chr(10) || chr(10)
          || 'The arrow from *Connect ideas* is a real link between two cards, drawn'
          || chr(10)
          || 'from their positions rather than stored coordinates — so it follows'
          || chr(10)
          || 'them when you move them.',
        'image', jsonb_build_object('src', null, 'alt', ''),
        'position', jsonb_build_object('x', 340, 'y', 340, 'width', 300, 'height', 240, 'zIndex', 5),
        'style', jsonb_build_object(
          'backgroundColor', '#FDF2F8', 'accentColor', '#E11D48', 'textColor', '#111827',
          'borderColor', '#FBCFE8', 'borderWidth', 1, 'borderRadius', 12, 'shadow', true
        ),
        'tags', jsonb_build_array('start-here'),
        'collapsed', false,
        'parentId', null,
        'checklist', jsonb_build_array(),
        'createdAt', now()::text,
        'updatedAt', now()::text
      )
    ),
    'connections', jsonb_build_array(
      jsonb_build_object(
        'id', 'tut_link_1',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_basics'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_connect'),
        'sourceAnchor', null,
        'targetAnchor', null,
        'label', 'leads to',
        'relationshipType', 'leads to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      ),
      jsonb_build_object(
        'id', 'tut_link_2',
        'source', jsonb_build_object('kind', 'card', 'id', 'tut_share'),
        'target', jsonb_build_object('kind', 'card', 'id', 'tut_welcome'),
        'sourceAnchor', null,
        'targetAnchor', null,
        'label', 'next step',
        'relationshipType', 'related to',
        'style', jsonb_build_object(
          'color', '#6366F1', 'width', 2, 'lineStyle', 'solid', 'routing', 'curved',
          'arrowStart', 'none', 'arrowEnd', 'arrow', 'animated', false
        )
      )
    )
  );
$$;

-- ----------------------------------------------------------------
-- Create it for one account
-- ----------------------------------------------------------------
create or replace function public.create_tutorial_workspace(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_document_id text;
  first_page_id text;
begin
  -- One welcome workspace per account, ever. Re-running is harmless.
  if exists (select 1 from public.documents where owner_id = p_user_id) then
    select id into new_document_id
    from public.documents
    where owner_id = p_user_id
    order by created_at
    limit 1;
    return new_document_id;
  end if;

  insert into public.documents (owner_id, title)
  values (p_user_id, 'tutorial')
  returning id into new_document_id;

  -- trg_create_default_page has already made the first page by now.
  select id into first_page_id
  from public.pages
  where document_id = new_document_id
  order by ordinal
  limit 1;

  if first_page_id is null then
    insert into public.pages (id, document_id, title, ordinal)
    values ('page_tutorial_' || substr(md5(random()::text), 1, 8), new_document_id, 'Getting started', 0)
    returning id into first_page_id;
  else
    update public.pages
    set title = 'Getting started',
        cards = (tutorial_page_content() -> 'cards'),
        connections = (tutorial_page_content() -> 'connections')
    where id = first_page_id;
  end if;

  return new_document_id;
end;
$$;

-- ----------------------------------------------------------------
-- Fire it on signup
-- ----------------------------------------------------------------
create or replace function public.create_tutorial_workspace_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_tutorial_workspace(new.id);
  return new;
end;
$$;

drop trigger if exists trg_create_tutorial_workspace on auth.users;
create trigger trg_create_tutorial_workspace
  after insert on auth.users
  for each row
  execute function public.create_tutorial_workspace_for_new_user();

-- ----------------------------------------------------------------
-- Backfill for accounts that signed up before this
-- ----------------------------------------------------------------
do $$
declare
  u record;
begin
  for u in
    select id from auth.users a
    where not exists (select 1 from public.documents d where d.owner_id = a.id)
  loop
    perform public.create_tutorial_workspace(u.id);
  end loop;
end;
$$;
