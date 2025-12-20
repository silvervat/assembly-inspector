-- ============================================================================
-- TARNE GRAAFIK - KELLAAEG JA KESTUS
-- Lisa see veokite tabelile
-- ============================================================================

-- Lisa uued veerud veokite tabelile
ALTER TABLE trimble_delivery_vehicles
ADD COLUMN IF NOT EXISTS unload_start_time TIME DEFAULT '08:00',
ADD COLUMN IF NOT EXISTS unload_duration_minutes INTEGER DEFAULT 90,
ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Kontrolli tulemust
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'trimble_delivery_vehicles'
ORDER BY ordinal_position;
