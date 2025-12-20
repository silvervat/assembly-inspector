-- ============================================================================
-- TARNE GRAAFIK (Delivery Schedule) - Andmebaasi migratsioon
-- Versioon: 3.0.0
-- Kuupäev: 2025-12-20
-- ============================================================================

-- Märkus: Käivita see fail Supabase SQL Editor'is

-- ============================================================================
-- 1. TEHASTE TABEL (Factories)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trimble_delivery_factories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  factory_name TEXT NOT NULL,           -- "Obornik", "Solid"
  factory_code TEXT NOT NULL,           -- "OPO", "SOL" (lühend veokite jaoks)
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT NOT NULL,

  CONSTRAINT unique_factory_per_project UNIQUE (project_id, factory_code)
);

CREATE INDEX IF NOT EXISTS idx_delivery_factories_project
ON trimble_delivery_factories(project_id);

-- ============================================================================
-- 2. VEOKITE TABEL (Vehicles)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trimble_delivery_vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  factory_id UUID REFERENCES trimble_delivery_factories(id) ON DELETE CASCADE,
  vehicle_number INTEGER NOT NULL,       -- 1, 2, 3...
  vehicle_code TEXT NOT NULL,            -- "OPO1", "OPO2" (genereeritakse)
  scheduled_date DATE NOT NULL,          -- Mis kuupäeval see veok tuleb

  -- Mahalaadimise meetodid (JSONB)
  unload_methods JSONB DEFAULT NULL,     -- {crane: 1, telescopic: 2, manual: 0}

  -- Ressursid (JSONB)
  resources JSONB DEFAULT NULL,          -- {taasnik: 2, keevitaja: 1}

  -- Staatused
  status TEXT DEFAULT 'planned' CHECK (status IN (
    'planned',      -- Planeeritud
    'loading',      -- Laadimisel tehases
    'transit',      -- Teel
    'arrived',      -- Kohale jõudnud
    'unloading',    -- Mahalaadimisel
    'completed',    -- Lõpetatud
    'cancelled'     -- Tühistatud
  )),

  -- Statistika (arvutatakse triggeriga)
  item_count INTEGER DEFAULT 0,
  total_weight DECIMAL(12,2) DEFAULT 0,

  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT,

  CONSTRAINT unique_vehicle_code_per_project UNIQUE (project_id, vehicle_code)
);

CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_project
ON trimble_delivery_vehicles(project_id);

CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_factory
ON trimble_delivery_vehicles(factory_id);

CREATE INDEX IF NOT EXISTS idx_delivery_vehicles_date
ON trimble_delivery_vehicles(scheduled_date);

-- ============================================================================
-- 3. DETAILIDE TABEL (Items)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trimble_delivery_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE SET NULL,

  -- Trimble Connect identifikaatorid
  model_id TEXT,
  guid TEXT NOT NULL,
  guid_ifc TEXT,
  guid_ms TEXT,
  object_runtime_id INTEGER,
  trimble_product_id TEXT,               -- Trimble Connect Product ID

  -- Detaili info
  assembly_mark TEXT NOT NULL,
  product_name TEXT,
  file_name TEXT,
  cast_unit_weight TEXT,
  cast_unit_position_code TEXT,

  -- Tarne info
  scheduled_date DATE NOT NULL,          -- Planeeritud kuupäev
  sort_order INTEGER DEFAULT 0,

  -- Staatused
  status TEXT DEFAULT 'planned' CHECK (status IN (
    'planned',      -- Planeeritud
    'loaded',       -- Peale laetud
    'in_transit',   -- Teel
    'delivered',    -- Kohale toimetatud
    'cancelled'     -- Tühistatud
  )),

  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT,

  CONSTRAINT unique_delivery_item_guid UNIQUE (project_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_delivery_items_project
ON trimble_delivery_items(project_id);

CREATE INDEX IF NOT EXISTS idx_delivery_items_vehicle
ON trimble_delivery_items(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_delivery_items_date
ON trimble_delivery_items(scheduled_date);

CREATE INDEX IF NOT EXISTS idx_delivery_items_guid
ON trimble_delivery_items(guid);

CREATE INDEX IF NOT EXISTS idx_delivery_items_guid_ifc
ON trimble_delivery_items(guid_ifc);

CREATE INDEX IF NOT EXISTS idx_delivery_items_guid_ms
ON trimble_delivery_items(guid_ms);

-- ============================================================================
-- 4. AJALOO TABEL (History)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trimble_delivery_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,
  item_id UUID REFERENCES trimble_delivery_items(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES trimble_delivery_vehicles(id) ON DELETE SET NULL,

  -- Muudatuse tüüp
  change_type TEXT NOT NULL CHECK (change_type IN (
    'created',           -- Esmakordselt lisatud
    'date_changed',      -- Kuupäev muutus
    'vehicle_changed',   -- Veok muutus
    'status_changed',    -- Staatus muutus
    'removed',           -- Eemaldatud koormast
    'daily_snapshot'     -- Päevalõpu hetktõmmis
  )),

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
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Päevalõpu snapshot flag
  is_snapshot BOOLEAN DEFAULT false,
  snapshot_date DATE
);

CREATE INDEX IF NOT EXISTS idx_delivery_history_project
ON trimble_delivery_history(project_id);

CREATE INDEX IF NOT EXISTS idx_delivery_history_item
ON trimble_delivery_history(item_id);

CREATE INDEX IF NOT EXISTS idx_delivery_history_vehicle
ON trimble_delivery_history(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_delivery_history_date
ON trimble_delivery_history(changed_at);

CREATE INDEX IF NOT EXISTS idx_delivery_history_snapshot
ON trimble_delivery_history(is_snapshot, snapshot_date);

-- ============================================================================
-- 5. KOMMENTAARIDE TABEL (Comments)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trimble_delivery_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id TEXT NOT NULL,

  -- Kommentaari sihtmärk (üks neist)
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

CREATE INDEX IF NOT EXISTS idx_delivery_comments_project
ON trimble_delivery_comments(project_id);

CREATE INDEX IF NOT EXISTS idx_delivery_comments_item
ON trimble_delivery_comments(delivery_item_id);

CREATE INDEX IF NOT EXISTS idx_delivery_comments_vehicle
ON trimble_delivery_comments(vehicle_id);

CREATE INDEX IF NOT EXISTS idx_delivery_comments_date
ON trimble_delivery_comments(delivery_date);

-- ============================================================================
-- 6. TRIGGERID JA FUNKTSIOONID
-- ============================================================================

-- 6.1 Veoki statistika uuendamine
-- ============================================================================

CREATE OR REPLACE FUNCTION update_delivery_vehicle_statistics()
RETURNS TRIGGER AS $$
BEGIN
  -- Uuenda vana veoki statistikat (kui veok muutus või element kustutati)
  IF (TG_OP = 'DELETE') OR
     (TG_OP = 'UPDATE' AND OLD.vehicle_id IS NOT NULL AND
      (NEW.vehicle_id IS NULL OR OLD.vehicle_id != NEW.vehicle_id)) THEN
    UPDATE trimble_delivery_vehicles
    SET
      item_count = (
        SELECT COUNT(*)
        FROM trimble_delivery_items
        WHERE vehicle_id = OLD.vehicle_id
      ),
      total_weight = (
        SELECT COALESCE(SUM(
          CASE
            WHEN cast_unit_weight ~ '^[0-9]+\.?[0-9]*$'
            THEN CAST(cast_unit_weight AS DECIMAL)
            ELSE 0
          END
        ), 0)
        FROM trimble_delivery_items
        WHERE vehicle_id = OLD.vehicle_id
      ),
      updated_at = NOW()
    WHERE id = OLD.vehicle_id;
  END IF;

  -- Uuenda uue veoki statistikat (kui lisati või veok muutus)
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.vehicle_id IS NOT NULL THEN
    UPDATE trimble_delivery_vehicles
    SET
      item_count = (
        SELECT COUNT(*)
        FROM trimble_delivery_items
        WHERE vehicle_id = NEW.vehicle_id
      ),
      total_weight = (
        SELECT COALESCE(SUM(
          CASE
            WHEN cast_unit_weight ~ '^[0-9]+\.?[0-9]*$'
            THEN CAST(cast_unit_weight AS DECIMAL)
            ELSE 0
          END
        ), 0)
        FROM trimble_delivery_items
        WHERE vehicle_id = NEW.vehicle_id
      ),
      updated_at = NOW()
    WHERE id = NEW.vehicle_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_delivery_vehicle_stats ON trimble_delivery_items;

CREATE TRIGGER trigger_update_delivery_vehicle_stats
AFTER INSERT OR UPDATE OF vehicle_id, cast_unit_weight OR DELETE
ON trimble_delivery_items
FOR EACH ROW
EXECUTE FUNCTION update_delivery_vehicle_statistics();

-- 6.2 Muudatuste logimine
-- ============================================================================

CREATE OR REPLACE FUNCTION log_delivery_item_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Uue kirje loomine
  IF TG_OP = 'INSERT' THEN
    INSERT INTO trimble_delivery_history (
      project_id, item_id, vehicle_id, change_type,
      new_date, new_vehicle_id, new_vehicle_code, new_status, changed_by
    )
    SELECT
      NEW.project_id, NEW.id, NEW.vehicle_id, 'created',
      NEW.scheduled_date, NEW.vehicle_id,
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id),
      NEW.status, NEW.created_by;
    RETURN NEW;
  END IF;

  -- Kuupäeva muutus
  IF TG_OP = 'UPDATE' AND OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date THEN
    INSERT INTO trimble_delivery_history (
      project_id, item_id, vehicle_id, change_type,
      old_date, new_date, old_vehicle_code, new_vehicle_code, changed_by
    )
    SELECT
      NEW.project_id, NEW.id, NEW.vehicle_id, 'date_changed',
      OLD.scheduled_date, NEW.scheduled_date,
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = OLD.vehicle_id),
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id),
      COALESCE(NEW.updated_by, NEW.created_by);
  END IF;

  -- Veoki muutus
  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    INSERT INTO trimble_delivery_history (
      project_id, item_id, vehicle_id, change_type,
      old_vehicle_id, new_vehicle_id, old_vehicle_code, new_vehicle_code, changed_by
    )
    SELECT
      NEW.project_id, NEW.id, NEW.vehicle_id, 'vehicle_changed',
      OLD.vehicle_id, NEW.vehicle_id,
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = OLD.vehicle_id),
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id),
      COALESCE(NEW.updated_by, NEW.created_by);
  END IF;

  -- Staatuse muutus
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO trimble_delivery_history (
      project_id, item_id, vehicle_id, change_type,
      old_status, new_status, changed_by
    )
    VALUES (
      NEW.project_id, NEW.id, NEW.vehicle_id, 'status_changed',
      OLD.status, NEW.status, COALESCE(NEW.updated_by, NEW.created_by)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_delivery_changes ON trimble_delivery_items;

CREATE TRIGGER trigger_log_delivery_changes
AFTER INSERT OR UPDATE
ON trimble_delivery_items
FOR EACH ROW
EXECUTE FUNCTION log_delivery_item_changes();

-- 6.3 Päevalõpu hetktõmmise funktsioon
-- ============================================================================
-- Märkus: Seda funktsiooni saab käivitada Supabase pg_cron laiendusega
-- või välise cron job'iga öösel

CREATE OR REPLACE FUNCTION create_daily_delivery_snapshot()
RETURNS void AS $$
DECLARE
  item_record RECORD;
  snapshot_count INTEGER := 0;
BEGIN
  -- Loo hetktõmmis kõigist elementidest, mida muudeti täna
  FOR item_record IN
    SELECT
      di.id,
      di.project_id,
      di.vehicle_id,
      di.scheduled_date,
      di.status,
      dv.vehicle_code
    FROM trimble_delivery_items di
    LEFT JOIN trimble_delivery_vehicles dv ON dv.id = di.vehicle_id
    WHERE di.updated_at::date = CURRENT_DATE
  LOOP
    -- Kontrolli, kas hetktõmmis juba eksisteerib
    IF NOT EXISTS (
      SELECT 1 FROM trimble_delivery_history
      WHERE item_id = item_record.id
        AND is_snapshot = true
        AND snapshot_date = CURRENT_DATE
    ) THEN
      INSERT INTO trimble_delivery_history (
        project_id, item_id, vehicle_id, change_type,
        new_date, new_vehicle_id, new_vehicle_code, new_status,
        is_snapshot, snapshot_date, changed_by
      )
      VALUES (
        item_record.project_id,
        item_record.id,
        item_record.vehicle_id,
        'daily_snapshot',
        item_record.scheduled_date,
        item_record.vehicle_id,
        item_record.vehicle_code,
        item_record.status,
        true,
        CURRENT_DATE,
        'SYSTEM'
      );
      snapshot_count := snapshot_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Created % daily snapshots for %', snapshot_count, CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- 6.4 Veoki koodi automaatne genereerimine
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_vehicle_code()
RETURNS TRIGGER AS $$
DECLARE
  factory_code_val TEXT;
BEGIN
  -- Hangi tehase kood
  SELECT factory_code INTO factory_code_val
  FROM trimble_delivery_factories
  WHERE id = NEW.factory_id;

  -- Genereeri veoki kood
  IF factory_code_val IS NOT NULL THEN
    NEW.vehicle_code := factory_code_val || NEW.vehicle_number::TEXT;
  ELSE
    NEW.vehicle_code := 'VEH' || NEW.vehicle_number::TEXT;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_vehicle_code ON trimble_delivery_vehicles;

CREATE TRIGGER trigger_generate_vehicle_code
BEFORE INSERT OR UPDATE OF factory_id, vehicle_number
ON trimble_delivery_vehicles
FOR EACH ROW
EXECUTE FUNCTION generate_vehicle_code();

-- ============================================================================
-- 7. VAIKIMISI TEHASED (Eesti projektidele)
-- ============================================================================
-- Märkus: Neid saab lisada projekti põhiselt

-- INSERT INTO trimble_delivery_factories (project_id, factory_name, factory_code, sort_order, created_by)
-- VALUES
--   ('YOUR_PROJECT_ID', 'Oborniki', 'OPO', 1, 'system'),
--   ('YOUR_PROJECT_ID', 'Solid', 'SOL', 2, 'system'),
--   ('YOUR_PROJECT_ID', 'E-Betoonelement', 'EBE', 3, 'system');

-- ============================================================================
-- 8. VAATED (Views) mugavamaks päringuteks
-- ============================================================================

-- 8.1 Täielik vaade kõigi detailide kohta koos veoki ja tehase infoga
CREATE OR REPLACE VIEW v_delivery_items_full AS
SELECT
  di.*,
  dv.vehicle_code,
  dv.vehicle_number,
  dv.status AS vehicle_status,
  dv.unload_methods,
  dv.resources,
  dv.item_count AS vehicle_item_count,
  dv.total_weight AS vehicle_total_weight,
  df.factory_name,
  df.factory_code
FROM trimble_delivery_items di
LEFT JOIN trimble_delivery_vehicles dv ON dv.id = di.vehicle_id
LEFT JOIN trimble_delivery_factories df ON df.id = dv.factory_id;

-- 8.2 Päevade kokkuvõte
CREATE OR REPLACE VIEW v_delivery_daily_summary AS
SELECT
  project_id,
  scheduled_date,
  COUNT(DISTINCT vehicle_id) AS vehicle_count,
  COUNT(*) AS item_count,
  SUM(
    CASE
      WHEN cast_unit_weight ~ '^[0-9]+\.?[0-9]*$'
      THEN CAST(cast_unit_weight AS DECIMAL)
      ELSE 0
    END
  ) AS total_weight
FROM trimble_delivery_items
GROUP BY project_id, scheduled_date
ORDER BY scheduled_date;

-- 8.3 Tehaste kokkuvõte
CREATE OR REPLACE VIEW v_delivery_factory_summary AS
SELECT
  di.project_id,
  df.factory_name,
  df.factory_code,
  COUNT(DISTINCT dv.id) AS vehicle_count,
  COUNT(di.id) AS item_count,
  SUM(
    CASE
      WHEN di.cast_unit_weight ~ '^[0-9]+\.?[0-9]*$'
      THEN CAST(di.cast_unit_weight AS DECIMAL)
      ELSE 0
    END
  ) AS total_weight
FROM trimble_delivery_items di
JOIN trimble_delivery_vehicles dv ON dv.id = di.vehicle_id
JOIN trimble_delivery_factories df ON df.id = dv.factory_id
GROUP BY di.project_id, df.factory_name, df.factory_code
ORDER BY df.factory_code;

-- 8.4 Muudatuste ajalugu koos detailse infoga
CREATE OR REPLACE VIEW v_delivery_history_full AS
SELECT
  dh.*,
  di.assembly_mark,
  di.guid,
  old_v.vehicle_code AS old_vehicle_code_resolved,
  new_v.vehicle_code AS new_vehicle_code_resolved
FROM trimble_delivery_history dh
LEFT JOIN trimble_delivery_items di ON di.id = dh.item_id
LEFT JOIN trimble_delivery_vehicles old_v ON old_v.id = dh.old_vehicle_id
LEFT JOIN trimble_delivery_vehicles new_v ON new_v.id = dh.new_vehicle_id;

-- ============================================================================
-- 9. RLS (Row Level Security) POLIITIKAD
-- ============================================================================
-- Märkus: Aktiveeritakse kui RLS on projekti jaoks vajalik

-- ALTER TABLE trimble_delivery_factories ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE trimble_delivery_vehicles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE trimble_delivery_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE trimble_delivery_history ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE trimble_delivery_comments ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- MIGRATSIOON LÕPETATUD
-- ============================================================================

-- Kontrollige, et kõik tabelid on loodud:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'trimble_delivery_%';
