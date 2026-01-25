-- ============================================================
-- ASSEMBLY INSPECTOR - TÄIELIK MIGRATSIOON
-- See migratsioon loob kõik vajalikud tabelid, veerud, funktsioonid ja vaated
-- Turvaline käivitada - kasutab "IF NOT EXISTS" ja "CREATE OR REPLACE"
-- Kuupäev: 2026-01-25
-- ============================================================

-- ============================================================
-- OSA 1: BAASTABELITE LOOMINE (kui puuduvad)
-- ============================================================

-- 1.1 inspection_audit_log
CREATE TABLE IF NOT EXISTS inspection_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT,
  entity_type TEXT,
  entity_id UUID,
  action TEXT,
  old_values JSONB,
  new_values JSONB,
  user_email TEXT,
  user_name TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.2 inspection_categories
CREATE TABLE IF NOT EXISTS inspection_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  description TEXT,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.3 inspection_types
CREATE TABLE IF NOT EXISTS inspection_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  description TEXT,
  category_id UUID REFERENCES inspection_categories(id) ON DELETE SET NULL,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.4 inspection_checkpoints
CREATE TABLE IF NOT EXISTS inspection_checkpoints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.5 inspection_plan_items
CREATE TABLE IF NOT EXISTS inspection_plan_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.6 inspection_results
CREATE TABLE IF NOT EXISTS inspection_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.7 inspection_result_photos
CREATE TABLE IF NOT EXISTS inspection_result_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.8 element_lifecycle
CREATE TABLE IF NOT EXISTS element_lifecycle (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guid TEXT,
  project_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.9 trimble_ex_users
CREATE TABLE IF NOT EXISTS trimble_ex_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT,
  name TEXT,
  role TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- OSA 2: VEERUDE LISAMINE (kasutab DO blokki)
-- ============================================================

-- Helper funktsioon veergude lisamiseks
CREATE OR REPLACE FUNCTION _add_col_if_missing(
  _tbl TEXT, _col TEXT, _def TEXT
) RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = _tbl AND column_name = _col
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', _tbl, _col, _def);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 2.1 inspection_audit_log veerud
SELECT _add_col_if_missing('inspection_audit_log', 'action_category', 'TEXT DEFAULT ''general''');
SELECT _add_col_if_missing('inspection_audit_log', 'related_entity_type', 'TEXT');
SELECT _add_col_if_missing('inspection_audit_log', 'related_entity_id', 'UUID');
SELECT _add_col_if_missing('inspection_audit_log', 'session_id', 'TEXT');
SELECT _add_col_if_missing('inspection_audit_log', 'request_id', 'TEXT');
SELECT _add_col_if_missing('inspection_audit_log', 'duration_ms', 'INT');
SELECT _add_col_if_missing('inspection_audit_log', 'is_bulk_action', 'BOOLEAN DEFAULT false');
SELECT _add_col_if_missing('inspection_audit_log', 'bulk_action_id', 'UUID');

-- 2.2 inspection_checkpoints veerud
SELECT _add_col_if_missing('inspection_checkpoints', 'category_id', 'UUID');
SELECT _add_col_if_missing('inspection_checkpoints', 'code', 'TEXT');
SELECT _add_col_if_missing('inspection_checkpoints', 'name', 'TEXT');
SELECT _add_col_if_missing('inspection_checkpoints', 'description', 'TEXT');
SELECT _add_col_if_missing('inspection_checkpoints', 'instructions', 'TEXT');
SELECT _add_col_if_missing('inspection_checkpoints', 'sort_order', 'INT DEFAULT 0');
SELECT _add_col_if_missing('inspection_checkpoints', 'is_required', 'BOOLEAN DEFAULT false');
SELECT _add_col_if_missing('inspection_checkpoints', 'is_active', 'BOOLEAN DEFAULT true');
SELECT _add_col_if_missing('inspection_checkpoints', 'response_options', 'JSONB DEFAULT ''[]''::jsonb');
SELECT _add_col_if_missing('inspection_checkpoints', 'display_type', 'TEXT DEFAULT ''radio''');
SELECT _add_col_if_missing('inspection_checkpoints', 'allow_multiple', 'BOOLEAN DEFAULT false');
SELECT _add_col_if_missing('inspection_checkpoints', 'comment_enabled', 'BOOLEAN DEFAULT true');
SELECT _add_col_if_missing('inspection_checkpoints', 'end_user_can_comment', 'BOOLEAN DEFAULT true');
SELECT _add_col_if_missing('inspection_checkpoints', 'photos_min', 'INT DEFAULT 0');
SELECT _add_col_if_missing('inspection_checkpoints', 'photos_max', 'INT DEFAULT 10');
SELECT _add_col_if_missing('inspection_checkpoints', 'photos_required_responses', 'TEXT[] DEFAULT ''{}''');
SELECT _add_col_if_missing('inspection_checkpoints', 'photos_allowed_responses', 'TEXT[] DEFAULT ''{}''');
SELECT _add_col_if_missing('inspection_checkpoints', 'comment_required_responses', 'TEXT[] DEFAULT ''{}''');
SELECT _add_col_if_missing('inspection_checkpoints', 'is_template', 'BOOLEAN DEFAULT false');
SELECT _add_col_if_missing('inspection_checkpoints', 'project_id', 'TEXT');
SELECT _add_col_if_missing('inspection_checkpoints', 'source_checkpoint_id', 'UUID');
SELECT _add_col_if_missing('inspection_checkpoints', 'requires_assembly_selection', 'BOOLEAN DEFAULT true');
SELECT _add_col_if_missing('inspection_checkpoints', 'updated_at', 'TIMESTAMPTZ DEFAULT NOW()');

-- 2.3 inspection_plan_items veerud
SELECT _add_col_if_missing('inspection_plan_items', 'project_id', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'category_id', 'UUID');
SELECT _add_col_if_missing('inspection_plan_items', 'inspection_type_id', 'UUID');
SELECT _add_col_if_missing('inspection_plan_items', 'guid', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'assembly_mark', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'object_name', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'product_name', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'status', 'TEXT DEFAULT ''pending''');
SELECT _add_col_if_missing('inspection_plan_items', 'review_status', 'TEXT DEFAULT ''pending''');
SELECT _add_col_if_missing('inspection_plan_items', 'reviewed_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('inspection_plan_items', 'reviewed_by', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'reviewed_by_name', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'review_comment', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'can_edit', 'BOOLEAN DEFAULT true');
SELECT _add_col_if_missing('inspection_plan_items', 'locked_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('inspection_plan_items', 'locked_by', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'element_lifecycle_id', 'UUID');
SELECT _add_col_if_missing('inspection_plan_items', 'prefix', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'custom_prefix', 'TEXT');
SELECT _add_col_if_missing('inspection_plan_items', 'prefix_locked', 'BOOLEAN DEFAULT false');
SELECT _add_col_if_missing('inspection_plan_items', 'updated_at', 'TIMESTAMPTZ DEFAULT NOW()');

-- 2.4 inspection_results veerud
SELECT _add_col_if_missing('inspection_results', 'plan_item_id', 'UUID');
SELECT _add_col_if_missing('inspection_results', 'checkpoint_id', 'UUID');
SELECT _add_col_if_missing('inspection_results', 'project_id', 'TEXT');
SELECT _add_col_if_missing('inspection_results', 'assembly_guid', 'TEXT');
SELECT _add_col_if_missing('inspection_results', 'assembly_name', 'TEXT');
SELECT _add_col_if_missing('inspection_results', 'response_value', 'TEXT');
SELECT _add_col_if_missing('inspection_results', 'response_label', 'TEXT');
SELECT _add_col_if_missing('inspection_results', 'comment', 'TEXT');
SELECT _add_col_if_missing('inspection_results', 'inspector_id', 'UUID');
SELECT _add_col_if_missing('inspection_results', 'inspector_name', 'TEXT');
SELECT _add_col_if_missing('inspection_results', 'user_email', 'TEXT');
SELECT _add_col_if_missing('inspection_results', 'inspected_at', 'TIMESTAMPTZ DEFAULT NOW()');
SELECT _add_col_if_missing('inspection_results', 'location_lat', 'DECIMAL(10, 8)');
SELECT _add_col_if_missing('inspection_results', 'location_lng', 'DECIMAL(11, 8)');
SELECT _add_col_if_missing('inspection_results', 'device_info', 'JSONB');
SELECT _add_col_if_missing('inspection_results', 'synced_to_trimble', 'BOOLEAN DEFAULT false');
SELECT _add_col_if_missing('inspection_results', 'trimble_sync_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('inspection_results', 'updated_at', 'TIMESTAMPTZ DEFAULT NOW()');

-- 2.5 inspection_result_photos veerud
SELECT _add_col_if_missing('inspection_result_photos', 'result_id', 'UUID');
SELECT _add_col_if_missing('inspection_result_photos', 'storage_path', 'TEXT');
SELECT _add_col_if_missing('inspection_result_photos', 'url', 'TEXT');
SELECT _add_col_if_missing('inspection_result_photos', 'thumbnail_url', 'TEXT');
SELECT _add_col_if_missing('inspection_result_photos', 'file_size', 'BIGINT');
SELECT _add_col_if_missing('inspection_result_photos', 'mime_type', 'TEXT');
SELECT _add_col_if_missing('inspection_result_photos', 'width', 'INT');
SELECT _add_col_if_missing('inspection_result_photos', 'height', 'INT');
SELECT _add_col_if_missing('inspection_result_photos', 'taken_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('inspection_result_photos', 'sort_order', 'INT DEFAULT 0');
SELECT _add_col_if_missing('inspection_result_photos', 'photo_type', 'TEXT');
SELECT _add_col_if_missing('inspection_result_photos', 'uploaded_by', 'TEXT');
SELECT _add_col_if_missing('inspection_result_photos', 'uploaded_by_name', 'TEXT');
SELECT _add_col_if_missing('inspection_result_photos', 'original_filename', 'TEXT');
SELECT _add_col_if_missing('inspection_result_photos', 'original_size', 'BIGINT');
SELECT _add_col_if_missing('inspection_result_photos', 'compressed_size', 'BIGINT');
SELECT _add_col_if_missing('inspection_result_photos', 'device_info', 'JSONB');
SELECT _add_col_if_missing('inspection_result_photos', 'location_lat', 'DECIMAL(10, 8)');
SELECT _add_col_if_missing('inspection_result_photos', 'location_lng', 'DECIMAL(11, 8)');
SELECT _add_col_if_missing('inspection_result_photos', 'inspection_id', 'UUID');
SELECT _add_col_if_missing('inspection_result_photos', 'checkpoint_name', 'TEXT');
SELECT _add_col_if_missing('inspection_result_photos', 'plan_item_guid', 'TEXT');

-- 2.6 element_lifecycle veerud
SELECT _add_col_if_missing('element_lifecycle', 'delivery_vehicle_id', 'UUID');
SELECT _add_col_if_missing('element_lifecycle', 'arrived_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('element_lifecycle', 'arrived_by', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'arrived_by_name', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'arrival_checked_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('element_lifecycle', 'arrival_checked_by', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'arrival_checked_by_name', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'arrival_check_result', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'arrival_check_notes', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'installed_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('element_lifecycle', 'installed_by', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'installed_by_name', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'installation_resource_id', 'UUID');
SELECT _add_col_if_missing('element_lifecycle', 'inspection_status', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'reviewed_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('element_lifecycle', 'reviewed_by', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'reviewed_by_name', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'review_decision', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'review_comment', 'TEXT');
SELECT _add_col_if_missing('element_lifecycle', 'can_edit', 'BOOLEAN DEFAULT true');

-- 2.7 trimble_ex_users veerud
SELECT _add_col_if_missing('trimble_ex_users', 'phone', 'TEXT');
SELECT _add_col_if_missing('trimble_ex_users', 'position', 'TEXT');
SELECT _add_col_if_missing('trimble_ex_users', 'company', 'TEXT');
SELECT _add_col_if_missing('trimble_ex_users', 'signature_url', 'TEXT');
SELECT _add_col_if_missing('trimble_ex_users', 'signature_storage_path', 'TEXT');
SELECT _add_col_if_missing('trimble_ex_users', 'signature_updated_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('trimble_ex_users', 'profile_updated_at', 'TIMESTAMPTZ');
SELECT _add_col_if_missing('trimble_ex_users', 'avatar_url', 'TEXT');
SELECT _add_col_if_missing('trimble_ex_users', 'language', 'TEXT DEFAULT ''et''');
SELECT _add_col_if_missing('trimble_ex_users', 'timezone', 'TEXT DEFAULT ''Europe/Tallinn''');
SELECT _add_col_if_missing('trimble_ex_users', 'notification_preferences', 'JSONB DEFAULT ''{"email": true, "push": false}''::jsonb');

-- ============================================================
-- OSA 3: BULK ACTIONS TABEL JA INDEKSID
-- ============================================================

-- 3.1 bulk_actions_log
CREATE TABLE IF NOT EXISTS bulk_actions_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  affected_entity_ids UUID[] NOT NULL,
  affected_count INT GENERATED ALWAYS AS (array_length(affected_entity_ids, 1)) STORED,
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

-- 3.2 PDF exports tabel
CREATE TABLE IF NOT EXISTS pdf_exports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  export_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT,
  download_url TEXT,
  included_items UUID[],
  item_count INT,
  photo_count INT,
  generated_by TEXT NOT NULL,
  generated_by_name TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  includes_signature BOOLEAN DEFAULT false,
  signature_url TEXT,
  status TEXT DEFAULT 'generating',
  error_message TEXT,
  expires_at TIMESTAMPTZ,
  file_size BIGINT,
  page_count INT
);

-- 3.3 Bulk downloads tabel
CREATE TABLE IF NOT EXISTS bulk_downloads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  download_type TEXT NOT NULL,
  file_urls TEXT[] NOT NULL,
  file_count INT GENERATED ALWAYS AS (array_length(file_urls, 1)) STORED,
  zip_filename TEXT,
  zip_storage_path TEXT,
  zip_download_url TEXT,
  zip_size BIGINT,
  status TEXT DEFAULT 'pending',
  progress INT DEFAULT 0,
  error_message TEXT,
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB
);

-- 3.4 Indeksid
CREATE INDEX IF NOT EXISTS idx_audit_log_bulk ON inspection_audit_log(bulk_action_id) WHERE bulk_action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_category ON inspection_audit_log(action_category);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON inspection_audit_log(entity_id);
CREATE INDEX IF NOT EXISTS idx_bulk_actions_project ON bulk_actions_log(project_id);
CREATE INDEX IF NOT EXISTS idx_bulk_actions_performed ON bulk_actions_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdf_exports_project ON pdf_exports(project_id);
CREATE INDEX IF NOT EXISTS idx_pdf_exports_status ON pdf_exports(status);
CREATE INDEX IF NOT EXISTS idx_bulk_downloads_project ON bulk_downloads(project_id);
CREATE INDEX IF NOT EXISTS idx_bulk_downloads_status ON bulk_downloads(status);
CREATE INDEX IF NOT EXISTS idx_result_photos_uploaded_by ON inspection_result_photos(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_result_photos_plan_item_guid ON inspection_result_photos(plan_item_guid);
CREATE INDEX IF NOT EXISTS idx_results_plan_item ON inspection_results(plan_item_id);
CREATE INDEX IF NOT EXISTS idx_results_project ON inspection_results(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_project ON inspection_plan_items(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_guid ON inspection_plan_items(guid);

-- ============================================================
-- OSA 4: FUNKTSIOONID
-- ============================================================

-- 4.1 Bulk Approve
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
  -- Leia projekti ID esimesest kirjest
  SELECT ipi.project_id INTO v_project_id
  FROM inspection_plan_items ipi
  WHERE ipi.id = p_plan_item_ids[1];

  -- Töötle iga kirje
  FOREACH v_item_id IN ARRAY p_plan_item_ids
  LOOP
    BEGIN
      SELECT * INTO v_item FROM inspection_plan_items WHERE id = v_item_id;

      IF v_item.status != 'completed' AND v_item.review_status != 'pending' THEN
        v_failure := v_failure + 1;
        v_results := v_results || jsonb_build_object(
          'entity_id', v_item_id,
          'success', false,
          'error', 'Vale staatus: ' || COALESCE(v_item.status, 'null')
        );
        CONTINUE;
      END IF;

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

      IF v_item.element_lifecycle_id IS NOT NULL THEN
        UPDATE element_lifecycle
        SET
          inspection_status = 'approved',
          reviewed_at = NOW(),
          reviewed_by = p_reviewer_email,
          reviewed_by_name = p_reviewer_name,
          review_decision = 'approved',
          review_comment = p_comment,
          can_edit = false
        WHERE id = v_item.element_lifecycle_id;
      END IF;

      INSERT INTO inspection_audit_log (
        project_id, entity_type, entity_id, action, action_category,
        new_values, user_email, user_name, ip_address, user_agent,
        is_bulk_action, bulk_action_id
      ) VALUES (
        v_item.project_id, 'plan_item', v_item_id, 'approved', 'review',
        jsonb_build_object('review_status', 'approved', 'comment', p_comment),
        p_reviewer_email, p_reviewer_name, p_ip_address, p_user_agent,
        true, v_bulk_id
      );

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object('entity_id', v_item_id, 'success', true);

    EXCEPTION WHEN OTHERS THEN
      v_failure := v_failure + 1;
      v_results := v_results || jsonb_build_object(
        'entity_id', v_item_id,
        'success', false,
        'error', SQLERRM
      );
    END;
  END LOOP;

  INSERT INTO bulk_actions_log (
    id, project_id, action_type, affected_entity_ids, changes,
    performed_by, performed_by_name, success_count, failure_count, failures,
    ip_address, user_agent
  ) VALUES (
    v_bulk_id, COALESCE(v_project_id, 'unknown'), 'bulk_approve', p_plan_item_ids,
    jsonb_build_object('review_status', 'approved', 'comment', p_comment),
    p_reviewer_email, p_reviewer_name, v_success, v_failure,
    (SELECT jsonb_agg(r) FROM jsonb_array_elements(v_results) r WHERE (r->>'success')::boolean = false),
    p_ip_address, p_user_agent
  );

  RETURN QUERY SELECT v_success, v_failure, v_results;
END;
$$ LANGUAGE plpgsql;

-- 4.2 Bulk Return
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
  v_item RECORD;
BEGIN
  IF p_comment IS NULL OR trim(p_comment) = '' THEN
    RAISE EXCEPTION 'Kommentaar on kohustuslik tagasi suunamisel';
  END IF;

  SELECT ipi.project_id INTO v_project_id
  FROM inspection_plan_items ipi
  WHERE ipi.id = p_plan_item_ids[1];

  FOREACH v_item_id IN ARRAY p_plan_item_ids
  LOOP
    BEGIN
      SELECT * INTO v_item FROM inspection_plan_items WHERE id = v_item_id;

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

      IF v_item.element_lifecycle_id IS NOT NULL THEN
        UPDATE element_lifecycle
        SET
          inspection_status = 'returned',
          reviewed_at = NOW(),
          reviewed_by = p_reviewer_email,
          review_decision = 'returned',
          review_comment = p_comment,
          can_edit = true
        WHERE id = v_item.element_lifecycle_id;
      END IF;

      INSERT INTO inspection_audit_log (
        project_id, entity_type, entity_id, action, action_category,
        new_values, user_email, user_name, ip_address, user_agent,
        is_bulk_action, bulk_action_id
      ) VALUES (
        v_item.project_id, 'plan_item', v_item_id, 'returned', 'review',
        jsonb_build_object('review_status', 'returned', 'comment', p_comment),
        p_reviewer_email, p_reviewer_name, p_ip_address, p_user_agent,
        true, v_bulk_id
      );

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

-- 4.3 Get Inspection History
CREATE OR REPLACE FUNCTION get_inspection_history(
  p_plan_item_id UUID
) RETURNS TABLE (
  id UUID,
  action TEXT,
  action_category TEXT,
  action_at TIMESTAMPTZ,
  action_by TEXT,
  action_by_name TEXT,
  old_values JSONB,
  new_values JSONB,
  is_bulk BOOLEAN,
  icon TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    al.id,
    al.action,
    al.action_category,
    al.created_at as action_at,
    al.user_email as action_by,
    al.user_name as action_by_name,
    al.old_values,
    al.new_values,
    al.is_bulk_action as is_bulk,
    CASE al.action
      WHEN 'created' THEN '+'
      WHEN 'updated' THEN 'E'
      WHEN 'status_changed' THEN 'S'
      WHEN 'approved' THEN 'A'
      WHEN 'rejected' THEN 'X'
      WHEN 'returned' THEN 'R'
      WHEN 'photo_added' THEN 'P'
      WHEN 'photo_deleted' THEN 'D'
      WHEN 'comment_added' THEN 'C'
      WHEN 'comment_edited' THEN 'E'
      WHEN 'assigned' THEN 'U'
      WHEN 'locked' THEN 'L'
      WHEN 'unlocked' THEN 'O'
      WHEN 'guid_changed' THEN 'G'
      ELSE 'I'
    END as icon
  FROM inspection_audit_log al
  WHERE al.entity_id = p_plan_item_id
    AND al.entity_type = 'plan_item'
  ORDER BY al.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 4.4 Generate Checkpoint Prefix
CREATE OR REPLACE FUNCTION generate_checkpoint_prefix(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_words TEXT[];
  v_word TEXT;
BEGIN
  v_words := string_to_array(regexp_replace(p_name, '[^a-zA-ZäöüõÄÖÜÕ0-9\s]', '', 'g'), ' ');
  v_prefix := '';

  FOREACH v_word IN ARRAY v_words
  LOOP
    IF length(v_word) > 0 THEN
      v_prefix := v_prefix || upper(substring(v_word from 1 for 1));
    END IF;
    IF length(v_prefix) >= 4 THEN
      EXIT;
    END IF;
  END LOOP;

  IF length(v_prefix) < 2 THEN
    v_prefix := v_prefix || '-' || floor(random() * 100)::text;
  END IF;

  RETURN v_prefix;
END;
$$ LANGUAGE plpgsql;

-- 4.5 Auto Generate Prefix Trigger Function
CREATE OR REPLACE FUNCTION auto_generate_prefix()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.prefix IS NULL AND NEW.custom_prefix IS NULL THEN
    NEW.prefix := generate_checkpoint_prefix(COALESCE(NEW.assembly_mark, NEW.object_name, 'CP'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (drop first to avoid duplicates)
DROP TRIGGER IF EXISTS auto_prefix_trigger ON inspection_plan_items;
CREATE TRIGGER auto_prefix_trigger
  BEFORE INSERT ON inspection_plan_items
  FOR EACH ROW EXECUTE FUNCTION auto_generate_prefix();

-- 4.6 Generate Inspection Filename
CREATE OR REPLACE FUNCTION generate_inspection_filename(
  p_project_name TEXT,
  p_inspection_type TEXT,
  p_checkpoint_prefix TEXT,
  p_assembly_mark TEXT,
  p_extension TEXT DEFAULT 'pdf'
) RETURNS TEXT AS $$
DECLARE
  v_date TEXT;
  v_project TEXT;
  v_type TEXT;
  v_prefix TEXT;
  v_mark TEXT;
BEGIN
  v_date := to_char(NOW(), 'YYYY-MM-DD');
  v_project := regexp_replace(COALESCE(p_project_name, 'PRJ'), '[^a-zA-Z0-9]', '', 'g');
  v_project := substring(v_project from 1 for 10);
  v_type := regexp_replace(COALESCE(p_inspection_type, 'INS'), '[^a-zA-Z0-9]', '', 'g');
  v_type := substring(v_type from 1 for 15);
  v_prefix := COALESCE(p_checkpoint_prefix, 'CP');
  v_mark := regexp_replace(COALESCE(p_assembly_mark, ''), '[^a-zA-Z0-9-_]', '', 'g');
  v_mark := substring(v_mark from 1 for 20);

  RETURN v_project || '_' || v_type || '_' || v_prefix || '_' || v_mark || '_' || v_date || '.' || p_extension;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- OSA 5: VAATED (Views)
-- ============================================================

-- 5.1 Photos Gallery View
DROP VIEW IF EXISTS v_inspection_photos_gallery;
CREATE VIEW v_inspection_photos_gallery AS
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
LEFT JOIN inspection_types it ON pi.inspection_type_id = it.id
ORDER BY p.created_at DESC;

-- 5.2 User Activity Stats
DROP VIEW IF EXISTS v_user_activity_stats;
CREATE VIEW v_user_activity_stats AS
SELECT
  project_id,
  user_email,
  user_name,
  COUNT(*) FILTER (WHERE action = 'created' AND entity_type = 'result') as inspections_done,
  COUNT(*) FILTER (WHERE action = 'approved') as approvals_given,
  COUNT(*) FILTER (WHERE action = 'returned') as returns_given,
  COUNT(*) FILTER (WHERE action = 'rejected') as rejections_given,
  COUNT(*) FILTER (WHERE action = 'photo_added') as photos_added,
  COUNT(*) FILTER (WHERE action = 'comment_added') as comments_added,
  MIN(created_at) as first_activity,
  MAX(created_at) as last_activity,
  COUNT(DISTINCT DATE(created_at)) as active_days
FROM inspection_audit_log
GROUP BY project_id, user_email, user_name;

-- 5.3 Daily Activity Stats
DROP VIEW IF EXISTS v_daily_activity_stats;
CREATE VIEW v_daily_activity_stats AS
SELECT
  project_id,
  DATE(created_at) as activity_date,
  COUNT(*) as total_actions,
  COUNT(DISTINCT user_email) as unique_users,
  COUNT(*) FILTER (WHERE action = 'created' AND entity_type = 'result') as inspections_completed,
  COUNT(*) FILTER (WHERE action = 'approved') as items_approved,
  COUNT(*) FILTER (WHERE action = 'returned') as items_returned,
  COUNT(*) FILTER (WHERE is_bulk_action = true) as bulk_actions
FROM inspection_audit_log
GROUP BY project_id, DATE(created_at)
ORDER BY activity_date DESC;

-- 5.4 Bulk Operations Stats
DROP VIEW IF EXISTS v_bulk_operations_stats;
CREATE VIEW v_bulk_operations_stats AS
SELECT
  project_id,
  action_type,
  COUNT(*) as operation_count,
  SUM(affected_count) as total_affected,
  SUM(success_count) as total_success,
  SUM(failure_count) as total_failures,
  AVG(affected_count) as avg_batch_size,
  COUNT(DISTINCT performed_by) as unique_performers
FROM bulk_actions_log
GROUP BY project_id, action_type;

-- 5.5 User Inspection Summary
DROP VIEW IF EXISTS v_user_inspection_summary;
CREATE VIEW v_user_inspection_summary AS
SELECT
  u.id as user_id,
  u.email,
  u.name,
  u.role,
  u.phone,
  u.position,
  u.company,
  u.signature_url IS NOT NULL as has_signature,
  COUNT(DISTINCT r.id) as total_inspections,
  COUNT(DISTINCT r.id) FILTER (WHERE DATE(r.inspected_at) = CURRENT_DATE) as today_inspections,
  COUNT(DISTINCT rp.id) as total_photos,
  COUNT(DISTINCT CASE WHEN pi.review_status = 'approved' THEN r.id END) as approved_inspections,
  COUNT(DISTINCT CASE WHEN pi.review_status = 'returned' THEN r.id END) as returned_inspections,
  MAX(r.inspected_at) as last_inspection_at
FROM trimble_ex_users u
LEFT JOIN inspection_results r ON r.user_email = u.email
LEFT JOIN inspection_result_photos rp ON rp.result_id = r.id
LEFT JOIN inspection_plan_items pi ON r.plan_item_id = pi.id
GROUP BY u.id, u.email, u.name, u.role, u.phone, u.position, u.company, u.signature_url;

-- ============================================================
-- OSA 6: RLS JA ÕIGUSED
-- ============================================================

-- Enable RLS
ALTER TABLE bulk_actions_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_result_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_plan_items ENABLE ROW LEVEL SECURITY;

-- Policies (drop first to avoid duplicates)
DROP POLICY IF EXISTS "bulk_actions_select" ON bulk_actions_log;
CREATE POLICY "bulk_actions_select" ON bulk_actions_log FOR SELECT USING (true);

DROP POLICY IF EXISTS "bulk_actions_insert" ON bulk_actions_log;
CREATE POLICY "bulk_actions_insert" ON bulk_actions_log FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "pdf_exports_all" ON pdf_exports;
CREATE POLICY "pdf_exports_all" ON pdf_exports FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bulk_downloads_all" ON bulk_downloads;
CREATE POLICY "bulk_downloads_all" ON bulk_downloads FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "audit_log_all" ON inspection_audit_log;
CREATE POLICY "audit_log_all" ON inspection_audit_log FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "results_all" ON inspection_results;
CREATE POLICY "results_all" ON inspection_results FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "result_photos_all" ON inspection_result_photos;
CREATE POLICY "result_photos_all" ON inspection_result_photos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "plan_items_all" ON inspection_plan_items;
CREATE POLICY "plan_items_all" ON inspection_plan_items FOR ALL USING (true) WITH CHECK (true);

-- Grants
GRANT ALL ON bulk_actions_log TO authenticated;
GRANT ALL ON bulk_actions_log TO anon;
GRANT ALL ON pdf_exports TO authenticated;
GRANT ALL ON pdf_exports TO anon;
GRANT ALL ON bulk_downloads TO authenticated;
GRANT ALL ON bulk_downloads TO anon;
GRANT SELECT ON v_user_activity_stats TO authenticated, anon;
GRANT SELECT ON v_daily_activity_stats TO authenticated, anon;
GRANT SELECT ON v_bulk_operations_stats TO authenticated, anon;
GRANT SELECT ON v_inspection_photos_gallery TO authenticated, anon;
GRANT SELECT ON v_user_inspection_summary TO authenticated, anon;

-- ============================================================
-- OSA 7: CLEANUP
-- ============================================================

-- Remove helper function
DROP FUNCTION IF EXISTS _add_col_if_missing;

-- ============================================================
-- DONE
-- ============================================================
SELECT 'Migratsioon edukalt lõpetatud!' as status;
