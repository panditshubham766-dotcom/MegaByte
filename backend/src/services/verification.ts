/**
 * verification.ts - Integrated Verification Workflow (Phase 4)
 *
 * Coordinates:
 *   1. Authenticated Student Identity & Face Enrollment check.
 *   2. Active Class Session & Classroom Eligibility check.
 *   3. Fresh GPS Evidence & Geofence Validation (Phase 2).
 *   4. Wi-Fi AP Verification & Verification Policy Enforcement (Phase 3).
 *   5. Face Recognition & Liveness Verification (Reusing existing Human AI pipeline).
 *   6. Short-Lived Server-Controlled Verification Sessions.
 *   7. Privacy-Preserving Audit Logging (No unnecessary face images or precise location tracks).
 */

import crypto from 'crypto';

/**
 * Calculates cosine similarity between two face embedding vectors.
 * Equivalent to Human's humanFull.match.similarity().
 */
export function computeCosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function getVerificationMatchThreshold(): number {
    const envVal = process.env.FACE_MATCH_THRESHOLD;
    if (envVal) {
        const parsed = parseFloat(envVal);
        if (!isNaN(parsed)) return parsed;
    }
    return 0.6;
}

export function getVerificationLivenessMinScore(): number {
    const envVal = process.env.LIVENESS_MIN_SCORE;
    if (envVal) {
        const parsed = parseFloat(envVal);
        if (!isNaN(parsed)) return parsed;
    }
    return 0.5;
}
import {
    validateLocation,
    validateClientLocationShape,
    type ClientLocation,
    type ClassroomConfig,
    type GeoValidationResult
} from './geo.ts';
import {
    validateWifiPresence,
    evaluateCombinedPresence,
    normalizeBssid,
    type ClientWifiEvidence,
    type ClassroomAccessPoint,
    type VerificationPolicy,
    type WifiValidationResult,
    type CombinedPresenceResult
} from './wifi.ts';

export interface StudentIdentityResult {
    verified: boolean;
    studentId: string; // Authenticated user ID (UUID)
    schoolStudentId?: string; // e.g. "STU1001"
    name?: string;
    email?: string;
    hasEnrolledFace: boolean;
    error?: {
        code: string;
        message: string;
    };
}

export interface SessionEligibilityResult {
    verified: boolean;
    sessionId?: string;
    subjectId?: string;
    subjectName?: string;
    classId?: string;
    className?: string;
    classroomId?: string | null;
    classroomName?: string | null;
    classroomConfig?: ClassroomConfig | null;
    verificationPolicy: VerificationPolicy;
    isEnrolled: boolean;
    alreadySubmitted: boolean;
    error?: {
        code: string;
        message: string;
    };
}

export interface GeofenceVerificationResult {
    required: boolean;
    verified: boolean;
    distanceMeters?: number | null;
    accuracyMeters?: number | null;
    timestamp?: string | null;
    error?: {
        code: string;
        message: string;
        retryHint: string;
    };
}

export interface WifiVerificationDetails {
    required: boolean;
    verified: boolean;
    bssid?: string | null;
    ssid?: string | null;
    status: string;
    error?: {
        code: string;
        message: string;
        retryHint: string;
    };
}

export interface FaceVerificationResult {
    verified: boolean;
    faceMatchScore?: number;
    livenessScore?: number;
    threshold: number;
    livenessThreshold: number;
    frontalFrameIndex?: number;
    error?: {
        code: string;
        message: string;
    };
}

export interface VerificationResultBreakdown {
    studentIdentity: StudentIdentityResult;
    sessionEligibility: SessionEligibilityResult;
    geofenceValidation: GeofenceVerificationResult;
    wifiVerification: WifiVerificationDetails;
    faceRecognition: FaceVerificationResult;
    overallStatus: 'PASSED' | 'FAILED';
    errorCode?: string;
    errorMessage?: string;
    retryHint?: string;
    verificationToken?: string;
    verificationSessionId?: string;
}

/**
 * Pure function: Evaluates whether student identity and face enrollment are valid.
 * Strictly checks that the recognized target matches authenticated identity.
 */
export function evaluateStudentIdentity(params: {
    authenticatedStudentId: string;
    userRecord: {
        id: string;
        name: string;
        email: string;
        role: string;
        student_id?: string;
        face_embedding?: any;
    } | null;
    claimedStudentId?: string; // If client sent an explicit student_id override
}): StudentIdentityResult {
    const { authenticatedStudentId, userRecord, claimedStudentId } = params;

    // Detect identity substitution attempt
    if (claimedStudentId && claimedStudentId !== authenticatedStudentId) {
        return {
            verified: false,
            studentId: authenticatedStudentId,
            hasEnrolledFace: false,
            error: {
                code: 'IDENTITY_SUBSTITUTION_REJECTED',
                message: 'Submitted student identity does not match authenticated credentials.'
            }
        };
    }

    if (!userRecord || userRecord.id !== authenticatedStudentId) {
        return {
            verified: false,
            studentId: authenticatedStudentId,
            hasEnrolledFace: false,
            error: {
                code: 'STUDENT_NOT_FOUND',
                message: 'Authenticated student user could not be found.'
            }
        };
    }

    if (userRecord.role !== 'STUDENT') {
        return {
            verified: false,
            studentId: authenticatedStudentId,
            hasEnrolledFace: false,
            error: {
                code: 'INVALID_ROLE',
                message: 'Only registered students may submit attendance.'
            }
        };
    }

    const hasFace = Boolean(userRecord.face_embedding);
    if (!hasFace) {
        return {
            verified: false,
            studentId: authenticatedStudentId,
            schoolStudentId: userRecord.student_id,
            name: userRecord.name,
            email: userRecord.email,
            hasEnrolledFace: false,
            error: {
                code: 'FACE_NOT_ENROLLED',
                message: 'Face biometrics have not been enrolled for this student.'
            }
        };
    }

    return {
        verified: true,
        studentId: authenticatedStudentId,
        schoolStudentId: userRecord.student_id,
        name: userRecord.name,
        email: userRecord.email,
        hasEnrolledFace: true
    };
}

/**
 * Pure function: Evaluates student enrollment and active session status.
 */
export function evaluateSessionEligibility(params: {
    sessionRow: any | null;
    isEnrolledInSubject: boolean;
    hasPriorSubmission: boolean;
}): SessionEligibilityResult {
    const { sessionRow, isEnrolledInSubject, hasPriorSubmission } = params;

    if (!sessionRow) {
        return {
            verified: false,
            verificationPolicy: 'GPS_ONLY',
            isEnrolled: false,
            alreadySubmitted: false,
            error: {
                code: 'SESSION_INVALID',
                message: 'The requested attendance session is invalid, inactive, or has expired.'
            }
        };
    }

    if (sessionRow.status !== 'ACTIVE' || new Date(sessionRow.expires_at) <= new Date()) {
        return {
            verified: false,
            sessionId: sessionRow.id,
            verificationPolicy: sessionRow.verification_policy || 'GPS_ONLY',
            isEnrolled: isEnrolledInSubject,
            alreadySubmitted: hasPriorSubmission,
            error: {
                code: 'SESSION_EXPIRED',
                message: 'This attendance session has ended or expired.'
            }
        };
    }

    if (hasPriorSubmission) {
        return {
            verified: false,
            sessionId: sessionRow.id,
            verificationPolicy: sessionRow.verification_policy || 'GPS_ONLY',
            isEnrolled: isEnrolledInSubject,
            alreadySubmitted: true,
            error: {
                code: 'ALREADY_SUBMITTED',
                message: 'Attendance has already been submitted for this session.'
            }
        };
    }

    if (!isEnrolledInSubject) {
        return {
            verified: false,
            sessionId: sessionRow.id,
            verificationPolicy: sessionRow.verification_policy || 'GPS_ONLY',
            isEnrolled: false,
            alreadySubmitted: false,
            error: {
                code: 'NOT_ENROLLED',
                message: 'You are not enrolled in the subject/class for this session.'
            }
        };
    }

    let classroomConfig: ClassroomConfig | null = null;
    if (sessionRow.classroom_id) {
        classroomConfig = {
            id: sessionRow.classroom_id,
            name: sessionRow.classroom_name,
            latitude: Number(sessionRow.classroom_lat),
            longitude: Number(sessionRow.classroom_lon),
            radius_meters: Number(sessionRow.radius_meters),
            max_accuracy_meters: Number(sessionRow.max_accuracy_meters)
        };
    }

    return {
        verified: true,
        sessionId: sessionRow.id,
        subjectId: sessionRow.subject_id,
        subjectName: sessionRow.subject_name,
        classId: sessionRow.class_id,
        className: sessionRow.class_name,
        classroomId: sessionRow.classroom_id,
        classroomName: sessionRow.classroom_name,
        classroomConfig,
        verificationPolicy: (sessionRow.verification_policy as VerificationPolicy) || 'GPS_ONLY',
        isEnrolled: true,
        alreadySubmitted: false
    };
}

/**
 * Pure function: Compares extracted embedding against enrolled embeddings.
 * Never trusts client-supplied faceVerified booleans.
 */
export function matchEnrolledFace(params: {
    probeEmbedding: number[];
    storedEmbeddingRaw: any;
    clientFaceVerifiedFlag?: boolean;
    minLivenessScore?: number;
    probeRealScore?: number;
    probeLiveScore?: number;
}): FaceVerificationResult {
    const {
        probeEmbedding,
        storedEmbeddingRaw,
        clientFaceVerifiedFlag,
        minLivenessScore = getVerificationLivenessMinScore(),
        probeRealScore = 1.0,
        probeLiveScore = 1.0
    } = params;

    const threshold = getVerificationMatchThreshold();
    const livenessScore = Math.min(probeRealScore, probeLiveScore);

    // Check liveness score first
    if (livenessScore < minLivenessScore) {
        return {
            verified: false,
            faceMatchScore: 0,
            livenessScore,
            threshold,
            livenessThreshold: minLivenessScore,
            error: {
                code: 'LIVENESS_FAILED',
                message: `Liveness score (${livenessScore.toFixed(2)}) is below required threshold (${minLivenessScore}).`
            }
        };
    }

    // Parse enrolled embeddings (supports number[] and number[][])
    let storedEmbeddings: number[][] = [];
    try {
        const parsed = typeof storedEmbeddingRaw === 'string' ? JSON.parse(storedEmbeddingRaw) : storedEmbeddingRaw;
        if (Array.isArray(parsed) && parsed.length > 0) {
            if (typeof parsed[0] === 'number') {
                storedEmbeddings = [parsed as number[]];
            } else if (Array.isArray(parsed[0])) {
                storedEmbeddings = parsed as number[][];
            }
        }
    } catch {
        // Parse failure
    }

    if (storedEmbeddings.length === 0) {
        return {
            verified: false,
            threshold,
            livenessThreshold: minLivenessScore,
            error: {
                code: 'FACE_NOT_ENROLLED',
                message: 'No valid enrolled face embeddings found for authenticated student.'
            }
        };
    }

    // Compute best similarity score using cosine similarity
    let highestScore = -1;
    for (const emb of storedEmbeddings) {
        const sim = computeCosineSimilarity(probeEmbedding, emb);
        if (sim > highestScore) {
            highestScore = sim;
        }
    }

    // Client-supplied flag (faceVerified=true) is completely ignored; only highestScore matters
    const verified = highestScore >= threshold;

    if (!verified) {
        return {
            verified: false,
            faceMatchScore: highestScore,
            livenessScore,
            threshold,
            livenessThreshold: minLivenessScore,
            error: {
                code: 'FACE_MISMATCH',
                message: `Face verification failed: photo does not match reference photo (score: ${highestScore.toFixed(2)}, required: ${threshold.toFixed(2)}).`
            }
        };
    }

    return {
        verified: true,
        faceMatchScore: highestScore,
        livenessScore,
        threshold,
        livenessThreshold: minLivenessScore
    };
}

/**
 * Pure function: Combines all verification factors into an authoritative decision.
 */
export function evaluateAllFactors(params: {
    studentIdentity: StudentIdentityResult;
    sessionEligibility: SessionEligibilityResult;
    geofenceResult: GeofenceVerificationResult;
    wifiResult: WifiVerificationDetails;
    faceResult: FaceVerificationResult;
}): VerificationResultBreakdown {
    const {
        studentIdentity,
        sessionEligibility,
        geofenceResult,
        wifiResult,
        faceResult
    } = params;

    // 1. Identity failure
    if (!studentIdentity.verified) {
        return {
            studentIdentity,
            sessionEligibility,
            geofenceValidation: geofenceResult,
            wifiVerification: wifiResult,
            faceRecognition: faceResult,
            overallStatus: 'FAILED',
            errorCode: studentIdentity.error?.code || 'IDENTITY_VERIFICATION_FAILED',
            errorMessage: studentIdentity.error?.message || 'Student identity check failed.'
        };
    }

    // 2. Session / Eligibility failure
    if (!sessionEligibility.verified) {
        return {
            studentIdentity,
            sessionEligibility,
            geofenceValidation: geofenceResult,
            wifiVerification: wifiResult,
            faceRecognition: faceResult,
            overallStatus: 'FAILED',
            errorCode: sessionEligibility.error?.code || 'ELIGIBILITY_CHECK_FAILED',
            errorMessage: sessionEligibility.error?.message || 'Class session eligibility check failed.'
        };
    }

    // 3. Presence Verification Check according to policy
    if (sessionEligibility.classroomId) {
        const policy = sessionEligibility.verificationPolicy;

        const gpsPassed = geofenceResult.verified;
        const wifiPassed = wifiResult.verified;

        let presencePassed = false;
        let presenceError: { code: string; message: string; retryHint: string } | undefined;

        switch (policy) {
            case 'GPS_ONLY':
                presencePassed = gpsPassed;
                if (!gpsPassed) presenceError = geofenceResult.error;
                break;

            case 'WIFI_ONLY':
                presencePassed = wifiPassed;
                if (!wifiPassed) presenceError = wifiResult.error;
                break;

            case 'GPS_OR_WIFI':
                presencePassed = gpsPassed || wifiPassed;
                if (!presencePassed) {
                    presenceError = {
                        code: 'PRESENCE_CHECK_FAILED',
                        message: `Neither GPS geofence nor approved Wi-Fi presence could be verified.`,
                        retryHint: 'Move inside the classroom or connect to the classroom Wi-Fi network and try again.'
                    };
                }
                break;

            case 'GPS_AND_WIFI':
                presencePassed = gpsPassed && wifiPassed;
                if (!presencePassed) {
                    presenceError = !gpsPassed ? geofenceResult.error : wifiResult.error;
                }
                break;
        }

        if (!presencePassed) {
            return {
                studentIdentity,
                sessionEligibility,
                geofenceValidation: geofenceResult,
                wifiVerification: wifiResult,
                faceRecognition: faceResult,
                overallStatus: 'FAILED',
                errorCode: presenceError?.code || 'PRESENCE_CHECK_FAILED',
                errorMessage: presenceError?.message || 'Presence verification failed.',
                retryHint: presenceError?.retryHint
            };
        }
    }

    // 4. Face Recognition Failure
    if (!faceResult.verified) {
        return {
            studentIdentity,
            sessionEligibility,
            geofenceValidation: geofenceResult,
            wifiVerification: wifiResult,
            faceRecognition: faceResult,
            overallStatus: 'FAILED',
            errorCode: faceResult.error?.code || 'FACE_VERIFICATION_FAILED',
            errorMessage: faceResult.error?.message || 'Face recognition check failed.'
        };
    }

    // 5. All passed!
    return {
        studentIdentity,
        sessionEligibility,
        geofenceValidation: geofenceResult,
        wifiVerification: wifiResult,
        faceRecognition: faceResult,
        overallStatus: 'PASSED'
    };
}

/**
 * Creates a short-lived server-controlled verification session token.
 */
export function generateVerificationToken(): string {
    return 'vtok_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Privacy & Audit: Creates an audit event payload without sensitive biometrics or raw coordinates.
 */
export function createVerificationAuditPayload(breakdown: VerificationResultBreakdown) {
    return {
        student_id: breakdown.studentIdentity.studentId,
        session_id: breakdown.sessionEligibility.sessionId,
        classroom_id: breakdown.sessionEligibility.classroomId,
        overall_status: breakdown.overallStatus,
        error_code: breakdown.errorCode,
        policy: breakdown.sessionEligibility.verificationPolicy,
        // Non-sensitive verification metrics:
        face_match_score: breakdown.faceRecognition.faceMatchScore,
        liveness_score: breakdown.faceRecognition.livenessScore,
        location_distance_m: breakdown.geofenceValidation.distanceMeters,
        location_accuracy_m: breakdown.geofenceValidation.accuracyMeters,
        location_verified: breakdown.geofenceValidation.verified,
        wifi_verified: breakdown.wifiVerification.verified,
        wifi_bssid: breakdown.wifiVerification.bssid,
        timestamp: new Date().toISOString()
    };
}

export interface RevalidationResult {
    valid: boolean;
    revoked: boolean;
    reason?: string;
    distanceMeters?: number;
    error?: {
        code: string;
        message: string;
        retryHint?: string;
    };
}

/**
 * Pure function: Evaluates revalidation of fresh location evidence against permitted classroom.
 * If student leaves the classroom area, flags session as revoked with OUT_OF_BOUNDS (Requirement 7).
 */
export function evaluatePresenceRevalidation(params: {
    vSession: {
        id: string;
        student_id: string;
        status: string;
        expires_at: string | Date;
        revoked_at?: string | Date | null;
        classroom_id?: string | null;
    };
    clientLocation?: ClientLocation | null;
    classroomConfig?: ClassroomConfig | null;
    now?: Date;
}): RevalidationResult {
    const { vSession, clientLocation, classroomConfig, now = new Date() } = params;

    // Must not be already revoked
    if (vSession.status === 'REVOKED' || vSession.revoked_at) {
        return {
            valid: false,
            revoked: true,
            reason: 'ALREADY_REVOKED',
            error: {
                code: 'VERIFICATION_REVOKED',
                message: 'Verification session has already been revoked.'
            }
        };
    }

    // Check expiration
    if (now >= new Date(vSession.expires_at)) {
        return {
            valid: false,
            revoked: false,
            reason: 'EXPIRED',
            error: {
                code: 'VERIFICATION_EXPIRED',
                message: 'Verification session has expired.'
            }
        };
    }

    // If no classroom geofence configured, revalidation passes
    if (!classroomConfig) {
        return { valid: true, revoked: false };
    }

    // Require location
    if (!clientLocation) {
        return {
            valid: false,
            revoked: false,
            reason: 'LOCATION_REQUIRED',
            error: {
                code: 'LOCATION_REQUIRED',
                message: 'Fresh location evidence is required for classroom revalidation.'
            }
        };
    }

    const geoResult = validateLocation(clientLocation, classroomConfig, now);
    if (!geoResult.valid) {
        if (geoResult.error?.code === 'OUTSIDE_CLASSROOM') {
            return {
                valid: false,
                revoked: true,
                reason: 'OUT_OF_BOUNDS',
                distanceMeters: geoResult.distanceMeters,
                error: {
                    code: 'PRESENCE_REVOKED',
                    message: `Student left the classroom area (${geoResult.distanceMeters?.toFixed(1)}m from classroom). Verification revoked.`,
                    retryHint: 'Return to the classroom and check-in again.'
                }
            };
        }
        return {
            valid: false,
            revoked: false,
            reason: geoResult.error?.code,
            distanceMeters: geoResult.distanceMeters,
            error: geoResult.error
        };
    }

    return {
        valid: true,
        revoked: false,
        distanceMeters: geoResult.distanceMeters
    };
}

/**
 * Executes the complete end-to-end verification workflow against the live database.
 */
export async function executeLiveVerificationWorkflow(params: {
    authenticatedStudentId: string;
    sessionCode: string;
    clientLocation?: ClientLocation | null;
    clientWifi?: ClientWifiEvidence | null;
    challengeId: string;
    frames: string[];
    claimedStudentId?: string;
    clientFaceVerifiedFlag?: boolean;
}): Promise<VerificationResultBreakdown> {
    const {
        authenticatedStudentId,
        sessionCode,
        clientLocation,
        clientWifi,
        challengeId,
        frames,
        claimedStudentId,
        clientFaceVerifiedFlag
    } = params;

    const pool = (await import('../config/db.ts')).default;
    const { getMatchThreshold, getLivenessMinScore, detectPose, checkFrontalFrame } = await import('./face.ts');

    // 1. Verify Authenticated Student Identity
    const userRes = await pool.query(
        `SELECT id, name, email, role, student_id, face_embedding FROM users WHERE id = $1`,
        [authenticatedStudentId]
    );
    const userRow = userRes.rows[0] || null;

    const studentIdentity = evaluateStudentIdentity({
        authenticatedStudentId,
        userRecord: userRow,
        claimedStudentId
    });

    if (!studentIdentity.verified) {
        return evaluateAllFactors({
            studentIdentity,
            sessionEligibility: { verified: false, verificationPolicy: 'GPS_ONLY', isEnrolled: false, alreadySubmitted: false },
            geofenceResult: { required: false, verified: false },
            wifiResult: { required: false, verified: false, status: 'NOT_REQUIRED' },
            faceResult: { verified: false, threshold: 0.6, livenessThreshold: 0.5 }
        });
    }

    // 2. Query Active Session & Permitted Classroom
    const sessionRes = await pool.query(
        `SELECT s.id, s.subject_id, s.class_id, s.classroom_id, s.status, s.expires_at,
                sub.name AS subject_name,
                cls.name AS class_name,
                c.name AS classroom_name,
                c.latitude AS classroom_lat,
                c.longitude AS classroom_lon,
                c.radius_meters,
                c.max_accuracy_meters,
                c.verification_policy
         FROM attendance_sessions s
         JOIN subjects sub ON sub.id = s.subject_id
         JOIN classes cls ON cls.id = s.class_id
         LEFT JOIN classrooms c ON c.id = s.classroom_id
         WHERE s.random_code = $1`,
        [sessionCode.toUpperCase()]
    );
    const sessionRow = sessionRes.rows[0] || null;

    let isEnrolled = false;
    let hasPriorSubmission = false;

    if (sessionRow) {
        // Check prior submission
        const priorRes = await pool.query(
            `SELECT id FROM attendance_records WHERE session_id = $1 AND student_id = $2`,
            [sessionRow.id, authenticatedStudentId]
        );
        hasPriorSubmission = priorRes.rowCount !== null && priorRes.rowCount > 0;

        // Check subject enrollment
        const enrollRes = await pool.query(
            `SELECT id FROM enrollments WHERE student_id = $1 AND subject_id = $2 LIMIT 1`,
            [authenticatedStudentId, sessionRow.subject_id]
        );
        isEnrolled = enrollRes.rowCount !== null && enrollRes.rowCount > 0;
    }

    const sessionEligibility = evaluateSessionEligibility({
        sessionRow,
        isEnrolledInSubject: isEnrolled,
        hasPriorSubmission
    });

    if (!sessionEligibility.verified) {
        return evaluateAllFactors({
            studentIdentity,
            sessionEligibility,
            geofenceResult: { required: false, verified: false },
            wifiResult: { required: false, verified: false, status: 'NOT_REQUIRED' },
            faceResult: { verified: false, threshold: 0.6, livenessThreshold: 0.5 }
        });
    }

    // 3 & 4. Validate Presence (GPS + Wi-Fi)
    let geofenceResult: GeofenceVerificationResult = { required: false, verified: false };
    let wifiResult: WifiVerificationDetails = { required: false, verified: false, status: 'NOT_REQUIRED' };

    if (sessionEligibility.classroomId && sessionEligibility.classroomConfig) {
        const policy = sessionEligibility.verificationPolicy;
        geofenceResult.required = (policy !== 'WIFI_ONLY');
        wifiResult.required = (policy !== 'GPS_ONLY');

        // Evaluate GPS
        if (clientLocation) {
            const shapeError = validateClientLocationShape(clientLocation);
            if (shapeError) {
                geofenceResult = {
                    required: geofenceResult.required,
                    verified: false,
                    error: {
                        code: shapeError.error.code,
                        message: shapeError.error.message,
                        retryHint: 'Provide valid location coordinates.'
                    }
                };
            } else {
                const geoValidation = validateLocation(clientLocation, sessionEligibility.classroomConfig);
                geofenceResult = {
                    required: geofenceResult.required,
                    verified: geoValidation.valid,
                    distanceMeters: geoValidation.distanceMeters,
                    accuracyMeters: clientLocation.accuracy,
                    timestamp: clientLocation.timestamp,
                    error: geoValidation.error
                };
            }
        } else {
            geofenceResult = {
                required: geofenceResult.required,
                verified: false,
                error: {
                    code: 'LOCATION_REQUIRED',
                    message: 'Location measurement is required to verify classroom geofence.',
                    retryHint: 'Enable location services on your device and try again.'
                }
            };
        }

        // Query active approved access points for this classroom
        const apRes = await pool.query(
            `SELECT id, classroom_id, bssid, ssid, description, is_active
             FROM classroom_access_points
             WHERE classroom_id = $1 AND is_active = TRUE`,
            [sessionEligibility.classroomId]
        );
        const approvedAps: ClassroomAccessPoint[] = apRes.rows;

        const wifiValidation = validateWifiPresence(clientWifi, approvedAps, policy);
        wifiResult = {
            required: wifiResult.required,
            verified: wifiValidation.verified,
            bssid: wifiValidation.matchedBssid || (clientWifi?.bssid ? normalizeBssid(clientWifi.bssid) : null),
            ssid: clientWifi?.ssid?.trim() || null,
            status: wifiValidation.status,
            error: wifiValidation.error
        };
    }

    // Check if presence checks passed before running heavy neural face recognition
    const presenceCheckBeforeFace = evaluateAllFactors({
        studentIdentity,
        sessionEligibility,
        geofenceResult,
        wifiResult,
        faceResult: { verified: true, threshold: 0.6, livenessThreshold: 0.5 } // placeholder to test presence
    });

    if (presenceCheckBeforeFace.overallStatus === 'FAILED') {
        // Record failed audit event
        await logVerificationAudit(presenceCheckBeforeFace);
        return presenceCheckBeforeFace;
    }

    // 5. Atomically Consume Challenge and Perform Face Recognition Pipeline
    const challengeRes = await pool.query(
        `UPDATE liveness_challenges
         SET used_at = NOW()
         WHERE id = $1 AND student_id = $2 AND session_id = $3 AND used_at IS NULL AND expires_at > NOW()
         RETURNING action`,
        [challengeId, authenticatedStudentId, sessionEligibility.sessionId]
    );

    if (challengeRes.rowCount === 0) {
        const failedBreakdown: VerificationResultBreakdown = {
            studentIdentity,
            sessionEligibility,
            geofenceValidation: geofenceResult,
            wifiVerification: wifiResult,
            faceRecognition: {
                verified: false,
                threshold: getMatchThreshold(),
                livenessThreshold: getLivenessMinScore(),
                error: {
                    code: 'CHALLENGE_INVALID',
                    message: 'Liveness challenge is invalid, expired, or was already used.'
                }
            },
            overallStatus: 'FAILED',
            errorCode: 'CHALLENGE_INVALID',
            errorMessage: 'Liveness challenge is invalid, expired, or was already used.'
        };
        await logVerificationAudit(failedBreakdown);
        return failedBreakdown;
    }

    const requestedAction: 'TURN_LEFT' | 'TURN_RIGHT' = challengeRes.rows[0].action;

    // Run multi-frame pose detection and liveness
    const yaws: number[] = [];
    const frameBuffers: Buffer[] = [];

    for (const frameBase64 of frames) {
        const base64Data = frameBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        const buf = Buffer.from(base64Data, 'base64');
        frameBuffers.push(buf);

        const pose = await detectPose(buf);
        if (pose.faces === 0) {
            const fail = buildFaceFailure('NO_FACE', 'No face detected in one or more frames');
            await logVerificationAudit(fail);
            return fail;
        }
        if (pose.faces > 1) {
            const fail = buildFaceFailure('MULTIPLE_FACES', 'Multiple faces detected in one or more frames');
            await logVerificationAudit(fail);
            return fail;
        }
        yaws.push(pose.yaw);
    }

    // Find frontal frame
    let frontalIdx = 0;
    let minAbsYaw = Math.abs(yaws[0]);
    for (let i = 1; i < yaws.length; i++) {
        const abs = Math.abs(yaws[i]);
        if (abs < minAbsYaw) {
            minAbsYaw = abs;
            frontalIdx = i;
        }
    }

    if (minAbsYaw >= 0.2) {
        const fail = buildFaceFailure('LIVENESS_FAILED', 'Liveness check failed: no frontal face detected (|yaw| must be < 0.2 rad)');
        await logVerificationAudit(fail);
        return fail;
    }

    // Check head turn in requested direction
    let headTurnPassed = false;
    for (let i = frontalIdx + 1; i < yaws.length; i++) {
        if (requestedAction === 'TURN_LEFT' && yaws[i] < -0.35) {
            headTurnPassed = true;
            break;
        } else if (requestedAction === 'TURN_RIGHT' && yaws[i] > 0.35) {
            headTurnPassed = true;
            break;
        }
    }

    if (!headTurnPassed) {
        const fail = buildFaceFailure('LIVENESS_FAILED', `Liveness check failed: head turn challenge (${requestedAction}) was not completed`);
        await logVerificationAudit(fail);
        return fail;
    }

    // Pass 2: checkFrontalFrame
    let frontalResult;
    try {
        frontalResult = await checkFrontalFrame(frameBuffers[frontalIdx]);
    } catch (err: any) {
        const fail = buildFaceFailure(err?.code || 'NO_FACE', err?.message || 'Face detection failed on frontal frame');
        await logVerificationAudit(fail);
        return fail;
    }

    // Match probe against authenticated student's stored embedding
    const faceResult = matchEnrolledFace({
        probeEmbedding: frontalResult.embedding,
        storedEmbeddingRaw: userRow.face_embedding,
        clientFaceVerifiedFlag,
        probeRealScore: frontalResult.real,
        probeLiveScore: frontalResult.live
    });
    faceResult.frontalFrameIndex = frontalIdx;

    const finalBreakdown = evaluateAllFactors({
        studentIdentity,
        sessionEligibility,
        geofenceResult,
        wifiResult,
        faceResult
    });

    if (finalBreakdown.overallStatus === 'FAILED') {
        await logVerificationAudit(finalBreakdown);
        return finalBreakdown;
    }

    // 6. Create Short-Lived Server-Controlled Verification Session
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

    const vSessionRes = await pool.query(
        `INSERT INTO verification_sessions (
            student_id, session_id, classroom_id, verification_token, status,
            results, face_match_score, liveness_score, location_distance_m, wifi_verified,
            expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
            authenticatedStudentId,
            sessionEligibility.sessionId,
            sessionEligibility.classroomId,
            verificationToken,
            'PASSED',
            JSON.stringify(createVerificationAuditPayload(finalBreakdown)),
            faceResult.faceMatchScore,
            faceResult.livenessScore,
            geofenceResult.distanceMeters ?? null,
            wifiResult.verified,
            expiresAt
        ]
    );

    const verificationSessionId = vSessionRes.rows[0].id;
    finalBreakdown.verificationToken = verificationToken;
    finalBreakdown.verificationSessionId = verificationSessionId;

    // 7. Atomically create Attendance Record linked to the Verification Session
    const frontalBase64 = frames[frontalIdx];
    await pool.query(
        `INSERT INTO attendance_records (
            session_id, student_id, status, photo_base64, face_match_score, liveness_score, submitted_at,
            location_lat, location_lon, location_accuracy_m, location_distance_m, location_verified, location_ts,
            wifi_bssid, wifi_ssid, wifi_verified, wifi_verification_status,
            verification_session_id
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
            sessionEligibility.sessionId,
            authenticatedStudentId,
            'PENDING',
            frontalBase64,
            faceResult.faceMatchScore,
            faceResult.livenessScore,
            clientLocation ? Number(clientLocation.latitude) : null,
            clientLocation ? Number(clientLocation.longitude) : null,
            geofenceResult.accuracyMeters ?? null,
            geofenceResult.distanceMeters ?? null,
            geofenceResult.verified,
            clientLocation?.timestamp ?? null,
            wifiResult.bssid ?? null,
            wifiResult.ssid ?? null,
            wifiResult.verified,
            wifiResult.status,
            verificationSessionId
        ]
    );

    // Mark verification session consumed
    await pool.query(
        `UPDATE verification_sessions SET consumed_at = NOW() WHERE id = $1`,
        [verificationSessionId]
    );

    // Audit log entry
    await logVerificationAudit(finalBreakdown);

    return finalBreakdown;

    function buildFaceFailure(code: string, message: string): VerificationResultBreakdown {
        return evaluateAllFactors({
            studentIdentity,
            sessionEligibility,
            geofenceResult,
            wifiResult,
            faceResult: {
                verified: false,
                threshold: getMatchThreshold(),
                livenessThreshold: getLivenessMinScore(),
                error: { code, message }
            }
        });
    }
}

/**
 * Inserts privacy-conscious audit record into audit_logs.
 */
async function logVerificationAudit(breakdown: VerificationResultBreakdown): Promise<void> {
    try {
        const pool = (await import('../config/db.ts')).default;
        const auditData = createVerificationAuditPayload(breakdown);
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, new_value, timestamp)
             VALUES ($1, $2, $3, NOW())`,
            [
                breakdown.studentIdentity.studentId,
                `VERIFICATION_${breakdown.overallStatus}`,
                JSON.stringify(auditData)
            ]
        );
    } catch (auditErr) {
        console.error('Failed to write verification audit log:', auditErr);
    }
}
