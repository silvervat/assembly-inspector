-- ============================================================================
-- TARNE GRAAFIK (Delivery Schedule) - TERVIKLIK MIGRATSIOON
-- Assembly Inspector v3.0.0
--
-- Käivita see fail Supabase SQL Editor'is
-- See fail teeb KÕIK vajaliku - tabelid, indeksid, triggerid, vaated, RLS
-- ============================================================================

-- ============================================
-- 1. PUHASTUS - Kustutame kõik vanad objektid
-- ============================================

-- Keela RLS ajutiselt
ALTER TABLE IF EXISTS trimble_delivery_factories DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS trimble_delivery_vehicles DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS trimble_delivery_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS trimble_delivery_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS trimble_delivery_comments DISABLE ROW LEVEL SECURITY;

-- Kustuta kõik poliitikad
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname, tablename
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename LIKE 'trimble_delivery%'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- Kustuta vaated
DROP VIEW IF EXISTS v_delivery_history_full CASCADE;
DROP VIEW IF EXISTS v_delivery_factory_summary CASCADE;
DROP VIEW IF EXISTS v_delivery_daily_summary CASCADE;
DROP VIEW IF EXISTS v_delivery_items_full CASCADE;

-- Kustuta triggerid
DROP TRIGGER IF EXISTS trigger_log_delivery_changes ON trimble_delivery_items;
DROP TRIGGER IF EXISTS trigger_update_vehicle_stats ON trimble_delivery_items;
DROP TRIGGER IF EXISTS trigger_generate_vehicle_code ON trimble_delivery_vehicles;

-- Kustuta funktsioonid
DROP FUNCTION IF EXISTS log_delivery_item_changes() CASCADE;
DROP FUNCTION IF EXISTS update_vehicle_statistics() CASCADE;
DROP FUNCTION IF EXISTS generate_vehicle_code() CASCADE;
DROP FUNCTION IF EXISTS create_daily_snapshot() CASCADE;

-- Kustuta tabelid (õiges järjekorras foreign key tõttu)
DROP TABLE IF EXISTS trimble_delivery_comments CASCADE;
DROP TABLE IF EXISTS trimble_delivery_history CASCADE;
DROP TABLE IF EXISTS trimble_delivery_items CASCADE;
DROP TABLE IF EXISTS trimble_delivery_vehicles CASCADE;
DROP TABLE IF EXISTS trimble_delivery_factories CASCADE;

-- ============================================
-- 2. TABELID
-- ============================================

-- 2.1 TEHASED (Factories)
-- Tehased nagu Obornik (OPO), Solid (SOL) jne
CREATE TABLE trimble_delivery_factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  factory_name TEXT NOT NULL,
  factory_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  CONSTRAINT unique_factory_per_project UNIQUE (trimble_project_id, factory_code)
);

COMMENT ON TABLE trimble_delivery_factories IS 'Tehased - tootmisüksused kust veokid tulevad';
COMMENT ON COLUMN trimble_delivery_factories.factory_code IS 'Lühend veokite jaoks, nt OPO, SOL';

-- 2.2 VEOKID (Vehicles)
-- Veokid mis tulevad tehastest, nt OPO1, OPO2, SOL1
CREATE TABLE trimble_delivery_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  factory_id UUID NOT NULL REFERENCES trimble_delivery_factories(id) ON DELETE CASCADE,
  vehicle_number INTEGER NOT NULL,
  vehicle_code TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  -- Mahalaadimise meetodid (JSONB)
  unload_methods JSONB DEFAULT NULL,
  -- Ressursid/töötajad (JSONB)
  resources JSONB DEFAULT NULL,
  -- Staatus
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'loading', 'transit', 'arrived', 'unloading', 'completed', 'cancelled')),
  -- Arvutatud statistika (uuendatakse triggeriga)
  item_count INTEGER DEFAULT 0,
  total_weight DECIMAL(12,2) DEFAULT 0,
  -- Märkmed
  notes TEXT,
  -- Audit väljad
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  CONSTRAINT unique_vehicle_code_per_project UNIQUE (trimble_project_id, vehicle_code)
);

COMMENT ON TABLE trimble_delivery_vehicles IS 'Veokid - iga veok kuulub tehasele ja on planeeritud kindlale kuupäevale';
COMMENT ON COLUMN trimble_delivery_vehicles.unload_methods IS 'JSON: {crane: 1, telescopic: 0, manual: 0}';
COMMENT ON COLUMN trimble_delivery_vehicles.resources IS 'JSON: {taasnik: 2, keevitaja: 1}';

-- 2.3 DETAILID (Items)
-- Detailid mis on veokitele määratud
CREATE TABLE trimble_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE SET NULL,
  -- Trimble Connect identifikaatorid
  model_id TEXT,
  guid TEXT NOT NULL,
  guid_ifc TEXT,
  guid_ms TEXT,
  object_runtime_id INTEGER,
  trimble_product_id TEXT,
  -- Detaili andmed
  assembly_mark TEXT NOT NULL,
  product_name TEXT,
  file_name TEXT,
  cast_unit_weight TEXT,
  cast_unit_position_code TEXT,
  -- Tarne info
  scheduled_date DATE NOT NULL,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'loaded', 'in_transit', 'delivered', 'cancelled')),
  notes TEXT,
  -- Audit väljad
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  -- Üks GUID ainult üks kord projektis
  CONSTRAINT unique_delivery_item_guid UNIQUE (trimble_project_id, guid)
);

COMMENT ON TABLE trimble_delivery_items IS 'Tarne detailid - elemendid mis on veokitele määratud';

-- 2.4 AJALUGU (History)
-- Kõik muudatused logitakse siia
CREATE TABLE trimble_delivery_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE SET NULL,
  -- Muudatuse tüüp
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'date_changed', 'vehicle_changed', 'status_changed', 'removed', 'daily_snapshot')),
  -- Vana väärtus
  old_date DATE,
  old_vehicle_id UUID,
  old_vehicle_code TEXT,
  old_status TEXT,
  -- Uus väärtus
  new_date DATE,
  new_vehicle_id UUID,
  new_vehicle_code TEXT,
  new_status TEXT,
  -- Meta
  change_reason TEXT,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  -- Päevalõpu snapshot
  is_snapshot BOOLEAN DEFAULT false,
  snapshot_date DATE
);

COMMENT ON TABLE trimble_delivery_history IS 'Muudatuste ajalugu - logib kõik muudatused detailide ja veokite kohta';

-- 2.5 KOMMENTAARID (Comments)
-- Kommentaarid detailidele, veokitele või kuupäevadele
CREATE TABLE trimble_delivery_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  -- Võib olla seotud detaili, veoki või kuupäevaga
  delivery_item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE CASCADE,
  delivery_date DATE,
  -- Kommentaari sisu
  comment_text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trimble_delivery_comments IS 'Kommentaarid - saab lisada detailidele, veokitele või kuupäevadele';

-- ============================================
-- 3. INDEKSID
-- ============================================

-- Tehased
CREATE INDEX idx_del_factories_project ON trimble_delivery_factories(trimble_project_id);

-- Veokid
CREATE INDEX idx_del_vehicles_project ON trimble_delivery_vehicles(trimble_project_id);
CREATE INDEX idx_del_vehicles_factory ON trimble_delivery_vehicles(factory_id);
CREATE INDEX idx_del_vehicles_date ON trimble_delivery_vehicles(scheduled_date);
CREATE INDEX idx_del_vehicles_status ON trimble_delivery_vehicles(status);

-- Detailid
CREATE INDEX idx_del_items_project ON trimble_delivery_items(trimble_project_id);
CREATE INDEX idx_del_items_vehicle ON trimble_delivery_items(vehicle_id);
CREATE INDEX idx_del_items_date ON trimble_delivery_items(scheduled_date);
CREATE INDEX idx_del_items_guid ON trimble_delivery_items(guid);
CREATE INDEX idx_del_items_status ON trimble_delivery_items(status);
CREATE INDEX idx_del_items_mark ON trimble_delivery_items(assembly_mark);

-- Ajalugu
CREATE INDEX idx_del_history_project ON trimble_delivery_history(trimble_project_id);
CREATE INDEX idx_del_history_item ON trimble_delivery_history(item_id);
CREATE INDEX idx_del_history_vehicle ON trimble_delivery_history(vehicle_id);
CREATE INDEX idx_del_history_date ON trimble_delivery_history(changed_at);
CREATE INDEX idx_del_history_snapshot ON trimble_delivery_history(is_snapshot, snapshot_date);

-- Kommentaarid
CREATE INDEX idx_del_comments_project ON trimble_delivery_comments(trimble_project_id);
CREATE INDEX idx_del_comments_item ON trimble_delivery_comments(delivery_item_id);
CREATE INDEX idx_del_comments_vehicle ON trimble_delivery_comments(vehicle_id);

-- ============================================
-- 4. FUNKTSIOONID JA TRIGGERID
-- ============================================

-- 4.1 Veoki statistika uuendamine
CREATE OR REPLACE FUNCTION update_vehicle_statistics()
RETURNS TRIGGER AS $$
BEGIN
  -- Uuenda vana veoki statistikat (kui oli)
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.vehicle_id IS NOT NULL) THEN
    UPDATE trimble_delivery_vehicles
    SET
      item_count = (SELECT COUNT(*) FROM trimble_delivery_items WHERE vehicle_id = OLD.vehicle_id),
      total_weight = COALESCE((SELECT SUM(CAST(NULLIF(cast_unit_weight, '') AS DECIMAL)) FROM trimble_delivery_items WHERE vehicle_id = OLD.vehicle_id), 0),
      updated_at = NOW()
    WHERE id = OLD.vehicle_id;
  END IF;

  -- Uuenda uue veoki statistikat
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.vehicle_id IS NOT NULL) THEN
    UPDATE trimble_delivery_vehicles
    SET
      item_count = (SELECT COUNT(*) FROM trimble_delivery_items WHERE vehicle_id = NEW.vehicle_id),
      total_weight = COALESCE((SELECT SUM(CAST(NULLIF(cast_unit_weight, '') AS DECIMAL)) FROM trimble_delivery_items WHERE vehicle_id = NEW.vehicle_id), 0),
      updated_at = NOW()
    WHERE id = NEW.vehicle_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_vehicle_stats
AFTER INSERT OR UPDATE OR DELETE ON trimble_delivery_items
FOR EACH ROW EXECUTE FUNCTION update_vehicle_statistics();

-- 4.2 Muudatuste logimine ajalukku
CREATE OR REPLACE FUNCTION log_delivery_item_changes()
RETURNS TRIGGER AS $$
DECLARE
  old_vehicle_code TEXT;
  new_vehicle_code TEXT;
BEGIN
  -- Hangi veokite koodid
  IF OLD.vehicle_id IS NOT NULL THEN
    SELECT vehicle_code INTO old_vehicle_code FROM trimble_delivery_vehicles WHERE id = OLD.vehicle_id;
  END IF;
  IF NEW.vehicle_id IS NOT NULL THEN
    SELECT vehicle_code INTO new_vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id;
  END IF;

  -- Logi kuupäeva muutus
  IF OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date THEN
    INSERT INTO trimble_delivery_history (
      trimble_project_id, item_id, vehicle_id, change_type,
      old_date, new_date, old_vehicle_code, new_vehicle_code,
      changed_by
    ) VALUES (
      NEW.trimble_project_id, NEW.id, NEW.vehicle_id, 'date_changed',
      OLD.scheduled_date, NEW.scheduled_date, old_vehicle_code, new_vehicle_code,
      COALESCE(NEW.updated_by, NEW.created_by)
    );
  END IF;

  -- Logi veoki muutus
  IF OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    INSERT INTO trimble_delivery_history (
      trimble_project_id, item_id, vehicle_id, change_type,
      old_vehicle_id, old_vehicle_code, new_vehicle_id, new_vehicle_code,
      old_date, new_date, changed_by
    ) VALUES (
      NEW.trimble_project_id, NEW.id, NEW.vehicle_id, 'vehicle_changed',
      OLD.vehicle_id, old_vehicle_code, NEW.vehicle_id, new_vehicle_code,
      OLD.scheduled_date, NEW.scheduled_date,
      COALESCE(NEW.updated_by, NEW.created_by)
    );
  END IF;

  -- Logi staatuse muutus
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO trimble_delivery_history (
      trimble_project_id, item_id, vehicle_id, change_type,
      old_status, new_status, old_vehicle_code, new_vehicle_code,
      changed_by
    ) VALUES (
      NEW.trimble_project_id, NEW.id, NEW.vehicle_id, 'status_changed',
      OLD.status, NEW.status, old_vehicle_code, new_vehicle_code,
      COALESCE(NEW.updated_by, NEW.created_by)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_log_delivery_changes
AFTER UPDATE ON trimble_delivery_items
FOR EACH ROW EXECUTE FUNCTION log_delivery_item_changes();

-- ============================================
-- 5. VAATED (Views)
-- ============================================

-- 5.1 Päevade kokkuvõte
CREATE OR REPLACE VIEW v_delivery_daily_summary AS
SELECT
  trimble_project_id,
  scheduled_date,
  COUNT(DISTINCT vehicle_id) as vehicle_count,
  COUNT(*) as item_count,
  COALESCE(SUM(CAST(NULLIF(cast_unit_weight, '') AS DECIMAL)), 0) as total_weight
FROM trimble_delivery_items
GROUP BY trimble_project_id, scheduled_date
ORDER BY scheduled_date;

-- 5.2 Tehaste kokkuvõte
CREATE OR REPLACE VIEW v_delivery_factory_summary AS
SELECT
  v.trimble_project_id,
  f.factory_name,
  f.factory_code,
  COUNT(DISTINCT v.id) as vehicle_count,
  COALESCE(SUM(v.item_count), 0) as item_count,
  COALESCE(SUM(v.total_weight), 0) as total_weight
FROM trimble_delivery_vehicles v
JOIN trimble_delivery_factories f ON v.factory_id = f.id
GROUP BY v.trimble_project_id, f.factory_name, f.factory_code
ORDER BY f.factory_name;

-- 5.3 Detailid koos veoki ja tehase infoga
CREATE OR REPLACE VIEW v_delivery_items_full AS
SELECT
  i.*,
  v.vehicle_code,
  v.scheduled_date as vehicle_date,
  v.status as vehicle_status,
  f.factory_name,
  f.factory_code
FROM trimble_delivery_items i
LEFT JOIN trimble_delivery_vehicles v ON i.vehicle_id = v.id
LEFT JOIN trimble_delivery_factories f ON v.factory_id = f.id;

-- ============================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Luba RLS kõigil tabelitel
ALTER TABLE trimble_delivery_factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE trimble_delivery_comments ENABLE ROW LEVEL SECURITY;

-- Loo lubavad poliitikad (kõik autenditud kasutajad saavad kõike teha)
CREATE POLICY "delivery_factories_all" ON trimble_delivery_factories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "delivery_vehicles_all" ON trimble_delivery_vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "delivery_items_all" ON trimble_delivery_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "delivery_history_all" ON trimble_delivery_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "delivery_comments_all" ON trimble_delivery_comments FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 7. TESTANDMED (valikuline - kommenteeri välja kui ei soovi)
-- ============================================

-- Näide: Lisa tehased testimiseks
-- INSERT INTO trimble_delivery_factories (trimble_project_id, factory_name, factory_code, sort_order, created_by)
-- VALUES
--   ('TEST_PROJECT', 'Obornik', 'OPO', 0, 'test@example.com'),
--   ('TEST_PROJECT', 'Solid', 'SOL', 1, 'test@example.com');

-- ============================================
-- VALMIS!
-- ============================================

-- Kontrolli, et tabelid on loodud
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name AND table_schema = 'public') as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
AND table_name LIKE 'trimble_delivery%'
ORDER BY table_name;
