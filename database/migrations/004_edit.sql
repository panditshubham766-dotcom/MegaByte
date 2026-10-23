ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS edit_reason TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE attendance_records ALTER COLUMN photo_base64 DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_session_student'
    ) THEN
        ALTER TABLE attendance_records ADD CONSTRAINT unique_session_student UNIQUE (session_id, student_id);
    END IF;
END $$;
