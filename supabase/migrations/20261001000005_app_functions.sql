-- 005 · Application functions
--
-- The things the app needs that a plain table read cannot do.

-- ----------------------------------------------------------------
-- Find somebody by their email address
-- ----------------------------------------------------------------
-- The share dialog has to turn "sam@example.com" into a user id, but `profiles`
-- is only readable for yourself and your co-collaborators, so a plain SELECT
-- returns nothing. This is `security definer` and matches exactly, so it can be
-- used to share *with* a known address without becoming a way to enumerate
-- every account that exists.
create or replace function public.find_profile_by_email(p_email text)
returns table (id uuid, email text, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.full_name, p.avatar_url
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.find_profile_by_email(text) from public;
grant execute on function public.find_profile_by_email(text) to authenticated;

-- ----------------------------------------------------------------
-- Import pages from a file
-- ----------------------------------------------------------------
-- One call, one transaction. Every page in the file is *added* to the
-- workspace; nothing already there is read, written or deleted.
--
-- Additive, not "replace the document". A destructive import is a class of bug
-- with no upside here: it is unsafe to run twice, unsafe to run over somebody
-- else's work, and possible to get wrong by choosing the wrong option. This way
-- importing the same file twice gives two independent sets of pages.
--
-- Atomic, which the client-driven version it replaced was not. That one did
-- N inserts, then N deletes, then a read, from the browser — so a failure
-- part-way through left a workspace holding both the old pages and some of the
-- new ones, with no record of which state it was in. One statement inside one
-- transaction is either the whole file or none of it.
--
-- The server also mints every id and rewires every reference, so the browser
-- does none of that work and cannot get it wrong.
create or replace function public.import_pages(
  p_document_id text,
  p_pages jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted jsonb := '[]'::jsonb;
  page jsonb;
  page_id text;
  next_ordinal integer;
  new_cards jsonb;
  new_groups jsonb;
  new_connections jsonb;
  card_map jsonb := '{}'::jsonb;
  group_map jsonb := '{}'::jsonb;
  conn_map jsonb := '{}'::jsonb;
begin
  ----------------------------------------------------------------
  -- Permission, and it is not optional. Being `security definer` is what lets
  -- this function insert at all; without an explicit check that would hand every
  -- account a way to write into any workspace. It is the first statement, and it
  -- uses the same helper the RLS policies use, so there is one definition of
  -- "may edit this".
  ----------------------------------------------------------------
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.can_edit_document(p_document_id) then
    raise exception 'You do not have edit access to that workspace.' using errcode = '42501';
  end if;

  if p_pages is null
     or jsonb_typeof(p_pages) <> 'array'
     or jsonb_array_length(p_pages) = 0 then
    raise exception 'The file contains no pages.' using errcode = '22023';
  end if;

  ----------------------------------------------------------------
  -- Imported pages land after the existing ones, so an import never interleaves
  -- with pages somebody is working on.
  ----------------------------------------------------------------
  select coalesce(max(p.ordinal), -1) + 1 into next_ordinal
  from public.pages p
  where p.document_id = p_document_id;

  for page in select value from jsonb_array_elements(p_pages)
  loop
    -- A page id is a primary key across every workspace, so it is always minted
    -- here rather than trusted from the file.
    page_id := 'page_' || floor(extract(epoch from now()) * 1000)::text
               || '_' || substr(md5(random()::text), 1, 6);

    card_map := coalesce((
      select jsonb_object_agg(
        coalesce(c.value ->> 'id', ''),
        'card_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'cards', '[]'::jsonb)) c(value)
    ), '{}'::jsonb);

    group_map := coalesce((
      select jsonb_object_agg(
        coalesce(g.value ->> 'id', ''),
        'group_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb)) g(value)
    ), '{}'::jsonb);

    conn_map := coalesce((
      select jsonb_object_agg(
        coalesce(x.value ->> 'id', ''),
        'connection_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'connections', '[]'::jsonb)) x(value)
    ), '{}'::jsonb);

    ----------------------------------------------------------------
    -- Cards: new id, and a new parentId looked up in the same map. Order is
    -- preserved so the canvas draws them in the same sequence.
    --
    -- Only the reference fields are touched. An earlier draft rewrote ids by
    -- casting each array to text and running `replace()` over it, which is
    -- short and wrong: ids are opaque strings that also appear in places they
    -- are not references — most obviously inside a card's Markdown body, which
    -- `replace()` would silently corrupt.
    ----------------------------------------------------------------
    new_cards := coalesce((
      select jsonb_agg(
        c.value || jsonb_build_object(
          'id', coalesce(card_map ->> (c.value ->> 'id'), c.value ->> 'id'),
          'parentId', case
            when c.value -> 'parentId' is null
              or jsonb_typeof(c.value -> 'parentId') = 'null'
              then null
            else coalesce(card_map ->> (c.value ->> 'parentId'), c.value ->> 'parentId')
          end
        )
        order by c.ord
      )
      from jsonb_array_elements(coalesce(page -> 'cards', '[]'::jsonb))
           with ordinality as c(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Groups: new id, and both membership lists re-pointed. A member that is not
    -- on the page is dropped rather than left pointing at a card that is not
    -- here — the client would drop it on read anyway, and filtering keeps the
    -- stored row honest.
    --
    -- `m` is the table alias, so `m` alone is a row and `m.id` is the value.
    -- Writing `->> m` is a `jsonb ->> record`, which Postgres rejects.
    ----------------------------------------------------------------
    new_groups := coalesce((
      select jsonb_agg(
        g.value || jsonb_build_object(
          'id', coalesce(group_map ->> (g.value ->> 'id'), g.value ->> 'id'),
          'memberCardIds', coalesce((
            select jsonb_agg(coalesce(card_map ->> m.id, m.id) order by m.ord)
            from jsonb_array_elements_text(
              coalesce(g.value -> 'memberCardIds', '[]'::jsonb)
            ) with ordinality as m(id, ord)
            where card_map ? m.id
          ), '[]'::jsonb),
          'memberGroupIds', coalesce((
            select jsonb_agg(coalesce(group_map ->> m.id, m.id) order by m.ord)
            from jsonb_array_elements_text(
              coalesce(g.value -> 'memberGroupIds', '[]'::jsonb)
            ) with ordinality as m(id, ord)
            where group_map ? m.id
          ), '[]'::jsonb)
        )
        order by g.ord
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb))
           with ordinality as g(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Connections: new id, and each endpoint re-pointed through the map for
    -- whichever kind it names. A connection to something absent is dropped,
    -- because an arrow to nothing is not a link.
    ----------------------------------------------------------------
    new_connections := coalesce((
      select jsonb_agg(
        x.value || jsonb_build_object(
          'id', coalesce(conn_map ->> (x.value ->> 'id'), x.value ->> 'id'),
          'source', (x.value -> 'source') || jsonb_build_object(
            'id', coalesce(
              case when x.value -> 'source' ->> 'kind' = 'group'
                then group_map ->> (x.value -> 'source' ->> 'id')
                else card_map ->> (x.value -> 'source' ->> 'id')
              end,
              x.value -> 'source' ->> 'id'
            )
          ),
          'target', (x.value -> 'target') || jsonb_build_object(
            'id', coalesce(
              case when x.value -> 'target' ->> 'kind' = 'group'
                then group_map ->> (x.value -> 'target' ->> 'id')
                else card_map ->> (x.value -> 'target' ->> 'id')
              end,
              x.value -> 'target' ->> 'id'
            )
          )
        )
        order by x.ord
      )
      from jsonb_array_elements(coalesce(page -> 'connections', '[]'::jsonb))
           with ordinality as x(value, ord)
      where (case when x.value -> 'source' ->> 'kind' = 'group'
                   then group_map ? (x.value -> 'source' ->> 'id')
                   else card_map ? (x.value -> 'source' ->> 'id') end)
        and (case when x.value -> 'target' ->> 'kind' = 'group'
                    then group_map ? (x.value -> 'target' ->> 'id')
                    else card_map ? (x.value -> 'target' ->> 'id') end)
    ), '[]'::jsonb);

    insert into public.pages (
      id, document_id, title, ordinal, position, viewport,
      cards, groups, connections, version
    )
    values (
      page_id,
      p_document_id,
      coalesce(nullif(page ->> 'title', ''), 'Imported page'),
      next_ordinal,
      coalesce(page -> 'position', '{"x":0,"y":0,"width":1920,"height":1080,"zIndex":0}'::jsonb),
      coalesce(page -> 'viewport', '{"x":0,"y":0,"zoom":1}'::jsonb),
      new_cards,
      new_groups,
      new_connections,
      0
    );

    next_ordinal := next_ordinal + 1;
    inserted := inserted || jsonb_build_object(
      'id', page_id,
      'title', coalesce(nullif(page ->> 'title', ''), 'Imported page')
    );
  end loop;

  return inserted;
end;
$$;

grant execute on function public.import_pages(text, jsonb) to authenticated;

-- ----------------------------------------------------------------
-- A welcome workspace for every account
-- ----------------------------------------------------------------
-- Created by the database, not the client, so it exists no matter which entry
-- point made the account. Two pages, and between them they use every part of
-- the data model: groups, a card inside a group, links between groups and cards,
-- every relationship, all three strokes, all three routings, several arrowheads,
-- and checklists.
--
-- A first version was five cards in a row, which demonstrated that cards exist
-- and nothing else — somebody reading it could not tell that grouping, page
-- lists or connection styling were features rather than accidents.
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

  insert into public.documents (owner_id, title, accent, icon)
  values (p_user_id, 'tutorial', 'violet', 'graduation-cap')
  returning id into new_document_id;

  -- trg_create_default_page has already made the first page by now.
  select id into first_page_id
  from public.pages
  where document_id = new_document_id
  order by ordinal
  limit 1;

  update public.pages
  set title = 'Start here',
      cards = tutorial_page_one() -> 'cards',
      groups = tutorial_page_one() -> 'groups',
      connections = tutorial_page_one() -> 'connections',
      viewport = '{"x":-60,"y":-40,"zoom":0.8}'::jsonb
  where id = first_page_id;

  insert into public.pages (
    id, document_id, title, ordinal, position, viewport, cards, groups, connections
  )
  values (
    'page_tutorial_maps',
    new_document_id,
    'Making maps',
    1,
    '{"x":0,"y":0,"width":1920,"height":1080,"zIndex":0}'::jsonb,
    '{"x":-40,"y":-40,"zoom":0.8}'::jsonb,
    tutorial_page_two() -> 'cards',
    tutorial_page_two() -> 'groups',
    tutorial_page_two() -> 'connections'
  );

  return new_document_id;
end;
$$;

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

-- Accounts that already exist and have no workspace at all.
do $$
declare
  u record;
begin
  for u in
    select a.id from auth.users a
    where not exists (select 1 from public.documents d where d.owner_id = a.id)
  loop
    perform public.create_tutorial_workspace(u.id);
  end loop;
end;
$$;

-- ----------------------------------------------------------------
-- Admin repairs
-- ----------------------------------------------------------------
-- How many accounts would change if they were re-derived. A diagnostic, so you
-- can look before changing anything.
create or replace function public.profiles_needing_resync()
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
     or exists (
       select 1 from public.profiles p
       where p.id = u.id
         and (p.full_name is null or p.avatar_url is null)
     );
$$;

-- Re-derive every profile. Returns how many it touched. Safe to run whenever.
create or replace function public.resync_all_profiles()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  select count(*) into n from auth.users;
  perform public.sync_profile_for(id) from auth.users;
  return n;
end;
$$;

grant execute on function public.profiles_needing_resync() to service_role;
grant execute on function public.resync_all_profiles() to service_role;
