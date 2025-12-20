-- ============================================================================
-- TARNE GRAAFIK - LIHTSUSTATUD MIGRATSIOON
-- Käivita Supabase SQL Editor'is
-- ============================================================================

-- 1. TEHASED
CREATE TABLE IF NOT EXISTS trimble_delivery_factories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  factory_name TEXT NOT NULL,
  factory_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT NOT NULL,
  CONSTRAINT unique_factory_per_project UNIQUE (project_id, factory_code)
);

CREATE INDEX IF NOT EXISTS idx_delivery_factories_project ON trimble_delivery_factories(project_id);

-- 2. VEOKID
CREATE TABLE IF NOT EXISTS trimble_delivery_vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  factory_id UUID REFERENCES trimble_delivery_factories(id) ON DELETE CASCADE,
  vehicle_number INTEGER NOT NULL,
  vehicle_code TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  unload_methods JSONB DEFAULT NULL,
  resources JSONB DEFAULT NULL,
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'loading', 'transit', 'arrived', 'unloading', 'completed', 'cancelled')),
  item_count INTEGER DEFAULT 0,
  total_weight DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT,
  CONSTRAINT unique_vehicle_code_per_project UNIQUE (project_id, vehicle_code)
);

CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_project ON trimble_delivery_vehicles(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_factory ON trimble_delivery_vehicles(factory_id);
CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_date ON trimble_delivery_vehicles(scheduled_date);

-- 3. DETAILID
CREATE TABLE IF NOT EXISTS trimble_delivery_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'loaded', 'in_transit', 'delivered', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT,
  CONSTRAINT unique_delivery_item_guid UNIQUE (project_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_delivery_items_project ON trimble_delivery_items(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_vehicle ON trimble_delivery_items(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_date ON trimble_delivery_items(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_delivery_items_guid ON trimble_delivery_items(guid);

-- 4. AJALUGU
CREATE TABLE IF NOT EXISTS trimble_delivery_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'date_changed', 'vehicle_changed', 'status_changed', 'removed', 'daily_snapshot')),
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
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_snapshot BOOLEAN DEFAULT false,
  snapshot_date DATE
);

CREATE INDEX IF NOT EXISTS idx_delivery_history_project ON trimble_delivery_history(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_history_item ON trimble_delivery_history(item_id);

-- 5. KOMMENTAARID
CREATE TABLE IF NOT EXISTS trimble_delivery_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  delivery_item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE CASCADE,
  delivery_date DATE,
  comment_text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT delivery_comment_target_check CHECK (
    (delivery_item_id IS NOT NULL AND vehicle_id IS NULL AND delivery_date IS NULL) OR
    (delivery_item_id IS NULL AND vehicle_id IS NOT NULL AND delivery_date IS NULL) OR
    (delivery_item_id IS NULL AND vehicle_id IS NULL AND delivery_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_delivery_comments_project ON trimble_delivery_comments(project_id);
