# Assembly Inspector - Mittevastavuste ja Probleemide Moodul

## Arendusplaan v3.0

**Kuupäev:** 11. jaanuar 2026  
**Projekt:** Assembly Inspector (Trimble Connect laiendus)  
**Moodul:** IssuesScreen - Mittevastavuste ja probleemide haldamine

---

## 1. ÜLEVAADE

### 1.1 Eesmärk

Luua professionaalne moodul ehitusdetailide mittevastavuste, probleemide ja defektide haldamiseks.

### 1.2 Põhifunktsioonid

| Funktsioon | Kirjeldus |
|------------|-----------|
| **Mudelist valimine** | Probleemi lisamiseks PEAB olema mudelist valitud detail(id). Toetab mitut detaili ühe probleemi kohta |
| **Staatuste grupeerimine** | Probleemid grupeeritakse staatuse järgi lahtikäivate sektsioonidena |
| **Mudeli värvimine** | Kõik objektid valgeks → probleemiga objektid staatuse värviga |
| **Kahepoolne sünk** | List → Mudel ja Mudel → List valik sünkroniseeritud |
| **Täielik tegevuste logi** | Kes, mida, millal - kõik tegevused logitakse |
| **Trimble kasutajate suunamine** | Probleemide määramine projekti meeskonnaliikmetele |
| **Menüü badge** | Aktiivsete probleemide arv nähtav avalehel |
| **Otsing ja filtrid** | Kiire leidmine staatuse, prioriteedi, vastutaja, kuupäeva järgi |
| **Piltide haldus** | Lisamine (ka Ctrl+V), kustutamine, allalaadimine struktureeritud nimega |
| **Excel eksport** | Kogu ülevaade allalaaditav Excelis |
| **PDF eksport** | Iga probleemi detailne PDF piltidega, varjatud Supabase URL-idega |

### 1.3 Staatused ja Mudeli Värvid

```
MITTEVASTAVUS → PROBLEEM → OOTEL → TÖÖS → VALMIS → LÕPETATUD
                                              ↓
                                         TÜHISTATUD
```

**Värvid on valitud MAKSIMAALSE eristatavuse jaoks 3D mudelis:**

| Staatus | Eesti | Mudeli RGB | HEX | Visuaal |
|---------|-------|------------|-----|---------|
| `nonconformance` | Mittevastavus | `255, 0, 0` | `#FF0000` | 🔴 ERE PUNANE |
| `problem` | Probleem | `255, 140, 0` | `#FF8C00` | 🟠 ERE ORANŽ |
| `pending` | Ootel | `255, 215, 0` | `#FFD700` | 🟡 KULD |
| `in_progress` | Töös | `0, 100, 255` | `#0064FF` | 🔵 ERE SININE |
| `completed` | Valmis | `0, 255, 100` | `#00FF64` | 🟢 ERE ROHELINE |
| `closed` | Lõpetatud | `100, 100, 100` | `#646464` | ⚫ TUMEHALL |
| `cancelled` | Tühistatud | `180, 180, 180` | `#B4B4B4` | ⚪ HELEHALL |

---

## 2. ANDMEBAASI SKEEM

### 2.1 Migratsioonifail

**Fail:** `supabase/migrations/20260112_issues_system.sql`

```sql
-- ============================================
-- ISSUES SYSTEM TABLES
-- Mittevastavuste ja probleemide haldamine
-- v3.0.XXX
-- ============================================

-- Drop existing
DROP TABLE IF EXISTS issue_activity_log CASCADE;
DROP TABLE IF EXISTS issue_attachments CASCADE;
DROP TABLE IF EXISTS issue_assignments CASCADE;
DROP TABLE IF EXISTS issue_resource_assignments CASCADE;
DROP TABLE IF EXISTS issue_comments CASCADE;
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
  unassigned_by TEXT,
  
  UNIQUE(issue_id, user_email, is_active)
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
      'priority', NEW.priority,
      'assembly_mark', NEW.assembly_mark
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
ALTER TABLE issue_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_resource_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_activity_log ENABLE ROW LEVEL SECURITY;

-- Allow all (visibility filtered in app)
CREATE POLICY "Allow all" ON issue_categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON issues FOR ALL USING (true) WITH CHECK (true);
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

-- Get issues assigned to user
CREATE OR REPLACE FUNCTION get_user_assigned_issues(p_project_id TEXT, p_user_email TEXT)
RETURNS TABLE (
  issue_id UUID,
  issue_number TEXT,
  title TEXT,
  status issue_status,
  priority issue_priority,
  assembly_mark TEXT,
  role TEXT
) AS $$
  SELECT i.id, i.issue_number, i.title, i.status, i.priority, i.assembly_mark, a.role
  FROM issues i
  JOIN issue_assignments a ON a.issue_id = i.id
  WHERE i.trimble_project_id = p_project_id
    AND a.user_email = p_user_email
    AND a.is_active = true
    AND i.status NOT IN ('closed', 'cancelled')
  ORDER BY 
    CASE i.priority 
      WHEN 'critical' THEN 1 
      WHEN 'high' THEN 2 
      WHEN 'medium' THEN 3 
      ELSE 4 
    END,
    i.detected_at DESC;
$$ LANGUAGE SQL STABLE;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE issues IS 'Mittevastavused ja probleemid, seotud mudeli objektidega';
COMMENT ON TABLE issue_assignments IS 'Kasutajate määramised probleemidele (Trimble Connect kasutajad)';
COMMENT ON TABLE issue_activity_log IS 'Täielik tegevuste logi - kes, mida, millal';
COMMENT ON COLUMN issue_activity_log.action IS 'Tegevuse tüüp (enum)';
COMMENT ON COLUMN issue_activity_log.action_label IS 'Inimloetav tegevuse nimi eesti keeles';
```

---

## 3. TYPESCRIPT TÜÜBID

**Lisa faili `src/supabase.ts`:**

```typescript
// ============================================
// ISSUES SYSTEM TYPES
// ============================================

export type IssueStatus = 
  | 'nonconformance'
  | 'problem'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'closed'
  | 'cancelled';

export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';

export type IssueSource = 
  | 'inspection' | 'delivery' | 'installation' 
  | 'production' | 'design' | 'other';

export type AttachmentType = 
  | 'photo' | 'document' | 'video' | 'drawing' | 'report' | 'other';

export type ActivityAction =
  | 'issue_created' | 'issue_updated' | 'issue_deleted'
  | 'status_changed' | 'priority_changed' | 'category_changed'
  | 'user_assigned' | 'user_unassigned' | 'assignment_accepted' | 'assignment_rejected'
  | 'resource_added' | 'resource_removed' | 'resource_updated'
  | 'attachment_added' | 'attachment_removed'
  | 'comment_added' | 'comment_edited' | 'comment_deleted'
  | 'zoomed_to_model' | 'isolated_in_model' | 'colored_in_model'
  | 'resolution_set' | 'issue_closed' | 'issue_reopened' | 'issue_cancelled';

// Main Issue interface
export interface Issue {
  id: string;
  trimble_project_id: string;
  issue_number: string;
  
  // Model link
  model_id?: string;
  guid_ifc?: string;
  guid_ms?: string;
  assembly_mark?: string;
  product_name?: string;
  
  // Details
  category_id?: string;
  title: string;
  description?: string;
  location?: string;
  
  // Status
  status: IssueStatus;
  priority: IssuePriority;
  source: IssueSource;
  
  // Timestamps
  detected_at: string;
  due_date?: string;
  started_at?: string;
  completed_at?: string;
  closed_at?: string;
  
  // Estimates
  estimated_hours?: number;
  actual_hours?: number;
  estimated_cost?: number;
  actual_cost?: number;
  
  // Resolution
  resolution_type?: string;
  resolution_notes?: string;
  
  // People
  reported_by: string;
  reported_by_name?: string;
  closed_by?: string;
  closed_by_name?: string;
  
  // Tags
  tags: string[];
  custom_fields: Record<string, unknown>;
  
  // Audit
  created_at: string;
  updated_at: string;
  updated_by?: string;
  
  // Joined (optional)
  category?: IssueCategory;
  assignments?: IssueAssignment[];
  primary_photo_url?: string;
  comments_count?: number;
  attachments_count?: number;
}

export interface IssueCategory {
  id: string;
  trimble_project_id: string;
  code: string;
  name: string;
  description?: string;
  color: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface IssueAssignment {
  id: string;
  issue_id: string;
  user_email: string;
  user_name?: string;
  role: 'assignee' | 'reviewer' | 'observer';
  is_primary: boolean;
  is_active: boolean;
  accepted_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  assigned_by: string;
  assigned_by_name?: string;
  assigned_at: string;
  assignment_notes?: string;
  unassigned_at?: string;
  unassigned_by?: string;
}

export interface IssueComment {
  id: string;
  issue_id: string;
  comment_text: string;
  is_internal: boolean;
  old_status?: IssueStatus;
  new_status?: IssueStatus;
  author_email: string;
  author_name?: string;
  created_at: string;
  updated_at: string;
  is_edited: boolean;
  attachments?: IssueAttachment[];
}

export interface IssueAttachment {
  id: string;
  issue_id: string;
  comment_id?: string;
  file_name: string;
  file_url: string;
  file_size?: number;
  mime_type?: string;
  attachment_type: AttachmentType;
  title?: string;
  description?: string;
  uploaded_by: string;
  uploaded_by_name?: string;
  uploaded_at: string;
  is_primary_photo: boolean;
  sort_order: number;
}

export interface IssueResourceAssignment {
  id: string;
  issue_id: string;
  resource_id?: string;
  resource_type: 'worker' | 'machine' | 'material' | 'tool';
  resource_name: string;
  planned_start?: string;
  planned_end?: string;
  planned_hours?: number;
  actual_hours?: number;
  status: 'planned' | 'assigned' | 'working' | 'completed';
  assigned_by: string;
  assigned_at: string;
  notes?: string;
}

export interface IssueActivityLog {
  id: string;
  trimble_project_id: string;
  issue_id?: string;
  action: ActivityAction;
  action_label: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  details?: Record<string, unknown>;
  target_user_email?: string;
  target_user_name?: string;
  actor_email: string;
  actor_name?: string;
  created_at: string;
  is_status_change: boolean;
  is_assignment: boolean;
  // Joined
  issue?: Issue;
}

// ============================================
// STATUS & PRIORITY CONFIGS
// ============================================

export const ISSUE_STATUS_CONFIG: Record<IssueStatus, {
  label: string;
  labelEn: string;
  color: string;
  bgColor: string;
  modelColor: { r: number; g: number; b: number; a: number };
  icon: string;
  order: number;
}> = {
  nonconformance: { 
    label: 'Mittevastavus', labelEn: 'Non-conformance',
    color: '#DC2626', bgColor: '#FEE2E2',
    modelColor: { r: 255, g: 0, b: 0, a: 255 },
    icon: 'alert-triangle', order: 0 
  },
  problem: { 
    label: 'Probleem', labelEn: 'Problem',
    color: '#EA580C', bgColor: '#FFEDD5',
    modelColor: { r: 255, g: 140, b: 0, a: 255 },
    icon: 'alert-circle', order: 1 
  },
  pending: { 
    label: 'Ootel', labelEn: 'Pending',
    color: '#CA8A04', bgColor: '#FEF9C3',
    modelColor: { r: 255, g: 215, b: 0, a: 255 },
    icon: 'clock', order: 2 
  },
  in_progress: { 
    label: 'Töös', labelEn: 'In Progress',
    color: '#2563EB', bgColor: '#DBEAFE',
    modelColor: { r: 0, g: 100, b: 255, a: 255 },
    icon: 'loader', order: 3 
  },
  completed: { 
    label: 'Valmis', labelEn: 'Completed',
    color: '#16A34A', bgColor: '#DCFCE7',
    modelColor: { r: 0, g: 255, b: 100, a: 255 },
    icon: 'check-circle', order: 4 
  },
  closed: { 
    label: 'Lõpetatud', labelEn: 'Closed',
    color: '#4B5563', bgColor: '#F3F4F6',
    modelColor: { r: 100, g: 100, b: 100, a: 255 },
    icon: 'check-square', order: 5 
  },
  cancelled: { 
    label: 'Tühistatud', labelEn: 'Cancelled',
    color: '#9CA3AF', bgColor: '#F9FAFB',
    modelColor: { r: 180, g: 180, b: 180, a: 255 },
    icon: 'x-circle', order: 6 
  }
};

export const ISSUE_PRIORITY_CONFIG: Record<IssuePriority, {
  label: string;
  color: string;
  bgColor: string;
  icon: string;
}> = {
  low: { label: 'Madal', color: '#6B7280', bgColor: '#F3F4F6', icon: 'arrow-down' },
  medium: { label: 'Keskmine', color: '#CA8A04', bgColor: '#FEF9C3', icon: 'minus' },
  high: { label: 'Kõrge', color: '#EA580C', bgColor: '#FFEDD5', icon: 'arrow-up' },
  critical: { label: 'Kriitiline', color: '#DC2626', bgColor: '#FEE2E2', icon: 'alert-octagon' }
};

// Activity action labels (Estonian)
export const ACTIVITY_ACTION_LABELS: Record<ActivityAction, string> = {
  issue_created: 'Probleem loodud',
  issue_updated: 'Probleem uuendatud',
  issue_deleted: 'Probleem kustutatud',
  status_changed: 'Staatus muudetud',
  priority_changed: 'Prioriteet muudetud',
  category_changed: 'Kategooria muudetud',
  user_assigned: 'Kasutaja määratud',
  user_unassigned: 'Kasutaja eemaldatud',
  assignment_accepted: 'Määramine aktsepteeritud',
  assignment_rejected: 'Määramine tagasi lükatud',
  resource_added: 'Ressurss lisatud',
  resource_removed: 'Ressurss eemaldatud',
  resource_updated: 'Ressurss uuendatud',
  attachment_added: 'Fail lisatud',
  attachment_removed: 'Fail eemaldatud',
  comment_added: 'Kommentaar lisatud',
  comment_edited: 'Kommentaar muudetud',
  comment_deleted: 'Kommentaar kustutatud',
  zoomed_to_model: 'Zoomitud mudelis',
  isolated_in_model: 'Isoleeritud mudelis',
  colored_in_model: 'Värvitud mudelis',
  resolution_set: 'Lahendus määratud',
  issue_closed: 'Probleem suletud',
  issue_reopened: 'Probleem taasavatud',
  issue_cancelled: 'Probleem tühistatud'
};
```

---

## 4. MUDELI VÄRVIMINE

### 4.1 Värvimise Funktsioon

```typescript
const WHITE_COLOR = { r: 255, g: 255, b: 255, a: 255 };
const COLOR_BATCH_SIZE = 100;

/**
 * Värvi mudel probleemide staatuste järgi
 * SAMA LOOGIKA kui teistel lehtedel (OrganizerScreen, DeliveryScheduleScreen)
 */
const colorModelByIssueStatus = useCallback(async () => {
  if (!api || !projectId) return;
  
  setColoringStatus('Värvin mudelit...');
  
  try {
    // 1. Lae kõik mudeli objektid andmebaasist
    const { data: modelObjects, error: moError } = await supabase
      .from('trimble_model_objects')
      .select('guid_ifc, model_id')
      .eq('trimble_project_id', projectId);
    
    if (moError) throw moError;
    if (!modelObjects || modelObjects.length === 0) {
      console.log('📦 No model objects found');
      setColoringStatus('');
      return;
    }
    
    // 2. Leia runtime ID-d mudelist
    const foundObjects = await findObjectsInLoadedModels(api, modelObjects);
    
    // 3. Värvi KÕIK objektid valgeks
    const allByModel: Record<string, number[]> = {};
    for (const [, found] of foundObjects) {
      if (!allByModel[found.modelId]) allByModel[found.modelId] = [];
      allByModel[found.modelId].push(found.runtimeId);
    }
    
    for (const [modelId, runtimeIds] of Object.entries(allByModel)) {
      for (let i = 0; i < runtimeIds.length; i += COLOR_BATCH_SIZE) {
        const batch = runtimeIds.slice(i, i + COLOR_BATCH_SIZE);
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId, objectRuntimeIds: batch }] },
          { color: WHITE_COLOR }
        );
      }
    }
    
    // 4. Lae KÕIK probleemid (ka closed/cancelled, et värvimine oleks täielik)
    const { data: allIssues, error: issuesError } = await supabase
      .from('issues')
      .select('guid_ifc, model_id, status')
      .eq('trimble_project_id', projectId)
      .not('guid_ifc', 'is', null);
    
    if (issuesError) throw issuesError;
    if (!allIssues || allIssues.length === 0) {
      console.log('✅ Model colored white, no issues');
      setColoringStatus('');
      return;
    }
    
    // 5. Värvi iga probleemi staatuse värviga
    for (const issue of allIssues) {
      const found = foundObjects.get(issue.guid_ifc.toLowerCase());
      if (found) {
        const color = ISSUE_STATUS_CONFIG[issue.status as IssueStatus].modelColor;
        await api.viewer.setObjectState(
          { modelObjectIds: [{ modelId: found.modelId, objectRuntimeIds: [found.runtimeId] }] },
          { color }
        );
      }
    }
    
    console.log(`✅ Model colored: ${allIssues.length} issues`);
    setColoringStatus('');
    
  } catch (e: any) {
    console.error('❌ Error coloring model:', e);
    setColoringStatus('');
  }
}, [api, projectId]);
```

### 4.2 Kahepoolne Sünkroniseerimine

```typescript
// =============================================
// MUDEL → LIST: Mudelist valitud objekti kuvamine listis
// =============================================

const handleModelSelectionChange = useCallback(async () => {
  if (syncingToModelRef.current) return;  // Ignore if we triggered the selection
  
  try {
    const selection = await api.viewer.getSelection();
    if (!selection || selection.length === 0) {
      setHighlightedIssueId(null);
      return;
    }
    
    // Get GUIDs of selected objects
    const firstSel = selection[0];
    const guids = await api.viewer.convertToObjectIds(
      firstSel.modelId,
      firstSel.objectRuntimeIds
    );
    
    if (!guids || guids.length === 0) return;
    
    // Find issue with this GUID
    const guidLower = guids[0].toLowerCase();
    const matchingIssue = issues.find(
      i => i.guid_ifc?.toLowerCase() === guidLower
    );
    
    if (matchingIssue) {
      // Highlight in list and show info
      setHighlightedIssueId(matchingIssue.id);
      setSelectedIssueFromModel(matchingIssue);
      
      // Scroll to issue in list
      const element = document.getElementById(`issue-card-${matchingIssue.id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      // Show toast with issue info
      setModelSelectionInfo({
        issue: matchingIssue,
        status: ISSUE_STATUS_CONFIG[matchingIssue.status].label,
        message: `${matchingIssue.issue_number}: ${matchingIssue.title}`
      });
      
      // Log activity
      await logActivity('zoomed_to_model', matchingIssue.id, {
        source: 'model_selection'
      });
    } else {
      setHighlightedIssueId(null);
      setSelectedIssueFromModel(null);
      setModelSelectionInfo(null);
    }
    
  } catch (e) {
    console.error('Error handling model selection:', e);
  }
}, [api, issues]);

// Subscribe to model selection changes
useEffect(() => {
  if (!api) return;
  
  const unsubscribe = api.viewer.subscribeToSelectionChanged(
    handleModelSelectionChange
  );
  
  return () => {
    if (unsubscribe) unsubscribe();
  };
}, [api, handleModelSelectionChange]);

// =============================================
// LIST → MUDEL: Listist valitud probleemi kuvamine mudelis
// =============================================

const selectIssueInModel = useCallback(async (issue: Issue) => {
  if (!issue.guid_ifc || !issue.model_id) {
    setMessage('⚠️ Probleem pole seotud mudeli objektiga');
    return;
  }
  
  syncingToModelRef.current = true;
  
  try {
    const runtimeIds = await api.viewer.convertToObjectRuntimeIds(
      issue.model_id,
      [issue.guid_ifc]
    );
    
    if (!runtimeIds || runtimeIds.length === 0 || !runtimeIds[0]) {
      setMessage('⚠️ Objekti ei leitud mudelist');
      return;
    }
    
    await api.viewer.setSelection({
      modelObjectIds: [{
        modelId: issue.model_id,
        objectRuntimeIds: runtimeIds.filter(Boolean)
      }]
    }, 'set');
    
    await api.viewer.setCamera({ selected: true }, { animationTime: 500 });
    
    // Log activity
    await logActivity('zoomed_to_model', issue.id);
    
  } catch (e: any) {
    console.error('Error selecting in model:', e);
    setMessage(`Viga: ${e.message}`);
  } finally {
    setTimeout(() => {
      syncingToModelRef.current = false;
    }, 2000);
  }
}, [api]);
```

---

## 5. MENÜÜ BADGE

### 5.1 Badge Komponent

```typescript
// MainMenu.tsx

interface MenuBadgeProps {
  count: number;
  color?: string;
}

const MenuBadge: React.FC<MenuBadgeProps> = ({ count, color = '#EF4444' }) => {
  if (count === 0) return null;
  
  return (
    <span 
      className="menu-badge"
      style={{ 
        backgroundColor: color,
        color: 'white',
        borderRadius: '10px',
        padding: '2px 8px',
        fontSize: '11px',
        fontWeight: 600,
        marginLeft: '8px',
        minWidth: '20px',
        textAlign: 'center'
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
};
```

### 5.2 Badge Laadimine

```typescript
// MainMenu.tsx

const [activeIssuesCount, setActiveIssuesCount] = useState(0);

// Load active issues count
useEffect(() => {
  if (!projectId) return;
  
  const loadIssuesCount = async () => {
    try {
      const { count, error } = await supabase
        .from('issues')
        .select('*', { count: 'exact', head: true })
        .eq('trimble_project_id', projectId)
        .not('status', 'in', '("closed","cancelled")');
      
      if (!error && count !== null) {
        setActiveIssuesCount(count);
      }
    } catch (e) {
      console.error('Error loading issues count:', e);
    }
  };
  
  loadIssuesCount();
  
  // Subscribe to realtime changes
  const subscription = supabase
    .channel('issues-count')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'issues' },
      () => loadIssuesCount()
    )
    .subscribe();
  
  return () => {
    subscription.unsubscribe();
  };
}, [projectId]);

// In render:
{user.can_view_issues && (
  <button
    className="menu-button issues-btn"
    onClick={() => onSelectMode('issues')}
  >
    <FiAlertTriangle size={24} />
    <span>Probleemid</span>
    <MenuBadge count={activeIssuesCount} />
  </button>
)}
```

---

## 6. TEGEVUSTE LOGI

### 6.1 Logi Funktsioon

```typescript
/**
 * Log activity to issue_activity_log
 */
const logActivity = useCallback(async (
  action: ActivityAction,
  issueId?: string,
  details?: {
    fieldName?: string;
    oldValue?: string;
    newValue?: string;
    targetUserEmail?: string;
    targetUserName?: string;
    extra?: Record<string, unknown>;
  }
) => {
  try {
    await supabase
      .from('issue_activity_log')
      .insert({
        trimble_project_id: projectId,
        issue_id: issueId,
        action,
        action_label: ACTIVITY_ACTION_LABELS[action],
        field_name: details?.fieldName,
        old_value: details?.oldValue,
        new_value: details?.newValue,
        details: details?.extra,
        target_user_email: details?.targetUserEmail,
        target_user_name: details?.targetUserName,
        actor_email: tcUserEmail,
        actor_name: tcUserName,
        is_status_change: action === 'status_changed',
        is_assignment: ['user_assigned', 'user_unassigned'].includes(action)
      });
  } catch (e) {
    console.error('Failed to log activity:', e);
  }
}, [projectId, tcUserEmail, tcUserName]);
```

### 6.2 Tegevuste Ajaloo Vaade

```typescript
// IssueActivityTimeline component
interface ActivityTimelineProps {
  issueId: string;
}

const IssueActivityTimeline: React.FC<ActivityTimelineProps> = ({ issueId }) => {
  const [activities, setActivities] = useState<IssueActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const loadActivities = async () => {
      const { data, error } = await supabase
        .from('issue_activity_log')
        .select('*')
        .eq('issue_id', issueId)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (!error) {
        setActivities(data || []);
      }
      setLoading(false);
    };
    
    loadActivities();
  }, [issueId]);
  
  const formatActivityText = (activity: IssueActivityLog): string => {
    switch (activity.action) {
      case 'status_changed':
        const oldLabel = ISSUE_STATUS_CONFIG[activity.old_value as IssueStatus]?.label || activity.old_value;
        const newLabel = ISSUE_STATUS_CONFIG[activity.new_value as IssueStatus]?.label || activity.new_value;
        return `Staatus: ${oldLabel} → ${newLabel}`;
      
      case 'user_assigned':
        return `Määras kasutaja: ${activity.target_user_name || activity.target_user_email}`;
      
      case 'user_unassigned':
        return `Eemaldas kasutaja: ${activity.target_user_name || activity.target_user_email}`;
      
      case 'priority_changed':
        return `Prioriteet: ${activity.old_value} → ${activity.new_value}`;
      
      default:
        return activity.action_label;
    }
  };
  
  return (
    <div className="activity-timeline">
      {activities.map(activity => (
        <div key={activity.id} className="activity-item">
          <div className="activity-dot" />
          <div className="activity-content">
            <div className="activity-text">{formatActivityText(activity)}</div>
            <div className="activity-meta">
              <span>{activity.actor_name || activity.actor_email}</span>
              <span>•</span>
              <span>{formatRelativeTime(activity.created_at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
```

---

## 7. TRIMBLE KASUTAJATE SUUNAMINE

### 7.1 Meeskonna Laadimine

```typescript
// Load Trimble Connect project team members
const loadTeamMembers = useCallback(async () => {
  try {
    // Get team from Trimble Connect API
    const team = await api.project.getProjectUsers();
    
    if (team && Array.isArray(team)) {
      const members = team.map((member: any) => ({
        id: member.id,
        email: member.email,
        firstName: member.firstName || '',
        lastName: member.lastName || '',
        fullName: `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email,
        role: member.role,
        status: member.status
      }));
      
      setTeamMembers(members.filter(m => m.status === 'ACTIVE'));
    }
  } catch (e) {
    console.error('Error loading team:', e);
  }
}, [api]);
```

### 7.2 Kasutaja Määramine

```typescript
const assignUserToIssue = useCallback(async (
  issueId: string,
  userEmail: string,
  userName: string,
  role: 'assignee' | 'reviewer' | 'observer' = 'assignee',
  isPrimary: boolean = false,
  notes?: string
) => {
  try {
    // Check if already assigned
    const { data: existing } = await supabase
      .from('issue_assignments')
      .select('id')
      .eq('issue_id', issueId)
      .eq('user_email', userEmail)
      .eq('is_active', true)
      .single();
    
    if (existing) {
      setMessage('⚠️ Kasutaja on juba määratud');
      return false;
    }
    
    // If setting as primary, unset other primaries
    if (isPrimary) {
      await supabase
        .from('issue_assignments')
        .update({ is_primary: false })
        .eq('issue_id', issueId)
        .eq('is_active', true);
    }
    
    // Create assignment
    const { error } = await supabase
      .from('issue_assignments')
      .insert({
        issue_id: issueId,
        user_email: userEmail,
        user_name: userName,
        role,
        is_primary: isPrimary,
        assigned_by: tcUserEmail,
        assigned_by_name: tcUserName,
        assignment_notes: notes
      });
    
    if (error) throw error;
    
    // Activity is logged automatically by trigger
    
    setMessage(`✅ ${userName} määratud`);
    await loadIssueAssignments(issueId);
    return true;
    
  } catch (e: any) {
    console.error('Error assigning user:', e);
    setMessage(`Viga: ${e.message}`);
    return false;
  }
}, [tcUserEmail, tcUserName]);
```

---

## 8. OTSING JA FILTRID

### 8.1 Filtrite State

```typescript
// Filter state
const [filters, setFilters] = useState({
  status: 'all' as IssueStatus | 'all',
  priority: 'all' as IssuePriority | 'all',
  category: 'all' as string,
  assignedTo: 'all' as string,
  reportedBy: 'all' as string,
  source: 'all' as IssueSource | 'all',
  dateRange: 'all' as 'today' | 'week' | 'month' | 'all',
  hasModel: 'all' as 'yes' | 'no' | 'all',
  overdue: false
});

const [searchQuery, setSearchQuery] = useState('');
const [sortField, setSortField] = useState<'detected_at' | 'due_date' | 'priority' | 'issue_number'>('detected_at');
const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
```

### 8.2 Filtreerimine

```typescript
const filteredIssues = useMemo(() => {
  let result = [...issues];
  
  // Text search
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    result = result.filter(issue =>
      issue.issue_number.toLowerCase().includes(query) ||
      issue.title.toLowerCase().includes(query) ||
      issue.assembly_mark?.toLowerCase().includes(query) ||
      issue.description?.toLowerCase().includes(query) ||
      issue.location?.toLowerCase().includes(query)
    );
  }
  
  // Status filter
  if (filters.status !== 'all') {
    result = result.filter(i => i.status === filters.status);
  }
  
  // Priority filter
  if (filters.priority !== 'all') {
    result = result.filter(i => i.priority === filters.priority);
  }
  
  // Category filter
  if (filters.category !== 'all') {
    result = result.filter(i => i.category_id === filters.category);
  }
  
  // Assigned to filter
  if (filters.assignedTo !== 'all') {
    result = result.filter(i => 
      i.assignments?.some(a => a.user_email === filters.assignedTo && a.is_active)
    );
  }
  
  // Date range filter
  if (filters.dateRange !== 'all') {
    const now = new Date();
    let startDate: Date;
    
    switch (filters.dateRange) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
    }
    
    result = result.filter(i => new Date(i.detected_at) >= startDate);
  }
  
  // Has model object filter
  if (filters.hasModel !== 'all') {
    result = result.filter(i => 
      filters.hasModel === 'yes' ? !!i.guid_ifc : !i.guid_ifc
    );
  }
  
  // Overdue filter
  if (filters.overdue) {
    const today = new Date().toISOString().split('T')[0];
    result = result.filter(i => 
      i.due_date && 
      i.due_date < today && 
      !['closed', 'cancelled', 'completed'].includes(i.status)
    );
  }
  
  // Sort
  result.sort((a, b) => {
    let comparison = 0;
    
    switch (sortField) {
      case 'detected_at':
        comparison = new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime();
        break;
      case 'due_date':
        if (!a.due_date && !b.due_date) comparison = 0;
        else if (!a.due_date) comparison = 1;
        else if (!b.due_date) comparison = -1;
        else comparison = a.due_date.localeCompare(b.due_date);
        break;
      case 'priority':
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
        break;
      case 'issue_number':
        comparison = a.issue_number.localeCompare(b.issue_number);
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });
  
  return result;
}, [issues, searchQuery, filters, sortField, sortDirection]);
```

### 8.3 Filtrite UI

```typescript
// FilterBar component
<div className="issues-filter-bar">
  {/* Search */}
  <div className="filter-search">
    <FiSearch size={16} />
    <input
      type="text"
      placeholder="Otsi numbri, pealkirja, detaili järgi..."
      value={searchQuery}
      onChange={e => setSearchQuery(e.target.value)}
    />
    {searchQuery && (
      <button onClick={() => setSearchQuery('')}>
        <FiX size={14} />
      </button>
    )}
  </div>
  
  {/* Status filter */}
  <select
    value={filters.status}
    onChange={e => setFilters(f => ({ ...f, status: e.target.value as any }))}
  >
    <option value="all">Kõik staatused</option>
    {Object.entries(ISSUE_STATUS_CONFIG).map(([key, config]) => (
      <option key={key} value={key}>{config.label}</option>
    ))}
  </select>
  
  {/* Priority filter */}
  <select
    value={filters.priority}
    onChange={e => setFilters(f => ({ ...f, priority: e.target.value as any }))}
  >
    <option value="all">Kõik prioriteedid</option>
    {Object.entries(ISSUE_PRIORITY_CONFIG).map(([key, config]) => (
      <option key={key} value={key}>{config.label}</option>
    ))}
  </select>
  
  {/* Assigned to filter */}
  <select
    value={filters.assignedTo}
    onChange={e => setFilters(f => ({ ...f, assignedTo: e.target.value }))}
  >
    <option value="all">Kõik vastutajad</option>
    <option value={tcUserEmail}>Mulle määratud</option>
    {teamMembers.map(member => (
      <option key={member.email} value={member.email}>
        {member.fullName}
      </option>
    ))}
  </select>
  
  {/* Date range */}
  <select
    value={filters.dateRange}
    onChange={e => setFilters(f => ({ ...f, dateRange: e.target.value as any }))}
  >
    <option value="all">Kõik kuupäevad</option>
    <option value="today">Täna</option>
    <option value="week">Viimane nädal</option>
    <option value="month">Viimane kuu</option>
  </select>
  
  {/* Overdue toggle */}
  <label className="filter-checkbox">
    <input
      type="checkbox"
      checked={filters.overdue}
      onChange={e => setFilters(f => ({ ...f, overdue: e.target.checked }))}
    />
    <span>Tähtaeg ületatud</span>
  </label>
  
  {/* Clear filters */}
  <button 
    className="filter-clear-btn"
    onClick={() => {
      setFilters({
        status: 'all', priority: 'all', category: 'all',
        assignedTo: 'all', reportedBy: 'all', source: 'all',
        dateRange: 'all', hasModel: 'all', overdue: false
      });
      setSearchQuery('');
    }}
  >
    <FiX size={14} /> Tühjenda
  </button>
</div>
```

---

## 9. MUDELIST VALIMISE INFO TOAST

```typescript
// Model selection info toast
{modelSelectionInfo && (
  <div className="model-selection-toast">
    <div className="toast-header">
      <span 
        className="toast-status-dot"
        style={{ backgroundColor: ISSUE_STATUS_CONFIG[modelSelectionInfo.issue.status].color }}
      />
      <span className="toast-status">
        {ISSUE_STATUS_CONFIG[modelSelectionInfo.issue.status].label}
      </span>
    </div>
    <div className="toast-issue-number">{modelSelectionInfo.issue.issue_number}</div>
    <div className="toast-title">{modelSelectionInfo.issue.title}</div>
    {modelSelectionInfo.issue.assembly_mark && (
      <div className="toast-assembly">{modelSelectionInfo.issue.assembly_mark}</div>
    )}
    <div className="toast-actions">
      <button onClick={() => openIssueDetail(modelSelectionInfo.issue)}>
        Ava detail
      </button>
      <button onClick={() => setModelSelectionInfo(null)}>
        <FiX size={14} />
      </button>
    </div>
  </div>
)}
```

---

## 10. KASUTAJA ÕIGUSED

**Lisa `TrimbleExUser` interface'i:**

```typescript
// Issues permissions
can_view_issues: boolean;
can_create_issues: boolean;
can_edit_issues: boolean;
can_delete_issues: boolean;
can_assign_issues: boolean;
can_close_issues: boolean;
can_view_all_issues: boolean;  // vs only assigned to me
```

---

## 11. MITU OBJEKTI ÜHE PROBLEEMI KOHTA

### 11.1 Probleemi Loomise Nõue

**REEGL:** Probleemi lisamiseks PEAB olema mudelist valitud vähemalt üks detail!

```typescript
// Validate before showing issue form
const handleCreateIssue = useCallback(async () => {
  // Get current selection from model
  const selection = await api.viewer.getSelection();
  
  if (!selection || selection.length === 0) {
    setMessage('⚠️ Vali mudelist vähemalt üks detail!');
    return;
  }
  
  // Extract all selected objects
  const selectedObjects: SelectedObject[] = [];
  
  for (const sel of selection) {
    for (const runtimeId of sel.objectRuntimeIds) {
      const props = await api.viewer.getObjectProperties(sel.modelId, runtimeId);
      const guids = await api.viewer.convertToObjectIds(sel.modelId, [runtimeId]);
      
      selectedObjects.push({
        modelId: sel.modelId,
        runtimeId,
        guidIfc: guids[0],
        assemblyMark: extractProperty(props, propertyMappings, 'assembly_mark'),
        productName: props?.name,
        // ... other properties
      });
    }
  }
  
  // Open form with selected objects
  setNewIssueObjects(selectedObjects);
  setShowForm(true);
}, [api, propertyMappings]);
```

### 11.2 Mitme Objekti Kuvamine

```typescript
// In IssueCard component
{issue.objects && issue.objects.length > 1 ? (
  <div className="issue-objects-badge">
    <FiLayers size={12} />
    <span>{issue.objects.length} detaili</span>
  </div>
) : (
  <div className="issue-assembly">
    {issue.objects?.[0]?.assembly_mark || 'Määramata'}
  </div>
)}
```

### 11.3 Objektide Lisamine/Eemaldamine

```typescript
// Add more objects to existing issue
const addObjectsToIssue = useCallback(async (issueId: string) => {
  const selection = await api.viewer.getSelection();
  if (!selection || selection.length === 0) {
    setMessage('⚠️ Vali mudelist detailid');
    return;
  }
  
  // Get existing objects to avoid duplicates
  const { data: existingObjects } = await supabase
    .from('issue_objects')
    .select('guid_ifc')
    .eq('issue_id', issueId);
  
  const existingGuids = new Set(existingObjects?.map(o => o.guid_ifc.toLowerCase()));
  
  // Add new objects
  const newObjects = [];
  for (const sel of selection) {
    const guids = await api.viewer.convertToObjectIds(sel.modelId, sel.objectRuntimeIds);
    
    for (let i = 0; i < sel.objectRuntimeIds.length; i++) {
      const guidIfc = guids[i];
      if (!existingGuids.has(guidIfc.toLowerCase())) {
        const props = await api.viewer.getObjectProperties(sel.modelId, sel.objectRuntimeIds[i]);
        newObjects.push({
          issue_id: issueId,
          model_id: sel.modelId,
          guid_ifc: guidIfc,
          assembly_mark: extractProperty(props, propertyMappings, 'assembly_mark'),
          product_name: props?.name,
          added_by: tcUserEmail
        });
      }
    }
  }
  
  if (newObjects.length === 0) {
    setMessage('⚠️ Kõik valitud detailid on juba lisatud');
    return;
  }
  
  const { error } = await supabase
    .from('issue_objects')
    .insert(newObjects);
  
  if (!error) {
    await logActivity('issue_updated', issueId, {
      fieldName: 'objects',
      newValue: `+${newObjects.length} detaili`
    });
    setMessage(`✅ Lisatud ${newObjects.length} detaili`);
    await loadIssueObjects(issueId);
  }
}, [api, propertyMappings, tcUserEmail]);
```

---

## 12. PILTIDE HALDUS

### 12.1 Ctrl+V Kleepimine

```typescript
// Paste handler for images
useEffect(() => {
  const handlePaste = async (e: ClipboardEvent) => {
    if (!showForm && !selectedIssue) return;
    
    const items = e.clipboardData?.items;
    if (!items) return;
    
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        
        const file = item.getAsFile();
        if (!file) continue;
        
        // Generate filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const extension = file.type.split('/')[1] || 'png';
        const filename = `pasted_${timestamp}.${extension}`;
        
        // Create new file with proper name
        const renamedFile = new File([file], filename, { type: file.type });
        
        // Add to pending uploads or upload immediately
        if (selectedIssue) {
          await uploadAttachment(selectedIssue.id, renamedFile, 'photo');
        } else {
          setPendingPhotos(prev => [...prev, {
            file: renamedFile,
            preview: URL.createObjectURL(renamedFile)
          }]);
        }
        
        setMessage('✅ Pilt kleebitud');
      }
    }
  };
  
  document.addEventListener('paste', handlePaste);
  return () => document.removeEventListener('paste', handlePaste);
}, [showForm, selectedIssue]);
```

### 12.2 Pildi Kustutamine

```typescript
const deleteAttachment = useCallback(async (attachment: IssueAttachment) => {
  if (!confirm('Kas oled kindel, et soovid pildi kustutada?')) return;
  
  try {
    // Delete from storage
    const storagePath = extractStoragePath(attachment.file_url);
    if (storagePath) {
      await supabase.storage
        .from('issue-attachments')
        .remove([storagePath]);
    }
    
    // Delete record
    const { error } = await supabase
      .from('issue_attachments')
      .delete()
      .eq('id', attachment.id);
    
    if (error) throw error;
    
    await logActivity('attachment_removed', attachment.issue_id, {
      extra: { fileName: attachment.file_name }
    });
    
    setAttachments(prev => prev.filter(a => a.id !== attachment.id));
    setMessage('✅ Pilt kustutatud');
    
  } catch (e: any) {
    setMessage(`Viga: ${e.message}`);
  }
}, []);
```

### 12.3 Pildi Allalaadimine Struktureeritud Nimega

```typescript
/**
 * Generate download filename:
 * {project}_{status}_{date}_{issue_title}_{index}.{ext}
 * Example: RM2506_TÖÖS_2026-01-11_Keevituse_viga_01.jpg
 */
const generateDownloadFilename = (
  issue: Issue,
  attachment: IssueAttachment,
  index: number,
  projectName: string
): string => {
  const sanitize = (str: string) => 
    str.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ]/g, '_').substring(0, 30);
  
  const status = ISSUE_STATUS_CONFIG[issue.status].label.toUpperCase();
  const date = new Date(issue.detected_at).toISOString().split('T')[0];
  const title = sanitize(issue.title);
  const ext = attachment.file_name.split('.').pop() || 'jpg';
  const num = String(index + 1).padStart(2, '0');
  
  return `${sanitize(projectName)}_${status}_${date}_${title}_${num}.${ext}`;
};

const downloadAttachment = useCallback(async (
  issue: Issue,
  attachment: IssueAttachment,
  index: number
) => {
  try {
    // Fetch file through proxy endpoint (hides Supabase URL)
    const response = await fetch(`/api/download-attachment/${attachment.id}`);
    const blob = await response.blob();
    
    // Generate proper filename
    const filename = generateDownloadFilename(issue, attachment, index, projectName);
    
    // Trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
  } catch (e: any) {
    setMessage(`Viga allalaadimisel: ${e.message}`);
  }
}, [projectName]);

// Download all photos for an issue
const downloadAllPhotos = useCallback(async (issue: Issue) => {
  const photos = attachments.filter(a => a.attachment_type === 'photo');
  
  for (let i = 0; i < photos.length; i++) {
    await downloadAttachment(issue, photos[i], i);
    // Small delay between downloads
    await new Promise(r => setTimeout(r, 200));
  }
  
  setMessage(`✅ ${photos.length} pilti alla laetud`);
}, [attachments, downloadAttachment]);
```

---

## 13. EXCEL EKSPORT

### 13.1 Kogu Ülevaate Eksport

```typescript
import * as XLSX from 'xlsx-js-style';

const exportToExcel = useCallback(async () => {
  setExporting(true);
  setMessage('Genereerin Excelit...');
  
  try {
    // Prepare data with all issues
    const rows: any[][] = [];
    
    // Header row
    rows.push([
      'Number', 'Pealkiri', 'Staatus', 'Prioriteet', 'Kategooria',
      'Detailid', 'Assembly Mark', 'Avastatud', 'Tähtaeg',
      'Vastutaja', 'Teavitaja', 'Kirjeldus', 'Asukoht',
      'Hinnatud (h)', 'Tegelik (h)', 'Hinnatud (€)', 'Tegelik (€)',
      'Lahendus', 'Sildid'
    ]);
    
    // Sort issues by status order then by number
    const sortedIssues = [...filteredIssues].sort((a, b) => {
      const statusDiff = ISSUE_STATUS_CONFIG[a.status].order - ISSUE_STATUS_CONFIG[b.status].order;
      if (statusDiff !== 0) return statusDiff;
      return a.issue_number.localeCompare(b.issue_number);
    });
    
    for (const issue of sortedIssues) {
      // Get objects for this issue
      const objects = issue.objects || [];
      const assemblyMarks = objects.map(o => o.assembly_mark).filter(Boolean).join(', ');
      
      // Get primary assignee
      const primaryAssignee = issue.assignments?.find(a => a.is_primary && a.is_active);
      
      rows.push([
        issue.issue_number,
        issue.title,
        ISSUE_STATUS_CONFIG[issue.status].label,
        ISSUE_PRIORITY_CONFIG[issue.priority].label,
        issue.category?.name || '',
        objects.length,
        assemblyMarks,
        formatDate(issue.detected_at),
        issue.due_date ? formatDate(issue.due_date) : '',
        primaryAssignee?.user_name || primaryAssignee?.user_email || '',
        issue.reported_by_name || issue.reported_by,
        issue.description || '',
        issue.location || '',
        issue.estimated_hours || '',
        issue.actual_hours || '',
        issue.estimated_cost || '',
        issue.actual_cost || '',
        issue.resolution_notes || '',
        issue.tags?.join(', ') || ''
      ]);
    }
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    
    // Style header row
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '2563EB' }, type: 'solid' },
      alignment: { horizontal: 'center' }
    };
    
    for (let col = 0; col < rows[0].length; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
      if (ws[cellRef]) {
        ws[cellRef].s = headerStyle;
      }
    }
    
    // Column widths
    ws['!cols'] = [
      { wch: 10 },  // Number
      { wch: 30 },  // Title
      { wch: 14 },  // Status
      { wch: 12 },  // Priority
      { wch: 15 },  // Category
      { wch: 8 },   // Objects count
      { wch: 20 },  // Assembly marks
      { wch: 12 },  // Detected
      { wch: 12 },  // Due date
      { wch: 20 },  // Assignee
      { wch: 20 },  // Reporter
      { wch: 40 },  // Description
      { wch: 20 },  // Location
      { wch: 10 },  // Est hours
      { wch: 10 },  // Act hours
      { wch: 10 },  // Est cost
      { wch: 10 },  // Act cost
      { wch: 30 },  // Resolution
      { wch: 20 }   // Tags
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Probleemid');
    
    // Add summary sheet
    const summaryRows = [
      ['KOKKUVÕTE'],
      [''],
      ['Staatuste järgi:'],
      ...Object.entries(ISSUE_STATUS_CONFIG).map(([status, config]) => [
        config.label,
        sortedIssues.filter(i => i.status === status).length
      ]),
      [''],
      ['Prioriteetide järgi:'],
      ...Object.entries(ISSUE_PRIORITY_CONFIG).map(([priority, config]) => [
        config.label,
        sortedIssues.filter(i => i.priority === priority).length
      ]),
      [''],
      ['Kokku:', sortedIssues.length],
      ['Aktiivsed:', sortedIssues.filter(i => !['closed', 'cancelled'].includes(i.status)).length],
      ['Tähtaeg ületatud:', sortedIssues.filter(i => 
        i.due_date && i.due_date < new Date().toISOString().split('T')[0] &&
        !['closed', 'cancelled', 'completed'].includes(i.status)
      ).length]
    ];
    
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Kokkuvõte');
    
    // Generate filename
    const date = new Date().toISOString().split('T')[0];
    const filename = `${projectName}_Probleemid_${date}.xlsx`;
    
    XLSX.writeFile(wb, filename);
    setMessage('✅ Excel alla laetud');
    
  } catch (e: any) {
    setMessage(`Viga: ${e.message}`);
  } finally {
    setExporting(false);
  }
}, [filteredIssues, projectName]);
```

---

## 14. PDF EKSPORT (Ühe Probleemi Raport)

### 14.1 PDF Genereerimise API Endpoint

**OLULINE:** PDF-is olevad piltide lingid peavad olema varjatud - kasutame proxy URL-e!

```typescript
// Vercel/Next.js API endpoint: /api/issue-pdf/[issueId].ts
// See genereerib PDF-i serveris, pildid laetakse läbi proxy

import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

export default async function handler(req, res) {
  const { issueId } = req.query;
  
  // Load issue data from Supabase (server-side)
  const issue = await loadIssueWithDetails(issueId);
  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }
  
  // Generate PDF
  const pdf = new jsPDF();
  
  // ... PDF generation code
  
  // Return PDF
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 
    `attachment; filename="${generatePdfFilename(issue)}"`);
  res.send(Buffer.from(pdf.output('arraybuffer')));
}
```

### 14.2 PDF Genereerimine (Client-side variant)

```typescript
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

/**
 * Generate PDF report for a single issue
 * Includes: details, objects, photos, comments, activity log
 * Photos have proxy links (not direct Supabase URLs)
 */
const generateIssuePDF = useCallback(async (issue: Issue) => {
  setGeneratingPdf(true);
  setMessage('Genereerin PDF-i...');
  
  try {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 15;
    let y = margin;
    
    // ==========================================
    // HEADER
    // ==========================================
    
    // Company logo (if available)
    // pdf.addImage(logo, 'PNG', margin, y, 30, 10);
    
    // Title
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`PROBLEEM ${issue.issue_number}`, margin, y + 5);
    
    // Status badge
    const statusConfig = ISSUE_STATUS_CONFIG[issue.status];
    pdf.setFillColor(...hexToRgb(statusConfig.color));
    pdf.roundedRect(pageWidth - margin - 40, y, 40, 8, 2, 2, 'F');
    pdf.setFontSize(10);
    pdf.setTextColor(255, 255, 255);
    pdf.text(statusConfig.label, pageWidth - margin - 20, y + 5.5, { align: 'center' });
    pdf.setTextColor(0, 0, 0);
    
    y += 15;
    
    // ==========================================
    // BASIC INFO
    // ==========================================
    
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text(issue.title, margin, y);
    y += 8;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    
    // Info table
    const infoData = [
      ['Kategooria:', issue.category?.name || '-'],
      ['Prioriteet:', ISSUE_PRIORITY_CONFIG[issue.priority].label],
      ['Allikas:', getSourceLabel(issue.source)],
      ['Avastatud:', formatDateTime(issue.detected_at)],
      ['Tähtaeg:', issue.due_date ? formatDate(issue.due_date) : '-'],
      ['Teavitas:', issue.reported_by_name || issue.reported_by],
      ['Asukoht:', issue.location || '-']
    ];
    
    (pdf as any).autoTable({
      startY: y,
      body: infoData,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 30 },
        1: { cellWidth: 'auto' }
      },
      margin: { left: margin }
    });
    
    y = (pdf as any).lastAutoTable.finalY + 10;
    
    // ==========================================
    // SEOTUD DETAILID
    // ==========================================
    
    if (issue.objects && issue.objects.length > 0) {
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('SEOTUD DETAILID', margin, y);
      y += 5;
      
      const objectsData = issue.objects.map((obj, idx) => [
        idx + 1,
        obj.assembly_mark || '-',
        obj.product_name || '-',
        obj.cast_unit_weight ? `${obj.cast_unit_weight} kg` : '-'
      ]);
      
      (pdf as any).autoTable({
        startY: y,
        head: [['#', 'Assembly Mark', 'Toode', 'Kaal']],
        body: objectsData,
        theme: 'striped',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [37, 99, 235] },
        margin: { left: margin, right: margin }
      });
      
      y = (pdf as any).lastAutoTable.finalY + 10;
    }
    
    // ==========================================
    // KIRJELDUS
    // ==========================================
    
    if (issue.description) {
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('KIRJELDUS', margin, y);
      y += 6;
      
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      const descLines = pdf.splitTextToSize(issue.description, pageWidth - 2 * margin);
      pdf.text(descLines, margin, y);
      y += descLines.length * 5 + 10;
    }
    
    // ==========================================
    // VASTUTAJAD
    // ==========================================
    
    if (issue.assignments && issue.assignments.length > 0) {
      const activeAssignments = issue.assignments.filter(a => a.is_active);
      if (activeAssignments.length > 0) {
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text('VASTUTAJAD', margin, y);
        y += 5;
        
        const assignData = activeAssignments.map(a => [
          a.user_name || a.user_email,
          a.role === 'assignee' ? 'Vastutaja' : a.role === 'reviewer' ? 'Ülevaataja' : 'Jälgija',
          a.is_primary ? '✓ Peamine' : ''
        ]);
        
        (pdf as any).autoTable({
          startY: y,
          body: assignData,
          theme: 'plain',
          styles: { fontSize: 10 },
          margin: { left: margin }
        });
        
        y = (pdf as any).lastAutoTable.finalY + 10;
      }
    }
    
    // ==========================================
    // HINNANGUD
    // ==========================================
    
    if (issue.estimated_hours || issue.actual_hours || issue.estimated_cost || issue.actual_cost) {
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('HINNANGUD', margin, y);
      y += 5;
      
      const estData = [
        ['', 'Hinnatud', 'Tegelik'],
        ['Ajakulu (h):', issue.estimated_hours || '-', issue.actual_hours || '-'],
        ['Kulu (€):', issue.estimated_cost ? `€${issue.estimated_cost}` : '-', 
                      issue.actual_cost ? `€${issue.actual_cost}` : '-']
      ];
      
      (pdf as any).autoTable({
        startY: y,
        body: estData,
        theme: 'grid',
        styles: { fontSize: 10 },
        margin: { left: margin }
      });
      
      y = (pdf as any).lastAutoTable.finalY + 10;
    }
    
    // ==========================================
    // PILDID
    // ==========================================
    
    const photos = attachments.filter(a => a.attachment_type === 'photo');
    if (photos.length > 0) {
      // New page for photos
      pdf.addPage();
      y = margin;
      
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('PILDID', margin, y);
      y += 8;
      
      const photoWidth = (pageWidth - 3 * margin) / 2;
      const photoHeight = 60;
      let col = 0;
      
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        
        // Check if need new page
        if (y + photoHeight + 20 > pdf.internal.pageSize.getHeight()) {
          pdf.addPage();
          y = margin;
        }
        
        try {
          // Load image through proxy (hides Supabase URL)
          const proxyUrl = `/api/proxy-image/${photo.id}`;
          const imgData = await loadImageAsBase64(proxyUrl);
          
          const x = margin + col * (photoWidth + margin);
          pdf.addImage(imgData, 'JPEG', x, y, photoWidth, photoHeight);
          
          // Caption with PROXY link (not direct Supabase)
          pdf.setFontSize(8);
          pdf.setTextColor(100, 100, 100);
          const caption = `${i + 1}. ${photo.title || photo.file_name}`;
          pdf.text(caption, x, y + photoHeight + 4);
          
          // Clickable link (proxy URL)
          const linkUrl = `${window.location.origin}/api/download/${photo.id}`;
          pdf.setTextColor(37, 99, 235);
          pdf.textWithLink('↓ Laadi alla', x + photoWidth - 20, y + photoHeight + 4, { url: linkUrl });
          pdf.setTextColor(0, 0, 0);
          
        } catch (e) {
          // Image load failed - show placeholder
          pdf.setFillColor(240, 240, 240);
          const x = margin + col * (photoWidth + margin);
          pdf.rect(x, y, photoWidth, photoHeight, 'F');
          pdf.setFontSize(10);
          pdf.text('Pilti ei õnnestunud laadida', x + photoWidth/2, y + photoHeight/2, { align: 'center' });
        }
        
        col++;
        if (col >= 2) {
          col = 0;
          y += photoHeight + 15;
        }
      }
      
      if (col !== 0) {
        y += photoHeight + 15;
      }
    }
    
    // ==========================================
    // KOMMENTAARID
    // ==========================================
    
    if (comments && comments.length > 0) {
      // Check if need new page
      if (y + 50 > pdf.internal.pageSize.getHeight()) {
        pdf.addPage();
        y = margin;
      }
      
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('KOMMENTAARID', margin, y);
      y += 8;
      
      for (const comment of comments) {
        // Check page break
        if (y + 20 > pdf.internal.pageSize.getHeight()) {
          pdf.addPage();
          y = margin;
        }
        
        // Author and date
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        const author = comment.author_name || comment.author_email;
        const date = formatDateTime(comment.created_at);
        pdf.text(`${author} • ${date}`, margin, y);
        y += 5;
        
        // Status change indicator
        if (comment.old_status && comment.new_status) {
          pdf.setFontSize(8);
          pdf.setTextColor(100, 100, 100);
          pdf.text(
            `Staatus: ${ISSUE_STATUS_CONFIG[comment.old_status].label} → ${ISSUE_STATUS_CONFIG[comment.new_status].label}`,
            margin, y
          );
          pdf.setTextColor(0, 0, 0);
          y += 4;
        }
        
        // Comment text
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        const commentLines = pdf.splitTextToSize(comment.comment_text, pageWidth - 2 * margin);
        pdf.text(commentLines, margin, y);
        y += commentLines.length * 4 + 8;
      }
    }
    
    // ==========================================
    // FOOTER
    // ==========================================
    
    const pageCount = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text(
        `Genereeritud: ${formatDateTime(new Date().toISOString())} | Leht ${i}/${pageCount}`,
        pageWidth / 2, pdf.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }
    
    // ==========================================
    // SAVE
    // ==========================================
    
    // Generate filename: PROJECT_STATUS_DATE_TITLE.pdf
    const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9äöüõÄÖÜÕ]/g, '_').substring(0, 30);
    const filename = [
      sanitize(projectName),
      ISSUE_STATUS_CONFIG[issue.status].label.toUpperCase(),
      formatDate(issue.detected_at),
      sanitize(issue.title)
    ].join('_') + '.pdf';
    
    pdf.save(filename);
    
    await logActivity('issue_updated', issue.id, {
      extra: { action: 'pdf_exported' }
    });
    
    setMessage('✅ PDF alla laetud');
    
  } catch (e: any) {
    console.error('PDF generation error:', e);
    setMessage(`Viga PDF genereerimisel: ${e.message}`);
  } finally {
    setGeneratingPdf(false);
  }
}, [attachments, comments, projectName]);
```

### 14.3 Proxy API Endpoints (URL Varjamine)

**OLULINE:** Need API endpointid varjavad Supabase Storage URL-id!

```typescript
// /api/proxy-image/[attachmentId].ts
// Returns image data without exposing Supabase URL

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const { attachmentId } = req.query;
  
  // Get attachment record
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  
  const { data: attachment } = await supabase
    .from('issue_attachments')
    .select('file_url, mime_type')
    .eq('id', attachmentId)
    .single();
  
  if (!attachment) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  // Fetch image from Supabase Storage
  const response = await fetch(attachment.file_url);
  const buffer = await response.arrayBuffer();
  
  res.setHeader('Content-Type', attachment.mime_type || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(buffer));
}

// /api/download/[attachmentId].ts
// Downloads file with proper filename, hides Supabase URL

export default async function handler(req, res) {
  const { attachmentId } = req.query;
  
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  
  // Get attachment with issue info for filename
  const { data: attachment } = await supabase
    .from('issue_attachments')
    .select(`
      *,
      issue:issues(issue_number, title, status, detected_at, trimble_project_id)
    `)
    .eq('id', attachmentId)
    .single();
  
  if (!attachment) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  // Generate proper filename
  const filename = generateDownloadFilename(
    attachment.issue,
    attachment,
    0, // index
    'Project' // TODO: get actual project name
  );
  
  // Fetch from Supabase Storage
  const response = await fetch(attachment.file_url);
  const buffer = await response.arrayBuffer();
  
  res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
}
```

---

## 15. IMPLEMENTATSIOONI JÄRJEKORD (UUENDATUD)

### Faas 1: Andmebaas (1 päev)
- [ ] Loo migratsioonifail `20260112_issues_system.sql`
- [ ] Lisa `issue_objects` tabel mitme objekti toeks
- [ ] Lisa TypeScript tüübid `supabase.ts`
- [ ] Jooksuta migratsioon
- [ ] Lisa kasutaja õigused

### Faas 2: Põhikomponent (2 päeva)
- [ ] Loo `IssuesScreen.tsx` struktuur
- [ ] Implementeeri andmete laadimine koos objektidega
- [ ] Implementeeri staatuste grupeerimine
- [ ] Implementeeri mudeli värvimine (valge + staatuse värvid)

### Faas 3: Probleemi Loomine Mudelist (1.5 päeva)
- [ ] Implementeeri mudelist valimise nõue
- [ ] Implementeeri mitme objekti tugi
- [ ] Loo `IssueForm.tsx` komponent
- [ ] Implementeeri objektide lisamine/eemaldamine

### Faas 4: Kahepoolne Sünk (1 päev)
- [ ] Implementeeri List → Mudel valik (kõik objektid)
- [ ] Implementeeri Mudel → List valik
- [ ] Lisa mudeli valiku info toast

### Faas 5: Piltide Haldus (1.5 päeva)
- [ ] Implementeeri piltide üleslaadimine
- [ ] Implementeeri Ctrl+V kleepimine
- [ ] Implementeeri piltide kustutamine
- [ ] Implementeeri allalaadimine struktureeritud nimega
- [ ] Loo proxy API endpointid URL varjamiseks

### Faas 6: Filtrid ja Otsing (1 päev)
- [ ] Implementeeri filtrite UI
- [ ] Implementeeri filtreerimise loogika
- [ ] Implementeeri sorteerimine

### Faas 7: Kasutajate Suunamine (1 päev)
- [ ] Implementeeri Trimble meeskonna laadimine
- [ ] Implementeeri kasutaja määramine
- [ ] Implementeeri määramiste UI

### Faas 8: Tegevuste Logi (1 päev)
- [ ] Implementeeri logimise funktsioon
- [ ] Lisa automaatsed triggerid
- [ ] Implementeeri ajaloo vaade

### Faas 9: Ekspordid (1.5 päeva)
- [ ] Implementeeri Excel eksport (kogu ülevaade)
- [ ] Implementeeri PDF eksport (üks probleem)
- [ ] Lisa jsPDF ja jspdf-autotable
- [ ] Testi proxy URL-id PDF-is

### Faas 10: Menüü Badge ja Lihvimine (1 päev)
- [ ] Lisa badge komponent
- [ ] Implementeeri realtime uuendused
- [ ] CSS stiilid
- [ ] Jõudluse optimeerimine
- [ ] Testimine

**Kokku: ~13-14 tööpäeva**

---

## 16. VERSIOON

```typescript
// src/App.tsx
export const APP_VERSION = '3.0.XXX';

// package.json
"version": "3.0.XXX"
```

**Commit:**
```
v3.0.XXX: Lisa IssuesScreen - Mittevastavuste ja probleemide haldus

- Probleemide haldus staatuste kaupa
- Mitu objekti ühe probleemi kohta (mudelist valimine kohustuslik)
- Mudeli värvimine staatuse järgi
- Kahepoolne mudeli sünkroniseerimine
- Täielik tegevuste logi (kes, mida, millal)
- Trimble kasutajatele suunamine
- Menüü badge aktiivsete probleemidega
- Otsing ja filtrid
- Piltide haldus (Ctrl+V, kustutamine, struktureeritud allalaadimine)
- Excel eksport (kogu ülevaade)
- PDF eksport (üks probleem piltidega, varjatud URL-id)
```

---

## 17. SÕLTUVUSED

**Lisa `package.json`:**

```json
{
  "dependencies": {
    "jspdf": "^2.5.1",
    "jspdf-autotable": "^3.8.1",
    "xlsx-js-style": "^1.2.0"
  }
}
```

---

*Arendusplaan v3.0 - 11. jaanuar 2026*
# LISA: Professionaalsed Täiendused Issues Moodulile

## Täiendavad Funktsioonid Täiusliku Lahenduse Jaoks

Põhinedes tööstuse parimatele praktikatele (ISO 9001, NCR haldus, punch list tarkvara):

---

## A. DASHBOARD JA ANALÜÜTIKA

### A.1 Reaalajas Ülevaate Dashboard

```typescript
interface IssueDashboard {
  // Kokkuvõte numbrid
  summary: {
    total: number;
    active: number;
    overdue: number;
    resolvedThisWeek: number;
    avgResolutionDays: number;
  };
  
  // Staatuste jaotus (pie chart)
  byStatus: Record<IssueStatus, number>;
  
  // Prioriteetide jaotus
  byPriority: Record<IssuePriority, number>;
  
  // Kategooriate jaotus
  byCategory: { categoryId: string; name: string; count: number }[];
  
  // Trendid (line chart)
  trends: {
    date: string;
    created: number;
    resolved: number;
  }[];
  
  // Top probleemid vastutajate järgi
  byAssignee: {
    email: string;
    name: string;
    activeCount: number;
    overdueCount: number;
  }[];
  
  // Korduvad probleemid (sama kategooria/asukoht)
  recurringIssues: {
    pattern: string;
    count: number;
    lastOccurrence: string;
  }[];
}
```

### A.2 KPI Mõõdikud

| KPI | Kirjeldus | Arvutus |
|-----|-----------|---------|
| **Keskmine lahendusaeg** | Kui kaua võtab probleemi lahendamine | `AVG(closed_at - detected_at)` |
| **Tähtajast kinnipidamine** | % probleeme mis lahendati tähtajaks | `resolved_on_time / total_resolved * 100` |
| **Esmakordne lahendus** | % probleeme mis ei avanenud uuesti | `(1 - reopened / resolved) * 100` |
| **Avatud probleemide trend** | Kas probleemid kogunevad või lahendatakse | `created_this_week - resolved_this_week` |
| **Kriitiliste osakaal** | % kriitilisi probleeme | `critical / total * 100` |

---

## B. KORRIGEERIVAD JA ENNETAVAD TEGEVUSED (CAPA)

### B.1 Juurpõhjuse Analüüs (Root Cause Analysis)

```sql
-- Lisa issues tabelisse
ALTER TABLE issues ADD COLUMN root_cause_category TEXT;  -- 'material', 'workmanship', 'design', 'process', 'equipment', 'human_error', 'environment'
ALTER TABLE issues ADD COLUMN root_cause_analysis TEXT;   -- 5 Whys või muu analüüs
ALTER TABLE issues ADD COLUMN corrective_action TEXT;     -- Korrigeeriv tegevus
ALTER TABLE issues ADD COLUMN preventive_action TEXT;     -- Ennetav tegevus
ALTER TABLE issues ADD COLUMN verification_required BOOLEAN DEFAULT false;
ALTER TABLE issues ADD COLUMN verification_date DATE;
ALTER TABLE issues ADD COLUMN verified_by TEXT;
ALTER TABLE issues ADD COLUMN verification_notes TEXT;
```

### B.2 CAPA Töövoog

```
PROBLEEM AVASTATUD
       ↓
JUURPÕHJUSE ANALÜÜS (5 Whys)
       ↓
KORRIGEERIV TEGEVUS (parandab praeguse)
       ↓
ENNETAV TEGEVUS (takistab tulevikus)
       ↓
VERIFITSEERIMINE (kas tegevused toimisid?)
       ↓
SULGEMINE
```

### B.3 5 Whys UI

```typescript
interface RootCauseAnalysis {
  why1: string;  // "Miks keevitusõmblus ebaühtlane?"
  why2: string;  // "Miks keevitaja ei järginud protsessi?"
  why3: string;  // "Miks ta ei teadnud protsessi?"
  why4: string;  // "Miks koolitust ei olnud?"
  why5: string;  // "Miks koolituskava puudub?"
  rootCause: string;  // "Puudulik koolitussüsteem"
}
```

---

## C. TEAVITUSED JA ESKALATSIOON

### C.1 E-maili Teavitused

```typescript
type NotificationType = 
  | 'issue_assigned'           // Sulle määrati probleem
  | 'issue_due_soon'          // Tähtaeg 3 päeva pärast
  | 'issue_overdue'           // Tähtaeg ületatud
  | 'issue_commented'         // Keegi kommenteeris
  | 'issue_status_changed'    // Staatus muutus
  | 'issue_escalated'         // Probleem eskaleeriti
  | 'daily_summary'           // Päeva kokkuvõte
  | 'weekly_report';          // Nädala raport

interface NotificationSettings {
  user_email: string;
  enabled_notifications: NotificationType[];
  email_frequency: 'instant' | 'hourly' | 'daily';
  daily_summary_time: string;  // "08:00"
}
```

### C.2 Automaatne Eskalatsioon

```sql
CREATE TABLE issue_escalation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  
  -- Tingimused
  trigger_condition JSONB NOT NULL,  -- {"priority": "critical", "days_open": 3}
  
  -- Tegevused
  escalate_to TEXT[],           -- Kellele eskaleerida (emailid)
  change_priority_to TEXT,      -- Uus prioriteet
  add_tag TEXT,                 -- Lisa silt "escalated"
  send_notification BOOLEAN DEFAULT true,
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Näide: Kui kriitiline probleem on avatud > 24h, eskalee juhile
INSERT INTO issue_escalation_rules (trimble_project_id, name, trigger_condition, escalate_to)
VALUES (
  'project-123',
  'Kriitilised üle 24h',
  '{"priority": "critical", "status_not_in": ["closed", "cancelled"], "hours_open_gt": 24}',
  ARRAY['manager@company.ee']
);
```

### C.3 Päeva/Nädala Kokkuvõte Email

```
📊 PROBLEEMIDE KOKKUVÕTE - 11. jaanuar 2026

ÜLEVAADE:
• Aktiivsed: 12 (↑3 võrreldes eile)
• Kriitilised: 2
• Tähtaeg ületatud: 3 ⚠️

SINU MÄÄRATUD:
• ISS-0042: Keevituse viga (KRIITILINE) - tähtaeg: TÄNA
• ISS-0039: Mõõtude erinevus - tähtaeg: 15.01

TÄNA LAHENDATUD:
• ISS-0038: Pinnakahjustus ✓
• ISS-0035: Dokumentatsiooni puudus ✓

[Ava dashboard →]
```

---

## D. SEOTUD DOKUMENTATSIOON

### D.1 Jooniste/Dokumentide Sidumine

```sql
CREATE TABLE issue_linked_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  
  -- Dokumendi info
  document_type TEXT NOT NULL,  -- 'drawing', 'specification', 'standard', 'procedure', 'checklist'
  document_name TEXT NOT NULL,
  document_url TEXT,            -- Link TC dokumentidele või Storage'ile
  document_version TEXT,
  
  -- Viide konkreetsele kohale
  page_number INTEGER,
  section_reference TEXT,       -- "§4.2.1"
  
  linked_by TEXT NOT NULL,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);
```

### D.2 Standardite Viited

```typescript
interface StandardReference {
  standardCode: string;    // "EN 1090-2"
  clause: string;          // "7.5.6"
  requirement: string;     // "Keevitusõmbluse visuaalne kontroll"
  complianceStatus: 'compliant' | 'non_compliant' | 'not_applicable';
}
```

---

## E. ALLKIRJASTAMINE JA KINNITUSED

### E.1 Digitaalne Allkiri

```sql
CREATE TABLE issue_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  
  signature_type TEXT NOT NULL,  -- 'inspection', 'approval', 'closure', 'verification'
  
  -- Allkirjastaja
  signer_email TEXT NOT NULL,
  signer_name TEXT,
  signer_role TEXT,              -- 'inspector', 'supervisor', 'quality_manager'
  
  -- Allkiri
  signature_data TEXT,           -- Base64 encoded käsitsi allkiri või "DIGITALLY_SIGNED"
  signed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Kontekst
  comment TEXT,
  ip_address TEXT,
  device_info TEXT
);
```

### E.2 Kinnituse Töövoog

```
PROBLEEM VALMIS
       ↓
INSPEKTORI ALLKIRI (kinnitan, et parandatud)
       ↓
JÄRELEVAATAJA ALLKIRI (kinnitan kontrolli)
       ↓
KVALITEEDIJUHI ALLKIRI (kinnitan sulgemise)
       ↓
LÕPETATUD
```

---

## F. MALLID JA KIIRSISETAMISED

### F.1 Probleemi Mallid

```sql
CREATE TABLE issue_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- Eeltäidetud väljad
  category_id UUID REFERENCES issue_categories(id),
  default_priority issue_priority,
  default_title TEXT,
  default_description TEXT,
  default_tags TEXT[],
  
  -- Checklist items (mis tuleb kontrollida)
  checklist_items JSONB DEFAULT '[]',  -- [{text: "Kontrollitud visuaalselt", required: true}]
  
  -- Kellele automaatselt määrata
  auto_assign_to TEXT[],
  
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  usage_count INTEGER DEFAULT 0
);
```

### F.2 Kiir-probleemide Nupud

```typescript
const QUICK_ISSUE_TEMPLATES = [
  { icon: '🔥', label: 'Keevitusviga', templateId: 'welding-defect' },
  { icon: '📏', label: 'Mõõtude viga', templateId: 'dimension-error' },
  { icon: '🎨', label: 'Pinnadefekt', templateId: 'surface-defect' },
  { icon: '📄', label: 'Dok. puudub', templateId: 'missing-doc' },
  { icon: '⚠️', label: 'Ohutus', templateId: 'safety-issue' },
];
```

---

## G. ARUANDLUS

### G.1 Aruande Tüübid

| Aruanne | Kirjeldus | Formaat |
|---------|-----------|---------|
| **Päeva ülevaade** | Tänased tegevused | PDF/Email |
| **Nädala kokkuvõte** | Statistika ja trendid | PDF/Excel |
| **Projekti aruanne** | Kogu projekti NCR ülevaade | PDF |
| **Vastutaja aruanne** | Ühe inimese probleemid | PDF |
| **Kategooria analüüs** | Probleemid kategooria järgi | Excel |
| **Tähtaegade aruanne** | Tähtajast kinnipidamine | PDF |
| **CAPA aruanne** | Korrigeerivad/ennetavad tegevused | PDF |
| **Audit trail** | Täielik tegevuste logi | PDF/CSV |

### G.2 Planeeritud Aruanded

```sql
CREATE TABLE scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  
  report_type TEXT NOT NULL,
  report_name TEXT NOT NULL,
  
  -- Ajakava
  frequency TEXT NOT NULL,  -- 'daily', 'weekly', 'monthly'
  day_of_week INTEGER,      -- 1-7 (nädala aruande jaoks)
  day_of_month INTEGER,     -- 1-31 (kuu aruande jaoks)
  time_of_day TIME DEFAULT '08:00',
  
  -- Saajad
  recipients TEXT[] NOT NULL,
  
  -- Filtrid
  filters JSONB,  -- {"status": ["active"], "priority": ["high", "critical"]}
  
  is_active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_by TEXT NOT NULL
);
```

---

## H. OFFLINE TUGI

### H.1 Offline Andmete Sünk

```typescript
interface OfflineIssue {
  localId: string;           // Ajutine ID
  syncStatus: 'pending' | 'syncing' | 'synced' | 'conflict';
  createdOfflineAt: string;
  syncedAt?: string;
  conflictData?: Issue;      // Serveri versioon kui konflikt
}

// Service Worker andmete cached'imine
const OFFLINE_CACHE = {
  issues: Issue[];
  categories: IssueCategory[];
  teamMembers: TeamMember[];
  pendingUploads: { issueId: string; photos: File[] }[];
};
```

### H.2 Konflikti Lahendamine

```
OFFLINE MUUDATUS          ONLINE MUUDATUS
       ↓                        ↓
    SÜNKIMINE ALGAB
       ↓
    KONFLIKT TUVASTATUD
       ↓
┌──────────────────────────────────────┐
│  KONFLIKTI LAHENDAMINE               │
│                                      │
│  Sinu muudatus:                      │
│  Staatus: Töös → Valmis              │
│  Offline: 10.01 14:32                │
│                                      │
│  Serveri muudatus:                   │
│  Staatus: Töös → Ootel               │
│  Keegi Teine: 10.01 14:35            │
│                                      │
│  [Kasuta minu] [Kasuta serveri]      │
│  [Ühenda käsitsi]                    │
└──────────────────────────────────────┘
```

---

## I. INTEGRATSIOONID

### I.1 Olemasolevate Moodulitega

| Moodul | Integratsioon |
|--------|---------------|
| **Tarnegraafik** | "Lisa probleem" nupp detaili juures → loob issue seotud GUID-iga |
| **Paigaldusgraafik** | Sama |
| **Inspektsioonid** | Inspektsiooni ebaõnnestumise korral automaatne issue |
| **Organiseerija** | Grupi elementidel "Lisa probleem" |

### I.2 Väliste Süsteemidega

```typescript
// Webhook'id
interface IssueWebhook {
  url: string;
  events: ('created' | 'updated' | 'closed' | 'escalated')[];
  secret: string;
  isActive: boolean;
}

// Näide: Saada Slack'i kui kriitiline probleem
POST https://hooks.slack.com/services/XXX
{
  "text": "🚨 Uus kriitiline probleem: ISS-0042 - Keevituse viga",
  "attachments": [{
    "color": "#DC2626",
    "fields": [
      {"title": "Detail", "value": "E-125", "short": true},
      {"title": "Vastutaja", "value": "M. Keevitaja", "short": true}
    ]
  }]
}
```

---

## J. MÄRGISTUS MUDELIS (3D MARKUP)

### J.1 Probleemi Marker Mudelis

```typescript
// Lisa visuaalne marker probleemi asukohta mudelis
const createIssueMarkerInModel = async (issue: Issue) => {
  if (!issue.guid_ifc) return;
  
  // Leia objekti bounding box
  const bounds = await api.viewer.getObjectBounds(issue.model_id, [runtimeId]);
  
  // Loo 3D marker (annotation)
  await api.viewer.createMarkup({
    type: 'sphere',
    position: bounds.center,
    radius: 0.3,
    color: ISSUE_STATUS_CONFIG[issue.status].modelColor,
    label: issue.issue_number,
    userData: { issueId: issue.id }
  });
};
```

### J.2 Mudelile Joonistamine

```typescript
// Võimalda kasutajal joonistada mudelile (visuaalne kirjeldus)
interface IssueSketch {
  issueId: string;
  sketchData: string;      // SVG või Canvas andmed
  viewpointData: string;   // Kaamera positsioon
  createdBy: string;
  createdAt: string;
}
```

---

## K. QR KOOD INTEGRATSIOON

### K.1 Detailide QR Koodid

```typescript
// Genereeri QR kood mis avab selle detaili probleemid
const generateDetailQRCode = (guidIfc: string, projectId: string): string => {
  const url = `${BASE_URL}/issues?project=${projectId}&guid=${guidIfc}`;
  return QRCode.toDataURL(url);
};

// Töölisel objektiivselt on QR kood → skännib → näeb kõik selle detaili probleemid
```

### K.2 Probleemi QR Kood PDF-is

```typescript
// PDF-is on QR kood mis viib otse probleemi juurde
const generateIssuePDFWithQR = async (issue: Issue) => {
  const qrDataUrl = await QRCode.toDataURL(
    `${BASE_URL}/issues/${issue.id}`
  );
  
  // Lisa QR kood PDF-i ülaossa
  pdf.addImage(qrDataUrl, 'PNG', pageWidth - 30, 10, 20, 20);
};
```

---

## L. MOBIILI OPTIMEERIMINE

### L.1 Puutetundlik UI

- Suuremad nupud (min 44x44px)
- Swipe žestid (swipe left = kustuta, swipe right = muuda staatust)
- Pull-to-refresh
- Floating Action Button (FAB) uue probleemi jaoks

### L.2 Kaamera Integratsioon

```typescript
// Otsene kaamerast pildistamine
const capturePhoto = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ 
    video: { facingMode: 'environment' }  // Tagakaamera
  });
  // ...
};

// Pildile automaatne metadata
interface PhotoMetadata {
  timestamp: string;
  gpsLocation?: { lat: number; lng: number };
  deviceInfo: string;
  projectId: string;
  issueId?: string;
}
```

---

## M. IMPLEMENTATSIOONI PRIORITEEDID

### Kõrge Prioriteet (Lisa v3.0-sse)
1. ✅ Dashboard põhiline (staatuste/prioriteetide ülevaade)
2. ✅ E-maili teavitused (määramine, tähtaeg)
3. ✅ Mallid (kiir-probleemide nupud)
4. ✅ Mobiili optimeerimine

### Keskmine Prioriteet (v3.1)
5. CAPA (juurpõhjuse analüüs, korrigeeriv/ennetav tegevus)
6. Automaatne eskalatsioon
7. Planeeritud aruanded
8. QR koodid

### Madal Prioriteet (v3.2+)
9. Offline tugi
10. Digitaalsed allkirjad
11. 3D markupid mudelis
12. Webhook integratsioonid

---

*Lisa koostatud: 11. jaanuar 2026*
