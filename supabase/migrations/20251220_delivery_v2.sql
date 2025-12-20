-- ============================================================================
-- TARNE GRAAFIK - LIHTNE VERSIOON (ainult tabelid)
-- Käivita see Supabase SQL Editor'is
-- ============================================================================

-- ============================================
-- 1. KUSTUTA VANAD (kui on)
-- ============================================

DROP TABLE IF EXISTS trimble_delivery_comments;
DROP TABLE IF EXISTS trimble_delivery_history;
DROP TABLE IF EXISTS trimble_delivery_items;
DROP TABLE IF EXISTS trimble_delivery_vehicles;
DROP TABLE IF EXISTS trimble_delivery_factories;

-- ============================================
-- 2. LOO TABELID
-- ============================================

-- TEHASED
CREATE TABLE trimble_delivery_factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  factory_name TEXT NOT NULL,
  factory_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  UNIQUE (trimble_project_id, factory_code)
);

-- VEOKID
CREATE TABLE trimble_delivery_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  factory_id UUID REFERENCES trimble_delivery_factories(id) ON DELETE CASCADE,
  vehicle_number INTEGER NOT NULL,
  vehicle_code TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  unload_methods JSONB,
  resources JSONB,
  status TEXT DEFAULT 'planned',
  item_count INTEGER DEFAULT 0,
  total_weight DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  UNIQUE (trimble_project_id, vehicle_code)
);

-- DETAILID
CREATE TABLE trimble_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE SET NULL,
  model_id TEXT,
  guid TEXT NOT NULL,
  guid_ifc TEXT,
  guid_ms TEXT,
  object_runtime_id INTEGER,
  trimble_product_id TEXT,
  assembly_mark TEXT NOT NULL,
  product_name TEXT,
  file_name TEXT,
  cast_unit_weight TEXT,
  cast_unit_position_code TEXT,
  scheduled_date DATE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'planned',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  UNIQUE (trimble_project_id, guid)
);

-- AJALUGU
CREATE TABLE trimble_delivery_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL,
  old_date DATE,
  old_vehicle_id UUID,
  old_vehicle_code TEXT,
  old_status TEXT,
  new_date DATE,
  new_vehicle_id UUID,
  new_vehicle_code TEXT,
  new_status TEXT,
  change_reason TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  is_snapshot BOOLEAN DEFAULT false,
  snapshot_date DATE
);

-- KOMMENTAARID
CREATE TABLE trimble_delivery_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  delivery_item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE CASCADE,
  delivery_date DATE,
  comment_text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. INDEKSID
-- ============================================

CREATE INDEX idx_df_project ON trimble_delivery_factories(trimble_project_id);
CREATE INDEX idx_dv_project ON trimble_delivery_vehicles(trimble_project_id);
CREATE INDEX idx_dv_factory ON trimble_delivery_vehicles(factory_id);
CREATE INDEX idx_dv_date ON trimble_delivery_vehicles(scheduled_date);
CREATE INDEX idx_di_project ON trimble_delivery_items(trimble_project_id);
CREATE INDEX idx_di_vehicle ON trimble_delivery_items(vehicle_id);
CREATE INDEX idx_di_date ON trimble_delivery_items(scheduled_date);
CREATE INDEX idx_di_guid ON trimble_delivery_items(guid);
CREATE INDEX idx_dh_project ON trimble_delivery_history(trimble_project_id);
CREATE INDEX idx_dh_item ON trimble_delivery_history(item_id);
CREATE INDEX idx_dc_project ON trimble_delivery_comments(trimble_project_id);

-- ============================================
-- 4. RLS
-- ============================================

ALTER TABLE trimble_delivery_factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON trimble_delivery_factories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON trimble_delivery_vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON trimble_delivery_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON trimble_delivery_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON trimble_delivery_comments FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- VALMIS! Kontrolli tulemust:
-- ============================================

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'trimble_delivery%';
