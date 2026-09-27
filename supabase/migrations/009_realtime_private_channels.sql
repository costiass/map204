-- Migration 009: Realtime channels are private and access-checked
--
-- Broadcast channels are private (`config.private = true`), so Supabase routes
-- every message through `realtime.messages` and the policies below decide who
-- may listen on `page:<pageId>` / `document:<docId>` and who may publish.

GRANT SELECT, INSERT ON realtime.messages TO authenticated;

-- `realtime.topic()` looks like `realtime:page:<pageId>`.
CREATE OR REPLACE FUNCTION realtime_page_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT (regexp_match(realtime.topic(), 'page:([^:]+)$'))[1];
$$;

CREATE OR REPLACE FUNCTION realtime_document_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT (regexp_match(realtime.topic(), 'document:([^:]+)$'))[1];
$$;

-- Listening: any user who can see the page / document.
DROP POLICY IF EXISTS "Read page broadcasts" ON realtime.messages;
CREATE POLICY "Read page broadcasts"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime_page_id() IS NOT NULL
    AND can_view_page(realtime_page_id())
  );

DROP POLICY IF EXISTS "Read document presence" ON realtime.messages;
CREATE POLICY "Read document presence"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime_document_id() IS NOT NULL
    AND can_view_document(realtime_document_id())
  );

-- Publishing: editors only.
DROP POLICY IF EXISTS "Publish page broadcasts" ON realtime.messages;
CREATE POLICY "Publish page broadcasts"
  ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (
    realtime_page_id() IS NOT NULL
    AND can_edit_page(realtime_page_id())
  );

DROP POLICY IF EXISTS "Publish document presence" ON realtime.messages;
CREATE POLICY "Publish document presence"
  ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (
    realtime_document_id() IS NOT NULL
    AND can_edit_document(realtime_document_id())
  );

-- Postgres change streams for the tables the canvas mirrors.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents', 'pages', 'user_settings'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END;
$$;
