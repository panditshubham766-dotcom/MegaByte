-- Migration 007: Multi-subject enrollment & created_at tracking
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'enrollments' AND column_name = 'created_at'
    ) THEN
        ALTER TABLE enrollments ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
        UPDATE enrollments SET created_at = '1970-01-01 00:00:00+00';
    END IF;
END $$;

ALTER TABLE enrollments ALTER COLUMN class_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_student_subject'
    ) THEN
        ALTER TABLE enrollments ADD CONSTRAINT unique_student_subject UNIQUE (student_id, subject_id);
    END IF;
END $$;
