-- ============================================================
-- KONTROLLKAVADE SÜSTEEMI TÄIUSTUSED v3.0
-- Assembly Inspector Pro
-- Kuupäev: 2026-01-21
-- ============================================================

-- ============================================================
-- 1. ELEMENT LIFECYCLE TABLE
-- Detaili täielik elutsükkel: saabumine -> paigaldus -> kontroll -> kinnitus
-- ============================================================

CREATE TABLE IF NOT EXISTS element_lifecycle (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Projekti ja mudeli info
  project_id TEXT NOT NULL,
  model_id TEXT,
  
  -- Detaili identifikaatorid
  guid TEXT NOT NULL,
  guid_ifc TEXT,
  guid_ms TEXT,
  guid_history JSONB DEFAULT '[]'::jsonb,  -- Varasemate GUID-ide ajalugu [{old_guid, changed_at, changed_by}]
  
  -- Detaili andmed
  assembly_mark TEXT,
  object_name TEXT,
  object_type TEXT,
  product_name TEXT,
  
  -- ===============================
  -- SAABUMINE
  -- ===============================
  delivery_vehicle_id UUID,                 -- Viide delivery_vehicles tabelile
  arrived_at TIMESTAMPTZ,                   -- Millal saabus objektile
  arrived_by TEXT,                          -- Kes võttis vastu (email)
  arrived_by_name TEXT,                     -- Vastuvõtja nimi
  
  -- Saabumise kontroll
  arrival_checked_at TIMESTAMPTZ,
  arrival_checked_by TEXT,
  arrival_checked_by_name TEXT,
  arrival_check_result TEXT CHECK (arrival_check_result IN ('ok', 'damaged', 'missing_parts', 'wrong_item')),
  arrival_check_notes TEXT,
  
  -- ===============================
  -- PAIGALDAMINE
  -- ===============================
  installed_at TIMESTAMPTZ,                 -- Millal paigaldati
  installed_by TEXT,                        -- Kes paigaldas (email)
  installed_by_name TEXT,                   -- Paigaldaja nimi
  installation_resource_id UUID,            -- Viide project_resources tabelile
  installation_schedule_id UUID,            -- Viide installation_schedule tabelile
  installation_notes TEXT,
  
  -- ===============================
  -- INSPEKTSIOON
  -- ===============================
  inspection_status TEXT DEFAULT 'not_started' CHECK (inspection_status IN (
    'not_started',      -- Pole alustatud
    'in_progress',      -- Käimas
    'completed',        -- Kasutaja lõpetanud
    'approved',         -- Moderaator kinnitanud
    'rejected',         -- Tagasi lükatud
    'returned'          -- Tagasi suunatud parandamiseks
  )),
  
  inspection_started_at TIMESTAMPTZ,
  inspection_started_by TEXT,
  inspection_completed_at TIMESTAMPTZ,
  inspection_completed_by TEXT,
  
  -- ===============================
  -- ÜLEVAATUS (Moderaator/Admin)
  -- ===============================
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  reviewed_by_name TEXT,
  review_decision TEXT CHECK (review_decision IN ('approved', 'rejected', 'returned')),
  review_comment TEXT,
  
  -- Kas kasutaja saab veel muuta
  can_edit BOOLEAN DEFAULT true,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  UNIQUE(project_id, guid)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_element_lifecycle_project ON element_lifecycle(project_id);
CREATE INDEX IF NOT EXISTS idx_element_lifecycle_guid ON element_lifecycle(guid);
CREATE INDEX IF NOT EXISTS idx_element_lifecycle_assembly_mark ON element_lifecycle(assembly_mark);
CREATE INDEX IF NOT EXISTS idx_element_lifecycle_status ON element_lifecycle(inspection_status);
CREATE INDEX IF NOT EXISTS idx_element_lifecycle_arrived ON element_lifecycle(arrived_at) WHERE arrived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_element_lifecycle_installed ON element_lifecycle(installed_at) WHERE installed_at IS NOT NULL;

-- ============================================================
-- 2. AUDIT LOG TABLE
-- Täielik tegevuste ajalugu
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Projekti info
  project_id TEXT NOT NULL,
  
  -- Seotud objekt
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'element',          -- element_lifecycle
    'checkpoint',       -- inspection_checkpoints
    'result',           -- inspection_results
    'plan_item',        -- inspection_plan_items
    'category',         -- inspection_categories
    'group',            -- checkpoint_groups
    'photo'             -- inspection_result_photos
  )),
  entity_id UUID NOT NULL,
  
  -- Mis juhtus
  action TEXT NOT NULL CHECK (action IN (
    'created',
    'updated',
    'deleted',
    'status_changed',
    'guid_changed',
    'reviewed',
    'approved',
    'rejected',
    'returned',
    'locked',
    'unlocked',
    'photo_added',
    'photo_deleted',
    'comment_added',
    'comment_edited',
    'assigned',
    'unassigned'
  )),
  
  -- Muutused
  old_values JSONB,
  new_values JSONB,
  
  -- Kes tegi
  user_email TEXT NOT NULL,
  user_name TEXT,
  user_role TEXT,
  
  -- Kust tegi
  ip_address TEXT,
  user_agent TEXT,
  device_info JSONB,
  
  -- Millal
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit log
CREATE INDEX IF NOT EXISTS idx_audit_log_project ON inspection_audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON inspection_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON inspection_audit_log(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON inspection_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON inspection_audit_log(created_at DESC);

-- ============================================================
-- 3. CHECKPOINT GROUPS TABLE
-- Grupeeritud kontrollpunktid (mitu detaili = üks kontroll)
-- ============================================================

CREATE TABLE IF NOT EXISTS checkpoint_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Projekti ja kategooria info
  project_id TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES inspection_categories(id) ON DELETE CASCADE,
  
  -- Grupi info
  name TEXT NOT NULL,                       -- "Tala T-15 komplekt"
  description TEXT,
  
  -- Grupi liikmed
  element_guids TEXT[] NOT NULL,            -- Kõik GUID-id grupis
  element_count INT GENERATED ALWAYS AS (array_length(element_guids, 1)) STORED,
  
  -- Mudeli info (visualiseerimiseks)
  model_id TEXT,
  primary_guid TEXT,                        -- Peamine GUID (mida kuvada nimes)
  
  -- Staatus
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  created_by TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_checkpoint_groups_project ON checkpoint_groups(project_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_groups_category ON checkpoint_groups(category_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_groups_guids ON checkpoint_groups USING GIN(element_guids);

-- ============================================================
-- 4. ALTER EXISTING TABLES
-- Lisa uued veerud olemasolevatesse tabelitesse
-- ============================================================

-- 4.1 inspection_plan_items - lisa uued veerud
ALTER TABLE inspection_plan_items 
  ADD COLUMN IF NOT EXISTS checkpoint_group_id UUID REFERENCES checkpoint_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS element_lifecycle_id UUID REFERENCES element_lifecycle(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected', 'returned')),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS review_comment TEXT,
  ADD COLUMN IF NOT EXISTS can_edit BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT;

-- 4.2 inspection_results - lisa photo_type veerg kui puudub
ALTER TABLE inspection_result_photos
  ADD COLUMN IF NOT EXISTS photo_type TEXT DEFAULT 'user' CHECK (photo_type IN ('user', 'snapshot_3d', 'topview', 'arrival', 'damage'));

-- 4.3 inspection_checkpoints - lisa support materials veerud
ALTER TABLE inspection_checkpoints
  ADD COLUMN IF NOT EXISTS support_video_url TEXT,
  ADD COLUMN IF NOT EXISTS support_document_urls TEXT[],
  ADD COLUMN IF NOT EXISTS auto_escalate_responses TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS escalate_to_role TEXT DEFAULT 'moderator';

-- ============================================================
-- 5. OFFLINE UPLOAD QUEUE TABLE
-- Täiustatud offline piltide järjekord
-- ============================================================

CREATE TABLE IF NOT EXISTS offline_upload_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Projekti info
  project_id TEXT NOT NULL,
  
  -- Üleslaadimise tüüp
  upload_type TEXT NOT NULL CHECK (upload_type IN ('photo', 'result', 'result_photo')),
  
  -- Seotud objekt
  entity_type TEXT,
  entity_id UUID,
  
  -- Andmed
  data JSONB NOT NULL,
  
  -- Faili info (piltide jaoks)
  file_name TEXT,
  file_size BIGINT,
  mime_type TEXT,
  blob_hash TEXT,                           -- SHA256 hash duplikaatide vältimiseks
  
  -- Staatus
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'completed', 'failed')),
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 5,
  last_error TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Kasutaja info
  created_by TEXT,
  device_id TEXT
);

-- Index
CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_upload_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_offline_queue_project ON offline_upload_queue(project_id);

-- ============================================================
-- 6. TRIGGERS FOR AUTO-UPDATE AND AUDIT
-- ============================================================

-- 6.1 Update timestamp trigger
CREATE OR REPLACE FUNCTION update_element_lifecycle_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS element_lifecycle_updated_at ON element_lifecycle;
CREATE TRIGGER element_lifecycle_updated_at
  BEFORE UPDATE ON element_lifecycle
  FOR EACH ROW EXECUTE FUNCTION update_element_lifecycle_timestamp();

DROP TRIGGER IF EXISTS checkpoint_groups_updated_at ON checkpoint_groups;
CREATE TRIGGER checkpoint_groups_updated_at
  BEFORE UPDATE ON checkpoint_groups
  FOR EACH ROW EXECUTE FUNCTION update_element_lifecycle_timestamp();

-- 6.2 Audit log trigger for element_lifecycle
CREATE OR REPLACE FUNCTION audit_element_lifecycle_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO inspection_audit_log (project_id, entity_type, entity_id, action, new_values, user_email, user_name)
    VALUES (NEW.project_id, 'element', NEW.id, 'created', to_jsonb(NEW), COALESCE(NEW.arrived_by, 'system'), COALESCE(NEW.arrived_by_name, 'System'));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Log status changes
    IF OLD.inspection_status IS DISTINCT FROM NEW.inspection_status THEN
      INSERT INTO inspection_audit_log (project_id, entity_type, entity_id, action, old_values, new_values, user_email)
      VALUES (NEW.project_id, 'element', NEW.id, 'status_changed', 
        jsonb_build_object('inspection_status', OLD.inspection_status),
        jsonb_build_object('inspection_status', NEW.inspection_status),
        COALESCE(NEW.reviewed_by, NEW.inspection_completed_by, 'system'));
    END IF;
    -- Log GUID changes
    IF OLD.guid IS DISTINCT FROM NEW.guid THEN
      INSERT INTO inspection_audit_log (project_id, entity_type, entity_id, action, old_values, new_values, user_email)
      VALUES (NEW.project_id, 'element', NEW.id, 'guid_changed',
        jsonb_build_object('guid', OLD.guid),
        jsonb_build_object('guid', NEW.guid),
        COALESCE(NEW.locked_by, 'system'));
      -- Update guid_history
      NEW.guid_history = OLD.guid_history || jsonb_build_array(jsonb_build_object(
        'old_guid', OLD.guid,
        'changed_at', NOW(),
        'changed_by', COALESCE(NEW.locked_by, 'system')
      ));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO inspection_audit_log (project_id, entity_type, entity_id, action, old_values, user_email)
    VALUES (OLD.project_id, 'element', OLD.id, 'deleted', to_jsonb(OLD), 'system');
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_element_lifecycle ON element_lifecycle;
CREATE TRIGGER audit_element_lifecycle
  AFTER INSERT OR UPDATE OR DELETE ON element_lifecycle
  FOR EACH ROW EXECUTE FUNCTION audit_element_lifecycle_changes();

-- 6.3 Audit log trigger for inspection_results
CREATE OR REPLACE FUNCTION audit_inspection_results_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO inspection_audit_log (project_id, entity_type, entity_id, action, new_values, user_email, user_name)
    VALUES (NEW.project_id, 'result', NEW.id, 'created', to_jsonb(NEW), COALESCE(NEW.user_email, 'system'), NEW.inspector_name);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO inspection_audit_log (project_id, entity_type, entity_id, action, old_values, new_values, user_email)
    VALUES (NEW.project_id, 'result', NEW.id, 'updated', to_jsonb(OLD), to_jsonb(NEW), COALESCE(NEW.user_email, 'system'));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO inspection_audit_log (project_id, entity_type, entity_id, action, old_values, user_email)
    VALUES (OLD.project_id, 'result', OLD.id, 'deleted', to_jsonb(OLD), 'system');
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_inspection_results ON inspection_results;
CREATE TRIGGER audit_inspection_results
  AFTER INSERT OR UPDATE OR DELETE ON inspection_results
  FOR EACH ROW EXECUTE FUNCTION audit_inspection_results_changes();

-- ============================================================
-- 7. VIEWS FOR STATISTICS
-- ============================================================

-- 7.1 Element lifecycle overview
CREATE OR REPLACE VIEW v_element_lifecycle_stats AS
SELECT
  project_id,
  COUNT(*) as total_elements,
  COUNT(*) FILTER (WHERE arrived_at IS NOT NULL) as arrived_count,
  COUNT(*) FILTER (WHERE arrival_checked_at IS NOT NULL) as arrival_checked_count,
  COUNT(*) FILTER (WHERE installed_at IS NOT NULL) as installed_count,
  COUNT(*) FILTER (WHERE inspection_status = 'not_started') as pending_inspection_count,
  COUNT(*) FILTER (WHERE inspection_status = 'in_progress') as in_progress_count,
  COUNT(*) FILTER (WHERE inspection_status = 'completed') as awaiting_review_count,
  COUNT(*) FILTER (WHERE inspection_status = 'approved') as approved_count,
  COUNT(*) FILTER (WHERE inspection_status = 'rejected') as rejected_count,
  COUNT(*) FILTER (WHERE inspection_status = 'returned') as returned_count,
  ROUND(
    COUNT(*) FILTER (WHERE inspection_status = 'approved')::numeric / 
    NULLIF(COUNT(*)::numeric, 0) * 100, 1
  ) as completion_percentage
FROM element_lifecycle
GROUP BY project_id;

-- 7.2 User activity stats
CREATE OR REPLACE VIEW v_user_inspection_stats AS
SELECT
  project_id,
  user_email,
  COUNT(*) as total_actions,
  COUNT(*) FILTER (WHERE action = 'created') as items_created,
  COUNT(*) FILTER (WHERE action = 'status_changed') as status_changes,
  COUNT(*) FILTER (WHERE action = 'approved') as approvals,
  COUNT(*) FILTER (WHERE action = 'rejected') as rejections,
  COUNT(*) FILTER (WHERE action = 'returned') as returns,
  MIN(created_at) as first_action_at,
  MAX(created_at) as last_action_at
FROM inspection_audit_log
GROUP BY project_id, user_email;

-- 7.3 Daily activity
CREATE OR REPLACE VIEW v_daily_inspection_activity AS
SELECT
  project_id,
  DATE(created_at) as activity_date,
  COUNT(*) as total_actions,
  COUNT(DISTINCT user_email) as unique_users,
  COUNT(*) FILTER (WHERE entity_type = 'result') as inspection_results,
  COUNT(*) FILTER (WHERE action = 'approved') as approvals
FROM inspection_audit_log
GROUP BY project_id, DATE(created_at)
ORDER BY activity_date DESC;

-- ============================================================
-- 8. FUNCTIONS FOR COMMON OPERATIONS
-- ============================================================

-- 8.1 Function to change GUID (for model updates)
CREATE OR REPLACE FUNCTION change_element_guid(
  p_project_id TEXT,
  p_old_guid TEXT,
  p_new_guid TEXT,
  p_changed_by TEXT
) RETURNS UUID AS $$
DECLARE
  v_element_id UUID;
BEGIN
  -- Update element_lifecycle
  UPDATE element_lifecycle
  SET 
    guid = p_new_guid,
    locked_by = p_changed_by,
    updated_at = NOW()
  WHERE project_id = p_project_id AND guid = p_old_guid
  RETURNING id INTO v_element_id;
  
  -- Update inspection_plan_items
  UPDATE inspection_plan_items
  SET guid = p_new_guid
  WHERE project_id = p_project_id AND guid = p_old_guid;
  
  -- Update inspection_results
  UPDATE inspection_results
  SET assembly_guid = p_new_guid
  WHERE project_id = p_project_id AND assembly_guid = p_old_guid;
  
  -- Update checkpoint_groups
  UPDATE checkpoint_groups
  SET element_guids = array_replace(element_guids, p_old_guid, p_new_guid)
  WHERE project_id = p_project_id AND p_old_guid = ANY(element_guids);
  
  RETURN v_element_id;
END;
$$ LANGUAGE plpgsql;

-- 8.2 Function to get element full history
CREATE OR REPLACE FUNCTION get_element_history(p_element_id UUID)
RETURNS TABLE (
  action TEXT,
  action_at TIMESTAMPTZ,
  action_by TEXT,
  action_by_name TEXT,
  details JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    al.action,
    al.created_at as action_at,
    al.user_email as action_by,
    al.user_name as action_by_name,
    COALESCE(al.new_values, al.old_values) as details
  FROM inspection_audit_log al
  WHERE al.entity_id = p_element_id
  ORDER BY al.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- 8.3 Function to approve inspection
CREATE OR REPLACE FUNCTION approve_inspection(
  p_plan_item_id UUID,
  p_reviewer_email TEXT,
  p_reviewer_name TEXT,
  p_comment TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_project_id TEXT;
  v_lifecycle_id UUID;
BEGIN
  -- Get related IDs
  SELECT project_id, element_lifecycle_id 
  INTO v_project_id, v_lifecycle_id
  FROM inspection_plan_items
  WHERE id = p_plan_item_id;
  
  -- Update plan item
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
  WHERE id = p_plan_item_id;
  
  -- Update lifecycle if exists
  IF v_lifecycle_id IS NOT NULL THEN
    UPDATE element_lifecycle
    SET 
      inspection_status = 'approved',
      reviewed_at = NOW(),
      reviewed_by = p_reviewer_email,
      reviewed_by_name = p_reviewer_name,
      review_decision = 'approved',
      review_comment = p_comment,
      can_edit = false,
      locked_at = NOW(),
      locked_by = p_reviewer_email
    WHERE id = v_lifecycle_id;
  END IF;
  
  -- Log audit
  INSERT INTO inspection_audit_log (project_id, entity_type, entity_id, action, new_values, user_email, user_name)
  VALUES (v_project_id, 'plan_item', p_plan_item_id, 'approved', 
    jsonb_build_object('review_status', 'approved', 'comment', p_comment),
    p_reviewer_email, p_reviewer_name);
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- 8.4 Function to return inspection for corrections
CREATE OR REPLACE FUNCTION return_inspection(
  p_plan_item_id UUID,
  p_reviewer_email TEXT,
  p_reviewer_name TEXT,
  p_comment TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_project_id TEXT;
  v_lifecycle_id UUID;
BEGIN
  -- Get related IDs
  SELECT project_id, element_lifecycle_id 
  INTO v_project_id, v_lifecycle_id
  FROM inspection_plan_items
  WHERE id = p_plan_item_id;
  
  -- Update plan item
  UPDATE inspection_plan_items
  SET 
    review_status = 'returned',
    reviewed_at = NOW(),
    reviewed_by = p_reviewer_email,
    reviewed_by_name = p_reviewer_name,
    review_comment = p_comment,
    can_edit = true,  -- Allow editing again
    status = 'in_progress'
  WHERE id = p_plan_item_id;
  
  -- Update lifecycle if exists
  IF v_lifecycle_id IS NOT NULL THEN
    UPDATE element_lifecycle
    SET 
      inspection_status = 'returned',
      reviewed_at = NOW(),
      reviewed_by = p_reviewer_email,
      reviewed_by_name = p_reviewer_name,
      review_decision = 'returned',
      review_comment = p_comment,
      can_edit = true
    WHERE id = v_lifecycle_id;
  END IF;
  
  -- Log audit
  INSERT INTO inspection_audit_log (project_id, entity_type, entity_id, action, new_values, user_email, user_name)
  VALUES (v_project_id, 'plan_item', p_plan_item_id, 'returned', 
    jsonb_build_object('review_status', 'returned', 'comment', p_comment),
    p_reviewer_email, p_reviewer_name);
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE element_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkpoint_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_upload_queue ENABLE ROW LEVEL SECURITY;

-- Allow all for now (tighten later based on roles)
CREATE POLICY "element_lifecycle_all" ON element_lifecycle FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "audit_log_select" ON inspection_audit_log FOR SELECT USING (true);
CREATE POLICY "audit_log_insert" ON inspection_audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY "checkpoint_groups_all" ON checkpoint_groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "offline_queue_all" ON offline_upload_queue FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 10. GRANT PERMISSIONS
-- ============================================================

GRANT ALL ON element_lifecycle TO authenticated;
GRANT ALL ON element_lifecycle TO anon;
GRANT ALL ON inspection_audit_log TO authenticated;
GRANT ALL ON inspection_audit_log TO anon;
GRANT ALL ON checkpoint_groups TO authenticated;
GRANT ALL ON checkpoint_groups TO anon;
GRANT ALL ON offline_upload_queue TO authenticated;
GRANT ALL ON offline_upload_queue TO anon;

-- Grant view permissions
GRANT SELECT ON v_element_lifecycle_stats TO authenticated;
GRANT SELECT ON v_element_lifecycle_stats TO anon;
GRANT SELECT ON v_user_inspection_stats TO authenticated;
GRANT SELECT ON v_user_inspection_stats TO anon;
GRANT SELECT ON v_daily_inspection_activity TO authenticated;
GRANT SELECT ON v_daily_inspection_activity TO anon;

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================

COMMENT ON TABLE element_lifecycle IS 'Detaili täielik elutsükkel saabumisest kinnitamiseni';
COMMENT ON TABLE inspection_audit_log IS 'Kõik tegevused kontrollsüsteemis';
COMMENT ON TABLE checkpoint_groups IS 'Grupeeritud kontrollpunktid (mitu detaili = üks kontroll)';
COMMENT ON TABLE offline_upload_queue IS 'Offline üleslaadimiste järjekord';
COMMENT ON FUNCTION change_element_guid IS 'Muuda detaili GUID-i mudeli uuenemisel';
COMMENT ON FUNCTION get_element_history IS 'Saa detaili täielik tegevuste ajalugu';
COMMENT ON FUNCTION approve_inspection IS 'Kinnita kontroll moderaatorina';
COMMENT ON FUNCTION return_inspection IS 'Suuna kontroll tagasi parandamiseks';
