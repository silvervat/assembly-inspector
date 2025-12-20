-- ============================================================================
-- TARNE GRAAFIK - PUHASTUS JA UUESTI LOOMINE
-- Käivita Supabase SQL Editor'is
-- ============================================================================

-- KÕIGEPEALT KUSTUTA VANAD OBJEKTID (kui on olemas)
DROP VIEW IF EXISTS v_delivery_history_full CASCADE;
DROP VIEW IF EXISTS v_delivery_factory_summary CASCADE;
DROP VIEW IF EXISTS v_delivery_daily_summary CASCADE;
DROP VIEW IF EXISTS v_delivery_items_full CASCADE;

DROP TRIGGER IF EXISTS trigger_log_delivery_changes ON trimble_delivery_items;
DROP TRIGGER IF EXISTS trigger_update_delivery_vehicle_stats ON trimble_delivery_items;
DROP TRIGGER IF EXISTS trigger_generate_vehicle_code ON trimble_delivery_vehicles;

DROP FUNCTION IF EXISTS log_delivery_item_changes() CASCADE;
DROP FUNCTION IF EXISTS update_delivery_vehicle_statistics() CASCADE;
DROP FUNCTION IF EXISTS generate_vehicle_code() CASCADE;
DROP FUNCTION IF EXISTS create_daily_delivery_snapshot() CASCADE;

DROP TABLE IF EXISTS trimble_delivery_comments CASCADE;
DROP TABLE IF EXISTS trimble_delivery_history CASCADE;
DROP TABLE IF EXISTS trimble_delivery_items CASCADE;
DROP TABLE IF EXISTS trimble_delivery_vehicles CASCADE;
DROP TABLE IF EXISTS trimble_delivery_factories CASCADE;

-- ============================================================================
-- NÜÜD LOO TABELID
-- ============================================================================

-- 1. TEHASED
CREATE TABLE trimble_delivery_factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  factory_name TEXT NOT NULL,
  factory_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  CONSTRAINT unique_factory_per_project UNIQUE (project_id, factory_code)
);

-- 2. VEOKID
CREATE TABLE trimble_delivery_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  factory_id UUID REFERENCES trimble_delivery_factories(id) ON DELETE CASCADE,
  vehicle_number INTEGER NOT NULL,
  vehicle_code TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  unload_methods JSONB DEFAULT NULL,
  resources JSONB DEFAULT NULL,
  status TEXT DEFAULT 'planned',
  item_count INTEGER DEFAULT 0,
  total_weight DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  CONSTRAINT unique_vehicle_code_per_project UNIQUE (project_id, vehicle_code)
);

-- 3. DETAILID
CREATE TABLE trimble_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
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
  CONSTRAINT unique_delivery_item_guid UNIQUE (project_id, guid)
);

-- 4. AJALUGU
CREATE TABLE trimble_delivery_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
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

-- 5. KOMMENTAARID
CREATE TABLE trimble_delivery_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  delivery_item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE CASCADE,
  delivery_date DATE,
  comment_text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEKSID
-- ============================================================================

CREATE INDEX idx_del_factories_project ON trimble_delivery_factories(project_id);
CREATE INDEX idx_del_vehicles_project ON trimble_delivery_vehicles(project_id);
CREATE INDEX idx_del_vehicles_date ON trimble_delivery_vehicles(scheduled_date);
CREATE INDEX idx_del_items_project ON trimble_delivery_items(project_id);
CREATE INDEX idx_del_items_vehicle ON trimble_delivery_items(vehicle_id);
CREATE INDEX idx_del_items_date ON trimble_delivery_items(scheduled_date);
CREATE INDEX idx_del_history_item ON trimble_delivery_history(item_id);
CREATE INDEX idx_del_comments_project ON trimble_delivery_comments(project_id);
