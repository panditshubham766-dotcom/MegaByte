CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS auth_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'reset')),
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INT DEFAULT 0,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_otps_email_purpose_created_at ON auth_otps (email, purpose, created_at DESC);

ALTER TABLE auth_otps ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS users_lower_email_idx ON users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_student_id_unique_idx ON users (student_id) WHERE student_id IS NOT NULL;
