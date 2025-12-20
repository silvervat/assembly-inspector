-- ============================================================================
-- TARNE GRAAFIK - KÕIGE LIHTSAM VERSIOON
-- Käivita see Supabase SQL Editor'is
-- ============================================================================

-- 1. TEHASED
CREATE TABLE IF NOT EXISTS trimble_delivery_factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  factory_name TEXT NOT NULL,
  factory_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL
);

-- 2. VEOKID
CREATE TABLE IF NOT EXISTS trimble_delivery_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  factory_id UUID,
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
  updated_by TEXT
);

-- 3. DETAILID
CREATE TABLE IF NOT EXISTS trimble_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  vehicle_id UUID,
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
  updated_by TEXT
);

-- 4. AJALUGU
CREATE TABLE IF NOT EXISTS trimble_delivery_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  item_id UUID,
  vehicle_id UUID,
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
CREATE TABLE IF NOT EXISTS trimble_delivery_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  delivery_item_id UUID,
  vehicle_id UUID,
  delivery_date DATE,
  comment_text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
