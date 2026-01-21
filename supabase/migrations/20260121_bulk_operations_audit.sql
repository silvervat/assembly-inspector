-- ============================================================
-- BULK OPERATSIOONID JA TÄIUSTATUD AUDIT LOG
-- Assembly Inspector Pro v3.0 - Lisa migratsioon
-- Kuupäev: 2026-01-21
-- ============================================================

-- ============================================================
-- 1. TÄIUSTATUD AUDIT LOG TABEL
-- Detailsem tegevuste ajalugu
-- ============================================================

-- Lisa puuduvad veerud kui tabel juba eksisteerib
ALTER TABLE inspection_audit_log
  ADD COLUMN IF NOT EXISTS action_category TEXT DEFAULT 'general'
    CHECK (action_category IN ('lifecycle', 'inspection', 'review', 'photo', 'comment', 'admin', 'system')),
  ADD COLUMN IF NOT EXISTS related_entity_type TEXT,
  ADD COLUMN IF NOT EXISTS related_entity_id UUID,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms INT,
  ADD COLUMN IF NOT EXISTS is_bulk_action BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS bulk_action_id UUID;

-- Index bulk tegevuste jaoks
CREATE INDEX IF NOT EXISTS idx_audit_log_bulk ON inspection_audit_log(bulk_action_id) WHERE bulk_action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_category ON inspection_audit_log(action_category);

-- ============================================================
-- 2. BULK ACTIONS LOG TABEL
-- Salvestab bulk operatsioonide koondinfo
-- ============================================================

CREATE TABLE IF NOT EXISTS bulk_actions_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,

  -- Operatsiooni info
  action_type TEXT NOT NULL CHECK (action_type IN (
    'bulk_approve',
    'bulk_reject',
    'bulk_return',
    'bulk_status_change',
    'bulk_assign',
    'bulk_priority_change',
    'bulk_delete',
    'bulk_export'
  )),

  -- Mõjutatud kirjed
  affected_entity_ids UUID[] NOT NULL,
  affected_count INT GENERATED ALWAYS AS (array_length(affected_entity_ids, 1)) STORED,

  -- Muutused
  changes JSONB,  -- { "status": "approved", "comment": "Bulk kinnitatud" }

  -- Kasutaja info
  performed_by TEXT NOT NULL,
  performed_by_name TEXT,
  performed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Tulemus
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  failures JSONB,  -- [{ "entity_id": "...", "error": "..." }]

  -- Metadata
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_bulk_actions_project ON bulk_actions_log(project_id);
CREATE INDEX IF NOT EXISTS idx_bulk_actions_performed ON bulk_actions_log(performed_at DESC);

-- ============================================================
-- 3. BULK OPERATSIOONIDE FUNKTSIOONID
-- ============================================================

-- 3.1 Bulk Approve - Kinnita mitu kontrollpunkti korraga
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
      -- Leia kirje
      SELECT * INTO v_item FROM inspection_plan_items WHERE id = v_item_id;

      -- Kontrolli kas saab kinnitada (peab olema 'completed' staatuses)
      IF v_item.status != 'completed' AND v_item.review_status != 'pending' THEN
        v_failure := v_failure + 1;
        v_results := v_results || jsonb_build_object(
          'entity_id', v_item_id,
          'success', false,
          'error', 'Vale staatus: ' || COALESCE(v_item.status, 'null')
        );
        CONTINUE;
      END IF;

      -- Uuenda kirje
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

      -- Uuenda lifecycle kui olemas
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

      -- Lisa audit log
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

  -- Salvesta bulk action log
  INSERT INTO bulk_actions_log (
    id, project_id, action_type, affected_entity_ids, changes,
    performed_by, performed_by_name, success_count, failure_count, failures,
    ip_address, user_agent
  ) VALUES (
    v_bulk_id, v_project_id, 'bulk_approve', p_plan_item_ids,
    jsonb_build_object('review_status', 'approved', 'comment', p_comment),
    p_reviewer_email, p_reviewer_name, v_success, v_failure,
    (SELECT jsonb_agg(r) FROM jsonb_array_elements(v_results) r WHERE (r->>'success')::boolean = false),
    p_ip_address, p_user_agent
  );

  RETURN QUERY SELECT v_success, v_failure, v_results;
END;
$$ LANGUAGE plpgsql;


-- 3.2 Bulk Return - Suuna mitu tagasi parandamiseks
CREATE OR REPLACE FUNCTION bulk_return_inspections(
  p_plan_item_ids UUID[],
  p_reviewer_email TEXT,
  p_reviewer_name TEXT,
  p_comment TEXT,  -- Kohustuslik
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
  -- Kontrolli et kommentaar on olemas
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

      -- Uuenda kirje
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

      -- Uuenda lifecycle
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

      -- Audit log
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

  -- Bulk log
  INSERT INTO bulk_actions_log (
    id, project_id, action_type, affected_entity_ids, changes,
    performed_by, performed_by_name, success_count, failure_count,
    ip_address, user_agent
  ) VALUES (
    v_bulk_id, v_project_id, 'bulk_return', p_plan_item_ids,
    jsonb_build_object('review_status', 'returned', 'comment', p_comment),
    p_reviewer_email, p_reviewer_name, v_success, v_failure,
    p_ip_address, p_user_agent
  );

  RETURN QUERY SELECT v_success, v_failure, v_results;
END;
$$ LANGUAGE plpgsql;


-- 3.3 Bulk Status Change - Muuda mitme staatust korraga
CREATE OR REPLACE FUNCTION bulk_change_status(
  p_plan_item_ids UUID[],
  p_new_status TEXT,
  p_user_email TEXT,
  p_user_name TEXT,
  p_comment TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL
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
  v_old_status TEXT;
BEGIN
  SELECT ipi.project_id INTO v_project_id
  FROM inspection_plan_items ipi
  WHERE ipi.id = p_plan_item_ids[1];

  FOREACH v_item_id IN ARRAY p_plan_item_ids
  LOOP
    BEGIN
      -- Saa vana staatus
      SELECT status INTO v_old_status FROM inspection_plan_items WHERE id = v_item_id;

      -- Uuenda
      UPDATE inspection_plan_items
      SET
        status = p_new_status,
        updated_at = NOW()
      WHERE id = v_item_id;

      -- Audit log
      INSERT INTO inspection_audit_log (
        project_id, entity_type, entity_id, action, action_category,
        old_values, new_values, user_email, user_name, ip_address,
        is_bulk_action, bulk_action_id
      ) VALUES (
        v_project_id, 'plan_item', v_item_id, 'status_changed', 'inspection',
        jsonb_build_object('status', v_old_status),
        jsonb_build_object('status', p_new_status, 'comment', p_comment),
        p_user_email, p_user_name, p_ip_address,
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
    performed_by, performed_by_name, success_count, failure_count, ip_address
  ) VALUES (
    v_bulk_id, v_project_id, 'bulk_status_change', p_plan_item_ids,
    jsonb_build_object('new_status', p_new_status),
    p_user_email, p_user_name, v_success, v_failure, p_ip_address
  );

  RETURN QUERY SELECT v_success, v_failure, v_results;
END;
$$ LANGUAGE plpgsql;


-- 3.4 Bulk Assign - Määra ülevaataja mitmele korraga
CREATE OR REPLACE FUNCTION bulk_assign_reviewer(
  p_plan_item_ids UUID[],
  p_reviewer_email TEXT,
  p_reviewer_name TEXT,
  p_assigned_by_email TEXT,
  p_assigned_by_name TEXT,
  p_ip_address TEXT DEFAULT NULL
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
  SELECT ipi.project_id INTO v_project_id
  FROM inspection_plan_items ipi
  WHERE ipi.id = p_plan_item_ids[1];

  FOREACH v_item_id IN ARRAY p_plan_item_ids
  LOOP
    BEGIN
      -- Lisa assigned_reviewer veerg kui pole olemas (eraldi migratsioonis)
      UPDATE inspection_plan_items
      SET
        reviewed_by = p_reviewer_email,
        reviewed_by_name = p_reviewer_name,
        updated_at = NOW()
      WHERE id = v_item_id;

      -- Audit log
      INSERT INTO inspection_audit_log (
        project_id, entity_type, entity_id, action, action_category,
        new_values, user_email, user_name, ip_address,
        is_bulk_action, bulk_action_id
      ) VALUES (
        v_project_id, 'plan_item', v_item_id, 'assigned', 'admin',
        jsonb_build_object('assigned_to', p_reviewer_email, 'assigned_to_name', p_reviewer_name),
        p_assigned_by_email, p_assigned_by_name, p_ip_address,
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
    performed_by, performed_by_name, success_count, failure_count, ip_address
  ) VALUES (
    v_bulk_id, v_project_id, 'bulk_assign', p_plan_item_ids,
    jsonb_build_object('assigned_to', p_reviewer_email),
    p_assigned_by_email, p_assigned_by_name, v_success, v_failure, p_ip_address
  );

  RETURN QUERY SELECT v_success, v_failure, v_results;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 4. AJALOO PÄRINGUD
-- ============================================================

-- 4.1 Saa kontrollpunkti täielik ajalugu
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
    -- Ikooni määramine tegevuse põhjal
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


-- 4.2 Saa detaili elutsükli ajalugu (kombineeritud)
CREATE OR REPLACE FUNCTION get_element_full_history(
  p_guid TEXT,
  p_project_id TEXT
) RETURNS TABLE (
  event_type TEXT,
  event_at TIMESTAMPTZ,
  event_by TEXT,
  event_by_name TEXT,
  details JSONB,
  icon TEXT,
  color TEXT
) AS $$
BEGIN
  RETURN QUERY

  -- Elutsükli sündmused
  SELECT
    'arrived' as event_type,
    el.arrived_at as event_at,
    el.arrived_by as event_by,
    el.arrived_by_name as event_by_name,
    jsonb_build_object('delivery_vehicle_id', el.delivery_vehicle_id) as details,
    'B' as icon,
    '#3B82F6' as color
  FROM element_lifecycle el
  WHERE el.guid = p_guid AND el.project_id = p_project_id AND el.arrived_at IS NOT NULL

  UNION ALL

  SELECT
    'arrival_checked' as event_type,
    el.arrival_checked_at,
    el.arrival_checked_by,
    el.arrival_checked_by_name,
    jsonb_build_object('result', el.arrival_check_result, 'notes', el.arrival_check_notes),
    'V' as icon,
    CASE el.arrival_check_result WHEN 'ok' THEN '#10B981' ELSE '#EF4444' END
  FROM element_lifecycle el
  WHERE el.guid = p_guid AND el.project_id = p_project_id AND el.arrival_checked_at IS NOT NULL

  UNION ALL

  SELECT
    'installed' as event_type,
    el.installed_at,
    el.installed_by,
    el.installed_by_name,
    jsonb_build_object('resource_id', el.installation_resource_id),
    'I' as icon,
    '#8B5CF6'
  FROM element_lifecycle el
  WHERE el.guid = p_guid AND el.project_id = p_project_id AND el.installed_at IS NOT NULL

  UNION ALL

  -- Audit log sündmused
  SELECT
    al.action as event_type,
    al.created_at as event_at,
    al.user_email as event_by,
    al.user_name as event_by_name,
    COALESCE(al.new_values, al.old_values) as details,
    CASE al.action
      WHEN 'created' THEN '+'
      WHEN 'approved' THEN 'A'
      WHEN 'rejected' THEN 'X'
      WHEN 'returned' THEN 'R'
      WHEN 'photo_added' THEN 'P'
      WHEN 'comment_added' THEN 'C'
      WHEN 'status_changed' THEN 'S'
      ELSE 'I'
    END as icon,
    CASE al.action
      WHEN 'approved' THEN '#10B981'
      WHEN 'rejected' THEN '#EF4444'
      WHEN 'returned' THEN '#F97316'
      ELSE '#6B7280'
    END as color
  FROM inspection_audit_log al
  JOIN inspection_plan_items pi ON al.entity_id = pi.id
  WHERE pi.guid = p_guid
    AND pi.project_id = p_project_id
    AND al.entity_type = 'plan_item'

  ORDER BY event_at DESC;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 5. STATISTIKA VAATED
-- ============================================================

-- 5.1 Kasutaja tegevuste statistika
CREATE OR REPLACE VIEW v_user_activity_stats AS
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


-- 5.2 Päevane tegevuste statistika
CREATE OR REPLACE VIEW v_daily_activity_stats AS
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


-- 5.3 Bulk operatsioonide statistika
CREATE OR REPLACE VIEW v_bulk_operations_stats AS
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


-- ============================================================
-- 6. RLS JA ÕIGUSED
-- ============================================================

ALTER TABLE bulk_actions_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bulk_actions_select" ON bulk_actions_log;
CREATE POLICY "bulk_actions_select" ON bulk_actions_log FOR SELECT USING (true);

DROP POLICY IF EXISTS "bulk_actions_insert" ON bulk_actions_log;
CREATE POLICY "bulk_actions_insert" ON bulk_actions_log FOR INSERT WITH CHECK (true);

GRANT ALL ON bulk_actions_log TO authenticated;
GRANT ALL ON bulk_actions_log TO anon;
GRANT SELECT ON v_user_activity_stats TO authenticated, anon;
GRANT SELECT ON v_daily_activity_stats TO authenticated, anon;
GRANT SELECT ON v_bulk_operations_stats TO authenticated, anon;


-- ============================================================
-- KOMMENTAARID
-- ============================================================

COMMENT ON FUNCTION bulk_approve_inspections IS 'Kinnita mitu kontrollpunkti korraga, salvestab audit logi ja bulk action logi';
COMMENT ON FUNCTION bulk_return_inspections IS 'Suuna mitu kontrollpunkti tagasi parandamiseks';
COMMENT ON FUNCTION bulk_change_status IS 'Muuda mitme kontrollpunkti staatust korraga';
COMMENT ON FUNCTION bulk_assign_reviewer IS 'Määra ülevaataja mitmele kontrollpunktile korraga';
COMMENT ON FUNCTION get_inspection_history IS 'Saa kontrollpunkti täielik tegevuste ajalugu';
COMMENT ON FUNCTION get_element_full_history IS 'Saa detaili kogu elutsükli ajalugu (saabumine, paigaldus, kontrollid)';
COMMENT ON TABLE bulk_actions_log IS 'Bulk operatsioonide koondlogi';
