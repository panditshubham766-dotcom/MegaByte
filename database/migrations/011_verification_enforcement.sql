-- Migration 009: Verification Enforcement, Revalidation and Revocation (Phase 5)
-- Expands verification_sessions to track revocation, revalidation, and class boundaries.

ALTER TABLE verification_sessions
DROP CONSTRAINT IF EXISTS verification_sessions_status_check;

ALTER TABLE verification_sessions
ADD CONSTRAINT verification_sessions_status_check
CHECK (status IN ('PENDING', 'PASSED', 'FAILED', 'REVOKED', 'EXPIRED'));

ALTER TABLE verification_sessions
ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS revocation_reason VARCHAR(255),
ADD COLUMN IF NOT EXISTS last_revalidated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS revalidation_count INT DEFAULT 0;

-- Index for revalidation lookup
CREATE INDEX IF NOT EXISTS idx_verification_sessions_active_status
ON verification_sessions(status, expires_at);
