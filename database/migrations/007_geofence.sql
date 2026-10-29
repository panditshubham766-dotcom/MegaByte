-- Migration 007: Robust geofencing schema
-- Classrooms: radius_m (default 100, 10-500) and hard_limit_m int (default 300, >= radius_m, max 2000).
-- Set radius_m = 100 for existing rows with radius_m < 50.
-- Attendance sessions: classroom link and location_mode ('STRICT'|'FLAG_ONLY'|'OFF', default 'STRICT').
-- Attendance records: distance_m real, geo_accuracy_m real, location_status ('INSIDE'|'REVIEW'|'UNKNOWN').

DO $$
BEGIN
    -- 1. Classrooms
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'classrooms' AND column_name = 'radius_m'
    ) THEN
        ALTER TABLE classrooms ADD COLUMN radius_m INT DEFAULT 100;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'classrooms' AND column_name = 'radius_meters'
        ) THEN
            UPDATE classrooms SET radius_m = radius_meters WHERE radius_m IS NULL;
        END IF;
    END IF;

    -- Ensure radius_meters default 100 if column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'classrooms' AND column_name = 'radius_meters'
    ) THEN
        ALTER TABLE classrooms ALTER COLUMN radius_meters SET DEFAULT 100;
    END IF;

    -- Set radius_m = 100 for existing rows with radius_m < 50 or null
    UPDATE classrooms
    SET radius_m = 100
    WHERE radius_m IS NULL OR radius_m < 50;

    -- Sync radius_meters if column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'classrooms' AND column_name = 'radius_meters'
    ) THEN
        UPDATE classrooms
        SET radius_meters = radius_m
        WHERE radius_meters IS NULL OR radius_meters < 50;
    END IF;

    ALTER TABLE classrooms ALTER COLUMN radius_m SET DEFAULT 100;

    ALTER TABLE classrooms DROP CONSTRAINT IF EXISTS classrooms_radius_m_check;
    ALTER TABLE classrooms ADD CONSTRAINT classrooms_radius_m_check CHECK (radius_m BETWEEN 10 AND 500);

    -- hard_limit_m
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'classrooms' AND column_name = 'hard_limit_m'
    ) THEN
        ALTER TABLE classrooms ADD COLUMN hard_limit_m INT DEFAULT 300;
    END IF;

    UPDATE classrooms
    SET hard_limit_m = 300
    WHERE hard_limit_m IS NULL OR hard_limit_m < radius_m;

    ALTER TABLE classrooms ALTER COLUMN hard_limit_m SET DEFAULT 300;

    ALTER TABLE classrooms DROP CONSTRAINT IF EXISTS classrooms_hard_limit_m_check;
    ALTER TABLE classrooms ADD CONSTRAINT classrooms_hard_limit_m_check CHECK (hard_limit_m >= radius_m AND hard_limit_m <= 2000);

    -- 2. Attendance Sessions
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance_sessions' AND column_name = 'classroom_id'
    ) THEN
        ALTER TABLE attendance_sessions ADD COLUMN classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance_sessions' AND column_name = 'location_mode'
    ) THEN
        ALTER TABLE attendance_sessions ADD COLUMN location_mode TEXT NOT NULL DEFAULT 'STRICT';
    END IF;

    ALTER TABLE attendance_sessions ALTER COLUMN location_mode SET DEFAULT 'STRICT';
    ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS attendance_sessions_location_mode_check;
    ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_sessions_location_mode_check CHECK (location_mode IN ('STRICT', 'FLAG_ONLY', 'OFF'));

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance_sessions' AND column_name = 'geo_hard_limit_m'
    ) THEN
        ALTER TABLE attendance_sessions ADD COLUMN geo_hard_limit_m INT DEFAULT 300;
    END IF;

    -- 3. Attendance Records
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance_records' AND column_name = 'distance_m'
    ) THEN
        ALTER TABLE attendance_records ADD COLUMN distance_m REAL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance_records' AND column_name = 'geo_accuracy_m'
    ) THEN
        ALTER TABLE attendance_records ADD COLUMN geo_accuracy_m REAL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'attendance_records' AND column_name = 'location_status'
    ) THEN
        ALTER TABLE attendance_records ADD COLUMN location_status TEXT;
    END IF;

    UPDATE attendance_records
    SET distance_m = location_distance_m
    WHERE distance_m IS NULL AND location_distance_m IS NOT NULL;

    UPDATE attendance_records
    SET geo_accuracy_m = location_accuracy_m
    WHERE geo_accuracy_m IS NULL AND location_accuracy_m IS NOT NULL;

    ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_location_status_check;
    ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_location_status_check CHECK (location_status IS NULL OR location_status IN ('INSIDE', 'REVIEW', 'UNKNOWN'));

END $$;
