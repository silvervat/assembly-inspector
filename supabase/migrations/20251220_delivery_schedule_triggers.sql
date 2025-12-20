-- ============================================================================
-- TARNE GRAAFIK - TRIGGERID JA VAATED
-- Käivita PÄRAST tabelite loomist
-- ============================================================================

-- 1. VEOKI STATISTIKA TRIGGER
CREATE OR REPLACE FUNCTION update_delivery_vehicle_statistics()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') OR
     (TG_OP = 'UPDATE' AND OLD.vehicle_id IS NOT NULL AND
      (NEW.vehicle_id IS NULL OR OLD.vehicle_id != NEW.vehicle_id)) THEN
    UPDATE trimble_delivery_vehicles
    SET
      item_count = (SELECT COUNT(*) FROM trimble_delivery_items WHERE vehicle_id = OLD.vehicle_id),
      total_weight = (
        SELECT COALESCE(SUM(
          CASE WHEN cast_unit_weight ~ '^[0-9]+\.?[0-9]*$' THEN CAST(cast_unit_weight AS DECIMAL) ELSE 0 END
        ), 0)
        FROM trimble_delivery_items WHERE vehicle_id = OLD.vehicle_id
      ),
      updated_at = NOW()
    WHERE id = OLD.vehicle_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.vehicle_id IS NOT NULL THEN
    UPDATE trimble_delivery_vehicles
    SET
      item_count = (SELECT COUNT(*) FROM trimble_delivery_items WHERE vehicle_id = NEW.vehicle_id),
      total_weight = (
        SELECT COALESCE(SUM(
          CASE WHEN cast_unit_weight ~ '^[0-9]+\.?[0-9]*$' THEN CAST(cast_unit_weight AS DECIMAL) ELSE 0 END
        ), 0)
        FROM trimble_delivery_items WHERE vehicle_id = NEW.vehicle_id
      ),
      updated_at = NOW()
    WHERE id = NEW.vehicle_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_delivery_vehicle_stats ON trimble_delivery_items;
CREATE TRIGGER trigger_update_delivery_vehicle_stats
AFTER INSERT OR UPDATE OF vehicle_id, cast_unit_weight OR DELETE
ON trimble_delivery_items
FOR EACH ROW EXECUTE FUNCTION update_delivery_vehicle_statistics();

-- 2. AJALOO LOGIMINE
CREATE OR REPLACE FUNCTION log_delivery_item_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO trimble_delivery_history (project_id, item_id, vehicle_id, change_type, new_date, new_vehicle_id, new_vehicle_code, new_status, changed_by)
    SELECT NEW.project_id, NEW.id, NEW.vehicle_id, 'created', NEW.scheduled_date, NEW.vehicle_id,
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id), NEW.status, NEW.created_by;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.scheduled_date IS DISTINCT FROM NEW.scheduled_date THEN
    INSERT INTO trimble_delivery_history (project_id, item_id, vehicle_id, change_type, old_date, new_date, old_vehicle_code, new_vehicle_code, changed_by)
    SELECT NEW.project_id, NEW.id, NEW.vehicle_id, 'date_changed', OLD.scheduled_date, NEW.scheduled_date,
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = OLD.vehicle_id),
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id),
      COALESCE(NEW.updated_by, NEW.created_by);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id THEN
    INSERT INTO trimble_delivery_history (project_id, item_id, vehicle_id, change_type, old_vehicle_id, new_vehicle_id, old_vehicle_code, new_vehicle_code, changed_by)
    SELECT NEW.project_id, NEW.id, NEW.vehicle_id, 'vehicle_changed', OLD.vehicle_id, NEW.vehicle_id,
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = OLD.vehicle_id),
      (SELECT vehicle_code FROM trimble_delivery_vehicles WHERE id = NEW.vehicle_id),
      COALESCE(NEW.updated_by, NEW.created_by);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO trimble_delivery_history (project_id, item_id, vehicle_id, change_type, old_status, new_status, changed_by)
    VALUES (NEW.project_id, NEW.id, NEW.vehicle_id, 'status_changed', OLD.status, NEW.status, COALESCE(NEW.updated_by, NEW.created_by));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_delivery_changes ON trimble_delivery_items;
CREATE TRIGGER trigger_log_delivery_changes
AFTER INSERT OR UPDATE ON trimble_delivery_items
FOR EACH ROW EXECUTE FUNCTION log_delivery_item_changes();

-- 3. VEOKI KOODI GENEREERIMINE
CREATE OR REPLACE FUNCTION generate_vehicle_code()
RETURNS TRIGGER AS $$
DECLARE factory_code_val TEXT;
BEGIN
  SELECT factory_code INTO factory_code_val FROM trimble_delivery_factories WHERE id = NEW.factory_id;
  IF factory_code_val IS NOT NULL THEN
    NEW.vehicle_code := factory_code_val || NEW.vehicle_number::TEXT;
  ELSE
    NEW.vehicle_code := 'VEH' || NEW.vehicle_number::TEXT;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generate_vehicle_code ON trimble_delivery_vehicles;
CREATE TRIGGER trigger_generate_vehicle_code
BEFORE INSERT OR UPDATE OF factory_id, vehicle_number ON trimble_delivery_vehicles
FOR EACH ROW EXECUTE FUNCTION generate_vehicle_code();
