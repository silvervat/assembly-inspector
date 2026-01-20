-- ============================================
-- UPDATE RESOURCE TYPES
-- Migration: 20260120_update_resource_types.sql
-- Description: Update resource_type keys to match InstallationScheduleScreen INSTALL_METHODS
-- ============================================

-- Update existing resource types to match installation schedule method keys
UPDATE project_resources SET resource_type = 'forklift' WHERE resource_type = 'telescopic_loader';
UPDATE project_resources SET resource_type = 'poomtostuk' WHERE resource_type = 'boom_lift';
UPDATE project_resources SET resource_type = 'kaartostuk' WHERE resource_type = 'scissor_lift';
UPDATE project_resources SET resource_type = 'troppija' WHERE resource_type = 'rigger';
UPDATE project_resources SET resource_type = 'monteerija' WHERE resource_type = 'installer';
UPDATE project_resources SET resource_type = 'keevitaja' WHERE resource_type = 'welder';

-- Update unique constraint to reflect new keys
ALTER TABLE project_resources DROP CONSTRAINT IF EXISTS project_resources_trimble_project_id_resource_type_name_key;
ALTER TABLE project_resources ADD CONSTRAINT project_resources_trimble_project_id_resource_type_name_key
  UNIQUE(trimble_project_id, resource_type, name);

-- Update comment to reflect new resource types
COMMENT ON COLUMN project_resources.resource_type IS 'Ressursi tüüp: crane, forklift, manual, poomtostuk, kaartostuk, troppija, monteerija, keevitaja (vastab paigaldusgraafiku INSTALL_METHODS võtmetele)';
