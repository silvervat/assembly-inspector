-- ============================================
-- ADD ISSUES PERMISSIONS TO TRIMBLE_EX_USERS
-- v3.0.481
-- ============================================

-- Add issues permissions columns to trimble_ex_users table
ALTER TABLE trimble_ex_users
ADD COLUMN IF NOT EXISTS can_view_issues BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS can_edit_issues BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS can_delete_issues BOOLEAN DEFAULT false;

-- Update existing users - give view and edit permissions to everyone
UPDATE trimble_ex_users
SET
  can_view_issues = true,
  can_edit_issues = true,
  can_delete_issues = CASE WHEN role = 'admin' THEN true ELSE false END
WHERE can_view_issues IS NULL;

COMMENT ON COLUMN trimble_ex_users.can_view_issues IS 'Võib vaadata probleeme';
COMMENT ON COLUMN trimble_ex_users.can_edit_issues IS 'Võib lisada ja muuta probleeme';
COMMENT ON COLUMN trimble_ex_users.can_delete_issues IS 'Võib kustutada probleeme';
