-- ============================================
-- KONTROLLKAVADE SÜSTEEM v3.0 - TÄIELIK MIGRATSIOON
-- Käivita see fail Supabase SQL Editoris
-- ============================================

-- ============================================
-- 1. STORAGE BUCKET ALLKIRJADE JAOKS
-- ============================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('inspection-signatures', 'inspection-signatures', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy allkirjade jaoks
CREATE POLICY IF NOT EXISTS "Signatures are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'inspection-signatures');

CREATE POLICY IF NOT EXISTS "Authenticated users can upload signatures"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'inspection-signatures');

CREATE POLICY IF NOT EXISTS "Users can update own signatures"
ON storage.objects FOR UPDATE
USING (bucket_id = 'inspection-signatures');

CREATE POLICY IF NOT EXISTS "Users can delete own signatures"
ON storage.objects FOR DELETE
USING (bucket_id = 'inspection-signatures');

-- ============================================
-- 2. ELEMENT LIFECYCLE TABEL
-- ============================================

CREATE TABLE IF NOT EXISTS element_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  guid_ifc TEXT NOT NULL,
  assembly_mark TEXT,

  -- Lifecycle states
  arrival_status TEXT DEFAULT 'not_arrived' CHECK (arrival_status IN ('not_arrived', 'arrived', 'damaged', 'rejected')),
  arrival_date TIMESTAMPTZ,
  arrival_vehicle_id UUID,
  arrival_checked_by TEXT,
  arrival_photos TEXT[],

  installation_status TEXT DEFAULT 'not_installed' CHECK (installation_status IN ('not_installed', 'in_progress', 'installed', 'removed')),
  installation_date TIMESTAMPTZ,
  installation_by TEXT,

  inspection_status TEXT DEFAULT 'not_inspected' CHECK (inspection_status IN ('not_inspected', 'in_progress', 'completed', 'failed')),
  last_inspection_date TIMESTAMPTZ,
  last_inspector TEXT,

  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'on_hold')),
  approved_date TIMESTAMPTZ,
  approved_by TEXT,

  -- History
  guid_history JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(trimble_project_id, guid_ifc)
);

CREATE INDEX IF NOT EXISTS idx_element_lifecycle_project ON element_lifecycle(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_element_lifecycle_guid ON element_lifecycle(guid_ifc);
CREATE INDEX IF NOT EXISTS idx_element_lifecycle_assembly ON element_lifecycle(assembly_mark);

-- ============================================
-- 3. AUDIT LOG TABEL
-- ============================================

CREATE TABLE IF NOT EXISTS inspection_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,

  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,

  action TEXT NOT NULL,
  action_category TEXT NOT NULL DEFAULT 'lifecycle',

  old_values JSONB,
  new_values JSONB,
  details JSONB DEFAULT '{}'::jsonb,

  performed_by TEXT NOT NULL,
  performed_by_name TEXT,
  performed_at TIMESTAMPTZ DEFAULT NOW(),

  ip_address INET,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_project ON inspection_audit_log(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON inspection_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON inspection_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at ON inspection_audit_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON inspection_audit_log(performed_by);

-- ============================================
-- 4. CHECKPOINT GROUPS TABEL
-- ============================================

CREATE TABLE IF NOT EXISTS checkpoint_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  inspection_plan_id UUID,

  name TEXT NOT NULL,
  description TEXT,

  element_guids TEXT[] NOT NULL DEFAULT '{}',
  element_count INT GENERATED ALWAYS AS (array_length(element_guids, 1)) STORED,

  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped')),

  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_groups_project ON checkpoint_groups(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_groups_plan ON checkpoint_groups(inspection_plan_id);

-- ============================================
-- 5. OFFLINE UPLOAD QUEUE TABEL
-- ============================================

CREATE TABLE IF NOT EXISTS offline_upload_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,

  upload_type TEXT NOT NULL CHECK (upload_type IN ('photo', 'result', 'signature', 'audit_log')),
  entity_id TEXT,

  payload JSONB NOT NULL,
  file_data TEXT,
  file_name TEXT,
  file_type TEXT,

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count INT DEFAULT 0,
  error_message TEXT,

  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_upload_queue(status);
CREATE INDEX IF NOT EXISTS idx_offline_queue_project ON offline_upload_queue(trimble_project_id);

-- ============================================
-- 6. BULK ACTIONS LOG TABEL
-- ============================================

CREATE TABLE IF NOT EXISTS bulk_actions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,

  action_type TEXT NOT NULL,
  affected_ids TEXT[] NOT NULL,
  affected_count INT NOT NULL,

  parameters JSONB DEFAULT '{}'::jsonb,
  result JSONB DEFAULT '{}'::jsonb,

  performed_by TEXT NOT NULL,
  performed_by_name TEXT,
  performed_at TIMESTAMPTZ DEFAULT NOW(),

  ip_address INET,
  duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_bulk_actions_project ON bulk_actions_log(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_bulk_actions_type ON bulk_actions_log(action_type);
CREATE INDEX IF NOT EXISTS idx_bulk_actions_date ON bulk_actions_log(performed_at DESC);

-- ============================================
-- 7. LISA VEERUD inspection_plan_items TABELILE
-- ============================================

DO $$
BEGIN
  -- Review status columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'review_status') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN review_status TEXT DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'reviewed_at') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN reviewed_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'reviewed_by') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN reviewed_by TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'reviewed_by_name') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN reviewed_by_name TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'review_comment') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN review_comment TEXT;
  END IF;

  -- Assignment columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'assigned_to') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN assigned_to TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'assigned_to_name') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN assigned_to_name TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'assigned_at') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN assigned_at TIMESTAMPTZ;
  END IF;

  -- Lock column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'is_locked') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN is_locked BOOLEAN DEFAULT FALSE;
  END IF;

  -- Group reference
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_plan_items' AND column_name = 'checkpoint_group_id') THEN
    ALTER TABLE inspection_plan_items ADD COLUMN checkpoint_group_id UUID;
  END IF;
END $$;

-- ============================================
-- 8. LISA VEERUD inspection_result_photos TABELILE
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'original_width') THEN
    ALTER TABLE inspection_result_photos ADD COLUMN original_width INT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'original_height') THEN
    ALTER TABLE inspection_result_photos ADD COLUMN original_height INT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'compressed_width') THEN
    ALTER TABLE inspection_result_photos ADD COLUMN compressed_width INT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'compressed_height') THEN
    ALTER TABLE inspection_result_photos ADD COLUMN compressed_height INT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'compressed_size') THEN
    ALTER TABLE inspection_result_photos ADD COLUMN compressed_size INT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'compression_ratio') THEN
    ALTER TABLE inspection_result_photos ADD COLUMN compression_ratio DECIMAL(5,2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'device_info') THEN
    ALTER TABLE inspection_result_photos ADD COLUMN device_info JSONB;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_result_photos' AND column_name = 'gps_coordinates') THEN
    ALTER TABLE inspection_result_photos ADD COLUMN gps_coordinates JSONB;
  END IF;
END $$;

-- ============================================
-- 9. LISA VEERUD trimble_ex_users TABELILE
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trimble_ex_users' AND column_name = 'phone') THEN
    ALTER TABLE trimble_ex_users ADD COLUMN phone TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trimble_ex_users' AND column_name = 'position') THEN
    ALTER TABLE trimble_ex_users ADD COLUMN position TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trimble_ex_users' AND column_name = 'company') THEN
    ALTER TABLE trimble_ex_users ADD COLUMN company TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trimble_ex_users' AND column_name = 'signature_url') THEN
    ALTER TABLE trimble_ex_users ADD COLUMN signature_url TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trimble_ex_users' AND column_name = 'signature_storage_path') THEN
    ALTER TABLE trimble_ex_users ADD COLUMN signature_storage_path TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trimble_ex_users' AND column_name = 'signature_updated_at') THEN
    ALTER TABLE trimble_ex_users ADD COLUMN signature_updated_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trimble_ex_users' AND column_name = 'inspector_prefix') THEN
    ALTER TABLE trimble_ex_users ADD COLUMN inspector_prefix TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trimble_ex_users' AND column_name = 'profile_updated_at') THEN
    ALTER TABLE trimble_ex_users ADD COLUMN profile_updated_at TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================
-- 10. PDF EXPORTS TABEL
-- ============================================

CREATE TABLE IF NOT EXISTS pdf_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,

  export_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INT,

  parameters JSONB DEFAULT '{}'::jsonb,
  item_count INT,

  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  download_count INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pdf_exports_project ON pdf_exports(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_pdf_exports_created ON pdf_exports(created_at DESC);

-- ============================================
-- 11. BULK DOWNLOADS TABEL
-- ============================================

CREATE TABLE IF NOT EXISTS bulk_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,

  download_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INT,

  source_ids TEXT[],
  source_count INT,

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,

  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_bulk_downloads_project ON bulk_downloads(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_bulk_downloads_status ON bulk_downloads(status);

-- ============================================
-- 12. VAATED (VIEWS)
-- ============================================

-- Lifecycle statistics view
CREATE OR REPLACE VIEW v_element_lifecycle_stats AS
SELECT
  trimble_project_id,
  COUNT(*) as total_elements,
  COUNT(*) FILTER (WHERE arrival_status = 'arrived') as arrived_count,
  COUNT(*) FILTER (WHERE installation_status = 'installed') as installed_count,
  COUNT(*) FILTER (WHERE inspection_status = 'completed') as inspected_count,
  COUNT(*) FILTER (WHERE approval_status = 'approved') as approved_count,
  COUNT(*) FILTER (WHERE approval_status = 'rejected') as rejected_count,
  COUNT(*) FILTER (WHERE approval_status = 'pending') as pending_count
FROM element_lifecycle
GROUP BY trimble_project_id;

-- Inspection photos gallery view
CREATE OR REPLACE VIEW v_inspection_photos_gallery AS
SELECT
  p.id,
  p.inspection_result_id,
  p.url,
  p.thumbnail_url,
  p.photo_type,
  p.original_filename,
  p.file_size,
  p.compressed_size,
  p.uploaded_by,
  p.uploaded_by_name,
  p.created_at,
  r.inspection_plan_item_id,
  i.guid_ifc,
  i.trimble_project_id as project_id,
  o.assembly_mark,
  u.name as inspector_name,
  c.name as category_name
FROM inspection_result_photos p
JOIN inspection_results r ON r.id = p.inspection_result_id
JOIN inspection_plan_items i ON i.id = r.inspection_plan_item_id
LEFT JOIN trimble_model_objects o ON o.guid_ifc = i.guid_ifc AND o.trimble_project_id = i.trimble_project_id
LEFT JOIN trimble_ex_users u ON u.email = r.inspector_email AND u.trimble_project_id = i.trimble_project_id
LEFT JOIN inspection_categories c ON c.id = i.inspection_category_id;

-- User inspection summary view
CREATE OR REPLACE VIEW v_user_inspection_summary AS
SELECT
  u.id as user_id,
  u.email,
  u.name,
  u.trimble_project_id,
  u.role,
  u.inspector_prefix,
  COUNT(DISTINCT r.id) as total_inspections,
  COUNT(DISTINCT r.id) FILTER (WHERE i.status = 'completed') as completed_inspections,
  COUNT(DISTINCT p.id) as total_photos,
  MAX(r.created_at) as last_inspection_at
FROM trimble_ex_users u
LEFT JOIN inspection_results r ON r.inspector_email = u.email
LEFT JOIN inspection_plan_items i ON i.id = r.inspection_plan_item_id AND i.trimble_project_id = u.trimble_project_id
LEFT JOIN inspection_result_photos p ON p.inspection_result_id = r.id
GROUP BY u.id, u.email, u.name, u.trimble_project_id, u.role, u.inspector_prefix;

-- ============================================
-- 13. FUNKTSIOONID
-- ============================================

-- Bulk approve function
CREATE OR REPLACE FUNCTION bulk_approve_inspections(
  p_plan_item_ids UUID[],
  p_reviewer_email TEXT,
  p_reviewer_name TEXT,
  p_comment TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_count INT := 0;
  v_failed_count INT := 0;
  v_item_id UUID;
  v_project_id TEXT;
BEGIN
  FOREACH v_item_id IN ARRAY p_plan_item_ids
  LOOP
    BEGIN
      UPDATE inspection_plan_items
      SET
        review_status = 'approved',
        reviewed_at = NOW(),
        reviewed_by = p_reviewer_email,
        reviewed_by_name = p_reviewer_name,
        review_comment = p_comment,
        updated_at = NOW()
      WHERE id = v_item_id
      AND (review_status IS NULL OR review_status != 'approved')
      RETURNING trimble_project_id INTO v_project_id;

      IF FOUND THEN
        v_updated_count := v_updated_count + 1;

        INSERT INTO inspection_audit_log (
          trimble_project_id, entity_type, entity_id, action, action_category,
          details, performed_by, performed_by_name, ip_address
        ) VALUES (
          v_project_id, 'plan_item', v_item_id::TEXT, 'approved', 'review',
          jsonb_build_object('comment', p_comment, 'bulk', true),
          p_reviewer_email, p_reviewer_name, p_ip_address
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed_count := v_failed_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'updated_count', v_updated_count,
    'failed_count', v_failed_count,
    'total', array_length(p_plan_item_ids, 1)
  );
END;
$$;

-- Bulk return function
CREATE OR REPLACE FUNCTION bulk_return_inspections(
  p_plan_item_ids UUID[],
  p_reviewer_email TEXT,
  p_reviewer_name TEXT,
  p_comment TEXT,
  p_ip_address INET DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_count INT := 0;
  v_failed_count INT := 0;
  v_item_id UUID;
  v_project_id TEXT;
BEGIN
  IF p_comment IS NULL OR p_comment = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Comment is required for return');
  END IF;

  FOREACH v_item_id IN ARRAY p_plan_item_ids
  LOOP
    BEGIN
      UPDATE inspection_plan_items
      SET
        review_status = 'returned',
        status = 'in_progress',
        reviewed_at = NOW(),
        reviewed_by = p_reviewer_email,
        reviewed_by_name = p_reviewer_name,
        review_comment = p_comment,
        updated_at = NOW()
      WHERE id = v_item_id
      RETURNING trimble_project_id INTO v_project_id;

      IF FOUND THEN
        v_updated_count := v_updated_count + 1;

        INSERT INTO inspection_audit_log (
          trimble_project_id, entity_type, entity_id, action, action_category,
          details, performed_by, performed_by_name, ip_address
        ) VALUES (
          v_project_id, 'plan_item', v_item_id::TEXT, 'returned', 'review',
          jsonb_build_object('comment', p_comment, 'bulk', true),
          p_reviewer_email, p_reviewer_name, p_ip_address
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed_count := v_failed_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'updated_count', v_updated_count,
    'failed_count', v_failed_count,
    'total', array_length(p_plan_item_ids, 1)
  );
END;
$$;

-- Bulk assign function
CREATE OR REPLACE FUNCTION bulk_assign_reviewer(
  p_plan_item_ids UUID[],
  p_assignee_email TEXT,
  p_assignee_name TEXT,
  p_assigner_email TEXT,
  p_assigner_name TEXT,
  p_ip_address INET DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_count INT := 0;
  v_failed_count INT := 0;
  v_item_id UUID;
  v_project_id TEXT;
BEGIN
  FOREACH v_item_id IN ARRAY p_plan_item_ids
  LOOP
    BEGIN
      UPDATE inspection_plan_items
      SET
        assigned_to = p_assignee_email,
        assigned_to_name = p_assignee_name,
        assigned_at = NOW(),
        updated_at = NOW()
      WHERE id = v_item_id
      RETURNING trimble_project_id INTO v_project_id;

      IF FOUND THEN
        v_updated_count := v_updated_count + 1;

        INSERT INTO inspection_audit_log (
          trimble_project_id, entity_type, entity_id, action, action_category,
          details, performed_by, performed_by_name, ip_address
        ) VALUES (
          v_project_id, 'plan_item', v_item_id::TEXT, 'assigned', 'lifecycle',
          jsonb_build_object('assigned_to', p_assignee_email, 'assigned_to_name', p_assignee_name, 'bulk', true),
          p_assigner_email, p_assigner_name, p_ip_address
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed_count := v_failed_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'updated_count', v_updated_count,
    'failed_count', v_failed_count,
    'total', array_length(p_plan_item_ids, 1)
  );
END;
$$;

-- Get inspection history function
CREATE OR REPLACE FUNCTION get_inspection_history(
  p_plan_item_id UUID
)
RETURNS TABLE (
  id UUID,
  action TEXT,
  action_category TEXT,
  action_at TIMESTAMPTZ,
  action_by TEXT,
  action_by_name TEXT,
  old_values JSONB,
  new_values JSONB,
  details JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.action,
    a.action_category,
    a.performed_at as action_at,
    a.performed_by as action_by,
    a.performed_by_name as action_by_name,
    a.old_values,
    a.new_values,
    a.details
  FROM inspection_audit_log a
  WHERE a.entity_id = p_plan_item_id::TEXT
  AND a.entity_type IN ('plan_item', 'inspection_plan_item')
  ORDER BY a.performed_at DESC;
END;
$$;

-- Change element GUID function
CREATE OR REPLACE FUNCTION change_element_guid(
  p_plan_item_id UUID,
  p_old_guid TEXT,
  p_new_guid TEXT,
  p_user_email TEXT,
  p_user_name TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id TEXT;
BEGIN
  SELECT trimble_project_id INTO v_project_id
  FROM inspection_plan_items
  WHERE id = p_plan_item_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE inspection_plan_items
  SET
    guid_ifc = p_new_guid,
    updated_at = NOW()
  WHERE id = p_plan_item_id;

  UPDATE element_lifecycle
  SET
    guid_history = guid_history || jsonb_build_object(
      'old_guid', p_old_guid,
      'new_guid', p_new_guid,
      'changed_at', NOW(),
      'changed_by', p_user_email
    ),
    guid_ifc = p_new_guid,
    updated_at = NOW()
  WHERE trimble_project_id = v_project_id
  AND guid_ifc = p_old_guid;

  INSERT INTO inspection_audit_log (
    trimble_project_id, entity_type, entity_id, action, action_category,
    old_values, new_values, performed_by, performed_by_name
  ) VALUES (
    v_project_id, 'plan_item', p_plan_item_id::TEXT, 'guid_changed', 'system',
    jsonb_build_object('guid_ifc', p_old_guid),
    jsonb_build_object('guid_ifc', p_new_guid),
    p_user_email, p_user_name
  );

  RETURN TRUE;
END;
$$;

-- ============================================
-- 14. TRIGGERID
-- ============================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_element_lifecycle') THEN
    CREATE TRIGGER set_timestamp_element_lifecycle
      BEFORE UPDATE ON element_lifecycle
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_timestamp();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_timestamp_checkpoint_groups') THEN
    CREATE TRIGGER set_timestamp_checkpoint_groups
      BEFORE UPDATE ON checkpoint_groups
      FOR EACH ROW
      EXECUTE FUNCTION trigger_set_timestamp();
  END IF;
END $$;

-- ============================================
-- VALMIS!
-- ============================================

SELECT 'Kontrollkavade süsteem v3.0 migratsioon lõpetatud!' as status;
