-- ============================================
-- CRANE PLANNING SYSTEM
-- Migration: 20260118_crane_planning_system.sql
-- Version: 4.0.0
-- Author: Silver Vatsel (Rivest OÜ)
-- ============================================

-- ============================================
-- 1. CRANE MODELS - Kraanide tüübid ja mudelid
-- ============================================

CREATE TABLE IF NOT EXISTS crane_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Põhiandmed
  manufacturer VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  crane_type VARCHAR(50) DEFAULT 'mobile' CHECK (crane_type IN ('mobile', 'tower', 'crawler')),

  -- Tehnilised andmed
  max_capacity_kg DECIMAL(10,2),
  max_height_m DECIMAL(10,2),
  max_radius_m DECIMAL(10,2),
  min_radius_m DECIMAL(10,2) DEFAULT 3,
  base_width_m DECIMAL(10,2) DEFAULT 3,
  base_length_m DECIMAL(10,2) DEFAULT 4,

  -- Visuaalsed seaded (default väärtused)
  cab_position VARCHAR(20) DEFAULT 'rear' CHECK (cab_position IN ('front', 'rear', 'left', 'right')),
  default_boom_length_m DECIMAL(10,2),
  default_crane_color JSONB DEFAULT '{"r":255,"g":165,"b":0,"a":255}',
  default_radius_color JSONB DEFAULT '{"r":255,"g":0,"b":0,"a":128}',

  -- Failid
  image_url TEXT,
  manual_pdf_url TEXT,
  load_chart_pdf_url TEXT,

  -- Metadata
  notes TEXT,
  is_active BOOLEAN DEFAULT true,

  -- Õigused (NULL = avalik kraana, kõik saavad kasutada)
  organization_id UUID,
  created_by_email TEXT,

  UNIQUE(manufacturer, model)
);

CREATE INDEX IF NOT EXISTS idx_crane_models_manufacturer ON crane_models(manufacturer);
CREATE INDEX IF NOT EXISTS idx_crane_models_type ON crane_models(crane_type);
CREATE INDEX IF NOT EXISTS idx_crane_models_active ON crane_models(is_active);

COMMENT ON TABLE crane_models IS 'Kraanide tüübid ja mudelid - üldine andmebaas';
COMMENT ON COLUMN crane_models.organization_id IS 'NULL = avalik kraana, UUID = ainult konkreetse organisatsiooni jaoks';

-- ============================================
-- 2. COUNTERWEIGHT CONFIGS - Vastukaalu konfiguratsioonid
-- ============================================

CREATE TABLE IF NOT EXISTS counterweight_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crane_model_id UUID NOT NULL REFERENCES crane_models(id) ON DELETE CASCADE,

  name VARCHAR(100) NOT NULL,
  weight_kg DECIMAL(10,2) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(crane_model_id, name)
);

CREATE INDEX IF NOT EXISTS idx_counterweights_crane ON counterweight_configs(crane_model_id);

COMMENT ON TABLE counterweight_configs IS 'Erinevad vastukaalu konfiguratsioonid iga kraana kohta';
COMMENT ON COLUMN counterweight_configs.name IS 'Vastukaalu konfiguratsiooni nimi, näiteks "Standard 20t"';

-- ============================================
-- 3. LOAD CHARTS - Tõstevõime graafikud
-- ============================================

CREATE TABLE IF NOT EXISTS load_charts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crane_model_id UUID NOT NULL REFERENCES crane_models(id) ON DELETE CASCADE,
  counterweight_config_id UUID NOT NULL REFERENCES counterweight_configs(id) ON DELETE CASCADE,

  -- Tingimused
  boom_length_m DECIMAL(10,2) NOT NULL,
  boom_angle_deg DECIMAL(10,2),

  -- Graafiku andmed (JSON array)
  -- Formaat: [{"radius_m": 3, "capacity_kg": 100000}, {"radius_m": 5, "capacity_kg": 80000}, ...]
  chart_data JSONB NOT NULL DEFAULT '[]',

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(crane_model_id, counterweight_config_id, boom_length_m)
);

CREATE INDEX IF NOT EXISTS idx_load_charts_crane ON load_charts(crane_model_id);
CREATE INDEX IF NOT EXISTS idx_load_charts_counterweight ON load_charts(counterweight_config_id);

COMMENT ON TABLE load_charts IS 'Tõstevõime graafikud iga kraana ja vastukaalu kombinatsiooni kohta';
COMMENT ON COLUMN load_charts.chart_data IS 'JSON array: [{"radius_m": number, "capacity_kg": number}, ...]';

-- ============================================
-- 4. PROJECT CRANES - Paigutatud kraanid (per projekt)
-- ============================================

CREATE TABLE IF NOT EXISTS project_cranes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Seosed
  trimble_project_id TEXT NOT NULL,
  crane_model_id UUID NOT NULL REFERENCES crane_models(id),
  counterweight_config_id UUID REFERENCES counterweight_configs(id),

  -- Positsioon (MEETRITES Trimble koordinaatides)
  position_x DECIMAL(15,6) NOT NULL,
  position_y DECIMAL(15,6) NOT NULL,
  position_z DECIMAL(15,6) NOT NULL,

  -- Orientatsioon
  rotation_deg DECIMAL(10,2) DEFAULT 0,

  -- Seadistused
  boom_length_m DECIMAL(10,2) NOT NULL,
  boom_angle_deg DECIMAL(10,2) DEFAULT 45,

  -- Koormus (kilogrammides)
  hook_weight_kg DECIMAL(10,2) DEFAULT 500,
  lifting_block_kg DECIMAL(10,2) DEFAULT 200,
  safety_factor DECIMAL(5,2) DEFAULT 1.25,

  -- Visuaalsed seaded
  crane_color JSONB DEFAULT '{"r":255,"g":165,"b":0,"a":255}',
  radius_color JSONB DEFAULT '{"r":255,"g":0,"b":0,"a":128}',
  show_radius_rings BOOLEAN DEFAULT true,
  radius_step_m DECIMAL(10,2) DEFAULT 2.5,
  show_capacity_labels BOOLEAN DEFAULT true,

  -- Märgistus
  position_label VARCHAR(50),
  notes TEXT,

  -- Trimble markup ID'd (JSON array - viited loodud markup'idele)
  markup_ids JSONB DEFAULT '[]',

  -- Audit
  created_by_email TEXT NOT NULL,
  updated_by_email TEXT,

  -- Unikaalne label projekti sees
  CONSTRAINT idx_project_cranes_unique_label UNIQUE(trimble_project_id, position_label)
);

CREATE INDEX IF NOT EXISTS idx_project_cranes_project ON project_cranes(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_project_cranes_crane_model ON project_cranes(crane_model_id);
CREATE INDEX IF NOT EXISTS idx_project_cranes_label ON project_cranes(position_label);

COMMENT ON TABLE project_cranes IS 'Konkreetsesse projekti paigutatud kraanid';
COMMENT ON COLUMN project_cranes.position_x IS 'X koordinaat MEETRITES (API nõuab hiljem mm)';
COMMENT ON COLUMN project_cranes.markup_ids IS 'JSON array Trimble markup ID-dest: [1234, 1235, 1236]';

-- Trigger updated_at automaatseks uuendamiseks
CREATE OR REPLACE FUNCTION update_project_cranes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_cranes_updated_at ON project_cranes;
CREATE TRIGGER project_cranes_updated_at
  BEFORE UPDATE ON project_cranes
  FOR EACH ROW
  EXECUTE FUNCTION update_project_cranes_timestamp();

-- ============================================
-- 5. CRANE RADIUS RINGS - Raadiuste cache
-- ============================================

CREATE TABLE IF NOT EXISTS crane_radius_rings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_crane_id UUID NOT NULL REFERENCES project_cranes(id) ON DELETE CASCADE,

  radius_m DECIMAL(10,2) NOT NULL,
  max_capacity_kg DECIMAL(10,2),

  -- Trimble markup ID (kui on joonistatud)
  markup_id INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(project_crane_id, radius_m)
);

CREATE INDEX IF NOT EXISTS idx_radius_rings_crane ON crane_radius_rings(project_crane_id);

COMMENT ON TABLE crane_radius_rings IS 'Cache tabel kraana raadiuste ja tõstevõimete kohta (kiire rendering)';

-- ============================================
-- 6. CRANE DOCUMENTS - Kraanide dokumentatsioon
-- ============================================

CREATE TABLE IF NOT EXISTS crane_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crane_model_id UUID NOT NULL REFERENCES crane_models(id) ON DELETE CASCADE,

  -- Faili andmed
  document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('manual', 'load_chart', 'certificate', 'specification')),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size_bytes BIGINT,
  mime_type VARCHAR(100),

  -- Metadata
  title TEXT NOT NULL,
  description TEXT,
  version VARCHAR(50),
  language VARCHAR(10) DEFAULT 'et',

  -- Timestamps
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by_email TEXT NOT NULL,

  -- Sort order
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_crane_documents_crane ON crane_documents(crane_model_id);
CREATE INDEX IF NOT EXISTS idx_crane_documents_type ON crane_documents(document_type);

COMMENT ON TABLE crane_documents IS 'Kraanide dokumentatsioon (kasutusjuhendid, sertifikaadid, tõstegraafikud)';
COMMENT ON COLUMN crane_documents.document_type IS 'manual=kasutusjuhend, load_chart=tõstegraafikud, certificate=sertifikaat, specification=tehnilised andmed';

-- ============================================
-- 7. STORAGE BUCKETS - Kraanide failid
-- ============================================

-- Kraanide pildid
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crane-images',
  'crane-images',
  true,
  5242880,  -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Kraanide dokumentatsioon
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crane-documents',
  'crane-documents',
  true,
  52428800,  -- 50MB limit
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword', 'application/vnd.ms-excel',
        'image/png', 'image/jpeg', 'application/zip']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 8. STORAGE POLICIES
-- ============================================

-- Crane images policies
DROP POLICY IF EXISTS "Crane images are publicly accessible" ON storage.objects;
CREATE POLICY "Crane images are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'crane-images' );

DROP POLICY IF EXISTS "Anyone can upload crane images" ON storage.objects;
CREATE POLICY "Anyone can upload crane images"
ON storage.objects FOR INSERT
TO public
WITH CHECK ( bucket_id = 'crane-images' );

DROP POLICY IF EXISTS "Users can update crane images" ON storage.objects;
CREATE POLICY "Users can update crane images"
ON storage.objects FOR UPDATE
TO public
USING ( bucket_id = 'crane-images' );

DROP POLICY IF EXISTS "Users can delete crane images" ON storage.objects;
CREATE POLICY "Users can delete crane images"
ON storage.objects FOR DELETE
TO public
USING ( bucket_id = 'crane-images' );

-- Crane documents policies
DROP POLICY IF EXISTS "Crane documents are publicly accessible" ON storage.objects;
CREATE POLICY "Crane documents are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING ( bucket_id = 'crane-documents' );

DROP POLICY IF EXISTS "Anyone can upload crane documents" ON storage.objects;
CREATE POLICY "Anyone can upload crane documents"
ON storage.objects FOR INSERT
TO public
WITH CHECK ( bucket_id = 'crane-documents' );

DROP POLICY IF EXISTS "Users can update crane documents" ON storage.objects;
CREATE POLICY "Users can update crane documents"
ON storage.objects FOR UPDATE
TO public
USING ( bucket_id = 'crane-documents' );

DROP POLICY IF EXISTS "Users can delete crane documents" ON storage.objects;
CREATE POLICY "Users can delete crane documents"
ON storage.objects FOR DELETE
TO public
USING ( bucket_id = 'crane-documents' );

-- ============================================
-- 9. RLS (Row Level Security) POLICIES
-- ============================================

-- Crane models - avalikud kraanid
ALTER TABLE crane_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public cranes viewable by all" ON crane_models;
CREATE POLICY "Public cranes viewable by all"
  ON crane_models FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert cranes" ON crane_models;
CREATE POLICY "Users can insert cranes"
  ON crane_models FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update cranes" ON crane_models;
CREATE POLICY "Users can update cranes"
  ON crane_models FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Users can delete cranes" ON crane_models;
CREATE POLICY "Users can delete cranes"
  ON crane_models FOR DELETE
  USING (true);

-- Counterweight configs
ALTER TABLE counterweight_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view counterweights" ON counterweight_configs;
CREATE POLICY "Anyone can view counterweights"
  ON counterweight_configs FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can insert counterweights" ON counterweight_configs;
CREATE POLICY "Anyone can insert counterweights"
  ON counterweight_configs FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update counterweights" ON counterweight_configs;
CREATE POLICY "Anyone can update counterweights"
  ON counterweight_configs FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Anyone can delete counterweights" ON counterweight_configs;
CREATE POLICY "Anyone can delete counterweights"
  ON counterweight_configs FOR DELETE
  USING (true);

-- Load charts
ALTER TABLE load_charts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view load_charts" ON load_charts;
CREATE POLICY "Anyone can view load_charts"
  ON load_charts FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can insert load_charts" ON load_charts;
CREATE POLICY "Anyone can insert load_charts"
  ON load_charts FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update load_charts" ON load_charts;
CREATE POLICY "Anyone can update load_charts"
  ON load_charts FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Anyone can delete load_charts" ON load_charts;
CREATE POLICY "Anyone can delete load_charts"
  ON load_charts FOR DELETE
  USING (true);

-- Project cranes
ALTER TABLE project_cranes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view project cranes" ON project_cranes;
CREATE POLICY "Users can view project cranes"
  ON project_cranes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert project cranes" ON project_cranes;
CREATE POLICY "Users can insert project cranes"
  ON project_cranes FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update project cranes" ON project_cranes;
CREATE POLICY "Users can update project cranes"
  ON project_cranes FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Users can delete project cranes" ON project_cranes;
CREATE POLICY "Users can delete project cranes"
  ON project_cranes FOR DELETE
  USING (true);

-- Crane radius rings
ALTER TABLE crane_radius_rings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view radius rings" ON crane_radius_rings;
CREATE POLICY "Anyone can view radius rings"
  ON crane_radius_rings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can insert radius rings" ON crane_radius_rings;
CREATE POLICY "Anyone can insert radius rings"
  ON crane_radius_rings FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update radius rings" ON crane_radius_rings;
CREATE POLICY "Anyone can update radius rings"
  ON crane_radius_rings FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Anyone can delete radius rings" ON crane_radius_rings;
CREATE POLICY "Anyone can delete radius rings"
  ON crane_radius_rings FOR DELETE
  USING (true);

-- Crane documents
ALTER TABLE crane_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view crane documents" ON crane_documents;
CREATE POLICY "Anyone can view crane documents"
  ON crane_documents FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can insert crane documents" ON crane_documents;
CREATE POLICY "Anyone can insert crane documents"
  ON crane_documents FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update crane documents" ON crane_documents;
CREATE POLICY "Anyone can update crane documents"
  ON crane_documents FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Anyone can delete crane documents" ON crane_documents;
CREATE POLICY "Anyone can delete crane documents"
  ON crane_documents FOR DELETE
  USING (true);

-- ============================================
-- 10. HELPER FUNCTIONS
-- ============================================

-- Function to calculate max capacity at a given radius (with interpolation)
CREATE OR REPLACE FUNCTION calculate_crane_capacity(
  p_crane_id UUID,
  p_counterweight_id UUID,
  p_boom_length_m DECIMAL,
  p_radius_m DECIMAL
) RETURNS DECIMAL AS $$
DECLARE
  v_chart_data JSONB;
  v_capacity DECIMAL;
  v_prev_radius DECIMAL;
  v_prev_capacity DECIMAL;
  v_next_radius DECIMAL;
  v_next_capacity DECIMAL;
  v_point JSONB;
BEGIN
  -- Get the chart data for this configuration
  SELECT chart_data INTO v_chart_data
  FROM load_charts
  WHERE crane_model_id = p_crane_id
    AND counterweight_config_id = p_counterweight_id
    AND boom_length_m = p_boom_length_m
  LIMIT 1;

  IF v_chart_data IS NULL THEN
    RETURN NULL;
  END IF;

  -- Find exact match or interpolate
  FOR v_point IN SELECT * FROM jsonb_array_elements(v_chart_data)
  LOOP
    IF (v_point->>'radius_m')::DECIMAL = p_radius_m THEN
      RETURN (v_point->>'capacity_kg')::DECIMAL;
    END IF;

    IF (v_point->>'radius_m')::DECIMAL < p_radius_m THEN
      v_prev_radius := (v_point->>'radius_m')::DECIMAL;
      v_prev_capacity := (v_point->>'capacity_kg')::DECIMAL;
    END IF;

    IF (v_point->>'radius_m')::DECIMAL > p_radius_m AND v_next_radius IS NULL THEN
      v_next_radius := (v_point->>'radius_m')::DECIMAL;
      v_next_capacity := (v_point->>'capacity_kg')::DECIMAL;
    END IF;
  END LOOP;

  -- Linear interpolation
  IF v_prev_radius IS NOT NULL AND v_next_radius IS NOT NULL THEN
    v_capacity := v_prev_capacity +
      (v_next_capacity - v_prev_capacity) *
      (p_radius_m - v_prev_radius) /
      (v_next_radius - v_prev_radius);
    RETURN v_capacity;
  ELSIF v_prev_radius IS NOT NULL THEN
    RETURN v_prev_capacity;
  ELSIF v_next_radius IS NOT NULL THEN
    RETURN v_next_capacity;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_crane_capacity IS 'Calculate lifting capacity at a given radius using linear interpolation';

-- ============================================
-- 11. TEST DATA (Optional - comment out for production)
-- ============================================

-- Insert a test crane: Liebherr LTM 1100-5.2
INSERT INTO crane_models (
  manufacturer,
  model,
  crane_type,
  max_capacity_kg,
  max_height_m,
  max_radius_m,
  min_radius_m,
  base_width_m,
  base_length_m,
  default_boom_length_m,
  cab_position,
  notes,
  created_by_email
) VALUES (
  'Liebherr',
  'LTM 1100-5.2',
  'mobile',
  100000,
  84,
  72,
  3,
  3.2,
  4.5,
  40,
  'rear',
  'Liebherr 100 tonni mobiilkraana. 5-telgne, max 100t @ 3m raadiusel.',
  'silver.vatsel@rivest.ee'
) ON CONFLICT (manufacturer, model) DO NOTHING;

-- Get the crane ID for test data
DO $$
DECLARE
  v_crane_id UUID;
  v_cw_standard_id UUID;
  v_cw_heavy_id UUID;
  v_cw_superheavy_id UUID;
BEGIN
  SELECT id INTO v_crane_id FROM crane_models WHERE manufacturer = 'Liebherr' AND model = 'LTM 1100-5.2';

  IF v_crane_id IS NOT NULL THEN
    -- Insert counterweight configurations
    INSERT INTO counterweight_configs (crane_model_id, name, weight_kg, description, sort_order)
    VALUES
      (v_crane_id, 'Standard 20t', 20000, 'Standardne 20 tonni vastukaal', 1),
      (v_crane_id, 'Heavy 40t', 40000, 'Raske 40 tonni vastukaal', 2),
      (v_crane_id, 'Super-Heavy 96t', 96000, 'Superraske 96 tonni vastukaal', 3)
    ON CONFLICT (crane_model_id, name) DO NOTHING;

    -- Get counterweight IDs
    SELECT id INTO v_cw_standard_id FROM counterweight_configs WHERE crane_model_id = v_crane_id AND name = 'Standard 20t';
    SELECT id INTO v_cw_heavy_id FROM counterweight_configs WHERE crane_model_id = v_crane_id AND name = 'Heavy 40t';
    SELECT id INTO v_cw_superheavy_id FROM counterweight_configs WHERE crane_model_id = v_crane_id AND name = 'Super-Heavy 96t';

    -- Insert load chart for Standard 20t, 40m boom
    IF v_cw_standard_id IS NOT NULL THEN
      INSERT INTO load_charts (crane_model_id, counterweight_config_id, boom_length_m, chart_data, notes)
      VALUES (
        v_crane_id,
        v_cw_standard_id,
        40,
        '[
          {"radius_m": 3, "capacity_kg": 60000},
          {"radius_m": 5, "capacity_kg": 45000},
          {"radius_m": 7, "capacity_kg": 35000},
          {"radius_m": 10, "capacity_kg": 25000},
          {"radius_m": 12, "capacity_kg": 20000},
          {"radius_m": 15, "capacity_kg": 15000},
          {"radius_m": 20, "capacity_kg": 10000},
          {"radius_m": 25, "capacity_kg": 7500},
          {"radius_m": 30, "capacity_kg": 5500},
          {"radius_m": 35, "capacity_kg": 4000},
          {"radius_m": 40, "capacity_kg": 3000}
        ]'::jsonb,
        '40m boom with 20t counterweight - standard configuration'
      )
      ON CONFLICT (crane_model_id, counterweight_config_id, boom_length_m) DO NOTHING;
    END IF;

    -- Insert load chart for Heavy 40t, 50m boom
    IF v_cw_heavy_id IS NOT NULL THEN
      INSERT INTO load_charts (crane_model_id, counterweight_config_id, boom_length_m, chart_data, notes)
      VALUES (
        v_crane_id,
        v_cw_heavy_id,
        50,
        '[
          {"radius_m": 3, "capacity_kg": 80000},
          {"radius_m": 5, "capacity_kg": 60000},
          {"radius_m": 7, "capacity_kg": 48000},
          {"radius_m": 10, "capacity_kg": 35000},
          {"radius_m": 12, "capacity_kg": 28000},
          {"radius_m": 15, "capacity_kg": 22000},
          {"radius_m": 20, "capacity_kg": 15000},
          {"radius_m": 25, "capacity_kg": 11000},
          {"radius_m": 30, "capacity_kg": 8500},
          {"radius_m": 35, "capacity_kg": 6500},
          {"radius_m": 40, "capacity_kg": 5000},
          {"radius_m": 45, "capacity_kg": 4000},
          {"radius_m": 50, "capacity_kg": 3200}
        ]'::jsonb,
        '50m boom with 40t counterweight - heavy duty'
      )
      ON CONFLICT (crane_model_id, counterweight_config_id, boom_length_m) DO NOTHING;
    END IF;

    -- Insert load chart for Super-Heavy 96t, 60m boom
    IF v_cw_superheavy_id IS NOT NULL THEN
      INSERT INTO load_charts (crane_model_id, counterweight_config_id, boom_length_m, chart_data, notes)
      VALUES (
        v_crane_id,
        v_cw_superheavy_id,
        60,
        '[
          {"radius_m": 3, "capacity_kg": 100000},
          {"radius_m": 5, "capacity_kg": 80000},
          {"radius_m": 7, "capacity_kg": 65000},
          {"radius_m": 10, "capacity_kg": 50000},
          {"radius_m": 12, "capacity_kg": 42000},
          {"radius_m": 15, "capacity_kg": 35000},
          {"radius_m": 20, "capacity_kg": 25000},
          {"radius_m": 25, "capacity_kg": 19000},
          {"radius_m": 30, "capacity_kg": 15000},
          {"radius_m": 35, "capacity_kg": 12000},
          {"radius_m": 40, "capacity_kg": 9500},
          {"radius_m": 45, "capacity_kg": 7500},
          {"radius_m": 50, "capacity_kg": 6000},
          {"radius_m": 55, "capacity_kg": 4800},
          {"radius_m": 60, "capacity_kg": 3800}
        ]'::jsonb,
        '60m boom with 96t counterweight - maximum capacity configuration'
      )
      ON CONFLICT (crane_model_id, counterweight_config_id, boom_length_m) DO NOTHING;
    END IF;

    RAISE NOTICE 'Test data inserted for Liebherr LTM 1100-5.2';
  END IF;
END $$;

-- Insert second test crane: Terex AC 55-1
INSERT INTO crane_models (
  manufacturer,
  model,
  crane_type,
  max_capacity_kg,
  max_height_m,
  max_radius_m,
  min_radius_m,
  base_width_m,
  base_length_m,
  default_boom_length_m,
  cab_position,
  notes,
  created_by_email
) VALUES (
  'Terex',
  'AC 55-1',
  'mobile',
  55000,
  58,
  48,
  3,
  2.8,
  4.0,
  35,
  'rear',
  'Terex 55 tonni mobiilkraana. Kompaktne 3-telgne kraana.',
  'silver.vatsel@rivest.ee'
) ON CONFLICT (manufacturer, model) DO NOTHING;
