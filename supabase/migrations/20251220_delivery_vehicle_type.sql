-- ============================================================================
-- TARNE GRAAFIK - VEOKI TÜÜBID
-- ============================================================================

-- Lisa vehicle_type veerg
ALTER TABLE trimble_delivery_vehicles
ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT 'haagis';

-- Kontrolli tulemust
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'trimble_delivery_vehicles'
AND column_name = 'vehicle_type';
