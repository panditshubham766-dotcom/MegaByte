-- Migration 006: GPS-based classroom geofencing
-- Adds physical classroom entities and associates them with attendance sessions.
-- attendance_records gains location columns for audit purposes.

-- ─── Classrooms Table ────────────────────────────────────────────────────────
-- Each row represents a physical room / lecture hall.
-- Coordinates must be set by an admin or faculty; they are NEVER trusted from
-- a student client. Only server-side Haversine distance is authoritative.
CREATE TABLE IF NOT EXISTS classrooms (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(255) NOT NULL,
    building      VARCHAR(255),
    latitude      DOUBLE PRECISION NOT NULL
                      CHECK (latitude  BETWEEN -90  AND 90),
    longitude     DOUBLE PRECISION NOT NULL
                      CHECK (longitude BETWEEN -180 AND 180),
    -- Geofence radius in metres (default 100 m; configurable per room).
    radius_meters INT  NOT NULL DEFAULT 100
                      CHECK (radius_meters BETWEEN 1 AND 5000),
    -- Maximum acceptable GPS accuracy the student device must report (metres).
    -- Readings coarser than this value are rejected even if they land inside
    -- the radius, to prevent trivially spoofed low-accuracy coordinates.
    max_accuracy_meters INT NOT NULL DEFAULT 30
                      CHECK (max_accuracy_meters BETWEEN 1 AND 500),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;

-- ─── Associate sessions with optional classroom ───────────────────────────────
-- NULL means geofencing is disabled for that session (backward-compatible).
ALTER TABLE attendance_sessions
    ADD COLUMN IF NOT EXISTS classroom_id UUID
        REFERENCES classrooms(id) ON DELETE SET NULL;

-- ─── Store verified location on liveness challenge ──────────────────────────
-- Saved when challenge is requested with verified location
ALTER TABLE liveness_challenges
    ADD COLUMN IF NOT EXISTS location_lat        DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS location_lon        DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS location_accuracy_m REAL,
    ADD COLUMN IF NOT EXISTS location_distance_m REAL,
    ADD COLUMN IF NOT EXISTS location_verified   BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS location_ts         TIMESTAMP WITH TIME ZONE;

-- ─── Store verified location on each attendance record ────────────────────────
-- These columns are written ONLY by the backend after server-side validation.
-- Clients must never be trusted to set location_verified = true.
ALTER TABLE attendance_records
    ADD COLUMN IF NOT EXISTS location_lat        DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS location_lon        DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS location_accuracy_m REAL,
    ADD COLUMN IF NOT EXISTS location_distance_m REAL,
    ADD COLUMN IF NOT EXISTS location_verified   BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS location_ts         TIMESTAMP WITH TIME ZONE;

-- Index for analytical queries on location data
CREATE INDEX IF NOT EXISTS idx_attendance_records_location_verified
    ON attendance_records (location_verified)
    WHERE location_verified IS NOT NULL;

-- Index to look up sessions by classroom
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_classroom_id
    ON attendance_sessions (classroom_id)
    WHERE classroom_id IS NOT NULL;
