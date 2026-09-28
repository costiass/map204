-- 012 · Import pages in one round trip, atomically, additively
--
-- ----------------------------------------------------------------
-- What this replaces
-- ----------------------------------------------------------------
-- The import used to be driven entirely from the browser:
--
--   for each page:  POST /rest/v1/pages
--   then:           DELETE /rest/v1/pages?id=eq.…   (the pages being replaced)
--   then:           GET  /rest/v1/pages             (read it back)
--
-- That is N + N + 1 requests, and it is **not atomic**. If the fourth insert
-- failed, the workspace was left holding three new pages *and* all of the old
-- ones, with no record of which state was intended. The client could only report
-- "something went wrong" and leave the user to work out what they now had.
--
-- The client also had to do the work: parse the file, renumber every id, hold
-- the whole document in memory, and reconcile the result. More code in the
-- client than the task needs.
--
-- ----------------------------------------------------------------
-- What this does instead
-- ----------------------------------------------------------------
-- One call, one transaction, one outcome:
--
--   select public.import_pages('<document id>', '[…]'::jsonb);
--
-- Postgres inserts the pages or it does not. A failure leaves the workspace
-- exactly as it was — the property the old version lacked.
--
-- ----------------------------------------------------------------
-- Additive by design: pages are added, never overwritten
-- ----------------------------------------------------------------
-- There is no "replace this workspace" any more. Every page in the file becomes
-- a new page in the workspace, and nothing already there is touched. That makes
-- import safe to run twice, safe to run over somebody else's work, and
-- impossible to get wrong by picking the wrong option — a destructive import is
-- a class of bug this no longer has.
--
-- ----------------------------------------------------------------
-- Permissions
-- ----------------------------------------------------------------
-- This function is `security definer`, so it bypasses RLS. The check inside it is
-- therefore the *only* thing between a signed-in user and a write to a workspace
-- they do not hold, so it is explicit and raises rather than inserting nothing.
-- Getting it wrong would hand every account a way to write into any workspace,
-- so it is the first statement and uses the same helper the policies use.
--
-- ----------------------------------------------------------------
-- On rewriting the ids
-- ----------------------------------------------------------------
-- Every id is re-issued here, and so is every reference to one:
--
--   cards[].id, cards[].parentId
--   groups[].id, groups[].memberCardIds, groups[].memberGroupIds
--   connections[].id, connections[].source.id, connections[].target.id
--
-- An earlier draft did this by casting each array to text, running `replace()`
-- over the old id, and casting back. That is short and it is wrong: the ids are
-- opaque strings that also appear in places they are not references — most
-- obviously inside a card's Markdown body, which `replace()` would rewrite and
-- silently corrupt. A card id is also not guaranteed to be free of being a
-- substring of another, so one rewrite could truncate another.
--
-- So each array is rebuilt field by field, touching the reference fields and
-- nothing else. Every other key — content, style, position, tags — is copied
-- through untouched, which is what "reproduce the document" requires.

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
  actor uuid := auth.uid();
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
  -- Permission. Not optional: the definer rights that let this insert at all
  -- are exactly what would make an unchecked version an open door.
  ----------------------------------------------------------------
  if actor is null then
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
  -- Imported pages land *after* the existing ones, so an import never
  -- interleaves with pages somebody is working on.
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
      select jsonb_object_agg(coalesce(c.value ->> 'id', ''), 'card_' || substr(md5(random()::text), 1, 10))
      from jsonb_array_elements(coalesce(page -> 'cards', '[]'::jsonb)) c(value)
    ), '{}'::jsonb);

    group_map := coalesce((
      select jsonb_object_agg(coalesce(g.value ->> 'id', ''), 'group_' || substr(md5(random()::text), 1, 10))
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb)) g(value)
    ), '{}'::jsonb);

    conn_map := coalesce((
      select jsonb_object_agg(coalesce(x.value ->> 'id', ''), 'connection_' || substr(md5(random()::text), 1, 10))
      from jsonb_array_elements(coalesce(page -> 'connections', '[]'::jsonb)) x(value)
    ), '{}'::jsonb);

    ----------------------------------------------------------------
    -- Cards: new id, and a new parentId that is looked up in the same map.
    -- Order is preserved so the canvas draws them in the same sequence.
    ----------------------------------------------------------------
    new_cards := coalesce((
      select jsonb_agg(
        c.value || jsonb_build_object(
          'id', coalesce(card_map ->> (c.value ->> 'id'), c.value ->> 'id'),
          'parentId', case
            when c.value -> 'parentId' is null or jsonb_typeof(c.value -> 'parentId') = 'null'
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
    -- in the page is dropped rather than left pointing at a card that is not
    -- here — the client would drop it on read anyway, and an explicit filter
    -- keeps the stored row honest.
    ----------------------------------------------------------------
    new_groups := coalesce((
      select jsonb_agg(
        g.value || jsonb_build_object(
          'id', coalesce(group_map ->> (g.value ->> 'id'), g.value ->> 'id'),
          'memberCardIds', coalesce((
            select jsonb_agg(coalesce(card_map ->> m, m) order by m.ord)
            from jsonb_array_elements_text(
              coalesce(g.value -> 'memberCardIds', '[]'::jsonb)
            ) with ordinality as m(id, ord)
            where card_map ? m.id
          ), '[]'::jsonb),
          'memberGroupIds', coalesce((
            select jsonb_agg(coalesce(group_map ->> m, m) order by m.ord)
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
    -- whichever kind it names. A connection to something that is not on the
    -- page is dropped, because an arrow to nothing is not a link.
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
      where (
        case when x.value -> 'source' ->> 'kind' = 'group'
          then group_map ? (x.value -> 'source' ->> 'id')
          else card_map ? (x.value -> 'source' ->> 'id')
        end
      ) and (
        case when x.value -> 'target' ->> 'kind' = 'group'
          then group_map ? (x.value -> 'target' ->> 'id')
          else card_map ? (x.value -> 'target' ->> 'id')
        end
      )
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
