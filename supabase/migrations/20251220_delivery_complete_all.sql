-- ============================================================================
-- TARNE GRAAFIK - TÄIELIK MIGRATSIOON
-- Käivita see Supabase SQL Editor'is
-- Sisaldab: tabelid + kellaaeg + kestus + veoki tüübid + item unload methods
-- ============================================================================

-- ============================================
-- 1. TEHASED
-- ============================================
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

-- ============================================
-- 2. VEOKID
-- ============================================
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
  -- Kellaaeg ja kestus
  unload_start_time TIME DEFAULT NULL,
  unload_duration_minutes INTEGER DEFAULT NULL,
  sort_order INTEGER DEFAULT 0,
  -- Veoki tüüp
  vehicle_type TEXT DEFAULT 'haagis',
  -- Metaandmed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- ============================================
-- 3. DETAILID
-- ============================================
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
  -- Detaili mahalaadimise meetodid
  unload_methods JSONB DEFAULT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- ============================================
-- 4. AJALUGU
-- ============================================
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

-- ============================================
-- 5. KOMMENTAARID
-- ============================================
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

-- ============================================
-- 6. INDEXID
-- ============================================
CREATE INDEX IF NOT EXISTS idx_delivery_factories_project
  ON trimble_delivery_factories(trimble_project_id);

CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_project
  ON trimble_delivery_vehicles(trimble_project_id);

CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_date
  ON trimble_delivery_vehicles(scheduled_date);

CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_factory
  ON trimble_delivery_vehicles(factory_id);

CREATE INDEX IF NOT EXISTS idx_delivery_items_project
  ON trimble_delivery_items(trimble_project_id);

CREATE INDEX IF NOT EXISTS idx_delivery_items_vehicle
  ON trimble_delivery_items(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_delivery_items_date
  ON trimble_delivery_items(scheduled_date);

CREATE INDEX IF NOT EXISTS idx_delivery_items_guid
  ON trimble_delivery_items(guid);

CREATE INDEX IF NOT EXISTS idx_delivery_history_project
  ON trimble_delivery_history(trimble_project_id);

CREATE INDEX IF NOT EXISTS idx_delivery_comments_project
  ON trimble_delivery_comments(trimble_project_id);

CREATE INDEX IF NOT EXISTS idx_delivery_comments_item
  ON trimble_delivery_comments(delivery_item_id);

CREATE INDEX IF NOT EXISTS idx_delivery_comments_vehicle
  ON trimble_delivery_comments(vehicle_id);

-- ============================================
-- 7. UNIKAALSUSE CONSTRAINT (Duplikaatide tuvastamiseks)
-- ============================================
-- See takistab sama detaili lisamist mitu korda
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_delivery_item_guid'
  ) THEN
    ALTER TABLE trimble_delivery_items
    ADD CONSTRAINT unique_delivery_item_guid
    UNIQUE (trimble_project_id, guid);
  END IF;
END $$;

-- ============================================
-- 8. RLS POLIITIKAD (Row Level Security)
-- ============================================
-- Lülita RLS sisse
ALTER TABLE trimble_delivery_factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_comments ENABLE ROW LEVEL SECURITY;

-- Loo poliitikad (kui pole juba olemas)
DO $$
BEGIN
  -- Factories
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all' AND tablename = 'trimble_delivery_factories') THEN
    CREATE POLICY allow_all ON trimble_delivery_factories FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- Vehicles
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all' AND tablename = 'trimble_delivery_vehicles') THEN
    CREATE POLICY allow_all ON trimble_delivery_vehicles FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- Items
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all' AND tablename = 'trimble_delivery_items') THEN
    CREATE POLICY allow_all ON trimble_delivery_items FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- History
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all' AND tablename = 'trimble_delivery_history') THEN
    CREATE POLICY allow_all ON trimble_delivery_history FOR ALL USING (true) WITH CHECK (true);
  END IF;

  -- Comments
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all' AND tablename = 'trimble_delivery_comments') THEN
    CREATE POLICY allow_all ON trimble_delivery_comments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================
-- VALMIS!
-- ============================================
-- Kontrolli tulemust:
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'trimble_delivery%'
ORDER BY table_name;
