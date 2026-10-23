-- Migration 005: Master Excel per subject
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS master_sheet_path text;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS master_sheet_updated_at timestamptz;

-- Ensure private storage bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('subject-sheets', 'subject-sheets', false)
ON CONFLICT (id) DO NOTHING;
