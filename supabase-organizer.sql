-- ============================================
-- ORGANISEERIJA SÜSTEEM (Organizer System v3.1.0)
-- ============================================

-- Grupid (kuni 3 taset alamgruppe)
CREATE TABLE IF NOT EXISTS organizer_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trimble_project_id TEXT NOT NULL,           -- Trimble Connect project ID
  parent_id UUID REFERENCES organizer_groups(id) ON DELETE CASCADE,  -- Alamgrupid
  name TEXT NOT NULL,                          -- Grupi nimi
  description TEXT,                            -- Grupi kirjeldus
  color TEXT DEFAULT '#6b7280',                -- Grupi värv (hex)
  sort_order INTEGER DEFAULT 0,                -- Järjekord
  level INTEGER DEFAULT 0 CHECK (level <= 2),  -- Tase (0, 1, 2 - max 3 taset)
  -- Seaded
  display_fields TEXT[] DEFAULT ARRAY['assembly_mark', 'cast_unit_weight'],  -- Kuvatavad väljad
  sort_by TEXT DEFAULT 'assembly_mark',        -- Sortimise väli
  sort_direction TEXT DEFAULT 'asc' CHECK (sort_direction IN ('asc', 'desc')),
  is_expanded BOOLEAN DEFAULT true,            -- Kas grupp on lahti
  -- Audit väljad
  created_by TEXT NOT NULL,                    -- Kasutaja email
  created_by_name TEXT,                        -- Kasutaja nimi
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Grupi elemendid (detailid)
CREATE TABLE IF NOT EXISTS organizer_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trimble_project_id TEXT NOT NULL,            -- Trimble Connect project ID
  group_id UUID NOT NULL REFERENCES organizer_groups(id) ON DELETE CASCADE,
  -- Trimble Connect identifikaatorid
  model_id TEXT,
  guid TEXT NOT NULL,
  guid_ifc TEXT,
  guid_ms TEXT,
  object_runtime_id INTEGER,
  -- Objekti info
  assembly_mark TEXT NOT NULL,
  product_name TEXT,
  file_name TEXT,
  cast_unit_weight TEXT,
  cast_unit_position_code TEXT,
  cast_unit_bottom_elevation TEXT,
  cast_unit_top_elevation TEXT,
  object_type TEXT,
  -- Positsioon grupis
  sort_order INTEGER DEFAULT 0,
  -- Märkused
  notes TEXT,
  -- Audit väljad
  added_by TEXT NOT NULL,                      -- Kes lisas
  added_by_name TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Unikaalsus: sama GUID ei saa olla samas grupis
  UNIQUE(group_id, guid)
);

-- Ajalugu (kõik muudatused)
CREATE TABLE IF NOT EXISTS organizer_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trimble_project_id TEXT NOT NULL,
  -- Viited
  group_id UUID REFERENCES organizer_groups(id) ON DELETE SET NULL,
  item_id UUID REFERENCES organizer_items(id) ON DELETE SET NULL,
  -- Muudatuse tüüp
  action_type TEXT NOT NULL CHECK (action_type IN (
    'group_created', 'group_updated', 'group_deleted', 'group_moved',
    'item_added', 'item_removed', 'item_moved', 'items_bulk_add', 'items_bulk_remove'
  )),
  -- Muudatuse info
  old_value JSONB,                             -- Vana väärtus
  new_value JSONB,                             -- Uus väärtus
  affected_count INTEGER,                      -- Mitu elementi mõjutati
  -- Audit
  changed_by TEXT NOT NULL,
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kommentaarid gruppidele
CREATE TABLE IF NOT EXISTS organizer_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trimble_project_id TEXT NOT NULL,
  group_id UUID REFERENCES organizer_groups(id) ON DELETE CASCADE,
  item_id UUID REFERENCES organizer_items(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Vähemalt üks viide peab olema
  CHECK (group_id IS NOT NULL OR item_id IS NOT NULL)
);

-- Indeksid
CREATE INDEX IF NOT EXISTS idx_organizer_groups_project ON organizer_groups(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_organizer_groups_parent ON organizer_groups(parent_id);
CREATE INDEX IF NOT EXISTS idx_organizer_items_project ON organizer_items(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_organizer_items_group ON organizer_items(group_id);
CREATE INDEX IF NOT EXISTS idx_organizer_items_guid ON organizer_items(guid);
CREATE INDEX IF NOT EXISTS idx_organizer_items_guid_ifc ON organizer_items(guid_ifc);
CREATE INDEX IF NOT EXISTS idx_organizer_history_project ON organizer_history(trimble_project_id);
CREATE INDEX IF NOT EXISTS idx_organizer_history_group ON organizer_history(group_id);
CREATE INDEX IF NOT EXISTS idx_organizer_history_item ON organizer_history(item_id);

-- Vaade: gruppide statistika
CREATE OR REPLACE VIEW organizer_group_stats AS
SELECT
  g.id,
  g.trimble_project_id,
  g.parent_id,
  g.name,
  g.description,
  g.color,
  g.level,
  g.sort_order,
  g.display_fields,
  g.sort_by,
  g.sort_direction,
  g.is_expanded,
  g.created_by,
  g.created_by_name,
  g.created_at,
  g.updated_by,
  g.updated_at,
  COUNT(DISTINCT i.id)::INTEGER AS item_count,
  COALESCE(SUM(NULLIF(i.cast_unit_weight, '')::NUMERIC), 0)::NUMERIC AS total_weight,
  (SELECT COUNT(*) FROM organizer_groups sg WHERE sg.parent_id = g.id)::INTEGER AS subgroup_count
FROM organizer_groups g
LEFT JOIN organizer_items i ON i.group_id = g.id
GROUP BY g.id;

-- Trigger: uuenda updated_at automaatselt
CREATE OR REPLACE FUNCTION update_organizer_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizer_groups_updated ON organizer_groups;
CREATE TRIGGER organizer_groups_updated
  BEFORE UPDATE ON organizer_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_organizer_timestamp();

DROP TRIGGER IF EXISTS organizer_items_updated ON organizer_items;
CREATE TRIGGER organizer_items_updated
  BEFORE UPDATE ON organizer_items
  FOR EACH ROW
  EXECUTE FUNCTION update_organizer_timestamp();

-- RLS politsies (Row Level Security)
ALTER TABLE organizer_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizer_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizer_comments ENABLE ROW LEVEL SECURITY;

-- Lubame kõigile lugemise ja kirjutamise (anonüümne kasutaja)
DROP POLICY IF EXISTS "Allow all on organizer_groups" ON organizer_groups;
CREATE POLICY "Allow all on organizer_groups" ON organizer_groups FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on organizer_items" ON organizer_items;
CREATE POLICY "Allow all on organizer_items" ON organizer_items FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on organizer_history" ON organizer_history;
CREATE POLICY "Allow all on organizer_history" ON organizer_history FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on organizer_comments" ON organizer_comments;
CREATE POLICY "Allow all on organizer_comments" ON organizer_comments FOR ALL USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON organizer_groups TO anon, authenticated;
GRANT ALL ON organizer_items TO anon, authenticated;
GRANT ALL ON organizer_history TO anon, authenticated;
GRANT ALL ON organizer_comments TO anon, authenticated;
GRANT ALL ON organizer_group_stats TO anon, authenticated;
