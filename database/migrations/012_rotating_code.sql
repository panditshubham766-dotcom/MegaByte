-- 012_rotating_code.sql
-- Add code_secret to attendance_sessions for rotating TOTP-style codes

ALTER TABLE attendance_sessions
ADD COLUMN IF NOT EXISTS code_secret TEXT DEFAULT gen_random_uuid()::text;

UPDATE attendance_sessions
SET code_secret = gen_random_uuid()::text
WHERE code_secret IS NULL;

ALTER TABLE attendance_sessions
ALTER COLUMN code_secret SET NOT NULL,
ALTER COLUMN code_secret SET DEFAULT gen_random_uuid()::text;
