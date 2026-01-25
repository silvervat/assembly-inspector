-- ============================================
-- INSPECTION CONFIG - Colors and Project Settings
-- Inspektsiooni seadistused - värvid ja projekti seaded
-- ============================================

-- ============================================
-- 1. ADD COLOR FIELDS TO INSPECTION TYPES
-- ============================================
-- Add colors for uninspected and inspected elements in model

ALTER TABLE inspection_types
ADD COLUMN IF NOT EXISTS color_uninspected_r INTEGER DEFAULT 200,
ADD COLUMN IF NOT EXISTS color_uninspected_g INTEGER DEFAULT 200,
ADD COLUMN IF NOT EXISTS color_uninspected_b INTEGER DEFAULT 200,
ADD COLUMN IF NOT EXISTS color_uninspected_a INTEGER DEFAULT 255,
ADD COLUMN IF NOT EXISTS color_inspected_r INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS color_inspected_g INTEGER DEFAULT 200,
ADD COLUMN IF NOT EXISTS color_inspected_b INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS color_inspected_a INTEGER DEFAULT 255;

-- Add comment
COMMENT ON COLUMN inspection_types.color_uninspected_r IS 'Kontrollimata elementide värv (R komponent 0-255)';
COMMENT ON COLUMN inspection_types.color_inspected_r IS 'Kontrollitud elementide värv (R komponent 0-255)';

-- ============================================
-- 2. PROJECT INSPECTION SETTINGS TABLE
-- ============================================
-- Project-specific inspection configuration overrides

CREATE TABLE IF NOT EXISTS project_inspection_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL,
  inspection_type_id UUID NOT NULL REFERENCES inspection_types(id) ON DELETE CASCADE,

  -- Override colors (null = use default from inspection_types)
  color_uninspected_r INTEGER,
  color_uninspected_g INTEGER,
  color_uninspected_b INTEGER,
  color_uninspected_a INTEGER DEFAULT 255,
  color_inspected_r INTEGER,
  color_inspected_g INTEGER,
  color_inspected_b INTEGER,
  color_inspected_a INTEGER DEFAULT 255,

  -- Workflow settings
  requires_moderator_approval BOOLEAN DEFAULT true,
  auto_lock_on_approval BOOLEAN DEFAULT true,
  allow_edit_after_approval BOOLEAN DEFAULT false,

  -- Notification settings
  notify_on_completion BOOLEAN DEFAULT false,
  notify_on_approval BOOLEAN DEFAULT false,
  notification_emails TEXT[], -- Array of emails to notify

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,

  -- Unique constraint per project+type
  UNIQUE(project_id, inspection_type_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_project_inspection_settings_project ON project_inspection_settings(project_id);
CREATE INDEX IF NOT EXISTS idx_project_inspection_settings_type ON project_inspection_settings(inspection_type_id);

-- RLS Policy
ALTER TABLE project_inspection_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to project_inspection_settings" ON project_inspection_settings;
CREATE POLICY "Allow all access to project_inspection_settings" ON project_inspection_settings
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 3. ADD PROJECT OVERRIDE TO CATEGORIES
-- ============================================
-- Allow project-specific category customization

ALTER TABLE inspection_categories
ADD COLUMN IF NOT EXISTS color_uninspected TEXT,
ADD COLUMN IF NOT EXISTS color_inspected TEXT;

-- ============================================
-- 4. ADD SUPPORT MATERIALS TO CHECKPOINTS
-- ============================================
-- Ensure support materials fields exist

ALTER TABLE inspection_checkpoints
ADD COLUMN IF NOT EXISTS support_video_url TEXT,
ADD COLUMN IF NOT EXISTS support_document_urls TEXT[];

-- ============================================
-- 5. UPDATE TIMESTAMPS TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION update_project_inspection_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_project_inspection_settings_updated_at ON project_inspection_settings;
CREATE TRIGGER trigger_project_inspection_settings_updated_at
  BEFORE UPDATE ON project_inspection_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_project_inspection_settings_updated_at();
