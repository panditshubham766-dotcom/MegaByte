-- Migration 008: Add session anchor columns to attendance_sessions
-- Faculty laptop live location anchor for 100m proximity verification

ALTER TABLE attendance_sessions
    ADD COLUMN IF NOT EXISTS anchor_lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS anchor_lng DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS anchor_accuracy_m REAL,
    ADD COLUMN IF NOT EXISTS anchor_updated_at TIMESTAMPTZ;
