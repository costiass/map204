-- Migration 008: Sharing — profiles, collaborator write access, access helpers

-- ============================================================
-- profiles: a public-facing mirror of auth.users
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can view profiles of people they share a document with"
  ON profiles FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM document_collaborators mine
      JOIN document_collaborators theirs
        ON theirs.document_id = mine.document_id
      WHERE mine.user_id = auth.uid() AND theirs.user_id = profiles.id
    )
  );

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION sync_profile_from_auth()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture')
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        avatar_url = EXCLUDED.avatar_url,
        updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_profile ON auth.users;
CREATE TRIGGER trg_sync_profile
  AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_profile_from_auth();

-- Backfill existing users.
INSERT INTO profiles (id, email, full_name, avatar_url)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
  COALESCE(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
FROM auth.users u
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      avatar_url = EXCLUDED.avatar_url;

-- ============================================================
-- Email lookup for the share dialog (exact match, no enumeration)
-- ============================================================
CREATE OR REPLACE FUNCTION find_profile_by_email(p_email text)
RETURNS TABLE (id text, email text, full_name text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.id, p.email, p.full_name, p.avatar_url
  FROM profiles p
  WHERE lower(p.email) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION find_profile_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_profile_by_email(text) TO authenticated;

-- ============================================================
-- Access helpers
-- ============================================================
-- can_view_document / can_edit_document / can_view_page / can_edit_page were
-- introduced in 20260921091500_fix_rls_recursion.sql, at the first migration
-- that needs them, so that no partial push can leave the database in a state
-- where its policies recurse. They are reused here, not redefined.

-- ============================================================
-- Collaborators can edit the documents shared with them
-- ============================================================
DROP POLICY IF EXISTS "Collaborators can update shared documents" ON documents;
CREATE POLICY "Collaborators can update shared documents"
  ON documents FOR UPDATE
  USING (can_edit_document(documents.id));

DROP POLICY IF EXISTS "Collaborators can insert pages in shared documents" ON pages;
CREATE POLICY "Collaborators can insert pages in shared documents"
  ON pages FOR INSERT
  -- A brand new page has no id yet, so this asks about the document instead.
  WITH CHECK (can_edit_document(pages.document_id));

DROP POLICY IF EXISTS "Collaborators can update pages in shared documents" ON pages;
CREATE POLICY "Collaborators can update pages in shared documents"
  ON pages FOR UPDATE
  USING (can_edit_page(pages.id));

DROP POLICY IF EXISTS "Collaborators can delete pages in shared documents" ON pages;
CREATE POLICY "Collaborators can delete pages in shared documents"
  ON pages FOR DELETE
  USING (can_edit_page(pages.id));

-- Collaborators can read the collaborator list of documents shared with them.
DROP POLICY IF EXISTS "Collaborators can view collaborator lists" ON document_collaborators;
CREATE POLICY "Collaborators can view collaborator lists"
  ON document_collaborators FOR SELECT
  USING (
    can_view_document(document_collaborators.document_id)
  );

-- `role` may only ever be one of the three the app offers.
ALTER TABLE document_collaborators
  DROP CONSTRAINT IF EXISTS document_collaborators_role_check;
ALTER TABLE document_collaborators
  ADD CONSTRAINT document_collaborators_role_check CHECK (role in ('owner', 'editor', 'viewer'));

-- A document's real owner is `documents.owner_id`; a second 'owner' row would
-- make the share dialog lie about who can delete things.
DROP FUNCTION IF EXISTS add_document_owner_collaborator(text, text);
CREATE FUNCTION add_document_owner_collaborator(p_document_id text, p_user_id text)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO document_collaborators (document_id, user_id, role)
  VALUES (p_document_id, p_user_id, 'owner')
  ON CONFLICT (document_id, user_id) DO UPDATE SET role = 'owner';
$$;

REVOKE ALL ON FUNCTION add_document_owner_collaborator(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_document_owner_collaborator(text, text) TO service_role;

