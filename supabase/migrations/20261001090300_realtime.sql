-- 004 · Realtime
--
-- The collaboration channels are private, which means Supabase routes every
-- message through `realtime.messages` and the policies below decide who may
-- listen on `page:<pageId>` and who may publish to it. Without them, anybody
-- holding the public anon key could subscribe to somebody else's page.
--
--   page:<pageId>      page content sync  (broadcast + presence)
--   document:<docId>   who is in the workspace (presence)

-- ----------------------------------------------------------------
-- The tables the client listens to
-- ----------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['documents', 'pages', 'user_settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------
-- Read the page id out of the topic
-- ----------------------------------------------------------------
-- A channel's topic arrives as `realtime:page:<pageId>`.
create or replace function public.realtime_page_id()
returns text
language sql
stable
as $$
  select (regexp_match(realtime.topic(), 'page:([^:]+)$'))[1];
$$;

create or replace function public.realtime_document_id()
returns text
language sql
stable
as $$
  select (regexp_match(realtime.topic(), 'document:([^:]+)$'))[1];
$$;

grant execute on function public.realtime_page_id() to authenticated;
grant execute on function public.realtime_document_id() to authenticated;

grant select, insert on realtime.messages to authenticated;

-- ----------------------------------------------------------------
-- Listening: anyone who can already see it through REST
-- ----------------------------------------------------------------
create policy "can receive page broadcasts"
  on realtime.messages for select to authenticated
  using (
    public.realtime_page_id() is not null
    and public.can_view_page(public.realtime_page_id())
  );

create policy "can receive document presence"
  on realtime.messages for select to authenticated
  using (
    public.realtime_document_id() is not null
    and public.can_view_document(public.realtime_document_id())
  );

-- ----------------------------------------------------------------
-- Publishing: editors only, so a viewer cannot push a change
-- ----------------------------------------------------------------
create policy "can publish page broadcasts"
  on realtime.messages for insert to authenticated
  with check (
    public.realtime_page_id() is not null
    and public.can_edit_page(public.realtime_page_id())
  );

create policy "can publish document presence"
  on realtime.messages for insert to authenticated
  with check (
    public.realtime_document_id() is not null
    and public.can_edit_document(public.realtime_document_id())
  );
