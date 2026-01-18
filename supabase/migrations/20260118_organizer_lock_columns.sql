-- ============================================
-- ORGANIZER GROUPS LOCK COLUMNS
-- Adds locking support for organizer groups
-- v3.0.650
-- ============================================

-- Add lock columns to organizer_groups table
ALTER TABLE organizer_groups
ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS locked_by TEXT,
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- Add permission columns if missing
ALTER TABLE organizer_groups
ADD COLUMN IF NOT EXISTS default_permissions JSONB DEFAULT '{"can_add": true, "can_delete_own": true, "can_delete_all": false, "can_edit_group": false, "can_manage_fields": false}',
ADD COLUMN IF NOT EXISTS user_permissions JSONB DEFAULT '{}';

-- Create index for locked groups (for quick filtering)
CREATE INDEX IF NOT EXISTS idx_organizer_groups_locked
  ON organizer_groups(is_locked)
  WHERE is_locked = true;

-- Comment
COMMENT ON COLUMN organizer_groups.is_locked IS 'Kas grupp on lukustatud - blokeerib lisamise/muutmise/kustutamise';
COMMENT ON COLUMN organizer_groups.locked_by IS 'Kasutaja email kes lukustas';
COMMENT ON COLUMN organizer_groups.locked_at IS 'Millal lukustati';
