-- Migration 006: Enforce business rules
-- 0. Page shape fixes: `position` is a JSON rect, `ordinal` orders the page list
-- 1. Auto-create a default page when a document is created
-- 2. Prevent deleting the last page of a document
-- 3. Keep `documents.updated_at` and `pages.updated_at` fresh

-- ============================================================
-- 0. Column shape
-- ============================================================
-- `position` holds the page rect ({ x, y, width, height, zIndex }) as JSON,
-- matching the Page payload sent by the app.
ALTER TABLE pages ALTER COLUMN position TYPE jsonb USING to_jsonb(position);
ALTER TABLE pages ALTER COLUMN position SET DEFAULT '{"x":0,"y":0,"width":1920,"height":1080,"zIndex":0}'::jsonb;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0;

-- Document-wide defaults (default card/link style) travel with the document.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- Trigger: Auto-create default page on document insert
-- ============================================================
-- SECURITY DEFINER so the insert is not re-checked against the caller's RLS
-- policies: the page belongs to the document being created, by definition.
CREATE OR REPLACE FUNCTION create_default_page_on_document_insert()
RETURNS TRIGGER AS $$
DECLARE
  new_page_id TEXT;
  next_ordinal INTEGER;
BEGIN
  new_page_id := 'page_' || floor(extract(epoch from now()) * 1000)::TEXT || '_' || substr(md5(random()::TEXT), 1, 6);

  SELECT COALESCE(MAX(ordinal), -1) + 1 INTO next_ordinal FROM pages WHERE document_id = NEW.id;

  INSERT INTO pages (id, document_id, title, position, viewport, cards, groups, connections, version, ordinal)
  VALUES (
    new_page_id,
    NEW.id,
    'Untitled Page',
    '{"x": 0, "y": 0, "width": 1920, "height": 1080, "zIndex": 0}'::jsonb,
    '{"x": 0, "y": 0, "zoom": 1}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    0,
    next_ordinal
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

DROP TRIGGER IF EXISTS trg_create_default_page ON documents;
CREATE TRIGGER trg_create_default_page
  AFTER INSERT ON documents
  FOR EACH ROW
  EXECUTE FUNCTION create_default_page_on_document_insert();

-- ============================================================
-- Trigger: Prevent deleting the last page of a document
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_deleting_last_page()
RETURNS TRIGGER AS $$
DECLARE
  page_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO page_count
  FROM pages
  WHERE document_id = OLD.document_id
    AND id <> OLD.id;

  IF page_count = 0 THEN
    RAISE EXCEPTION 'Cannot delete the last page of a document. Documents must have at least one page.';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_last_page_delete ON pages;
CREATE TRIGGER trg_prevent_last_page_delete
  BEFORE DELETE ON pages
  FOR EACH ROW
  EXECUTE FUNCTION prevent_deleting_last_page();

-- ============================================================
-- Index: Faster lookups by document_id
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pages_document_id ON pages(document_id);
CREATE INDEX IF NOT EXISTS idx_pages_document_ordinal ON pages(document_id, ordinal);

-- ============================================================
-- Trigger: keep updated_at fresh
-- ============================================================
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_touch ON documents;
CREATE TRIGGER trg_documents_touch
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_pages_touch ON pages;
CREATE TRIGGER trg_pages_touch
  BEFORE UPDATE ON pages
  FOR EACH ROW
  EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Comments
-- ============================================================
COMMENT ON FUNCTION create_default_page_on_document_insert() IS
  'Auto-creates a default page whenever a new document is inserted';
COMMENT ON FUNCTION prevent_deleting_last_page() IS
  'Prevents deletion of the last page in a document (business rule: doc must have >= 1 page)';
