-- Migration 007: Wi-Fi Access Point (BSSID) verification
-- Associates approved BSSIDs with classrooms and adds presence verification policies.

-- 1. Extend classrooms with configurable verification policy
-- Policies:
--   'GPS_ONLY': Only GPS geofencing is enforced (default).
--   'WIFI_ONLY': Only Wi-Fi BSSID verification is enforced (e.g. basement labs).
--   'GPS_OR_WIFI': Valid GPS OR approved Wi-Fi BSSID satisfies presence check.
--   'GPS_AND_WIFI': Both valid GPS AND approved Wi-Fi BSSID are required.
ALTER TABLE classrooms
    ADD COLUMN IF NOT EXISTS verification_policy VARCHAR(50) NOT NULL DEFAULT 'GPS_ONLY'
        CHECK (verification_policy IN ('GPS_ONLY', 'WIFI_ONLY', 'GPS_OR_WIFI', 'GPS_AND_WIFI'));

-- 2. Approved Wi-Fi Access Points table
-- Maps approved hardware BSSIDs to classrooms.
-- Router passwords / credentials are NEVER stored here or exposed to clients.
CREATE TABLE IF NOT EXISTS classroom_access_points (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    classroom_id  UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    -- Normalized canonical BSSID (format: XX:XX:XX:XX:XX:XX)
    bssid         VARCHAR(17) NOT NULL,
    ssid          VARCHAR(255),
    description   VARCHAR(255),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_classroom_bssid UNIQUE (classroom_id, bssid)
);

ALTER TABLE classroom_access_points ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_classroom_access_points_classroom_id
    ON classroom_access_points (classroom_id);

CREATE INDEX IF NOT EXISTS idx_classroom_access_points_bssid
    ON classroom_access_points (bssid)
    WHERE is_active = TRUE;

-- 3. Audit columns on liveness_challenges
ALTER TABLE liveness_challenges
    ADD COLUMN IF NOT EXISTS wifi_bssid               VARCHAR(17),
    ADD COLUMN IF NOT EXISTS wifi_ssid                VARCHAR(255),
    ADD COLUMN IF NOT EXISTS wifi_verified            BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS wifi_verification_status VARCHAR(50);

-- 4. Audit columns on attendance_records
ALTER TABLE attendance_records
    ADD COLUMN IF NOT EXISTS wifi_bssid               VARCHAR(17),
    ADD COLUMN IF NOT EXISTS wifi_ssid                VARCHAR(255),
    ADD COLUMN IF NOT EXISTS wifi_verified            BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS wifi_verification_status VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_attendance_records_wifi_verified
    ON attendance_records (wifi_verified)
    WHERE wifi_verified IS NOT NULL;
