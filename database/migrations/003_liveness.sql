CREATE TABLE IF NOT EXISTS liveness_challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    action TEXT CHECK (action IN ('TURN_LEFT', 'TURN_RIGHT')),
    expires_at TIMESTAMP WITH TIME ZONE,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE liveness_challenges ENABLE ROW LEVEL SECURITY;

ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS liveness_score REAL;
