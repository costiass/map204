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

-- 3. Enable Realtime for all required tables
ALTER PUBLICATION supabase_realtime ADD TABLE documents;
ALTER PUBLICATION supabase_realtime ADD TABLE pages;
ALTER PUBLICATION supabase_realtime ADD TABLE user_settings;

-- 4. Fix RLS policies - remove recursion, allow proper access
-- Drop problematic policies
DROP POLICY IF EXISTS "Collaborators can view shared documents" ON documents;
DROP POLICY IF EXISTS "Owners can manage collaborators" ON document_collaborators;
DROP POLICY IF EXISTS "Users can view collaborators on shared documents" ON document_collaborators;

-- documents policies
CREATE POLICY "Owners can view own documents" ON documents FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "Collaborators can view shared documents" ON documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM document_collaborators WHERE document_id = documents.id AND user_id = auth.uid())
);
CREATE POLICY "Owners can insert documents" ON documents FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners can update documents" ON documents FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "Owners can delete documents" ON documents FOR DELETE USING (owner_id = auth.uid());

-- pages policies
CREATE POLICY "Users can view pages in own documents" ON pages FOR SELECT USING (
  EXISTS (SELECT 1 FROM documents WHERE documents.id = pages.document_id AND documents.owner_id = auth.uid())
);
CREATE POLICY "Collaborators can view pages in shared documents" ON pages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM documents
    JOIN document_collaborators dc ON dc.document_id = documents.id
    WHERE documents.id = pages.document_id AND dc.user_id = auth.uid()
  )
);
CREATE POLICY "Users can insert pages in own documents" ON pages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM documents WHERE documents.id = pages.document_id AND documents.owner_id = auth.uid())
);
CREATE POLICY "Users can update pages in own documents" ON pages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM documents WHERE documents.id = pages.document_id AND documents.owner_id = auth.uid())
);
CREATE POLICY "Users can delete pages in own documents" ON pages FOR DELETE USING (
  EXISTS (SELECT 1 FROM documents WHERE documents.id = pages.document_id AND documents.owner_id = auth.uid())
);

-- document_collaborators policies (no recursion)
CREATE POLICY "Users can view own collaborator rows" ON document_collaborators FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Owners can manage collaborators" ON document_collaborators FOR ALL USING (
  EXISTS (SELECT 1 FROM documents WHERE documents.id = document_collaborators.document_id AND documents.owner_id = auth.uid())
);

-- user_settings policies
CREATE POLICY "Users can view own settings" ON user_settings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own settings" ON user_settings FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own settings" ON user_settings FOR UPDATE USING (user_id = auth.uid());