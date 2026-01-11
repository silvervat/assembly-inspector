-- ============================================
-- PROJEKTI RESSURSID (Project Resources)
-- Migration: 20260111_project_resources.sql
-- ============================================

-- Ressurside tabel
CREATE TABLE IF NOT EXISTS project_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,

  -- Ressursi tüüp
  resource_type TEXT NOT NULL,  -- 'crane', 'telescopic_loader', 'boom_lift', 'scissor_lift', 'welder', 'rigger', 'installer', 'crane_operator', 'forklift_operator'

  -- Ressursi nimi (nt "Liebherr 50t", "Jaan Tamm", "CAT TH414")
  name TEXT NOT NULL,

  -- Märksõnad (nt "50t, suur, punane")
  keywords TEXT,

  -- Staatus
  is_active BOOLEAN DEFAULT TRUE,

  -- Järjekord
  sort_order INTEGER DEFAULT 0,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,

  -- Unikaalsus projekti, tüübi ja nime kombinatsioonile
  UNIQUE(trimble_project_id, resource_type, name)
);

-- Indeksid
CREATE INDEX IF NOT EXISTS idx_project_resources_project ON project_resources(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_project_resources_type ON project_resources(resource_type);
CREATE INDEX IF NOT EXISTS idx_project_resources_active ON project_resources(is_active);
CREATE INDEX IF NOT EXISTS idx_project_resources_project_type ON project_resources(trimble_project_id, resource_type);

-- RLS
ALTER TABLE project_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for project_resources" ON project_resources;
CREATE POLICY "Allow all for project_resources" ON project_resources FOR ALL USING (true);

-- Kommentaarid
COMMENT ON TABLE project_resources IS 'Projekti ressursid - tehnika, töötajad jne mida kasutatakse kogu extensionis';
COMMENT ON COLUMN project_resources.resource_type IS 'Ressursi tüüp: crane, telescopic_loader, boom_lift, scissor_lift, welder, rigger, installer, crane_operator, forklift_operator';
COMMENT ON COLUMN project_resources.name IS 'Ressursi nimi - tehnika mudel/registrinumber või töötaja nimi';
COMMENT ON COLUMN project_resources.keywords IS 'Märksõnad otsinguks ja filtreerimiseks (komadega eraldatud)';
