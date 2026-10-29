-- 013_multiple_subjects.sql
-- Ensure faculty_id on subjects, backfill, and add unique case-insensitive index on upper(code)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'subjects' AND column_name = 'faculty_id'
    ) THEN
        ALTER TABLE subjects ADD COLUMN faculty_id UUID REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Backfill any null faculty_id using session owner or first faculty
UPDATE subjects s
SET faculty_id = COALESCE(
    (SELECT faculty_id FROM attendance_sessions WHERE subject_id = s.id LIMIT 1),
    (SELECT id FROM users WHERE role = 'FACULTY' ORDER BY created_at ASC LIMIT 1)
)
WHERE s.faculty_id IS NULL;

-- Ensure NOT NULL on faculty_id
ALTER TABLE subjects ALTER COLUMN faculty_id SET NOT NULL;

-- Unique case-insensitive index on upper(code)
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_upper_code ON subjects (UPPER(code));
