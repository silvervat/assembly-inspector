-- ============================================
-- INSPECTION PLAN SYSTEM (v2.6.0)
-- Inspektsiooni kava süsteem - EOS2 ühilduv
-- ============================================

-- ============================================
-- 1. INSPECTION TYPES - Inspektsioonitüübid
-- ============================================
-- Kõrgeim tase - määrab inspektsiooni tüübi

CREATE TABLE IF NOT EXISTS inspection_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID,                                    -- Omaniku ID (null = süsteemne mall)
  code TEXT UNIQUE NOT NULL,                         -- Unikaalne kood (nt STEEL_INSTALLATION)
  name TEXT NOT NULL,                                -- Kuvatav nimi
  description TEXT,                                  -- Kirjeldus
  icon TEXT DEFAULT 'clipboard-list',               -- Ikooni nimi
  color TEXT DEFAULT 'blue',                        -- Värvi nimi
  sort_order INT DEFAULT 0,                         -- Järjestuse number
  is_active BOOLEAN DEFAULT true,                   -- Kas aktiivne
  is_system BOOLEAN DEFAULT false,                  -- Süsteemne tüüp (ei saa kustutada)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indeksid
CREATE INDEX IF NOT EXISTS idx_inspection_types_code ON inspection_types(code);
CREATE INDEX IF NOT EXISTS idx_inspection_types_tenant ON inspection_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inspection_types_active ON inspection_types(is_active);

-- Vaikimisi inspektsioonitüübid (EOS2 süsteemist)
INSERT INTO inspection_types (code, name, description, icon, color, sort_order, is_system, is_active) VALUES
  ('STEEL_INSTALLATION', 'Teraskonstruktsioonide paigaldus', 'Teraselementide paigalduse inspektsioon', 'wrench', 'teal', 1, true, true),
  ('CONCRETE_INSTALLATION', 'Betoonelemetnide paigaldus', 'Betoonelemendide paigalduse inspektsioon', 'cube', 'gray', 2, true, true),
  ('BOLT_TORQUE', 'Poltide pingutus', 'Poltide pingutuse ja kontrolli inspektsioon', 'tool', 'blue', 3, true, true),
  ('PAINTING', 'Värvimine', 'Värvimistööde inspektsioon', 'paint-brush', 'orange', 4, true, true),
  ('WELDING', 'Keevitustööd', 'Keevitustööde inspektsioon', 'fire', 'red', 5, true, true),
  ('MONOLITHISATION', 'Monolitiseerimine', 'Monolitiseerimise inspektsioon', 'box', 'purple', 6, true, true),
  ('SHEET_METAL', 'Plekitööd', 'Plekitööde inspektsioon', 'layers', 'zinc', 7, true, true),
  ('SW_PANELS_INSTALL', 'SW paneelide paigaldus', 'Sandwich-paneelide paigalduse inspektsioon', 'layout', 'green', 8, true, true),
  ('SW_PANELS', 'SW paneelid', 'Sandwich-paneelide inspektsioon', 'square', 'lime', 9, true, true),
  ('OTHER', 'Muu', 'Muud inspektsioonid', 'more-horizontal', 'gray', 99, true, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 2. INSPECTION CATEGORIES - Kategooriad
-- ============================================
-- Kategooriad grupeerivad seotud kontrollpunkte

CREATE TABLE IF NOT EXISTS inspection_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID,                                    -- Omaniku ID (null = jagatud mall)
  type_id UUID NOT NULL REFERENCES inspection_types(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,                         -- Unikaalne kood
  name TEXT NOT NULL,                                -- Kategooria nimi
  description TEXT,                                  -- Kirjeldus
  icon TEXT,                                         -- Ikooni nimi
  color TEXT,                                        -- Värvi nimi
  sort_order INT DEFAULT 0,                         -- Järjestuse number
  is_required BOOLEAN DEFAULT false,                -- Kas kohustuslik
  is_active BOOLEAN DEFAULT true,                   -- Kas aktiivne
  is_template BOOLEAN DEFAULT false,                -- Kas jagatud mall
  project_id UUID,                                  -- Projekti-spetsiifiline
  source_category_id UUID,                          -- Algne mall (kui kopeeritud)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indeksid
CREATE INDEX IF NOT EXISTS idx_inspection_categories_type ON inspection_categories(type_id);
CREATE INDEX IF NOT EXISTS idx_inspection_categories_tenant ON inspection_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inspection_categories_project ON inspection_categories(project_id);

-- Vaikimisi kategooriad (näited)
INSERT INTO inspection_categories (type_id, code, name, description, sort_order, is_active)
SELECT
  it.id,
  'CAT_STEEL_VISUAL',
  'Visuaalne kontroll',
  'Elemendi visuaalne ülevaatus',
  1,
  true
FROM inspection_types it WHERE it.code = 'STEEL_INSTALLATION'
ON CONFLICT (code) DO NOTHING;

INSERT INTO inspection_categories (type_id, code, name, description, sort_order, is_active)
SELECT
  it.id,
  'CAT_STEEL_POSITION',
  'Asendi kontroll',
  'Elemendi asendi ja paigutuse kontroll',
  2,
  true
FROM inspection_types it WHERE it.code = 'STEEL_INSTALLATION'
ON CONFLICT (code) DO NOTHING;

INSERT INTO inspection_categories (type_id, code, name, description, sort_order, is_active)
SELECT
  it.id,
  'CAT_BOLT_VISUAL',
  'Visuaalne kontroll',
  'Poldi visuaalne ülevaatus',
  1,
  true
FROM inspection_types it WHERE it.code = 'BOLT_TORQUE'
ON CONFLICT (code) DO NOTHING;

INSERT INTO inspection_categories (type_id, code, name, description, sort_order, is_active)
SELECT
  it.id,
  'CAT_BOLT_TORQUE',
  'Pingutuse kontroll',
  'Poldi pingutuse mõõtmine',
  2,
  true
FROM inspection_types it WHERE it.code = 'BOLT_TORQUE'
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 3. INSPECTION PLAN ITEMS - Inspektsiooni kava
-- ============================================
-- Põhitabel - objektid mis vajavad inspekteerimist

CREATE TABLE IF NOT EXISTS inspection_plan_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Projekti ja mudeli info
  project_id TEXT NOT NULL,                          -- Trimble Connect projekti ID
  model_id TEXT NOT NULL,                            -- Mudeli ID

  -- Objekti identifikaatorid (EOS2 suhtluseks)
  guid TEXT NOT NULL,                                -- IFC GUID - peamine identifikaator
  guid_ifc TEXT,                                     -- Alternatiivne IFC GUID
  guid_ms TEXT,                                      -- Microsoft GUID
  object_runtime_id INTEGER,                         -- Trimble runtime ID

  -- Objekti andmed
  assembly_mark TEXT,                                -- Assembly mark (Cast_unit_Mark)
  object_name TEXT,                                  -- Objekti nimi
  object_type TEXT,                                  -- Objekti tüüp (IfcBeam, IfcColumn jne)
  product_name TEXT,                                 -- Toote nimi (IFC Product)

  -- Inspektsiooni seaded
  inspection_type_id UUID REFERENCES inspection_types(id),
  category_id UUID REFERENCES inspection_categories(id),
  assembly_selection_mode BOOLEAN DEFAULT true,      -- Kas assembly selection oli sees

  -- Staatus
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped')),
  priority INT DEFAULT 0,                            -- Prioriteet (kõrgem = olulisem)

  -- Märkmed
  notes TEXT,                                        -- Kasutaja märkmed
  planner_notes TEXT,                               -- Kava koostaja märkmed

  -- Metadata
  created_by TEXT,                                   -- Looja email
  created_by_name TEXT,                             -- Looja nimi
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unikaalsus - sama objekt ei saa olla mitu korda samas kavas
  UNIQUE(project_id, guid, inspection_type_id)
);

-- Indeksid kiireks otsinguks
CREATE INDEX IF NOT EXISTS idx_plan_items_project ON inspection_plan_items(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_guid ON inspection_plan_items(guid);
CREATE INDEX IF NOT EXISTS idx_plan_items_type ON inspection_plan_items(inspection_type_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_category ON inspection_plan_items(category_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_status ON inspection_plan_items(status);
CREATE INDEX IF NOT EXISTS idx_plan_items_assembly ON inspection_plan_items(assembly_mark);
CREATE INDEX IF NOT EXISTS idx_plan_items_created ON inspection_plan_items(created_at);

-- ============================================
-- 4. INSPECTION PLAN STATISTICS VIEW
-- ============================================
-- Vaade statistika kiireks pärimiseks

CREATE OR REPLACE VIEW inspection_plan_stats AS
SELECT
  project_id,
  inspection_type_id,
  it.name as inspection_type_name,
  COUNT(*) as total_items,
  COUNT(*) FILTER (WHERE ipi.status = 'planned') as planned_count,
  COUNT(*) FILTER (WHERE ipi.status = 'in_progress') as in_progress_count,
  COUNT(*) FILTER (WHERE ipi.status = 'completed') as completed_count,
  COUNT(*) FILTER (WHERE ipi.status = 'skipped') as skipped_count,
  COUNT(*) FILTER (WHERE ipi.assembly_selection_mode = true) as assembly_on_count,
  COUNT(*) FILTER (WHERE ipi.assembly_selection_mode = false) as assembly_off_count
FROM inspection_plan_items ipi
LEFT JOIN inspection_types it ON it.id = ipi.inspection_type_id
GROUP BY project_id, inspection_type_id, it.name;

-- ============================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================

-- Luba RLS
ALTER TABLE inspection_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_plan_items ENABLE ROW LEVEL SECURITY;

-- Poliitikad (kõik saavad lugeda, ainult autenditud saavad kirjutada)
CREATE POLICY "inspection_types_read" ON inspection_types FOR SELECT USING (true);
CREATE POLICY "inspection_types_write" ON inspection_types FOR ALL USING (true);

CREATE POLICY "inspection_categories_read" ON inspection_categories FOR SELECT USING (true);
CREATE POLICY "inspection_categories_write" ON inspection_categories FOR ALL USING (true);

CREATE POLICY "inspection_plan_items_read" ON inspection_plan_items FOR SELECT USING (true);
CREATE POLICY "inspection_plan_items_write" ON inspection_plan_items FOR ALL USING (true);

-- ============================================
-- 6. TRIGGERS
-- ============================================

-- Updated_at trigger funktsioon
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggerid updated_at jaoks
DROP TRIGGER IF EXISTS update_inspection_types_updated_at ON inspection_types;
CREATE TRIGGER update_inspection_types_updated_at
  BEFORE UPDATE ON inspection_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inspection_categories_updated_at ON inspection_categories;
CREATE TRIGGER update_inspection_categories_updated_at
  BEFORE UPDATE ON inspection_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_inspection_plan_items_updated_at ON inspection_plan_items;
CREATE TRIGGER update_inspection_plan_items_updated_at
  BEFORE UPDATE ON inspection_plan_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- KOMMENTAARID
-- ============================================

COMMENT ON TABLE inspection_types IS 'Inspektsioonitüübid - kõrgeim tase hierarhias. EOS2 ühilduv.';
COMMENT ON TABLE inspection_categories IS 'Kategooriad - grupeerivad kontrollpunkte. EOS2 ühilduv.';
COMMENT ON TABLE inspection_plan_items IS 'Inspektsiooni kava - objektid mis vajavad inspekteerimist. Suhtleb EOS2-ga GUID kaudu.';
COMMENT ON COLUMN inspection_plan_items.guid IS 'IFC GUID - peamine identifikaator EOS2 suhtluseks';
COMMENT ON COLUMN inspection_plan_items.assembly_selection_mode IS 'Kas Trimble assembly selection oli sisse lülitatud objekti valimisel';
