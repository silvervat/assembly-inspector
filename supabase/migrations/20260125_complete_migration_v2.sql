-- ============================================================
-- ASSEMBLY INSPECTOR - TÄIELIK MIGRATSIOON v2
-- Lihtsustatud versioon - käivita osade kaupa kui vaja
-- ============================================================

-- ============================================================
-- OSA 1: LISA PUUDUVAD VEERUD inspection_results TABELILE
-- ============================================================

DO $$
BEGIN
  -- Kontrolli kas tabel eksisteerib
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inspection_results') THEN
    -- Lisa project_id kui puudub
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_results' AND column_name = 'project_id') THEN
      ALTER TABLE inspection_results ADD COLUMN project_id TEXT;
    END IF;

    -- Lisa teised veerud
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_results' AND column_name = 'plan_item_id') THEN
      ALTER TABLE inspection_results ADD COLUMN plan_item_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_results' AND column_name = 'checkpoint_id') THEN
      ALTER TABLE inspection_results ADD COLUMN checkpoint_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_results' AND column_name = 'assembly_guid') THEN
      ALTER TABLE inspection_results ADD COLUMN assembly_guid TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_results' AND column_name = 'assembly_name') THEN
      ALTER TABLE inspection_results ADD COLUMN assembly_name TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_results' AND column_name = 'inspector_name') THEN
      ALTER TABLE inspection_results ADD COLUMN inspector_name TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_results' AND column_name = 'user_email') THEN
      ALTER TABLE inspection_results ADD COLUMN user_email TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_results' AND column_name = 'inspected_at') THEN
      ALTER TABLE inspection_results ADD COLUMN inspected_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
  END IF;
END $$;

-- ============================================================
-- OSA 2: LISA PUUDUVAD VEERUD inspection_result_photos TABELILE
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inspection_result_photos') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'result_id') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN result_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'storage_path') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN storage_path TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'url') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN url TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'thumbnail_url') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN thumbnail_url TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'photo_type') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN photo_type TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'uploaded_by') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN uploaded_by TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'uploaded_by_name') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN uploaded_by_name TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'original_filename') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN original_filename TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'original_size') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN original_size BIGINT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'compressed_size') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN compressed_size BIGINT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'checkpoint_name') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN checkpoint_name TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'plan_item_guid') THEN
      ALTER TABLE inspection_result_photos ADD COLUMN plan_item_guid TEXT;
    END IF;
  END IF;
END $$;

-- ============================================================
-- OSA 3: LISA PUUDUVAD VEERUD inspection_plan_items TABELILE
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inspection_plan_items') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'project_id') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN project_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'category_id') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN category_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'inspection_type_id') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN inspection_type_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'guid') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN guid TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'assembly_mark') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN assembly_mark TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'prefix') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN prefix TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'review_status') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN review_status TEXT DEFAULT 'pending';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'reviewed_by') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN reviewed_by TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'reviewed_by_name') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN reviewed_by_name TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'reviewed_at') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN reviewed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'review_comment') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN review_comment TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'element_lifecycle_id') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN element_lifecycle_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'can_edit') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN can_edit BOOLEAN DEFAULT true;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'locked_at') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN locked_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'locked_by') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN locked_by TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'status') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN status TEXT DEFAULT 'pending';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'object_name') THEN
      ALTER TABLE inspection_plan_items ADD COLUMN object_name TEXT;
    END IF;
  END IF;
END $$;

-- ============================================================
-- OSA 4: LISA PUUDUVAD VEERUD inspection_audit_log TABELILE
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inspection_audit_log') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_audit_log' AND column_name = 'action_category') THEN
      ALTER TABLE inspection_audit_log ADD COLUMN action_category TEXT DEFAULT 'general';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_audit_log' AND column_name = 'is_bulk_action') THEN
      ALTER TABLE inspection_audit_log ADD COLUMN is_bulk_action BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_audit_log' AND column_name = 'bulk_action_id') THEN
      ALTER TABLE inspection_audit_log ADD COLUMN bulk_action_id UUID;
    END IF;
  END IF;
END $$;

-- ============================================================
-- OSA 5: LOO PUUDUVAD TABELID
-- ============================================================

-- inspection_categories
CREATE TABLE IF NOT EXISTS inspection_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  description TEXT,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- inspection_types
CREATE TABLE IF NOT EXISTS inspection_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  description TEXT,
  category_id UUID,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- bulk_actions_log
CREATE TABLE IF NOT EXISTS bulk_actions_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  affected_entity_ids UUID[] NOT NULL,
  affected_count INT,
  changes JSONB,
  performed_by TEXT NOT NULL,
  performed_by_name TEXT,
  performed_at TIMESTAMPTZ DEFAULT NOW(),
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  failures JSONB,
  ip_address TEXT,
  user_agent TEXT
);

-- element_lifecycle (kui puudub)
CREATE TABLE IF NOT EXISTS element_lifecycle (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guid TEXT,
  project_id TEXT,
  inspection_status TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  reviewed_by_name TEXT,
  review_decision TEXT,
  review_comment TEXT,
  can_edit BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OSA 6: LOO FUNKTSIOONID
-- ============================================================

-- bulk_approve_inspections
CREATE OR REPLACE FUNCTION bulk_approve_inspections(
  p_plan_item_ids UUID[],
  p_reviewer_email TEXT,
  p_reviewer_name TEXT,
  p_comment TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS TABLE (
  success_count INT,
  failure_count INT,
  results JSONB
) AS $$
DECLARE
  v_bulk_id UUID := gen_random_uuid();
  v_project_id TEXT;
  v_success INT := 0;
  v_failure INT := 0;
  v_results JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_item RECORD;
BEGIN
  SELECT ipi.project_id INTO v_project_id
  FROM inspection_plan_items ipi
  WHERE ipi.id = p_plan_item_ids[1];

  FOREACH v_item_id IN ARRAY p_plan_item_ids
  LOOP
    BEGIN
      SELECT * INTO v_item FROM inspection_plan_items WHERE id = v_item_id;

      UPDATE inspection_plan_items
      SET
        review_status = 'approved',
        reviewed_at = NOW(),
        reviewed_by = p_reviewer_email,
        reviewed_by_name = p_reviewer_name,
        review_comment = p_comment,
        can_edit = false,
        locked_at = NOW(),
        locked_by = p_reviewer_email,
        status = 'completed'
      WHERE id = v_item_id;

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object('entity_id', v_item_id, 'success', true);

    EXCEPTION WHEN OTHERS THEN
      v_failure := v_failure + 1;
      v_results := v_results || jsonb_build_object('entity_id', v_item_id, 'success', false, 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO bulk_actions_log (
    id, project_id, action_type, affected_entity_ids, changes,
    performed_by, performed_by_name, success_count, failure_count,
    ip_address, user_agent
  ) VALUES (
    v_bulk_id, COALESCE(v_project_id, 'unknown'), 'bulk_approve', p_plan_item_ids,
    jsonb_build_object('review_status', 'approved', 'comment', p_comment),
    p_reviewer_email, p_reviewer_name, v_success, v_failure,
    p_ip_address, p_user_agent
  );

  RETURN QUERY SELECT v_success, v_failure, v_results;
END;
$$ LANGUAGE plpgsql;

-- bulk_return_inspections
CREATE OR REPLACE FUNCTION bulk_return_inspections(
  p_plan_item_ids UUID[],
  p_reviewer_email TEXT,
  p_reviewer_name TEXT,
  p_comment TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS TABLE (
  success_count INT,
  failure_count INT,
  results JSONB
) AS $$
DECLARE
  v_bulk_id UUID := gen_random_uuid();
  v_project_id TEXT;
  v_success INT := 0;
  v_failure INT := 0;
  v_results JSONB := '[]'::jsonb;
  v_item_id UUID;
BEGIN
  IF p_comment IS NULL OR trim(p_comment) = '' THEN
    RAISE EXCEPTION 'Kommentaar on kohustuslik';
  END IF;

  SELECT ipi.project_id INTO v_project_id
  FROM inspection_plan_items ipi
  WHERE ipi.id = p_plan_item_ids[1];

  FOREACH v_item_id IN ARRAY p_plan_item_ids
  LOOP
    BEGIN
      UPDATE inspection_plan_items
      SET
        review_status = 'returned',
        reviewed_at = NOW(),
        reviewed_by = p_reviewer_email,
        reviewed_by_name = p_reviewer_name,
        review_comment = p_comment,
        can_edit = true,
        status = 'in_progress'
      WHERE id = v_item_id;

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object('entity_id', v_item_id, 'success', true);

    EXCEPTION WHEN OTHERS THEN
      v_failure := v_failure + 1;
      v_results := v_results || jsonb_build_object('entity_id', v_item_id, 'success', false, 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO bulk_actions_log (
    id, project_id, action_type, affected_entity_ids, changes,
    performed_by, performed_by_name, success_count, failure_count,
    ip_address, user_agent
  ) VALUES (
    v_bulk_id, COALESCE(v_project_id, 'unknown'), 'bulk_return', p_plan_item_ids,
    jsonb_build_object('review_status', 'returned', 'comment', p_comment),
    p_reviewer_email, p_reviewer_name, v_success, v_failure,
    p_ip_address, p_user_agent
  );

  RETURN QUERY SELECT v_success, v_failure, v_results;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- OSA 7: LOO VAATED
-- ============================================================

-- Kustuta vanad vaated
DROP VIEW IF EXISTS v_inspection_photos_gallery CASCADE;
DROP VIEW IF EXISTS v_user_activity_stats CASCADE;
DROP VIEW IF EXISTS v_daily_activity_stats CASCADE;
DROP VIEW IF EXISTS v_bulk_operations_stats CASCADE;

-- v_inspection_photos_gallery - kasutab COALESCE et vältida puuduvaid veerge
CREATE OR REPLACE VIEW v_inspection_photos_gallery AS
SELECT
  p.id,
  p.result_id,
  p.storage_path,
  p.url,
  p.thumbnail_url,
  p.photo_type,
  p.uploaded_by,
  p.uploaded_by_name,
  p.original_filename,
  p.original_size,
  p.compressed_size,
  p.created_at,
  p.checkpoint_name,
  p.plan_item_guid,
  r.project_id,
  r.assembly_guid,
  r.assembly_name,
  r.inspector_name,
  r.inspected_at,
  pi.assembly_mark,
  pi.prefix,
  ic.name as category_name,
  it.name as inspection_type_name
FROM inspection_result_photos p
LEFT JOIN inspection_results r ON p.result_id = r.id
LEFT JOIN inspection_plan_items pi ON r.plan_item_id = pi.id
LEFT JOIN inspection_categories ic ON pi.category_id = ic.id
LEFT JOIN inspection_types it ON pi.inspection_type_id = it.id;

-- v_user_activity_stats
CREATE OR REPLACE VIEW v_user_activity_stats AS
SELECT
  project_id,
  user_email,
  user_name,
  COUNT(*) FILTER (WHERE action = 'created' AND entity_type = 'result') as inspections_done,
  COUNT(*) FILTER (WHERE action = 'approved') as approvals_given,
  COUNT(*) FILTER (WHERE action = 'returned') as returns_given,
  MIN(created_at) as first_activity,
  MAX(created_at) as last_activity
FROM inspection_audit_log
GROUP BY project_id, user_email, user_name;

-- v_daily_activity_stats
CREATE OR REPLACE VIEW v_daily_activity_stats AS
SELECT
  project_id,
  DATE(created_at) as activity_date,
  COUNT(*) as total_actions,
  COUNT(DISTINCT user_email) as unique_users
FROM inspection_audit_log
GROUP BY project_id, DATE(created_at);

-- v_bulk_operations_stats
CREATE OR REPLACE VIEW v_bulk_operations_stats AS
SELECT
  project_id,
  action_type,
  COUNT(*) as operation_count,
  SUM(success_count) as total_success,
  SUM(failure_count) as total_failures
FROM bulk_actions_log
GROUP BY project_id, action_type;

-- ============================================================
-- OSA 8: RLS JA ÕIGUSED
-- ============================================================

ALTER TABLE bulk_actions_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bulk_actions_all" ON bulk_actions_log;
CREATE POLICY "bulk_actions_all" ON bulk_actions_log FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON bulk_actions_log TO authenticated, anon;
GRANT SELECT ON v_inspection_photos_gallery TO authenticated, anon;
GRANT SELECT ON v_user_activity_stats TO authenticated, anon;
GRANT SELECT ON v_daily_activity_stats TO authenticated, anon;
GRANT SELECT ON v_bulk_operations_stats TO authenticated, anon;

-- ============================================================
-- VALMIS
-- ============================================================
SELECT 'Migratsioon v2 edukalt lõpetatud!' as status;
