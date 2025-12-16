-- Uuenda inspections tabel - lisa uued veerud
ALTER TABLE inspections
ADD COLUMN IF NOT EXISTS file_name TEXT,
ADD COLUMN IF NOT EXISTS guid TEXT,
ADD COLUMN IF NOT EXISTS guid_ifc TEXT,
ADD COLUMN IF NOT EXISTS guid_ms TEXT,
ADD COLUMN IF NOT EXISTS object_id TEXT,
ADD COLUMN IF NOT EXISTS cast_unit_bottom_elevation TEXT,
ADD COLUMN IF NOT EXISTS cast_unit_position_code TEXT,
ADD COLUMN IF NOT EXISTS cast_unit_top_elevation TEXT,
ADD COLUMN IF NOT EXISTS cast_unit_weight TEXT,
ADD COLUMN IF NOT EXISTS photo_urls JSONB;

-- Indeksid kiireks otsinguks
CREATE INDEX IF NOT EXISTS idx_inspections_guid ON inspections(guid);
CREATE INDEX IF NOT EXISTS idx_inspections_guid_ifc ON inspections(guid_ifc);
CREATE INDEX IF NOT EXISTS idx_inspections_assembly_mark ON inspections(assembly_mark);
