-- ============================================
-- Add vehicle_separator to factories (v3.0.44)
-- ============================================

-- Add vehicle_separator column to factories table
ALTER TABLE trimble_delivery_factories
ADD COLUMN IF NOT EXISTS vehicle_separator TEXT DEFAULT '' NOT NULL;

-- Comment
COMMENT ON COLUMN trimble_delivery_factories.vehicle_separator IS 'Separator between factory code and vehicle number (e.g., ".", ",", "|", or empty)';
