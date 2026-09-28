-- Fix ID types and enable Realtime properly

-- 1. Ensure all IDs are TEXT (matching app-generated IDs like 'page_...')
ALTER TABLE IF EXISTS pages ALTER COLUMN id TYPE TEXT;
ALTER TABLE IF EXISTS pages ALTER COLUMN document_id TYPE TEXT;
ALTER TABLE IF EXISTS documents ALTER COLUMN id TYPE TEXT;
ALTER TABLE IF EXISTS documents ALTER COLUMN owner_id TYPE TEXT;
ALTER TABLE IF EXISTS document_collaborators ALTER COLUMN document_id TYPE TEXT;
ALTER TABLE IF EXISTS document_collaborators ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE IF EXISTS user_settings ALTER COLUMN user_id TYPE TEXT;

-- 2. Ensure pages table has version column for conflict resolution
ALTER TABLE IF EXISTS pages ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 0;

-- 3. Enable Realtime for all required tables (idempotent — 009 repeats this)
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

-- 4. Drop the policies that recurse (003/008 recreate them properly)
DROP POLICY IF EXISTS "Collaborators can view shared documents" ON documents;
DROP POLICY IF EXISTS "Users can view own documents" ON documents;
DROP POLICY IF EXISTS "Users can create documents" ON documents;
DROP POLICY IF EXISTS "Owners can update documents" ON documents;
DROP POLICY IF EXISTS "Owners can delete documents" ON documents;
DROP POLICY IF EXISTS "Users can view pages in own documents" ON pages;
DROP POLICY IF EXISTS "Collaborators can view pages in shared documents" ON pages;
DROP POLICY IF EXISTS "Users can insert pages in own documents" ON pages;
DROP POLICY IF EXISTS "Users can update pages in own documents" ON pages;
DROP POLICY IF EXISTS "Users can delete pages in own documents" ON pages;
DROP POLICY IF EXISTS "Owners can manage collaborators" ON document_collaborators;
DROP POLICY IF EXISTS "Users can view collaborators on shared documents" ON document_collaborators;

-- documents: the owner of a document can do anything with it
CREATE POLICY "Owners can view own documents" ON documents FOR SELECT USING (owner_id = auth.uid()::text);
CREATE POLICY "Owners can insert documents" ON documents FOR INSERT WITH CHECK (owner_id = auth.uid()::text);
CREATE POLICY "Owners can update documents" ON documents FOR UPDATE USING (owner_id = auth.uid()::text);
CREATE POLICY "Owners can delete documents" ON documents FOR DELETE USING (owner_id = auth.uid()::text);

-- pages: reach the document through it, never the other way round
CREATE POLICY "Owners can view pages in own documents" ON pages FOR SELECT USING (
  EXISTS (SELECT 1 FROM documents WHERE documents.id = pages.document_id AND documents.owner_id = auth.uid()::text)
);
CREATE POLICY "Owners can insert pages in own documents" ON pages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM documents WHERE documents.id = pages.document_id AND documents.owner_id = auth.uid()::text)
);
CREATE POLICY "Owners can update pages in own documents" ON pages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM documents WHERE documents.id = pages.document_id AND documents.owner_id = auth.uid()::text)
);
CREATE POLICY "Owners can delete pages in own documents" ON pages FOR DELETE USING (
  EXISTS (SELECT 1 FROM documents WHERE documents.id = pages.document_id AND documents.owner_id = auth.uid()::text)
);

-- user_settings
CREATE POLICY "Users can view own settings" ON user_settings FOR SELECT USING (user_id = auth.uid()::text);
CREATE POLICY "Users can insert own settings" ON user_settings FOR INSERT WITH CHECK (user_id = auth.uid()::text);
CREATE POLICY "Users can update own settings" ON user_settings FOR UPDATE USING (user_id = auth.uid()::text);