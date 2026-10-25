-- Migration 008: Verification Sessions and Integrated Verification Workflow (Phase 4)
-- Creates short-lived server-controlled verification sessions to link
-- student identity, active class session, classroom presence, and face recognition.

CREATE TABLE IF NOT EXISTS verification_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
    verification_token VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING', 'PASSED', 'FAILED')),
    results JSONB NOT NULL,
    face_match_score REAL,
    liveness_score REAL,
    location_distance_m REAL,
    wifi_verified BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick lookup and expiration sweep
CREATE INDEX IF NOT EXISTS idx_verification_sessions_token ON verification_sessions(verification_token);
CREATE INDEX IF NOT EXISTS idx_verification_sessions_student_session ON verification_sessions(student_id, session_id);
CREATE INDEX IF NOT EXISTS idx_verification_sessions_expires_at ON verification_sessions(expires_at);

-- Link attendance_records with the authoritative verification session
ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS verification_session_id UUID REFERENCES verification_sessions(id) ON DELETE SET NULL;

-- Enable Row Level Security (RLS) on verification_sessions
ALTER TABLE verification_sessions ENABLE ROW LEVEL SECURITY;

-- Students can read their own verification sessions
CREATE POLICY student_read_own_verification_sessions
ON verification_sessions
FOR SELECT
TO authenticated
USING (student_id = auth.uid());

-- Faculty and Admins can view verification sessions for their sessions
CREATE POLICY faculty_read_verification_sessions
ON verification_sessions
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM attendance_sessions s
        WHERE s.id = verification_sessions.session_id
          AND s.faculty_id = auth.uid()
    )
);
