-- ============================================
-- ORGANIZER SYSTEM TABLES
-- Gruppide haldamine ja organiseerimine
-- v3.0.315
-- ============================================

-- Drop if exists (for re-running)
DROP TABLE IF EXISTS organizer_group_items;
DROP TABLE IF EXISTS organizer_groups;

-- ============================================
-- ORGANIZER GROUPS TABLE
-- Hierarhilised grupid (max 3 taset)
-- ============================================

CREATE TABLE organizer_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  parent_id UUID REFERENCES organizer_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_private BOOLEAN DEFAULT false,
  allowed_users TEXT[] DEFAULT '{}',  -- Array of user emails who can see private group
  display_properties JSONB DEFAULT '[]',  -- Max 3 properties to display [{set, prop, label}]
  assembly_selection_required BOOLEAN DEFAULT true,
  color JSONB,  -- {r, g, b} for model coloring
  created_by TEXT NOT NULL,  -- User email
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  sort_order INTEGER DEFAULT 0,
  level INTEGER DEFAULT 0 CHECK (level >= 0 AND level <= 2),  -- 0, 1, or 2 (max 3 levels)

  -- Constraints
  CONSTRAINT valid_color CHECK (
    color IS NULL OR (
      (color->>'r')::int BETWEEN 0 AND 255 AND
      (color->>'g')::int BETWEEN 0 AND 255 AND
      (color->>'b')::int BETWEEN 0 AND 255
    )
  )
);

-- Indexes for groups
CREATE INDEX idx_organizer_groups_project ON organizer_groups(trimble_project_id);
CREATE INDEX idx_organizer_groups_parent ON organizer_groups(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_organizer_groups_created_by ON organizer_groups(created_by);
CREATE INDEX idx_organizer_groups_sort ON organizer_groups(trimble_project_id, sort_order);

-- ============================================
-- ORGANIZER GROUP ITEMS TABLE
-- Detailid gruppides
-- ============================================

CREATE TABLE organizer_group_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES organizer_groups(id) ON DELETE CASCADE,
  guid_ifc TEXT NOT NULL,
  assembly_mark TEXT,
  product_name TEXT,
  cast_unit_weight TEXT,
  cast_unit_position_code TEXT,
  custom_properties JSONB DEFAULT '{}',  -- Dynamic property values
  added_by TEXT NOT NULL,  -- User email
  added_at TIMESTAMPTZ DEFAULT NOW(),
  sort_order INTEGER DEFAULT 0,
  notes TEXT,

  -- Each GUID can only be in one group (within same project via group)
  UNIQUE(group_id, guid_ifc)
);

-- Indexes for group items
CREATE INDEX idx_organizer_items_group ON organizer_group_items(group_id);
CREATE INDEX idx_organizer_items_guid ON organizer_group_items(guid_ifc);
CREATE INDEX idx_organizer_items_sort ON organizer_group_items(group_id, sort_order);
CREATE INDEX idx_organizer_items_mark ON organizer_group_items(assembly_mark) WHERE assembly_mark IS NOT NULL;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at on groups
CREATE OR REPLACE FUNCTION update_organizer_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_organizer_groups_updated_at
  BEFORE UPDATE ON organizer_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_organizer_groups_updated_at();

-- Validate parent level (ensure max 3 levels)
CREATE OR REPLACE FUNCTION validate_organizer_group_level()
RETURNS TRIGGER AS $$
DECLARE
  parent_level INTEGER;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT level INTO parent_level FROM organizer_groups WHERE id = NEW.parent_id;
    IF parent_level IS NULL THEN
      RAISE EXCEPTION 'Parent group not found';
    END IF;
    NEW.level = parent_level + 1;
    IF NEW.level > 2 THEN
      RAISE EXCEPTION 'Maximum 3 levels allowed (level 0, 1, 2)';
    END IF;
  ELSE
    NEW.level = 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_organizer_group_level
  BEFORE INSERT OR UPDATE ON organizer_groups
  FOR EACH ROW
  EXECUTE FUNCTION validate_organizer_group_level();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE organizer_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizer_group_items ENABLE ROW LEVEL SECURITY;

-- Groups: Allow all (visibility filtered in app by is_private/allowed_users)
CREATE POLICY "Allow all for organizer_groups" ON organizer_groups
  FOR ALL USING (true) WITH CHECK (true);

-- Items: Allow all
CREATE POLICY "Allow all for organizer_group_items" ON organizer_group_items
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- PERMISSIONS
-- ============================================

GRANT ALL ON organizer_groups TO authenticated;
GRANT ALL ON organizer_groups TO anon;
GRANT ALL ON organizer_group_items TO authenticated;
GRANT ALL ON organizer_group_items TO anon;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE organizer_groups IS 'Hierarhilised grupid detailide organiseerimiseks (max 3 taset)';
COMMENT ON TABLE organizer_group_items IS 'Detailid gruppides, seotud IFC GUID-iga';
COMMENT ON COLUMN organizer_groups.level IS '0=peagrupp, 1=alamgrupp, 2=alam-alamgrupp';
COMMENT ON COLUMN organizer_groups.display_properties IS 'Maksimaalselt 3 propertyt kuvamiseks [{set, prop, label}]';
COMMENT ON COLUMN organizer_groups.color IS 'RGB värv mudeli värvimiseks {r, g, b}';
COMMENT ON COLUMN organizer_group_items.custom_properties IS 'Dünaamilised property väärtused';
