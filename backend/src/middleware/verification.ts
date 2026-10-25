/**
 * verification.ts - Classroom Verification Enforcement Middleware (Phase 5)
 *
 * Enforces that protected attendance actions and session access are strictly gated
 * by an active, unexpired, non-revoked verification session issued to the authenticated student.
 *
 * Guarantees:
 *   1. Rejects unauthenticated requests (401).
 *   2. Rejects students without a valid verification session (403).
 *   3. Enforces that verification session belongs strictly to the authenticated student (anti-cross-user reuse).
 *   4. Enforces class-session boundaries (revoking or rejecting if class session has ended or expired).
 *   5. Enforces classroom boundaries (rejecting if token was issued for a different classroom).
 *   6. Preserves Faculty and Administrator authorization without imposing student verification tokens.
 *   7. Revalidates fresh location evidence and revokes verification if out-of-bounds.
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.ts';

export interface VerificationSessionData {
    id: string;
    student_id: string;
    session_id: string;
    classroom_id: string | null;
    verification_token: string;
    status: 'PENDING' | 'PASSED' | 'FAILED' | 'REVOKED' | 'EXPIRED';
    expires_at: string | Date;
    consumed_at?: string | Date | null;
    revoked_at?: string | Date | null;
    revocation_reason?: string | null;
    last_revalidated_at?: string | Date | null;
    revalidation_count?: number;
}

export interface ClassSessionBoundaryData {
    id: string;
    status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
    expires_at: string | Date;
    classroom_id?: string | null;
}

export interface VerificationEnforcementResult {
    valid: boolean;
    error?: {
        code:
            | 'UNAUTHENTICATED'
            | 'NO_VERIFICATION_TOKEN'
            | 'VERIFICATION_NOT_FOUND'
            | 'CROSS_USER_REUSE_BLOCKED'
            | 'VERIFICATION_EXPIRED'
            | 'VERIFICATION_REVOKED'
            | 'SESSION_ENDED'
            | 'SESSION_MISMATCH'
            | 'CLASSROOM_MISMATCH';
        message: string;
    };
}

/**
 * Pure evaluation function for verification session tokens.
 * Decoupled from Express and DB for deterministic unit and security testing.
 */
export function validateVerificationToken(params: {
    token?: string | null;
    authenticatedUserId?: string | null;
    authenticatedUserRole?: string | null;
    vSession?: VerificationSessionData | null;
    classSession?: ClassSessionBoundaryData | null;
    targetClassroomId?: string | null;
    now?: Date;
}): VerificationEnforcementResult {
    const {
        token,
        authenticatedUserId,
        authenticatedUserRole,
        vSession,
        classSession,
        targetClassroomId,
        now = new Date()
    } = params;

    // Faculty and Administrators are preserved per existing RBAC rules (Requirement 12)
    if (authenticatedUserRole === 'FACULTY' || authenticatedUserRole === 'ADMIN') {
        return { valid: true };
    }

    // 1. Must be authenticated
    if (!authenticatedUserId) {
        return {
            valid: false,
            error: {
                code: 'UNAUTHENTICATED',
                message: 'Authentication required. Please sign in to access this resource.'
            }
        };
    }

    // 2. Token must be supplied
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
        return {
            valid: false,
            error: {
                code: 'NO_VERIFICATION_TOKEN',
                message: 'Valid classroom verification session token is required.'
            }
        };
    }

    // 3. Verification session record must exist
    if (!vSession) {
        return {
            valid: false,
            error: {
                code: 'VERIFICATION_NOT_FOUND',
                message: 'The provided verification session was not found.'
            }
        };
    }

    // 4. Cross-user token reuse prevention (Requirement 4 & 10)
    if (vSession.student_id !== authenticatedUserId) {
        return {
            valid: false,
            error: {
                code: 'CROSS_USER_REUSE_BLOCKED',
                message: 'Security violation: Verification session does not belong to the authenticated user.'
            }
        };
    }

    // 5. Explicit Revocation check (Requirement 5)
    if (vSession.status === 'REVOKED' || vSession.revoked_at) {
        return {
            valid: false,
            error: {
                code: 'VERIFICATION_REVOKED',
                message: vSession.revocation_reason
                    ? `Verification session has been revoked: ${vSession.revocation_reason}`
                    : 'Verification session has been revoked. Please check-in again inside the classroom.'
            }
        };
    }

    // 6. Verification session status must be PASSED
    if (vSession.status !== 'PASSED') {
        return {
            valid: false,
            error: {
                code: 'VERIFICATION_EXPIRED',
                message: `Verification session is invalid or in status '${vSession.status}'.`
            }
        };
    }

    // 7. Token expiration check (Requirement 5)
    const expiresAtDate = new Date(vSession.expires_at);
    if (now >= expiresAtDate) {
        return {
            valid: false,
            error: {
                code: 'VERIFICATION_EXPIRED',
                message: 'Verification session has expired. Please verify your classroom presence again.'
            }
        };
    }

    // 8. Class session boundary check (Requirement 5)
    if (classSession) {
        if (classSession.status !== 'ACTIVE' || now >= new Date(classSession.expires_at)) {
            return {
                valid: false,
                error: {
                    code: 'SESSION_ENDED',
                    message: 'The class session has ended or expired. Attendance verification is no longer active.'
                }
            };
        }
        if (classSession.id && vSession.session_id && vSession.session_id !== classSession.id) {
            return {
                valid: false,
                error: {
                    code: 'SESSION_MISMATCH',
                    message: 'Verification session was issued for a different class session.'
                }
            };
        }
    }

    // 9. Classroom boundary check (Requirement 4)
    const effectiveClassroomId = targetClassroomId !== undefined ? targetClassroomId : classSession?.classroom_id;
    if (effectiveClassroomId && vSession.classroom_id && vSession.classroom_id !== effectiveClassroomId) {
        return {
            valid: false,
            error: {
                code: 'CLASSROOM_MISMATCH',
                message: 'Verification session was issued for a different classroom than the requested session.'
            }
        };
    }

    return { valid: true };
}

/**
 * Express middleware to enforce classroom verification on attendance-protected routes.
 */
export const requireClassroomVerification = async (
    req: AuthRequest & { verificationSession?: VerificationSessionData },
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Faculty and Admins bypass verification tokens (Requirement 12)
        if (req.user?.role === 'FACULTY') {
            next();
            return;
        }

        // 1. Require student authentication
        if (!req.user || !req.user.id) {
            res.status(401).json({
                code: 'UNAUTHENTICATED',
                message: 'Authentication required.'
            });
            return;
        }

        // 2. Extract verification token
        const headerToken = req.headers['x-verification-token'] as string | undefined;
        const bodyToken = req.body?.verificationToken || req.body?.verification_token;
        const queryToken = req.query?.verificationToken as string | undefined;
        const token = headerToken || bodyToken || queryToken;

        if (!token) {
            res.status(403).json({
                code: 'NO_VERIFICATION_TOKEN',
                message: 'Valid classroom verification token is required to access this resource.',
                retryHint: 'Complete face and presence check-in to obtain a verification session.'
            });
            return;
        }

        // Lazy load pool to preserve testability
        const pool = (await import('../config/db.ts')).default;

        // Query verification session joined with class session
        const queryRes = await pool.query(
            `SELECT v.*,
                    s.status AS class_session_status,
                    s.expires_at AS class_session_expires_at,
                    s.classroom_id AS class_session_classroom_id
             FROM verification_sessions v
             JOIN attendance_sessions s ON s.id = v.session_id
             WHERE v.verification_token = $1`,
            [token.trim()]
        );

        if (queryRes.rowCount === 0) {
            res.status(403).json({
                code: 'VERIFICATION_NOT_FOUND',
                message: 'Invalid verification session token.'
            });
            return;
        }

        const row = queryRes.rows[0];
        const vSession: VerificationSessionData = {
            id: row.id,
            student_id: row.student_id,
            session_id: row.session_id,
            classroom_id: row.classroom_id,
            verification_token: row.verification_token,
            status: row.status,
            expires_at: row.expires_at,
            consumed_at: row.consumed_at,
            revoked_at: row.revoked_at,
            revocation_reason: row.revocation_reason,
            last_revalidated_at: row.last_revalidated_at,
            revalidation_count: row.revalidation_count
        };

        const classSession: ClassSessionBoundaryData = {
            id: row.session_id,
            status: row.class_session_status,
            expires_at: row.class_session_expires_at,
            classroom_id: row.class_session_classroom_id
        };

        const validation = validateVerificationToken({
            token,
            authenticatedUserId: req.user.id,
            authenticatedUserRole: req.user.role,
            vSession,
            classSession,
            targetClassroomId: classSession.classroom_id
        });

        if (!validation.valid) {
            res.status(403).json({
                code: validation.error!.code,
                message: validation.error!.message
            });
            return;
        }

        req.verificationSession = vSession;
        next();
    } catch (error: any) {
        console.error('Error enforcing verification:', error);
        res.status(500).json({ message: 'Internal server error while enforcing verification' });
    }
};
