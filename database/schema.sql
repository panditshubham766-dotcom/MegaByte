CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('FACULTY', 'STUDENT')),
    student_id VARCHAR(100),
    face_embedding JSONB,
    face_enrolled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) NOT NULL,
    faculty_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    master_sheet_path TEXT,
    master_sheet_updated_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    department VARCHAR(255) NOT NULL,
    semester INT NOT NULL,
    section VARCHAR(50) NOT NULL
);

CREATE TABLE enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_student_subject UNIQUE (student_id, subject_id)
);

CREATE TABLE classrooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    building VARCHAR(255),
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    radius_meters INT NOT NULL DEFAULT 100 CHECK (radius_meters BETWEEN 1 AND 5000),
    max_accuracy_meters INT NOT NULL DEFAULT 30 CHECK (max_accuracy_meters BETWEEN 1 AND 500),
    verification_policy VARCHAR(50) NOT NULL DEFAULT 'GPS_ONLY' CHECK (verification_policy IN ('GPS_ONLY', 'WIFI_ONLY', 'GPS_OR_WIFI', 'GPS_AND_WIFI')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE classroom_access_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    bssid VARCHAR(17) NOT NULL,
    ssid VARCHAR(255),
    description VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_classroom_bssid UNIQUE (classroom_id, bssid)
);

CREATE TABLE attendance_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
    random_code VARCHAR(10) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('ACTIVE', 'ENDED', 'EXPIRED')),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    photo_base64 TEXT,
    face_match_score REAL,
    liveness_score REAL,
    location_lat DOUBLE PRECISION,
    location_lon DOUBLE PRECISION,
    location_accuracy_m REAL,
    location_distance_m REAL,
    location_verified BOOLEAN DEFAULT FALSE,
    location_ts TIMESTAMP WITH TIME ZONE,
    wifi_bssid VARCHAR(17),
    wifi_ssid VARCHAR(255),
    wifi_verified BOOLEAN DEFAULT FALSE,
    wifi_verification_status VARCHAR(50),
    verification_session_id UUID REFERENCES verification_sessions(id) ON DELETE SET NULL,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    edit_reason TEXT,
    edited_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_session_student UNIQUE (session_id, student_id)
);

CREATE TABLE verification_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
    verification_token VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING', 'PASSED', 'FAILED', 'REVOKED', 'EXPIRED')),
    results JSONB NOT NULL,
    face_match_score REAL,
    liveness_score REAL,
    location_distance_m REAL,
    wifi_verified BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revocation_reason VARCHAR(255),
    last_revalidated_at TIMESTAMP WITH TIME ZONE,
    revalidation_count INT DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE liveness_challenges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    action TEXT CHECK (action IN ('TURN_LEFT', 'TURN_RIGHT')),
    location_lat DOUBLE PRECISION,
    location_lon DOUBLE PRECISION,
    location_accuracy_m REAL,
    location_distance_m REAL,
    location_verified BOOLEAN DEFAULT FALSE,
    location_ts TIMESTAMP WITH TIME ZONE,
    wifi_bssid VARCHAR(17),
    wifi_ssid VARCHAR(255),
    wifi_verified BOOLEAN DEFAULT FALSE,
    wifi_verification_status VARCHAR(50),
    expires_at TIMESTAMP WITH TIME ZONE,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE student_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_uuid VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    CONSTRAINT unique_student_device UNIQUE (student_id, device_uuid)
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    attendance_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE liveness_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_access_points ENABLE ROW LEVEL SECURITY;

CREATE TABLE session_exports (
    session_id UUID PRIMARY KEY REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    faculty_id UUID REFERENCES users(id) ON DELETE CASCADE,
    file BYTEA,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE session_exports ENABLE ROW LEVEL SECURITY;

CREATE TABLE auth_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'reset')),
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INT DEFAULT 0,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auth_otps_email_purpose_created_at ON auth_otps (email, purpose, created_at DESC);

ALTER TABLE auth_otps ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX users_lower_email_idx ON users (LOWER(email));
CREATE UNIQUE INDEX users_student_id_unique_idx ON users (student_id) WHERE student_id IS NOT NULL;


