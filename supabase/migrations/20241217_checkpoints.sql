-- ============================================================
-- EOS2 Checkpoint System for Assembly Inspector
-- Allows defining specific checkpoints per category
-- and tracking inspection results with responses
-- ============================================================

-- 0. CLEANUP - Drop existing tables if partially created
-- ============================================================
DROP VIEW IF EXISTS checkpoint_completion_stats;
DROP TABLE IF EXISTS inspection_result_photos CASCADE;
DROP TABLE IF EXISTS inspection_results CASCADE;
DROP TABLE IF EXISTS inspection_checkpoint_attachments CASCADE;
DROP TABLE IF EXISTS inspection_checkpoints CASCADE;

-- 1. INSPECTION CHECKPOINTS TABLE
-- Specific control points within a category
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_checkpoints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES inspection_categories(id) ON DELETE CASCADE,

  -- Identification
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  -- Instructions in Markdown format
  instructions TEXT,

  -- Ordering and status
  sort_order INT DEFAULT 0,
  is_required BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Response configuration
  response_options JSONB DEFAULT '[]'::jsonb,
  display_type TEXT DEFAULT 'radio' CHECK (display_type IN ('radio', 'checkbox', 'dropdown')),
  allow_multiple BOOLEAN DEFAULT false,

  -- Comment settings
  comment_enabled BOOLEAN DEFAULT true,
  end_user_can_comment BOOLEAN DEFAULT true,

  -- Photo requirements
  photos_min INT DEFAULT 0,
  photos_max INT DEFAULT 10,
  photos_required_responses TEXT[] DEFAULT '{}',
  photos_allowed_responses TEXT[] DEFAULT '{}',
  comment_required_responses TEXT[] DEFAULT '{}',

  -- Template and project settings
  is_template BOOLEAN DEFAULT false,
  project_id TEXT,
  source_checkpoint_id UUID REFERENCES inspection_checkpoints(id),

  -- Trimble specific
  requires_assembly_selection BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index on code within category
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoints_category_code
ON inspection_checkpoints(category_id, code);

-- Create index for active checkpoints
CREATE INDEX IF NOT EXISTS idx_checkpoints_active
ON inspection_checkpoints(category_id, is_active) WHERE is_active = true;

-- ============================================================
-- 2. CHECKPOINT ATTACHMENTS TABLE
-- Juhendmaterjalid: links, videos, documents, images
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_checkpoint_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  checkpoint_id UUID NOT NULL REFERENCES inspection_checkpoints(id) ON DELETE CASCADE,

  -- Attachment info
  type TEXT NOT NULL CHECK (type IN ('link', 'video', 'document', 'image', 'file')),
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,

  -- Storage info (if uploaded)
  storage_path TEXT,
  file_size BIGINT,
  mime_type TEXT,

  -- Ordering
  sort_order INT DEFAULT 0,

  -- Metadata
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_checkpoint
ON inspection_checkpoint_attachments(checkpoint_id);

-- ============================================================
-- 3. INSPECTION RESULTS TABLE
-- Stores actual inspection results/responses
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Reference to plan item and checkpoint
  plan_item_id UUID REFERENCES inspection_plan_items(id) ON DELETE SET NULL,
  checkpoint_id UUID NOT NULL REFERENCES inspection_checkpoints(id) ON DELETE CASCADE,

  -- Project and assembly info
  project_id TEXT NOT NULL,
  assembly_guid TEXT NOT NULL,
  assembly_name TEXT,

  -- Response data
  response_value TEXT NOT NULL,
  response_label TEXT,
  comment TEXT,

  -- Inspector info
  inspector_id UUID,
  inspector_name TEXT NOT NULL,
  user_email TEXT,

  -- Inspection time and location
  inspected_at TIMESTAMPTZ DEFAULT NOW(),
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),

  -- Device info
  device_info JSONB,

  -- Sync status with Trimble
  synced_to_trimble BOOLEAN DEFAULT false,
  trimble_sync_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup by assembly
CREATE INDEX IF NOT EXISTS idx_results_assembly
ON inspection_results(project_id, assembly_guid);

-- Index for checkpoint results
CREATE INDEX IF NOT EXISTS idx_results_checkpoint
ON inspection_results(checkpoint_id);

-- Index for plan item results
CREATE INDEX IF NOT EXISTS idx_results_plan_item
ON inspection_results(plan_item_id);

-- ============================================================
-- 4. INSPECTION RESULT PHOTOS TABLE
-- Photos attached to inspection results
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_result_photos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  result_id UUID NOT NULL REFERENCES inspection_results(id) ON DELETE CASCADE,

  -- Photo storage
  storage_path TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,

  -- File info
  file_size BIGINT,
  mime_type TEXT,
  width INT,
  height INT,

  -- Photo metadata
  taken_at TIMESTAMPTZ,
  sort_order INT DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_result_photos
ON inspection_result_photos(result_id);

-- ============================================================
-- 5. UPDATE TRIGGERS
-- ============================================================

-- Update timestamp trigger for checkpoints
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

-- Update timestamp trigger for results
DROP TRIGGER IF EXISTS result_updated_at ON inspection_results;
CREATE TRIGGER result_updated_at
  BEFORE UPDATE ON inspection_results
  FOR EACH ROW EXECUTE FUNCTION update_checkpoint_timestamp();

-- ============================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE inspection_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_checkpoint_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_result_photos ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read checkpoints
CREATE POLICY "checkpoints_select" ON inspection_checkpoints
  FOR SELECT USING (true);

CREATE POLICY "checkpoint_attachments_select" ON inspection_checkpoint_attachments
  FOR SELECT USING (true);

-- Allow all authenticated users to insert/update results
CREATE POLICY "results_select" ON inspection_results
  FOR SELECT USING (true);

CREATE POLICY "results_insert" ON inspection_results
  FOR INSERT WITH CHECK (true);

CREATE POLICY "results_update" ON inspection_results
  FOR UPDATE USING (true);

-- Allow all for result photos
CREATE POLICY "result_photos_all" ON inspection_result_photos
  FOR ALL USING (true);

-- ============================================================
-- 7. INSERT DEFAULT CHECKPOINTS
-- Example checkpoints for "Visuaalne kontroll" category
-- ============================================================

DO $$
DECLARE
  v_category_id UUID;
BEGIN
  -- Find "Visuaalne kontroll" category for steel installation
  SELECT c.id INTO v_category_id
  FROM inspection_categories c
  JOIN inspection_types t ON c.type_id = t.id
  WHERE t.code = 'STEEL_INSTALLATION'
    AND c.code = 'CAT_STEEL_VISUAL'
  LIMIT 1;

  IF v_category_id IS NOT NULL THEN
    -- Insert checkpoints if they don't exist
    IF NOT EXISTS (SELECT 1 FROM inspection_checkpoints WHERE category_id = v_category_id AND code = 'VIS_IDENT') THEN
      INSERT INTO inspection_checkpoints (
        category_id, code, name, description, instructions, sort_order, is_required,
        response_options, display_type, photos_min, photos_required_responses
      ) VALUES (
        v_category_id,
        'VIS_IDENT',
        'Elemendi identifitseerimine',
        'Kontrolli elemendi märgistust ja vastavust projektile',
        E'## Mida kontrollida\n\n1. Kontrolli, et elemendi märgistus vastab projektile\n2. Veendu, et märgistus on loetav\n3. Pildista märgistus\n\n### Aktsepteerimiskriteeriumid\n- Märgistus peab olema loetav\n- Märgistus peab vastama joonisele',
        1,
        true,
        '[
          {"value": "ok", "label": "Korras", "color": "green", "requiresPhoto": false, "requiresComment": false},
          {"value": "not_ok", "label": "Ei ole korras", "color": "red", "requiresPhoto": true, "requiresComment": true, "photoMin": 1},
          {"value": "na", "label": "Ei kohaldu", "color": "gray", "requiresPhoto": false, "requiresComment": false}
        ]'::jsonb,
        'radio',
        0,
        ARRAY['not_ok']
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM inspection_checkpoints WHERE category_id = v_category_id AND code = 'VIS_DAMAGE') THEN
      INSERT INTO inspection_checkpoints (
        category_id, code, name, description, instructions, sort_order, is_required,
        response_options, display_type, photos_min, photos_required_responses
      ) VALUES (
        v_category_id,
        'VIS_DAMAGE',
        'Kahjustuste kontroll',
        'Kontrolli, et elemendil pole kahjustusi',
        E'## Mida kontrollida\n\n1. Kontrolli visuaalselt elemendi pinda\n2. Otsi mõlke, pragusid, roostet\n3. Kahjustuse leidmisel dokumenteeri fotoga\n\n### Puudused\n- Mõlgid\n- Praod\n- Rooste\n- Pinnakatte kahjustused',
        2,
        true,
        '[
          {"value": "ok", "label": "Kahjustusi pole", "color": "green", "requiresPhoto": false, "requiresComment": false},
          {"value": "minor", "label": "Väikesed kahjustused", "color": "yellow", "requiresPhoto": true, "requiresComment": true, "photoMin": 1},
          {"value": "major", "label": "Olulised kahjustused", "color": "red", "requiresPhoto": true, "requiresComment": true, "photoMin": 1}
        ]'::jsonb,
        'radio',
        0,
        ARRAY['minor', 'major']
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM inspection_checkpoints WHERE category_id = v_category_id AND code = 'VIS_COATING') THEN
      INSERT INTO inspection_checkpoints (
        category_id, code, name, description, instructions, sort_order, is_required,
        response_options, display_type, photos_min, photos_required_responses
      ) VALUES (
        v_category_id,
        'VIS_COATING',
        'Pinnakatte kontroll',
        'Kontrolli värvi või galvaniseeringu seisukorda',
        E'## Mida kontrollida\n\n1. Kontrolli pinnakatte ühtlust\n2. Kontrolli, et pole kriime ega kulumist\n3. Kontrolli keevituskohtade töötlust',
        3,
        false,
        '[
          {"value": "ok", "label": "Korras", "color": "green", "requiresPhoto": false, "requiresComment": false},
          {"value": "touch_up", "label": "Vajab parandust", "color": "yellow", "requiresPhoto": true, "requiresComment": true, "photoMin": 1},
          {"value": "not_ok", "label": "Ei vasta nõuetele", "color": "red", "requiresPhoto": true, "requiresComment": true, "photoMin": 1}
        ]'::jsonb,
        'radio',
        0,
        ARRAY['touch_up', 'not_ok']
      );
    END IF;
  END IF;
END $$;

-- Insert checkpoints for "Asendi kontroll" category
DO $$
DECLARE
  v_category_id UUID;
BEGIN
  SELECT c.id INTO v_category_id
  FROM inspection_categories c
  JOIN inspection_types t ON c.type_id = t.id
  WHERE t.code = 'STEEL_INSTALLATION'
    AND c.code = 'CAT_STEEL_POSITION'
  LIMIT 1;

  IF v_category_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM inspection_checkpoints WHERE category_id = v_category_id AND code = 'POS_LEVEL') THEN
      INSERT INTO inspection_checkpoints (
        category_id, code, name, description, instructions, sort_order, is_required,
        response_options, display_type, photos_min, photos_required_responses
      ) VALUES (
        v_category_id,
        'POS_LEVEL',
        'Kõrguse kontroll',
        'Kontrolli elemendi paigalduskõrgust',
        E'## Mida kontrollida\n\n1. Mõõda elemendi kõrgus (TOP/BOTTOM)\n2. Võrdle projekteeritud väärtusega\n3. Dokumenteeri mõõtmistulemus\n\n### Tolerantsid\n- Kõrgus: ±5mm',
        1,
        true,
        '[
          {"value": "ok", "label": "Tolerantsis", "color": "green", "requiresPhoto": false, "requiresComment": false},
          {"value": "deviation", "label": "Kõrvalekalle lubatud", "color": "yellow", "requiresPhoto": false, "requiresComment": true},
          {"value": "not_ok", "label": "Väljaspool tolerantsi", "color": "red", "requiresPhoto": true, "requiresComment": true, "photoMin": 1}
        ]'::jsonb,
        'radio',
        0,
        ARRAY['not_ok']
      );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM inspection_checkpoints WHERE category_id = v_category_id AND code = 'POS_ALIGN') THEN
      INSERT INTO inspection_checkpoints (
        category_id, code, name, description, instructions, sort_order, is_required,
        response_options, display_type, photos_min, photos_required_responses
      ) VALUES (
        v_category_id,
        'POS_ALIGN',
        'Joonduse kontroll',
        'Kontrolli elemendi joondust teiste elementidega',
        E'## Mida kontrollida\n\n1. Kontrolli tsentreeritust\n2. Kontrolli vertikaal-/horisontaaljoondust\n3. Mõõda kõrvalekalle\n\n### Tolerantsid\n- Horisontaalne: ±3mm\n- Vertikaalne: ±2mm',
        2,
        true,
        '[
          {"value": "ok", "label": "Korras", "color": "green", "requiresPhoto": false, "requiresComment": false},
          {"value": "not_ok", "label": "Vajab korrigeerimist", "color": "red", "requiresPhoto": true, "requiresComment": true, "photoMin": 1}
        ]'::jsonb,
        'radio',
        0,
        ARRAY['not_ok']
      );
    END IF;
  END IF;
END $$;

-- ============================================================
-- 8. VIEW FOR CHECKPOINT STATS
-- ============================================================

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
