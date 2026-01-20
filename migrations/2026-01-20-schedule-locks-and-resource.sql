-- Migration: Add resource field and schedule locks
-- Date: 2026-01-20
-- Description: Adds resource column to installation_schedule_items and creates schedule_locks table

-- 1. Add resource column to installation_schedule_items
ALTER TABLE installation_schedule_items
ADD COLUMN IF NOT EXISTS resource TEXT;

-- 2. Create schedule_locks table for day and month level locking
CREATE TABLE IF NOT EXISTS schedule_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trimble_project_id TEXT NOT NULL,
  version_id UUID,  -- Optional: lock specific to version
  lock_type TEXT NOT NULL CHECK (lock_type IN ('day', 'month')),
  lock_date DATE NOT NULL,  -- For 'day': the specific date; For 'month': first day of month
  locked_by TEXT NOT NULL,  -- User email who locked
  locked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,  -- Optional reason for locking

  -- Unique constraint: one lock per project+version+type+date
  UNIQUE (trimble_project_id, COALESCE(version_id::TEXT, ''), lock_type, lock_date)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_schedule_locks_project_date
ON schedule_locks(trimble_project_id, lock_date);

CREATE INDEX IF NOT EXISTS idx_schedule_locks_version
ON schedule_locks(version_id);

-- Comments for documentation
COMMENT ON TABLE schedule_locks IS 'Stores day and month level locks for installation schedules';
COMMENT ON COLUMN schedule_locks.lock_type IS 'Type of lock: "day" for specific date, "month" for entire month';
COMMENT ON COLUMN schedule_locks.lock_date IS 'For day locks: exact date. For month locks: first day of that month (YYYY-MM-01)';
COMMENT ON COLUMN schedule_locks.version_id IS 'Optional: if set, lock applies only to that version. If NULL, applies to default/legacy schedule';

-- Example queries:
-- Check if a specific date is locked (day lock):
-- SELECT * FROM schedule_locks
-- WHERE trimble_project_id = 'xxx'
--   AND lock_type = 'day'
--   AND lock_date = '2026-01-15';

-- Check if a month is locked:
-- SELECT * FROM schedule_locks
-- WHERE trimble_project_id = 'xxx'
--   AND lock_type = 'month'
--   AND lock_date = '2026-01-01';

-- Get all locks for a project:
-- SELECT * FROM schedule_locks
-- WHERE trimble_project_id = 'xxx'
-- ORDER BY lock_date DESC;
