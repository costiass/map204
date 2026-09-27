-- Migration 007: Auto-create user settings on signup
-- When a user signs up via Supabase Auth (Google OAuth), a user_settings row
-- is automatically created with default values.

-- ============================================================
-- Trigger: Create default settings on new user signup
-- ============================================================
-- SECURITY DEFINER: the row is created for the new user, so the caller's RLS
-- policies (which are about "your own" row) must not stand in the way.
CREATE OR REPLACE FUNCTION create_user_settings_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_settings (user_id, theme, default_snap_to_grid, default_grid_pattern, default_grid_size)
  VALUES (
    NEW.id,
    'light',
    true,
    'dots',
    20
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;

-- Attach trigger to auth.users table
DROP TRIGGER IF EXISTS trg_create_user_settings ON auth.users;
CREATE TRIGGER trg_create_user_settings
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_settings_on_signup();

-- ============================================================
-- Backfill: Create settings for existing users who don't have one
-- ============================================================
INSERT INTO user_settings (user_id, theme, default_snap_to_grid, default_grid_pattern, default_grid_size)
SELECT
  u.id,
  'light',
  true,
  'dots',
  20
FROM auth.users u
LEFT JOIN user_settings s ON s.user_id = u.id
WHERE s.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- Comment for documentation
-- ============================================================
COMMENT ON FUNCTION create_user_settings_on_signup() IS
  'Auto-creates a default user_settings row whenever a new user signs up via Supabase Auth';
