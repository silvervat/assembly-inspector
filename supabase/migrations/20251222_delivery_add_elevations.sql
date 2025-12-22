-- ============================================================================
-- TARNE GRAAFIK - LISA KÕRGUSED (Elevations)
-- ============================================================================

-- Lisa elevation veerud detailidele
ALTER TABLE trimble_delivery_items
ADD COLUMN IF NOT EXISTS cast_unit_bottom_elevation TEXT,
ADD COLUMN IF NOT EXISTS cast_unit_top_elevation TEXT;

-- Kommentaarid
COMMENT ON COLUMN trimble_delivery_items.cast_unit_bottom_elevation IS 'Bottom elevation from Tekla model (fresh from import)';
COMMENT ON COLUMN trimble_delivery_items.cast_unit_top_elevation IS 'Top elevation from Tekla model (fresh from import)';

-- Kontrolli tulemust
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'trimble_delivery_items'
AND column_name IN ('cast_unit_bottom_elevation', 'cast_unit_top_elevation')
ORDER BY column_name;
