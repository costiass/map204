-- Un-break `import_pages`, which a previous migration overloaded.
--
-- Migration 7 taught this function to read a version 2 document, and did it by
-- changing the type of its first parameter from `text` to `uuid`. That was
-- wrong in a way nothing caught at the time. A function's identity is its whole
-- signature, so `create or replace` did not replace anything - it created a
-- *second* `import_pages`, and the original `(text, jsonb)` from migration 5
-- stayed exactly where it was.
--
-- PostgREST looks up an RPC by name and refuses to guess when a name is
-- overloaded. So importing a document stopped working outright:
--
--   PGRST203 Could not choose the best candidate function between:
--     public.import_pages(p_document_id => text,  p_pages => jsonb),
--     public.import_pages(p_document_id => uuid,  p_pages => jsonb)
--
-- Note what is not in that message: neither version was broken. The version 2
-- reader was correct and the original was correct; having both was the fault.
--
-- So this drops the `uuid` overload and restates the version 2 reader under the
-- `text` signature it was always meant to have. `text` is the type of
-- `pages.document_id` and the type `can_edit_document` takes, so it was never
-- a question of which was right.
--
-- The body below is migration 7's, unchanged, because that body was correct.
-- The one lesson worth writing down: a migration that alters a function's
-- parameter *type* is not a migration that alters that function. It is a
-- migration that adds one.

drop function if exists public.import_pages(uuid, jsonb);

-- Teach `import_pages` to read a version 2 document.
--
-- The import path was broken and broke silently, which is the worst way: the
-- function read its page contents from `page -> 'cards'`, and the client had
-- been sending `page -> 'elements'` since the element migration. `coalesce` with
-- a missing key yields an empty array, so every page imported **successfully and
-- empty**. No error, no warning, just a workspace full of blank pages and a
-- file that appeared to work.
--
-- This is a forward migration rather than an edit, because the rule is that an
-- applied migration is never rewritten — a database that has run the old file
-- must reach the same state as a fresh one, and editing history breaks that.
-- The database is being reset for version 2 anyway; this exists so the reset is
-- not the *first* time this is fixed.
--
-- What changes, and what deliberately does not:
--
--   * Elements are read from `elements`, falling back to `cards`. Both work, so
--     an old file and a new one take the same path.
--   * The id remapping, the ordering, the drop-dangling-connections rule and the
--     single-transaction guarantee are untouched. Those were right.
--   * `parentId` is gone, and so is the branch that remapped it. It was the only
--     reference field on an element that was not a group membership, and groups
--     carry that.
--   * The stored column is still `cards`. The client reads it under that name and
--     the value is a list of elements; the column is renamed in the same reset
--     that renames the model.
--
-- An element's `id` is remapped exactly as a card's was, and only the reference
-- fields are touched. An earlier draft rewrote ids by casting the array to text
-- and running `replace()` over it, which corrupts any id that also appears in
-- prose — a card's Markdown body being the obvious one.

create or replace function public.import_pages(
  p_document_id text,
  p_pages       jsonb
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
  -- The page's elements, under whichever name the file used.
  src_elements jsonb;
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

  select coalesce(max(ordinal) + 1, 0)
  into next_ordinal
  from public.pages p
  where p.document_id = p_document_id;

  for page in select value from jsonb_array_elements(p_pages)
  loop
    -- A page id is a primary key across every workspace, so it is always minted
    -- here rather than trusted from the file.
    page_id := 'page_' || floor(extract(epoch from now()) * 1000)::text
               || '_' || substr(md5(random()::text), 1, 6);

    -- The contents, under either name. A version 1 file says `cards`; a version
    -- 2 file says `elements`. Reading one and not the other is what made every
    -- import blank.
    src_elements := coalesce(
      case when jsonb_typeof(page -> 'elements') = 'array' then page -> 'elements' end,
      case when jsonb_typeof(page -> 'cards') = 'array' then page -> 'cards' end,
      '[]'::jsonb
    );

    card_map := coalesce((
      select jsonb_object_agg(
        coalesce(c.value ->> 'id', ''),
        'card_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(src_elements) c(value)
      where c.value ->> 'id' is not null
    ), '{}'::jsonb);

    group_map := coalesce((
      select jsonb_object_agg(
        coalesce(g.value ->> 'id', ''),
        'group_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb)) g(value)
      where g.value ->> 'id' is not null
    ), '{}'::jsonb);

    conn_map := coalesce((
      select jsonb_object_agg(
        coalesce(x.value ->> 'id', ''),
        'connection_' || substr(md5(random()::text), 1, 10)
      )
      from jsonb_array_elements(coalesce(page -> 'connections', '[]'::jsonb)) x(value)
      where x.value ->> 'id' is not null
    ), '{}'::jsonb);

    ----------------------------------------------------------------
    -- Elements: a new id, nothing else.
    --
    -- The only reference an element carries is the group it is a member of, and
    -- that is rewritten below with the group. `parentId` was the other one and it
    -- is gone from the model, so there is nothing to remap here — which is the
    -- whole reason this block got shorter.
    --
    -- Order is preserved so the canvas draws them in the same sequence.
    ----------------------------------------------------------------
    new_cards := coalesce((
      select jsonb_agg(
        c.value || jsonb_build_object(
          'id', coalesce(card_map ->> (c.value ->> 'id'), c.value ->> 'id')
        )
        order by c.ord
      )
      from jsonb_array_elements(src_elements)
           with ordinality as c(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Groups: a new id, and the membership list re-pointed. A member that is not
    -- on the page is dropped rather than left pointing at an element that is not
    -- here — the client would drop it on read anyway, and filtering keeps the
    -- stored row honest.
    --
    -- `memberGroupIds` is read and dropped. A group can no longer contain a group,
    -- and keeping a field the model does not have would make the stored row
    -- disagree with the document it claims to be.
    --
    -- `m` is the table alias, so `m` alone is a row and `m.id` is the value.
    -- Writing `->> m` is a `jsonb ->> record`, which Postgres rejects.
    ----------------------------------------------------------------
    new_groups := coalesce((
      select jsonb_agg(
        g.value
        || jsonb_build_object(
          'id', coalesce(group_map ->> (g.value ->> 'id'), g.value ->> 'id'),
          'memberIds', coalesce((
            select jsonb_agg(coalesce(card_map ->> m.id, m.id) order by m.ord)
            from jsonb_array_elements_text(
              coalesce(
                -- Version 2 names it `memberIds`; version 1 named it
                -- `memberCardIds`. Both are read, because an old file is exactly
                -- what people have.
                case when jsonb_typeof(g.value -> 'memberIds') = 'array'
                  then g.value -> 'memberIds' end,
                case when jsonb_typeof(g.value -> 'memberCardIds') = 'array'
                  then g.value -> 'memberCardIds' end,
                '[]'::jsonb
              )
            ) with ordinality as m(id, ord)
            where card_map ? m.id
          ), '[]'::jsonb)
        )
        - 'memberCardIds'
        - 'memberGroupIds'
        - 'parentId'
        order by g.ord
      )
      from jsonb_array_elements(coalesce(page -> 'groups', '[]'::jsonb))
           with ordinality as g(value, ord)
    ), '[]'::jsonb);

    ----------------------------------------------------------------
    -- Connections: a new id, and each endpoint re-pointed through the map for
    -- whichever kind it names. A connection to something absent is dropped,
    -- because an arrow to nothing is not a link.
    --
    -- The endpoint discriminator is `element` in version 2 and `card` in
    -- version 1. Anything that is not `group` is an element, so both spellings
    -- resolve the same way without needing the list written out twice.
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

    inserted := inserted || jsonb_build_array(
      jsonb_build_object(
        'id', page_id,
        'title', coalesce(nullif(page ->> 'title', ''), 'Imported page'),
        'ordinal', next_ordinal
      )
    );
    next_ordinal := next_ordinal + 1;
  end loop;

  return inserted;
end;
$$;

-- The signature did not change, but a `create or replace` on a function whose
-- return type moved needs the grant re-stated or the function comes back with
-- the default privileges, which for a `security definer` function is nobody.
grant execute on function public.import_pages(text, jsonb) to authenticated;
