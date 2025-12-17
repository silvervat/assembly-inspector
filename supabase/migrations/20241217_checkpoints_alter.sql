-- ============================================================
-- EOS2 Checkpoint System - ADD MISSING COLUMNS
-- This migration adds columns that don't exist yet
-- Preserves existing EOS2 data
-- ============================================================

-- Helper function to add column if it doesn't exist
CREATE OR REPLACE FUNCTION add_column_if_not_exists(
  p_table_name TEXT,
  p_column_name TEXT,
  p_column_definition TEXT
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = p_table_name AND column_name = p_column_name
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', p_table_name, p_column_name, p_column_definition);
    RAISE NOTICE 'Added column %.%', p_table_name, p_column_name;
  ELSE
    RAISE NOTICE 'Column %.% already exists', p_table_name, p_column_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. INSPECTION_CHECKPOINTS - Add missing columns
-- ============================================================

SELECT add_column_if_not_exists('inspection_checkpoints', 'category_id', 'UUID REFERENCES inspection_categories(id) ON DELETE CASCADE');
SELECT add_column_if_not_exists('inspection_checkpoints', 'code', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoints', 'name', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoints', 'description', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoints', 'instructions', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoints', 'sort_order', 'INT DEFAULT 0');
SELECT add_column_if_not_exists('inspection_checkpoints', 'is_required', 'BOOLEAN DEFAULT false');
SELECT add_column_if_not_exists('inspection_checkpoints', 'is_active', 'BOOLEAN DEFAULT true');
SELECT add_column_if_not_exists('inspection_checkpoints', 'response_options', 'JSONB DEFAULT ''[]''::jsonb');
SELECT add_column_if_not_exists('inspection_checkpoints', 'display_type', 'TEXT DEFAULT ''radio''');
SELECT add_column_if_not_exists('inspection_checkpoints', 'allow_multiple', 'BOOLEAN DEFAULT false');
SELECT add_column_if_not_exists('inspection_checkpoints', 'comment_enabled', 'BOOLEAN DEFAULT true');
SELECT add_column_if_not_exists('inspection_checkpoints', 'end_user_can_comment', 'BOOLEAN DEFAULT true');
SELECT add_column_if_not_exists('inspection_checkpoints', 'photos_min', 'INT DEFAULT 0');
SELECT add_column_if_not_exists('inspection_checkpoints', 'photos_max', 'INT DEFAULT 10');
SELECT add_column_if_not_exists('inspection_checkpoints', 'photos_required_responses', 'TEXT[] DEFAULT ''{}''');
SELECT add_column_if_not_exists('inspection_checkpoints', 'photos_allowed_responses', 'TEXT[] DEFAULT ''{}''');
SELECT add_column_if_not_exists('inspection_checkpoints', 'comment_required_responses', 'TEXT[] DEFAULT ''{}''');
SELECT add_column_if_not_exists('inspection_checkpoints', 'is_template', 'BOOLEAN DEFAULT false');
SELECT add_column_if_not_exists('inspection_checkpoints', 'project_id', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoints', 'source_checkpoint_id', 'UUID');
SELECT add_column_if_not_exists('inspection_checkpoints', 'requires_assembly_selection', 'BOOLEAN DEFAULT true');
SELECT add_column_if_not_exists('inspection_checkpoints', 'created_at', 'TIMESTAMPTZ DEFAULT NOW()');
SELECT add_column_if_not_exists('inspection_checkpoints', 'updated_at', 'TIMESTAMPTZ DEFAULT NOW()');

-- Add CHECK constraint for display_type if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'inspection_checkpoints_display_type_check'
  ) THEN
    ALTER TABLE inspection_checkpoints
    ADD CONSTRAINT inspection_checkpoints_display_type_check
    CHECK (display_type IN ('radio', 'checkbox', 'dropdown'));
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ============================================================
-- 2. INSPECTION_CHECKPOINT_ATTACHMENTS - Add missing columns
-- ============================================================

-- Create table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS inspection_checkpoint_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY
);

SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'checkpoint_id', 'UUID REFERENCES inspection_checkpoints(id) ON DELETE CASCADE');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'type', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'name', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'description', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'url', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'storage_path', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'file_size', 'BIGINT');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'mime_type', 'TEXT');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'sort_order', 'INT DEFAULT 0');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'created_by', 'UUID');
SELECT add_column_if_not_exists('inspection_checkpoint_attachments', 'created_at', 'TIMESTAMPTZ DEFAULT NOW()');

-- Add CHECK constraint for type if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'inspection_checkpoint_attachments_type_check'
  ) THEN
    ALTER TABLE inspection_checkpoint_attachments
    ADD CONSTRAINT inspection_checkpoint_attachments_type_check
    CHECK (type IN ('link', 'video', 'document', 'image', 'file'));
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ============================================================
-- 3. INSPECTION_RESULTS - Add missing columns
-- ============================================================

-- Create table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS inspection_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY
);

SELECT add_column_if_not_exists('inspection_results', 'plan_item_id', 'UUID REFERENCES inspection_plan_items(id) ON DELETE SET NULL');
SELECT add_column_if_not_exists('inspection_results', 'checkpoint_id', 'UUID REFERENCES inspection_checkpoints(id) ON DELETE CASCADE');
SELECT add_column_if_not_exists('inspection_results', 'project_id', 'TEXT');
SELECT add_column_if_not_exists('inspection_results', 'assembly_guid', 'TEXT');
SELECT add_column_if_not_exists('inspection_results', 'assembly_name', 'TEXT');
SELECT add_column_if_not_exists('inspection_results', 'response_value', 'TEXT');
SELECT add_column_if_not_exists('inspection_results', 'response_label', 'TEXT');
SELECT add_column_if_not_exists('inspection_results', 'comment', 'TEXT');
SELECT add_column_if_not_exists('inspection_results', 'inspector_id', 'UUID');
SELECT add_column_if_not_exists('inspection_results', 'inspector_name', 'TEXT');
SELECT add_column_if_not_exists('inspection_results', 'user_email', 'TEXT');
SELECT add_column_if_not_exists('inspection_results', 'inspected_at', 'TIMESTAMPTZ DEFAULT NOW()');
SELECT add_column_if_not_exists('inspection_results', 'location_lat', 'DECIMAL(10, 8)');
SELECT add_column_if_not_exists('inspection_results', 'location_lng', 'DECIMAL(11, 8)');
SELECT add_column_if_not_exists('inspection_results', 'device_info', 'JSONB');
SELECT add_column_if_not_exists('inspection_results', 'synced_to_trimble', 'BOOLEAN DEFAULT false');
SELECT add_column_if_not_exists('inspection_results', 'trimble_sync_at', 'TIMESTAMPTZ');
SELECT add_column_if_not_exists('inspection_results', 'created_at', 'TIMESTAMPTZ DEFAULT NOW()');
SELECT add_column_if_not_exists('inspection_results', 'updated_at', 'TIMESTAMPTZ DEFAULT NOW()');

-- ============================================================
-- 4. INSPECTION_RESULT_PHOTOS - Add missing columns
-- ============================================================

-- Create table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS inspection_result_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY
);

SELECT add_column_if_not_exists('inspection_result_photos', 'result_id', 'UUID REFERENCES inspection_results(id) ON DELETE CASCADE');
SELECT add_column_if_not_exists('inspection_result_photos', 'storage_path', 'TEXT');
SELECT add_column_if_not_exists('inspection_result_photos', 'url', 'TEXT');
SELECT add_column_if_not_exists('inspection_result_photos', 'thumbnail_url', 'TEXT');
SELECT add_column_if_not_exists('inspection_result_photos', 'file_size', 'BIGINT');
SELECT add_column_if_not_exists('inspection_result_photos', 'mime_type', 'TEXT');
SELECT add_column_if_not_exists('inspection_result_photos', 'width', 'INT');
SELECT add_column_if_not_exists('inspection_result_photos', 'height', 'INT');
SELECT add_column_if_not_exists('inspection_result_photos', 'taken_at', 'TIMESTAMPTZ');
SELECT add_column_if_not_exists('inspection_result_photos', 'sort_order', 'INT DEFAULT 0');
SELECT add_column_if_not_exists('inspection_result_photos', 'created_at', 'TIMESTAMPTZ DEFAULT NOW()');

-- ============================================================
-- 5. CREATE INDEXES (IF NOT EXISTS)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_checkpoints_category_code
ON inspection_checkpoints(category_id, code);

CREATE INDEX IF NOT EXISTS idx_checkpoints_active
ON inspection_checkpoints(category_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_attachments_checkpoint
ON inspection_checkpoint_attachments(checkpoint_id);

CREATE INDEX IF NOT EXISTS idx_results_assembly
ON inspection_results(project_id, assembly_guid);

CREATE INDEX IF NOT EXISTS idx_results_checkpoint
ON inspection_results(checkpoint_id);

CREATE INDEX IF NOT EXISTS idx_results_plan_item
ON inspection_results(plan_item_id);

CREATE INDEX IF NOT EXISTS idx_result_photos
ON inspection_result_photos(result_id);

-- ============================================================
-- 6. UPDATE TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_checkpoint_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS checkpoint_updated_at ON inspection_checkpoints;
CREATE TRIGGER checkpoint_updated_at
  BEFORE UPDATE ON inspection_checkpoints
  FOR EACH ROW EXECUTE FUNCTION update_checkpoint_timestamp();

DROP TRIGGER IF EXISTS result_updated_at ON inspection_results;
CREATE TRIGGER result_updated_at
  BEFORE UPDATE ON inspection_results
  FOR EACH ROW EXECUTE FUNCTION update_checkpoint_timestamp();

-- ============================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE inspection_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_checkpoint_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_result_photos ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then recreate
DROP POLICY IF EXISTS "checkpoints_select" ON inspection_checkpoints;
CREATE POLICY "checkpoints_select" ON inspection_checkpoints
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "checkpoint_attachments_select" ON inspection_checkpoint_attachments;
CREATE POLICY "checkpoint_attachments_select" ON inspection_checkpoint_attachments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "results_select" ON inspection_results;
CREATE POLICY "results_select" ON inspection_results
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "results_insert" ON inspection_results;
CREATE POLICY "results_insert" ON inspection_results
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "results_update" ON inspection_results;
CREATE POLICY "results_update" ON inspection_results
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS "result_photos_all" ON inspection_result_photos;
CREATE POLICY "result_photos_all" ON inspection_result_photos
  FOR ALL USING (true);

-- ============================================================
-- 8. CREATE OR REPLACE VIEW
-- ============================================================

DROP VIEW IF EXISTS checkpoint_completion_stats;
CREATE OR REPLACE VIEW checkpoint_completion_stats AS
SELECT
  pi.id as plan_item_id,
  pi.guid,
  pi.assembly_mark,
  pi.category_id,
  COUNT(DISTINCT cp.id) as total_checkpoints,
  COUNT(DISTINCT CASE WHEN cp.is_required THEN cp.id END) as required_checkpoints,
  COUNT(DISTINCT ir.checkpoint_id) as completed_checkpoints,
  COUNT(DISTINCT CASE WHEN cp.is_required AND ir.id IS NOT NULL THEN cp.id END) as completed_required,
  CASE
    WHEN COUNT(DISTINCT CASE WHEN cp.is_required THEN cp.id END) = 0 THEN 100
    ELSE ROUND(
      COUNT(DISTINCT CASE WHEN cp.is_required AND ir.id IS NOT NULL THEN cp.id END)::numeric /
      NULLIF(COUNT(DISTINCT CASE WHEN cp.is_required THEN cp.id END), 0)::numeric * 100
    )
  END as completion_percentage
FROM inspection_plan_items pi
LEFT JOIN inspection_checkpoints cp ON cp.category_id = pi.category_id AND cp.is_active = true
LEFT JOIN inspection_results ir ON ir.plan_item_id = pi.id AND ir.checkpoint_id = cp.id
GROUP BY pi.id, pi.guid, pi.assembly_mark, pi.category_id;

COMMENT ON VIEW checkpoint_completion_stats IS 'Shows completion statistics for each plan item';

-- ============================================================
-- 9. CLEANUP - Drop helper function
-- ============================================================

DROP FUNCTION IF EXISTS add_column_if_not_exists;

-- ============================================================
-- DONE!
-- ============================================================
SELECT 'Migration completed successfully - missing columns added' as status;
