-- ============================================
-- ISSUES SYSTEM TABLES
-- Mittevastavuste ja probleemide haldamine
-- v3.0.481
-- ============================================

-- Drop existing
DROP TABLE IF EXISTS issue_activity_log CASCADE;
DROP TABLE IF EXISTS issue_attachments CASCADE;
DROP TABLE IF EXISTS issue_assignments CASCADE;
DROP TABLE IF EXISTS issue_resource_assignments CASCADE;
DROP TABLE IF EXISTS issue_comments CASCADE;
DROP TABLE IF EXISTS issue_objects CASCADE;
DROP TABLE IF EXISTS issues CASCADE;
DROP TABLE IF EXISTS issue_categories CASCADE;

DROP TYPE IF EXISTS issue_status CASCADE;
DROP TYPE IF EXISTS issue_priority CASCADE;
DROP TYPE IF EXISTS issue_source CASCADE;
DROP TYPE IF EXISTS attachment_type CASCADE;
DROP TYPE IF EXISTS activity_action CASCADE;

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE issue_status AS ENUM (
  'nonconformance',  -- Mittevastavus (punane)
  'problem',         -- Probleem (oranž)
  'pending',         -- Ootel (kollane)
  'in_progress',     -- Töös (sinine)
  'completed',       -- Valmis (roheline)
  'closed',          -- Lõpetatud (hall)
  'cancelled'        -- Tühistatud (helehall)
);

CREATE TYPE issue_priority AS ENUM (
  'low',       -- Madal
  'medium',    -- Keskmine
  'high',      -- Kõrge
  'critical'   -- Kriitiline
);

CREATE TYPE issue_source AS ENUM (
  'inspection',      -- Avastatud inspektsioonil
  'delivery',        -- Avastatud tarnimisel
  'installation',    -- Avastatud paigaldamisel
  'production',      -- Tootmisviga
  'design',          -- Projekteerimise viga
  'other'            -- Muu
);

CREATE TYPE attachment_type AS ENUM (
  'photo', 'document', 'video', 'drawing', 'report', 'other'
);

-- ============================================
-- ACTIVITY LOG ACTION TYPES
-- ============================================

CREATE TYPE activity_action AS ENUM (
  -- Issue lifecycle
  'issue_created',
  'issue_updated',
  'issue_deleted',
  'status_changed',
  'priority_changed',
  'category_changed',

  -- Assignments
  'user_assigned',
  'user_unassigned',
  'assignment_accepted',
  'assignment_rejected',

  -- Resources
  'resource_added',
  'resource_removed',
  'resource_updated',

  -- Attachments
  'attachment_added',
  'attachment_removed',

  -- Comments
  'comment_added',
  'comment_edited',
  'comment_deleted',

  -- Model interaction
  'zoomed_to_model',
  'isolated_in_model',
  'colored_in_model',

  -- Resolution
  'resolution_set',
  'issue_closed',
  'issue_reopened',
  'issue_cancelled'
);

-- ============================================
-- ISSUE CATEGORIES
-- ============================================

CREATE TABLE issue_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6B7280',
  icon TEXT DEFAULT 'alert-circle',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(trimble_project_id, code)
);

-- ============================================
-- ISSUES - Main table (NO direct model link - use issue_objects)
-- ============================================

CREATE TABLE issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,

  -- Auto-generated number
  issue_number TEXT NOT NULL,  -- ISS-0001, ISS-0002

  -- NOTE: Model objects are in separate table issue_objects
  -- This allows multiple objects per issue

  -- Issue details
  category_id UUID REFERENCES issue_categories(id),
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,  -- Asukoht objektil

  -- Status & Priority
  status issue_status DEFAULT 'nonconformance',
  priority issue_priority DEFAULT 'medium',
  source issue_source DEFAULT 'inspection',

  -- Timestamps
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  due_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  -- Estimates
  estimated_hours DECIMAL(6,2),
  actual_hours DECIMAL(6,2),
  estimated_cost DECIMAL(12,2),
  actual_cost DECIMAL(12,2),

  -- Resolution
  resolution_type TEXT,  -- 'repair', 'replace', 'accept', 'reject', 'rework'
  resolution_notes TEXT,

  -- Creator
  reported_by TEXT NOT NULL,
  reported_by_name TEXT,

  -- Closer
  closed_by TEXT,
  closed_by_name TEXT,

  -- Tags & custom
  tags TEXT[] DEFAULT '{}',
  custom_fields JSONB DEFAULT '{}',

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,

  UNIQUE(trimble_project_id, issue_number)
);

-- Indexes for issues
CREATE INDEX idx_issues_project ON issues(trimble_project_id);
CREATE INDEX idx_issues_status ON issues(trimble_project_id, status);
CREATE INDEX idx_issues_number ON issues(issue_number);
CREATE INDEX idx_issues_priority ON issues(priority);
CREATE INDEX idx_issues_due_date ON issues(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_issues_detected ON issues(detected_at DESC);
-- Composite index for badge count query
CREATE INDEX idx_issues_active_count ON issues(trimble_project_id, status)
  WHERE status NOT IN ('closed', 'cancelled');

-- ============================================
-- ISSUE OBJECTS - Multiple model objects per issue
-- REQUIRED: At least one object must be selected to create issue
-- ============================================

CREATE TABLE issue_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,

  -- Model object identification
  model_id TEXT NOT NULL,
  guid_ifc TEXT NOT NULL,
  guid_ms TEXT,

  -- Cached object info (for display when model not loaded)
  assembly_mark TEXT,
  product_name TEXT,
  cast_unit_weight TEXT,
  cast_unit_position_code TEXT,

  -- Is this the "primary" object (first selected, used for main display)
  is_primary BOOLEAN DEFAULT false,

  -- Sort order
  sort_order INTEGER DEFAULT 0,

  -- Audit
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each object can only be linked once per issue
  UNIQUE(issue_id, guid_ifc)
);

CREATE INDEX idx_issue_objects_issue ON issue_objects(issue_id);
CREATE INDEX idx_issue_objects_guid ON issue_objects(guid_ifc);
-- For finding all issues for a specific object
CREATE INDEX idx_issue_objects_lookup ON issue_objects(guid_ifc, issue_id);

-- ============================================
-- ISSUE ASSIGNMENTS - Trimble users assigned
-- ============================================

CREATE TABLE issue_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,

  -- Assigned user (Trimble Connect user)
  user_email TEXT NOT NULL,
  user_name TEXT,

  -- Assignment type
  role TEXT DEFAULT 'assignee',  -- 'assignee', 'reviewer', 'observer'
  is_primary BOOLEAN DEFAULT false,  -- Primary assignee

  -- Status
  is_active BOOLEAN DEFAULT true,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,

  -- Who assigned
  assigned_by TEXT NOT NULL,
  assigned_by_name TEXT,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assignment_notes TEXT,

  -- Unassignment
  unassigned_at TIMESTAMPTZ,
  unassigned_by TEXT
);

CREATE INDEX idx_assignments_issue ON issue_assignments(issue_id);
CREATE INDEX idx_assignments_user ON issue_assignments(user_email);
CREATE INDEX idx_assignments_active ON issue_assignments(user_email, is_active) WHERE is_active = true;

-- ============================================
-- ISSUE COMMENTS
-- ============================================

CREATE TABLE issue_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,

  comment_text TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,  -- Internal note

  -- Status change (if this comment changed status)
  old_status issue_status,
  new_status issue_status,

  -- Author
  author_email TEXT NOT NULL,
  author_name TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_edited BOOLEAN DEFAULT false
);

CREATE INDEX idx_comments_issue ON issue_comments(issue_id);
CREATE INDEX idx_comments_created ON issue_comments(created_at DESC);

-- ============================================
-- ISSUE ATTACHMENTS
-- ============================================

CREATE TABLE issue_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES issue_comments(id) ON DELETE CASCADE,

  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  attachment_type attachment_type DEFAULT 'other',

  title TEXT,
  description TEXT,

  uploaded_by TEXT NOT NULL,
  uploaded_by_name TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),

  is_primary_photo BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX idx_attachments_issue ON issue_attachments(issue_id);
CREATE INDEX idx_attachments_type ON issue_attachments(attachment_type);

-- ============================================
-- ISSUE RESOURCE ASSIGNMENTS
-- ============================================

CREATE TABLE issue_resource_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,

  resource_id UUID,  -- FK to project_resources if exists
  resource_type TEXT NOT NULL,  -- 'worker', 'machine', 'material', 'tool'
  resource_name TEXT NOT NULL,

  planned_start DATE,
  planned_end DATE,
  planned_hours DECIMAL(6,2),
  actual_hours DECIMAL(6,2),

  status TEXT DEFAULT 'planned',  -- 'planned', 'assigned', 'working', 'completed'

  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX idx_resources_issue ON issue_resource_assignments(issue_id);

-- ============================================
-- ISSUE ACTIVITY LOG - Complete audit trail
-- ============================================

CREATE TABLE issue_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,

  -- What happened
  action activity_action NOT NULL,
  action_label TEXT NOT NULL,  -- Human readable: "Staatus muudetud", "Kasutaja määratud"

  -- Details
  field_name TEXT,           -- Which field changed (for updates)
  old_value TEXT,            -- Previous value
  new_value TEXT,            -- New value
  details JSONB,             -- Additional structured details

  -- Target (who/what was affected)
  target_user_email TEXT,    -- If action involves another user
  target_user_name TEXT,

  -- Actor (who did it)
  actor_email TEXT NOT NULL,
  actor_name TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- For quick filtering
  is_status_change BOOLEAN DEFAULT false,
  is_assignment BOOLEAN DEFAULT false
);

-- Indexes for activity log
CREATE INDEX idx_activity_project ON issue_activity_log(trimble_project_id);
CREATE INDEX idx_activity_issue ON issue_activity_log(issue_id);
CREATE INDEX idx_activity_actor ON issue_activity_log(actor_email);
CREATE INDEX idx_activity_created ON issue_activity_log(created_at DESC);
CREATE INDEX idx_activity_action ON issue_activity_log(action);
-- For user's assigned issues activity
CREATE INDEX idx_activity_target_user ON issue_activity_log(target_user_email)
  WHERE target_user_email IS NOT NULL;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_issues_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_issues_updated_at
  BEFORE UPDATE ON issues
  FOR EACH ROW
  EXECUTE FUNCTION update_issues_updated_at();

-- Auto-generate issue_number
CREATE OR REPLACE FUNCTION generate_issue_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(issue_number FROM 5) AS INTEGER)
  ), 0) + 1
  INTO next_num
  FROM issues
  WHERE trimble_project_id = NEW.trimble_project_id;

  NEW.issue_number = 'ISS-' || LPAD(next_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_issue_number
  BEFORE INSERT ON issues
  FOR EACH ROW
  WHEN (NEW.issue_number IS NULL)
  EXECUTE FUNCTION generate_issue_number();

-- Log status changes automatically
CREATE OR REPLACE FUNCTION log_issue_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Update timestamps based on new status
    IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' THEN
      NEW.started_at = NOW();
    ELSIF NEW.status = 'completed' AND OLD.status != 'completed' THEN
      NEW.completed_at = NOW();
    ELSIF NEW.status = 'closed' AND OLD.status != 'closed' THEN
      NEW.closed_at = NOW();
      NEW.closed_by = NEW.updated_by;
    END IF;

    -- Log the status change
    INSERT INTO issue_activity_log (
      trimble_project_id, issue_id, action, action_label,
      field_name, old_value, new_value,
      actor_email, is_status_change
    ) VALUES (
      NEW.trimble_project_id, NEW.id, 'status_changed', 'Staatus muudetud',
      'status', OLD.status::TEXT, NEW.status::TEXT,
      COALESCE(NEW.updated_by, NEW.reported_by), true
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_issue_status_change
  BEFORE UPDATE ON issues
  FOR EACH ROW
  EXECUTE FUNCTION log_issue_status_change();

-- Log issue creation
CREATE OR REPLACE FUNCTION log_issue_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO issue_activity_log (
    trimble_project_id, issue_id, action, action_label,
    details, actor_email, actor_name
  ) VALUES (
    NEW.trimble_project_id, NEW.id, 'issue_created', 'Probleem loodud',
    jsonb_build_object(
      'issue_number', NEW.issue_number,
      'title', NEW.title,
      'status', NEW.status,
      'priority', NEW.priority
    ),
    NEW.reported_by, NEW.reported_by_name
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_issue_created
  AFTER INSERT ON issues
  FOR EACH ROW
  EXECUTE FUNCTION log_issue_created();

-- Log assignment changes
CREATE OR REPLACE FUNCTION log_assignment_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO issue_activity_log (
      trimble_project_id, issue_id, action, action_label,
      target_user_email, target_user_name,
      details, actor_email, actor_name, is_assignment
    )
    SELECT
      i.trimble_project_id, NEW.issue_id, 'user_assigned', 'Kasutaja määratud',
      NEW.user_email, NEW.user_name,
      jsonb_build_object('role', NEW.role, 'notes', NEW.assignment_notes),
      NEW.assigned_by, NEW.assigned_by_name, true
    FROM issues i WHERE i.id = NEW.issue_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.is_active = true AND NEW.is_active = false THEN
    INSERT INTO issue_activity_log (
      trimble_project_id, issue_id, action, action_label,
      target_user_email, target_user_name,
      actor_email, is_assignment
    )
    SELECT
      i.trimble_project_id, NEW.issue_id, 'user_unassigned', 'Kasutaja eemaldatud',
      NEW.user_email, NEW.user_name,
      NEW.unassigned_by, true
    FROM issues i WHERE i.id = NEW.issue_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_assignment_change
  AFTER INSERT OR UPDATE ON issue_assignments
  FOR EACH ROW
  EXECUTE FUNCTION log_assignment_change();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE issue_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_resource_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_activity_log ENABLE ROW LEVEL SECURITY;

-- Allow all (visibility filtered in app)
CREATE POLICY "Allow all" ON issue_categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON issues FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON issue_objects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON issue_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON issue_comments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON issue_attachments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON issue_resource_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON issue_activity_log FOR ALL USING (true) WITH CHECK (true);

-- Permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, anon;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get active issues count for badge
CREATE OR REPLACE FUNCTION get_active_issues_count(p_project_id TEXT)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM issues
  WHERE trimble_project_id = p_project_id
    AND status NOT IN ('closed', 'cancelled');
$$ LANGUAGE SQL STABLE;

-- ============================================
-- STORAGE BUCKET FOR ATTACHMENTS
-- ============================================

-- Create storage bucket for issue attachments (photos etc.)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'issue-attachments',
  'issue-attachments',
  true,
  52428800,  -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 52428800;

-- Storage policies for issue-attachments bucket
-- Allow upload (INSERT)
CREATE POLICY "Allow upload to issue-attachments" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'issue-attachments');

-- Allow read (SELECT)
CREATE POLICY "Allow read from issue-attachments" ON storage.objects
FOR SELECT USING (bucket_id = 'issue-attachments');

-- Allow update (UPDATE)
CREATE POLICY "Allow update in issue-attachments" ON storage.objects
FOR UPDATE USING (bucket_id = 'issue-attachments');

-- Allow delete (DELETE)
CREATE POLICY "Allow delete from issue-attachments" ON storage.objects
FOR DELETE USING (bucket_id = 'issue-attachments');

-- ============================================
-- DEFAULT CATEGORIES
-- ============================================

-- Insert default categories (will use trimble_project_id from first use)
-- These serve as template categories that can be copied per project

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE issues IS 'Mittevastavused ja probleemid, seotud mudeli objektidega';
COMMENT ON TABLE issue_objects IS 'Mudeli objektid seotud probleemiga (mitu objekti ühe probleemi kohta)';
COMMENT ON TABLE issue_assignments IS 'Kasutajate määramised probleemidele (Trimble Connect kasutajad)';
COMMENT ON TABLE issue_activity_log IS 'Täielik tegevuste logi - kes, mida, millal';
COMMENT ON COLUMN issue_activity_log.action IS 'Tegevuse tüüp (enum)';
COMMENT ON COLUMN issue_activity_log.action_label IS 'Inimloetav tegevuse nimi eesti keeles';
