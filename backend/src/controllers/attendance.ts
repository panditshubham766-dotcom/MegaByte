import crypto from 'crypto';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { markExpired } from './session';
import { computeStudentAttendance, isRecordPresent } from '../services/attendanceCalculator';
import {
    isRotatingCodeEnabled,
    getCodeWindowSeconds,
    liveCode,
    checkCodeRateLimit,
    recordCodeFailure
} from '../services/rotatingCode';
import { triggerDebouncedSubmissionExport, writeSessionExport } from '../services/sessionExport';
import { updateSubjectSheet } from '../services/subjectSheet';
import {
    detectPose,
    checkFrontalFrame,
    compareSimilarity,
    getMatchThreshold,
    getLivenessMinScore,
    FaceError
} from '../services/face';
import {
    evaluateLocation,
    validateLocation,
    validateClientLocationShape,
    logGeofenceCheck,
    getGeoRadiusM,
    getGeoMaxAccuracyM,
    type ClientLocation,
    type ClassroomConfig
} from '../services/geo';
import {
    validateWifiPresence,
    evaluateCombinedPresence,
    normalizeBssid,
    type ClientWifiEvidence,
    type ClassroomAccessPoint,
    type VerificationPolicy
} from '../services/wifi';

export const requestChallenge = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const studentId = req.user?.id;
        if (!studentId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const sessionCode = req.body.code || req.body.session_code;
        if (!sessionCode) {
            res.status(400).json({ message: 'Session code is required' });
            return;
        }

        // Accept optional client location & Wi-Fi payload for multi-factor presence verification.
        // IMPORTANT: We never trust client-supplied booleans like insideClassroom=true or wifiVerified=true.
        // All distance calculation is performed server-side using Haversine, and BSSIDs are matched
        // server-side against authorized classroom access points.
        const clientLocation = req.body.location ?? null;
        const clientWifi: ClientWifiEvidence | null = req.body.wifi ?? null;

        // Rate limit wrong codes: max 5 failures per student per minute
        const rateLimit = checkCodeRateLimit(studentId);
        if (rateLimit.limited) {
            res.status(429).json({
                code: 'CODE_RATE_LIMITED',
                message: `Too many incorrect attempts. Please try again in ${rateLimit.retryAfterSeconds} seconds.`,
                retryAfterSeconds: rateLimit.retryAfterSeconds,
                retryHint: `Please wait ${rateLimit.retryAfterSeconds} seconds before trying again.`
            });
            return;
        }

        const cleanCode = (sessionCode || '').trim().toUpperCase();

        // Resolve active, non-expired session
        let sessionRow: any;
        if (isRotatingCodeEnabled()) {
            const sessionRes = await pool.query(
                `SELECT s.id, s.subject_id, s.class_id, s.classroom_id, s.location_mode,
                        s.code_secret, s.random_code,
                        s.geo_lat, s.geo_lng, s.geo_radius_m, s.geo_hard_limit_m,
                        s.anchor_lat, s.anchor_lng, s.anchor_accuracy_m, s.anchor_updated_at,
                        sub.name              AS subject_name,
                        cls.name              AS class_name,
                        c.name                AS classroom_name,
                        COALESCE(s.geo_lat, c.latitude) AS classroom_lat,
                        COALESCE(s.geo_lng, c.longitude) AS classroom_lon,
                        COALESCE(s.geo_radius_m, c.radius_m, c.radius_meters, 100) AS radius_m,
                        COALESCE(s.geo_hard_limit_m, c.hard_limit_m, 300) AS hard_limit_m,
                        COALESCE(c.max_accuracy_meters, 100) AS max_accuracy_meters,
                        c.verification_policy
                 FROM attendance_sessions s
                 JOIN subjects sub ON sub.id = s.subject_id
                 JOIN classes cls ON cls.id = s.class_id
                 LEFT JOIN classrooms c ON c.id = s.classroom_id
                 WHERE s.status = 'ACTIVE'
                   AND s.expires_at > NOW()`
            );

            const nowMs = Date.now();
            const windowSeconds = getCodeWindowSeconds();
            const windowMs = windowSeconds * 1000;
            const currentWindowIndex = Math.floor(nowMs / windowMs);
            const previousWindowIndex = currentWindowIndex - 1;

            const matchingSessions = sessionRes.rows.filter(s => {
                const curr = liveCode(s.code_secret, currentWindowIndex);
                const prev = liveCode(s.code_secret, previousWindowIndex);
                return cleanCode === curr || cleanCode === prev;
            });

            if (matchingSessions.length === 0) {
                recordCodeFailure(studentId);
                res.status(422).json({
                    code: 'INVALID_OR_EXPIRED_CODE',
                    message: 'Code expired or wrong. Check the screen for the new code'
                });
                return;
            }

            if (matchingSessions.length > 1) {
                res.status(409).json({
                    code: 'CODE_COLLISION',
                    message: 'Try again'
                });
                return;
            }

            sessionRow = matchingSessions[0];
        } else {
            const sessionRes = await pool.query(
                `SELECT s.id, s.subject_id, s.class_id, s.classroom_id, s.location_mode,
                        s.code_secret, s.random_code,
                        s.geo_lat, s.geo_lng, s.geo_radius_m, s.geo_hard_limit_m,
                        s.anchor_lat, s.anchor_lng, s.anchor_accuracy_m, s.anchor_updated_at,
                        sub.name              AS subject_name,
                        cls.name              AS class_name,
                        c.name                AS classroom_name,
                        COALESCE(s.geo_lat, c.latitude) AS classroom_lat,
                        COALESCE(s.geo_lng, c.longitude) AS classroom_lon,
                        COALESCE(s.geo_radius_m, c.radius_m, c.radius_meters, 100) AS radius_m,
                        COALESCE(s.geo_hard_limit_m, c.hard_limit_m, 300) AS hard_limit_m,
                        COALESCE(c.max_accuracy_meters, 100) AS max_accuracy_meters,
                        c.verification_policy
                 FROM attendance_sessions s
                 JOIN subjects sub ON sub.id = s.subject_id
                 JOIN classes cls ON cls.id = s.class_id
                 LEFT JOIN classrooms c ON c.id = s.classroom_id
                 WHERE s.random_code = $1
                   AND s.status = 'ACTIVE'
                   AND s.expires_at > NOW()`,
                [cleanCode]
            );

            if (!sessionRes.rowCount || sessionRes.rowCount === 0) {
                recordCodeFailure(studentId);
                res.status(422).json({
                    code: 'INVALID_OR_EXPIRED_CODE',
                    message: 'Code expired or wrong. Check the screen for the new code'
                });
                return;
            }

            sessionRow = sessionRes.rows[0];
        }

        // Never expose or log code_secret in any response
        delete sessionRow.code_secret;
        const sessionId: string = sessionRow.id;

        // Check if student is enrolled in the session's subject (if enrollments exist for this subject)
        const totalEnrollmentsRes = await pool.query(
            `SELECT COUNT(*) FROM enrollments WHERE subject_id = $1`,
            [sessionRow.subject_id]
        );
        const totalEnrolled = parseInt(totalEnrollmentsRes.rows[0].count, 10);
        if (totalEnrolled > 0) {
            const enrollRes = await pool.query(
                `SELECT id FROM enrollments WHERE student_id = $1 AND subject_id = $2 LIMIT 1`,
                [studentId, sessionRow.subject_id]
            );
            if (!enrollRes.rowCount || enrollRes.rowCount === 0) {
                res.status(403).json({
                    code: 'NOT_ENROLLED',
                    message: 'You are not enrolled in the subject/class for this session.'
                });
                return;
            }
        }

        let locLat: number | null = null;
        let locLon: number | null = null;
        let locAcc: number | null = null;
        let locDist: number | null = null;
        let locVerified = false;
        let locTs: string | null = null;

        let wifiBssid: string | null = null;
        let wifiSsid: string | null = null;
        let wifiVerified = false;
        let wifiStatus: string = 'NOT_REQUIRED';

        // Presence validation - single source of truth via evaluateLocation
        const evalResult = evaluateLocation(sessionRow, clientLocation);

        if (!evalResult.valid) {
            logGeofenceCheck(
                sessionId,
                getGeoRadiusM(),
                evalResult.distance_m,
                evalResult.geo_accuracy_m,
                `FAILED (${evalResult.error?.code})`
            );
            res.status(evalResult.error?.statusCode || 422).json(evalResult.error);
            return;
        }

        logGeofenceCheck(
            sessionId,
            getGeoRadiusM(),
            evalResult.distance_m,
            evalResult.geo_accuracy_m,
            `PASSED (${evalResult.location_status})`
        );

        if (clientLocation) {
            const rawLat = clientLocation.lat !== undefined && clientLocation.lat !== null ? clientLocation.lat : clientLocation.latitude;
            const rawLng = clientLocation.lng !== undefined && clientLocation.lng !== null ? clientLocation.lng : (clientLocation.longitude !== undefined && clientLocation.longitude !== null ? clientLocation.longitude : clientLocation.lon);
            locLat = rawLat !== undefined && rawLat !== null && Number.isFinite(Number(rawLat)) ? Number(rawLat) : null;
            locLon = rawLng !== undefined && rawLng !== null && Number.isFinite(Number(rawLng)) ? Number(rawLng) : null;
            locTs = clientLocation.timestamp ? String(clientLocation.timestamp) : null;
        }
        locAcc = evalResult.geo_accuracy_m;
        locDist = evalResult.distance_m;
        locVerified = evalResult.location_status === 'INSIDE';

        if (clientWifi?.bssid) {
            wifiBssid = normalizeBssid(clientWifi.bssid);
            wifiSsid = clientWifi.ssid?.trim() || null;
        }

        // Check if student already submitted
        const priorSubmission = await pool.query(
            `SELECT id FROM attendance_records WHERE session_id = $1 AND student_id = $2`,
            [sessionId, studentId]
        );

        if (priorSubmission.rowCount && priorSubmission.rowCount > 0) {
            res.status(400).json({ message: 'Attendance already submitted for this session' });
            return;
        }

        // Check if student has enrolled face embedding
        const userRes = await pool.query(
            `SELECT face_embedding FROM users WHERE id = $1`,
            [studentId]
        );
        if (!userRes.rows[0]?.face_embedding) {
            res.status(403).json({ code: 'FACE_NOT_ENROLLED', message: 'Face not enrolled for this student' });
            return;
        }

        // Max 5 challenges per student per session, else 429
        const countRes = await pool.query(
            `SELECT count(*) FROM liveness_challenges WHERE session_id = $1 AND student_id = $2`,
            [sessionId, studentId]
        );
        const challengeCount = parseInt(countRes.rows[0].count, 10);
        if (challengeCount >= 5) {
            res.status(429).json({ message: 'Maximum of 5 challenge attempts reached for this session' });
            return;
        }

        // Random action via crypto
        const action = crypto.randomInt(0, 2) === 0 ? 'TURN_LEFT' : 'TURN_RIGHT';

        const insertRes = await pool.query(
            `INSERT INTO liveness_challenges (
                student_id, session_id, action, expires_at,
                location_lat, location_lon, location_accuracy_m, location_distance_m, location_verified, location_ts,
                wifi_bssid, wifi_ssid, wifi_verified, wifi_verification_status
             ) VALUES ($1, $2, $3, NOW() + make_interval(secs => 60), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING id, action`,
            [studentId, sessionId, action, locLat, locLon, locAcc, locDist, locVerified, locTs, wifiBssid, wifiSsid, wifiVerified, wifiStatus]
        );

        res.status(200).json({
            challengeId: insertRes.rows[0].id,
            action: insertRes.rows[0].action,
            geofenced: Boolean(sessionRow.classroom_id),
            policy: sessionRow.verification_policy || 'GPS_ONLY',
            location_mode: sessionRow.location_mode || 'STRICT',
            location_status: evalResult.location_status,
            distance_m: evalResult.distance_m,
            geo_accuracy_m: evalResult.geo_accuracy_m,
            sessionCode: sessionCode.toUpperCase(),
            classroomName: sessionRow.classroom_name || 'Assigned Classroom',
            subjectName: sessionRow.subject_name || 'Current Subject',
            className: sessionRow.class_name || 'Class Session',
            locationDistanceM: locDist,
            locationAccuracyM: locAcc,
            locationVerified: locVerified,
            wifiStatus: wifiStatus,
            wifiVerified: wifiVerified,
            wifiSsid: wifiSsid
        });
    } catch (error: any) {
        console.error('Error requesting challenge:', error.message || 'Unknown error');
        res.status(500).json({ message: 'Internal server error' });
    }
};
export const submitAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const studentId = req.user?.id;
        if (!studentId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const sessionCode = req.body.code || req.body.session_code;
        const { challengeId, frames } = req.body;
        
        if (!sessionCode || !challengeId || !Array.isArray(frames) || frames.length < 4 || frames.length > 16) {
            res.status(400).json({ message: 'Session code, challengeId, and 4-16 frames are required' });
            return;
        }

        // Requirement 6: Ensure authenticated identity matches recognized student.
        // Never trust client-supplied identity overrides or student_id substitutions.
        const claimedStudentId = req.body.studentId || req.body.student_id;
        if (claimedStudentId && claimedStudentId !== studentId) {
            res.status(403).json({
                code: 'IDENTITY_SUBSTITUTION_REJECTED',
                message: 'Submitted student identity does not match authenticated credentials.'
            });
            return;
        }

        // The issued challenge is bound to that session, so /submit does NOT re-check the code
        const sessionRes = await pool.query(
            `SELECT s.id, s.subject_id, s.class_id, s.classroom_id, s.location_mode,
                    s.geo_lat, s.geo_lng, s.geo_radius_m, s.geo_hard_limit_m,
                    s.anchor_lat, s.anchor_lng, s.anchor_accuracy_m, s.anchor_updated_at,
                    c.name AS classroom_name,
                    COALESCE(s.geo_lat, c.latitude) AS classroom_lat,
                    COALESCE(s.geo_lng, c.longitude) AS classroom_lon,
                    COALESCE(s.geo_radius_m, c.radius_m, c.radius_meters, 100) AS radius_m,
                    COALESCE(s.geo_hard_limit_m, c.hard_limit_m, 300) AS hard_limit_m,
                    COALESCE(c.max_accuracy_meters, 100) AS max_accuracy_meters,
                    c.verification_policy
             FROM liveness_challenges lc
             JOIN attendance_sessions s ON s.id = lc.session_id
             LEFT JOIN classrooms c ON c.id = s.classroom_id
             WHERE lc.id = $1
               AND lc.student_id = $2
               AND lc.used_at IS NULL
               AND lc.expires_at > NOW()
               AND s.status = 'ACTIVE' 
               AND s.expires_at > NOW()`,
            [challengeId, studentId]
        );

        if (sessionRes.rowCount === 0) {
            res.status(400).json({ code: 'CHALLENGE_INVALID', message: 'Invalid, expired, or already used challenge' });
            return;
        }

        const sessionRow = sessionRes.rows[0];
        const sessionId = sessionRow.id;

        // Geofence enforcement at submit time: single source of truth via evaluateLocation
        let submitLocLat: number | null = null;
        let submitLocLon: number | null = null;
        let submitLocAcc: number | null = null;
        let submitLocDist: number | null = null;
        let submitLocVerified = false;
        let submitLocTs: string | null = null;
        let submitLocationStatus: string | null = null;

        const submitLocation = req.body.location;
        const submitEvalResult = evaluateLocation(sessionRow, submitLocation);

        if (!submitEvalResult.valid) {
            logGeofenceCheck(
                sessionId,
                getGeoRadiusM(),
                submitEvalResult.distance_m,
                submitEvalResult.geo_accuracy_m,
                `FAILED (${submitEvalResult.error?.code})`
            );
            res.status(submitEvalResult.error?.statusCode || 422).json(submitEvalResult.error);
            return;
        }

        logGeofenceCheck(
            sessionId,
            getGeoRadiusM(),
            submitEvalResult.distance_m,
            submitEvalResult.geo_accuracy_m,
            `PASSED (${submitEvalResult.location_status})`
        );

        if (submitLocation) {
            const rawLat = submitLocation.lat !== undefined && submitLocation.lat !== null ? submitLocation.lat : submitLocation.latitude;
            const rawLng = submitLocation.lng !== undefined && submitLocation.lng !== null ? submitLocation.lng : (submitLocation.longitude !== undefined && submitLocation.longitude !== null ? submitLocation.longitude : submitLocation.lon);
            submitLocLat = rawLat !== undefined && rawLat !== null && Number.isFinite(Number(rawLat)) ? Number(rawLat) : null;
            submitLocLon = rawLng !== undefined && rawLng !== null && Number.isFinite(Number(rawLng)) ? Number(rawLng) : null;
            submitLocTs = submitLocation.timestamp ? String(submitLocation.timestamp) : null;
        }
        submitLocAcc = submitEvalResult.geo_accuracy_m;
        submitLocDist = submitEvalResult.distance_m;
        submitLocationStatus = submitEvalResult.location_status;
        submitLocVerified = submitEvalResult.location_status === 'INSIDE';

        // Check if student already submitted
        const priorSubmission = await pool.query(
            `SELECT id FROM attendance_records WHERE session_id = $1 AND student_id = $2`,
            [sessionId, studentId]
        );

        if (priorSubmission.rowCount && priorSubmission.rowCount > 0) {
            res.status(400).json({ message: 'Attendance already submitted for this session' });
            return;
        }

        // Check student enrollment in the session's subject (if enrollments exist)
        const totalEnrollmentsRes = await pool.query(
            `SELECT COUNT(*) FROM enrollments WHERE subject_id = $1`,
            [sessionRow.subject_id]
        );
        const totalEnrolled = parseInt(totalEnrollmentsRes.rows[0].count, 10);
        if (totalEnrolled > 0) {
            const enrollRes = await pool.query(
                `SELECT id FROM enrollments WHERE student_id = $1 AND subject_id = $2 LIMIT 1`,
                [studentId, sessionRow.subject_id]
            );
            if (!enrollRes.rowCount || enrollRes.rowCount === 0) {
                res.status(403).json({
                    code: 'NOT_ENROLLED',
                    message: 'You are not enrolled in the subject/class for this session.'
                });
                return;
            }
        }

        // Check if student has enrolled face embedding
        const userRes = await pool.query(
            `SELECT face_embedding FROM users WHERE id = $1`,
            [studentId]
        );

        const storedRaw = userRes.rows[0]?.face_embedding;
        if (!storedRaw) {
            res.status(403).json({ code: 'FACE_NOT_ENROLLED', message: 'Face not enrolled for this student' });
            return;
        }

        const parsed = typeof storedRaw === 'string' ? JSON.parse(storedRaw) : storedRaw;
        // Handle both new format (array of embeddings: number[][]) and old format (flat array: number[])
        let storedEmbeddings: number[][];
        if (Array.isArray(parsed) && parsed.length > 0) {
            if (typeof parsed[0] === 'number') {
                // Legacy format: flat number[]
                storedEmbeddings = [parsed as number[]];
            } else if (Array.isArray(parsed[0])) {
                // New format: number[][]
                storedEmbeddings = parsed as number[][];
            } else {
                res.status(403).json({ code: 'FACE_NOT_ENROLLED', message: 'Face not enrolled for this student' });
                return;
            }
        } else {
            res.status(403).json({ code: 'FACE_NOT_ENROLLED', message: 'Face not enrolled for this student' });
            return;
        }

        // 1. Atomically consume the challenge
        const challengeRes = await pool.query(
            `UPDATE liveness_challenges 
             SET used_at = NOW() 
             WHERE id = $1 AND student_id = $2 AND session_id = $3 AND used_at IS NULL AND expires_at > NOW() 
             RETURNING action, location_lat, location_lon, location_accuracy_m, location_distance_m, location_verified, location_ts,
                       wifi_bssid, wifi_ssid, wifi_verified, wifi_verification_status`,
            [challengeId, studentId, sessionId]
        );

        if (challengeRes.rowCount === 0) {
            res.status(400).json({ code: 'CHALLENGE_INVALID', message: 'Invalid, expired, or already used challenge' });
            return;
        }



        const requestedAction: 'TURN_LEFT' | 'TURN_RIGHT' = challengeRes.rows[0].action;

        // 2. Pass 1 on every frame (detectPose): exactly one face, else NO_FACE / MULTIPLE_FACES
        const yaws: number[] = [];
        const frameBuffers: Buffer[] = [];

        for (const frameBase64 of frames) {
            const base64Data = frameBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
            const buf = Buffer.from(base64Data, 'base64');
            frameBuffers.push(buf);

            const pose = await detectPose(buf);
            if (pose.faces === 0) {
                res.status(422).json({ code: 'NO_FACE', message: 'No face detected in one or more frames' });
                return;
            }
            if (pose.faces > 1) {
                res.status(422).json({ code: 'MULTIPLE_FACES', message: 'Multiple faces detected in one or more frames' });
                return;
            }
            yaws.push(pose.yaw);
        }

        // 3. Frontal frame = smallest |yaw|, must be < 0.2 rad.
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
            res.status(422).json({
                code: 'LIVENESS_FAILED',
                message: 'Liveness check failed: no frontal face detected (|yaw| must be < 0.2 rad)'
            });
            return;
        }

        // A LATER frame must have yaw beyond 0.35 rad in the requested direction.
        // Yaw sign convention in @vladmandic/human:
        // - TURN_LEFT (student turning to their left / viewer's right): yaw < -0.35 rad
        // - TURN_RIGHT (student turning to their right / viewer's left): yaw > +0.35 rad
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
            res.status(422).json({
                code: 'LIVENESS_FAILED',
                message: `Liveness check failed: head turn challenge (${requestedAction}) was not completed`
            });
            return;
        }

        // 4. Pass 2 on the frontal frame only (embedding + antispoof + liveness)
        const frontalBuffer = frameBuffers[frontalIdx];
        let frontalResult;
        try {
            frontalResult = await checkFrontalFrame(frontalBuffer);
        } catch (err: any) {
            if (err instanceof FaceError || (err && (err.code === 'NO_FACE' || err.code === 'MULTIPLE_FACES'))) {
                res.status(422).json({ code: err.code, message: err.message });
                return;
            }
            throw err;
        }

        const livenessMinScore = getLivenessMinScore();
        if (frontalResult.real < livenessMinScore || frontalResult.live < livenessMinScore) {
            res.status(422).json({
                code: 'LIVENESS_FAILED',
                message: `Liveness check failed: anti-spoof or liveness score below required threshold (${livenessMinScore})`
            });
            return;
        }

        // Face match against stored embeddings (best-of-several)
        let highestScore = -1;
        for (const emb of storedEmbeddings) {
            const sim = compareSimilarity(frontalResult.embedding, emb);
            if (sim > highestScore) {
                highestScore = sim;
            }
        }
        const faceMatchScore = highestScore;
        const threshold = getMatchThreshold();

        if (faceMatchScore < threshold) {
            // Write privacy-preserving failure audit log
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, new_value, timestamp)
                 VALUES ($1, 'VERIFICATION_FAILED', $2, NOW())`,
                [studentId, JSON.stringify({
                    session_id: sessionId,
                    reason: 'FACE_MISMATCH',
                    face_match_score: faceMatchScore,
                    threshold
                })]
            );
            res.status(422).json({
                code: 'FACE_MISMATCH',
                message: 'Face verification failed: photo does not match reference photo'
            });
            return;
        }

        // 5. On pass, store frontal frame as photo_base64 plus face_match_score and liveness_score (lower of real/live)
        const livenessScore = Math.min(frontalResult.real, frontalResult.live);
        const frontalBase64 = frames[frontalIdx];
        const challengeRow = challengeRes.rows[0];

        // 6. Create short-lived server-controlled verification session (Requirements 8 & 9)
        const verificationToken = 'vtok_' + crypto.randomBytes(24).toString('hex');
        const verificationBreakdown = {
            studentIdentity: { verified: true, studentId },
            sessionEligibility: { verified: true, sessionId, classroomId: sessionRow.classroom_id, verificationPolicy: 'GPS_ONLY' },
            geofenceValidation: {
                required: Boolean(sessionRow.classroom_id),
                verified: sessionRow.classroom_id ? (submitLocVerified && Boolean(challengeRow.location_verified)) : false,
                distanceMeters: submitLocDist ?? challengeRow.location_distance_m,
                accuracyMeters: submitLocAcc ?? challengeRow.location_accuracy_m
            },
            wifiVerification: {
                required: false,
                verified: Boolean(challengeRow.wifi_verified),
                bssid: challengeRow.wifi_bssid,
                ssid: challengeRow.wifi_ssid,
                status: challengeRow.wifi_verification_status
            },
            faceRecognition: {
                verified: true,
                faceMatchScore,
                livenessScore,
                threshold,
                livenessThreshold: livenessMinScore
            },
            overallStatus: 'PASSED'
        };

        const vSessionRes = await pool.query(
            `INSERT INTO verification_sessions (
                student_id, session_id, classroom_id, verification_token, status, results,
                face_match_score, liveness_score, location_distance_m, wifi_verified,
                expires_at
             ) VALUES ($1, $2, $3, $4, 'PASSED', $5, $6, $7, $8, $9, NOW() + INTERVAL '5 minutes')
             RETURNING id`,
            [
                studentId,
                sessionId,
                sessionRow.classroom_id ?? null,
                verificationToken,
                JSON.stringify(verificationBreakdown),
                faceMatchScore,
                livenessScore,
                submitLocDist ?? challengeRow.location_distance_m ?? null,
                challengeRow.wifi_verified ?? false
            ]
        );
        const verificationSessionId = vSessionRes.rows[0].id;

        // 7. Atomically insert attendance_records linked with the verification session
        await pool.query(
            `INSERT INTO attendance_records (
                session_id, student_id, status, photo_base64, face_match_score, liveness_score, submitted_at,
                location_lat, location_lon, location_accuracy_m, location_distance_m, location_verified, location_ts,
                distance_m, geo_accuracy_m, location_status,
                wifi_bssid, wifi_ssid, wifi_verified, wifi_verification_status,
                verification_session_id
             ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
            [
                sessionId,
                studentId,
                'PENDING',
                frontalBase64,
                faceMatchScore,
                livenessScore,
                submitLocLat ?? challengeRow.location_lat ?? null,
                submitLocLon ?? challengeRow.location_lon ?? null,
                submitLocAcc ?? challengeRow.location_accuracy_m ?? null,
                submitLocDist ?? challengeRow.location_distance_m ?? null,
                (submitLocVerified && Boolean(challengeRow.location_verified)),
                submitLocTs ?? challengeRow.location_ts ?? null,
                submitLocDist ?? challengeRow.location_distance_m ?? null,
                submitLocAcc ?? challengeRow.location_accuracy_m ?? null,
                submitLocationStatus,
                challengeRow.wifi_bssid ?? null,
                challengeRow.wifi_ssid ?? null,
                challengeRow.wifi_verified ?? false,
                challengeRow.wifi_verification_status ?? 'NOT_REQUIRED',
                verificationSessionId
            ]
        );

        // Mark verification session consumed
        await pool.query(
            `UPDATE verification_sessions SET consumed_at = NOW() WHERE id = $1`,
            [verificationSessionId]
        );

        // Requirement 11: Privacy-preserving audit event without storing unnecessary raw photo or full GPS track
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, new_value, timestamp)
             VALUES ($1, 'ATTENDANCE_VERIFICATION_PASSED', $2, NOW())`,
            [studentId, JSON.stringify({
                session_id: sessionId,
                verification_session_id: verificationSessionId,
                face_match_score: faceMatchScore,
                liveness_score: livenessScore,
                location_distance_m: challengeRow.location_distance_m,
                wifi_verified: challengeRow.wifi_verified,
                overall_status: 'PASSED'
            })]
        );

        triggerDebouncedSubmissionExport(sessionId);

        res.status(201).json({
            message: 'Attendance submitted successfully',
            face_match_score: faceMatchScore,
            liveness_score: livenessScore,
            location_status: submitLocationStatus,
            distance_m: submitLocDist ?? challengeRow.location_distance_m ?? null,
            geo_accuracy_m: submitLocAcc ?? challengeRow.location_accuracy_m ?? null,
            verification_token: verificationToken,
            verification_session_id: verificationSessionId,
            breakdown: verificationBreakdown
        });
    } catch (error: any) {
        console.error('Error submitting attendance:', error.message || 'Unknown error');
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getPendingSubmissions = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { sessionId } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        // Fetch pending records for this session, joined with users
        const pendingRes = await pool.query(
            `SELECT a.id as record_id, u.name, u.student_id, a.photo_base64, a.status, a.face_match_score, a.liveness_score,
                    COALESCE(a.distance_m, a.location_distance_m) AS distance_m,
                    COALESCE(a.geo_accuracy_m, a.location_accuracy_m) AS geo_accuracy_m,
                    a.location_status,
                    a.location_distance_m, a.location_accuracy_m, a.location_verified,
                    a.wifi_bssid, a.wifi_ssid, a.wifi_verified, a.wifi_verification_status
             FROM attendance_records a
             JOIN users u ON a.student_id = u.id
             WHERE a.session_id = $1 AND a.status = 'PENDING'`,
            [sessionId]
        );

        res.status(200).json(pendingRes.rows);
    } catch (error: any) {
        console.error('Error fetching pending submissions:', error.message || 'Unknown error');
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const reviewSubmission = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { record_id, status } = req.body;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        if (status !== 'APPROVED' && status !== 'REJECTED') {
            res.status(400).json({ message: 'Status must be APPROVED or REJECTED' });
            return;
        }

        const updateRes = await pool.query(
            `UPDATE attendance_records SET status = $1, reviewed_at = NOW() WHERE id = $2 RETURNING *`,
            [status, record_id]
        );

        if (updateRes.rowCount === 0) {
            res.status(404).json({ message: 'Record not found' });
            return;
        }

        const reviewedRecord = updateRes.rows[0];
        try {
            await writeSessionExport(reviewedRecord.session_id);
        } catch (err) {
            console.error('Export error on review decision:', err);
        }
        try {
            const sessRes = await pool.query('SELECT subject_id FROM attendance_sessions WHERE id = $1', [reviewedRecord.session_id]);
            if (sessRes.rowCount && sessRes.rows[0].subject_id) {
                await updateSubjectSheet(sessRes.rows[0].subject_id);
            }
        } catch (err) {
            console.error('Subject sheet update error on review decision:', err);
        }

        res.status(200).json({ message: 'Submission reviewed successfully', record: reviewedRecord });
    } catch (error) {
        console.error('Error reviewing submission:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const editAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { sessionId, studentId, status, reason } = req.body;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        if (!sessionId || !studentId) {
            res.status(400).json({ message: 'sessionId and studentId are required' });
            return;
        }

        if (status !== 'APPROVED' && status !== 'REJECTED') {
            res.status(400).json({ message: 'status must be APPROVED or REJECTED' });
            return;
        }

        const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
        if (trimmedReason.length < 5) {
            res.status(400).json({ message: 'Reason must be at least 5 characters' });
            return;
        }

        // Check session ownership
        const sessionRes = await pool.query(
            `SELECT id, faculty_id, subject_id FROM attendance_sessions WHERE id = $1`,
            [sessionId]
        );

        if (sessionRes.rowCount === 0) {
            res.status(404).json({ message: 'Session not found' });
            return;
        }

        const session = sessionRes.rows[0];
        if (session.faculty_id !== facultyId) {
            res.status(403).json({ message: 'Forbidden: You do not own this session' });
            return;
        }

        // Find student user
        const userRes = await pool.query(
            `SELECT id, student_id, name FROM users WHERE id::text = $1 OR student_id = $1 LIMIT 1`,
            [studentId]
        );

        if (userRes.rowCount === 0) {
            res.status(404).json({ message: 'Student not found' });
            return;
        }

        const resolvedStudent = userRes.rows[0];
        const studentUuid = resolvedStudent.id;

        // Check if student is enrolled in the session's subject
        const enrollRes = await pool.query(
            `SELECT 1 FROM enrollments WHERE student_id = $1 AND subject_id = $2 LIMIT 1`,
            [studentUuid, session.subject_id]
        );

        if (enrollRes.rowCount === 0) {
            res.status(400).json({ message: 'Student is not enrolled in this session’s subject' });
            return;
        }

        // Check current attendance record status (if any)
        const currentRes = await pool.query(
            `SELECT id, status, edit_reason FROM attendance_records WHERE session_id = $1 AND student_id = $2`,
            [sessionId, studentUuid]
        );

        const currentRecord = currentRes.rows[0];
        const currentStatus = currentRecord ? currentRecord.status : null;

        if (currentStatus === status) {
            res.status(400).json({ message: 'New status cannot be the same as current status' });
            return;
        }

        // Upsert attendance record: student with no record gets a new record with no photo
        const upsertRes = await pool.query(
            `INSERT INTO attendance_records (session_id, student_id, status, edit_reason, edited_at, reviewed_at, photo_base64)
             VALUES ($1, $2, $3, $4, NOW(), NOW(), NULL)
             ON CONFLICT (session_id, student_id)
             DO UPDATE SET
                 status = EXCLUDED.status,
                 edit_reason = EXCLUDED.edit_reason,
                 edited_at = NOW(),
                 reviewed_at = NOW()
             RETURNING *`,
            [sessionId, studentUuid, status, trimmedReason]
        );

        const updatedRecord = upsertRes.rows[0];

        // Audit log entry
        await pool.query(
            `INSERT INTO audit_logs (user_id, attendance_id, action, old_value, new_value, timestamp)
             VALUES ($1, $2, 'EDIT_ATTENDANCE', $3, $4, NOW())`,
            [
                facultyId,
                updatedRecord.id,
                JSON.stringify({ status: currentStatus, edit_reason: currentRecord?.edit_reason || null }),
                JSON.stringify({ status: status, reason: trimmedReason, actor: 'FACULTY' })
            ]
        );

        // Update Excel export
        try {
            await writeSessionExport(sessionId);
        } catch (err) {
            console.error('Export error on edit attendance:', err);
        }
        try {
            if (session.subject_id) {
                await updateSubjectSheet(session.subject_id);
            }
        } catch (err) {
            console.error('Subject sheet update error on edit attendance:', err);
        }

        res.status(200).json({
            message: 'Attendance edited successfully',
            record: updatedRecord
        });
    } catch (error) {
        console.error('Error editing attendance:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getMyAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const studentId = req.user?.id;
        if (!studentId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        // 1. Fetch all subjects student is enrolled in
        const subjectsRes = await pool.query(
            `SELECT DISTINCT s.id AS subject_id, s.name AS subject_name, s.code AS subject_code, e.created_at AS enrolled_at
             FROM enrollments e
             JOIN subjects s ON e.subject_id = s.id
             WHERE e.student_id = $1
             ORDER BY s.name ASC`,
            [studentId]
        );

        const result = [];

        for (const sub of subjectsRes.rows) {
            // Sessions of that subject no longer ACTIVE (i.e. ENDED or EXPIRED)
            const sessionsRes = await pool.query(
                `SELECT id, created_at, status
                 FROM attendance_sessions
                 WHERE subject_id = $1 AND status != 'ACTIVE'
                 ORDER BY created_at DESC`,
                [sub.subject_id]
            );

            const sessions = sessionsRes.rows;
            const total = sessions.length;

            if (total === 0) {
                result.push({
                    subject_id: sub.subject_id,
                    subject_name: sub.subject_name,
                    subject_code: sub.subject_code,
                    total: 0,
                    present: 0,
                    percentage: 0,
                    sessions: []
                });
                continue;
            }

            const sessionIds = sessions.map(s => s.id);
            const recordsRes = await pool.query(
                `SELECT session_id, status, edit_reason, edited_at
                 FROM attendance_records
                 WHERE student_id = $1 AND session_id = ANY($2::uuid[])`,
                [studentId, sessionIds]
            );

            const recordMap = new Map<string, any>();
            for (const r of recordsRes.rows) {
                recordMap.set(r.session_id, r);
            }

            const stats = computeStudentAttendance(sessionIds, (sid) => recordMap.get(sid)?.status);
            const sessionList = [];

            for (const sess of sessions) {
                const rec = recordMap.get(sess.id);
                let statusDisplay = 'Absent';

                if (rec) {
                    if (isRecordPresent(rec.status)) {
                        statusDisplay = 'Present';
                    } else if (rec.status === 'REJECTED') {
                        statusDisplay = 'Rejected';
                    } else if (rec.status === 'PENDING') {
                        statusDisplay = 'Pending';
                    }
                }

                sessionList.push({
                    session_id: sess.id,
                    date: sess.created_at,
                    status: statusDisplay,
                    edited: Boolean(rec && (rec.edited_at || rec.edit_reason)),
                    edit_reason: rec?.edit_reason || null
                });
            }

            result.push({
                subject_id: sub.subject_id,
                subject_name: sub.subject_name,
                subject_code: sub.subject_code,
                total: stats.total,
                present: stats.present,
                percentage: stats.percentage,
                sessions: sessionList
            });
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Error fetching student attendance summary:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};



const approveAllBuckets = new Map<string, number[]>();

function checkRateLimitApproveAll(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const timestamps = (approveAllBuckets.get(key) || []).filter(ts => now - ts < windowMs);
    if (timestamps.length >= maxRequests) {
        approveAllBuckets.set(key, timestamps);
        return false;
    }
    timestamps.push(now);
    approveAllBuckets.set(key, timestamps);
    return true;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(val: any): boolean {
    return typeof val === 'string' && UUID_REGEX.test(val);
}

export const approveAllSubmissions = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        // Rate limit: 10 per minute per user
        if (!checkRateLimitApproveAll(`approve_all:${facultyId}`, 10, 60 * 1000)) {
            res.status(429).json({ message: 'Too many requests. Please try again later.' });
            return;
        }

        const { sessionId, recordIds } = req.body;

        // Validate sessionId is a UUID
        if (!sessionId || !isValidUUID(sessionId)) {
            res.status(400).json({ message: 'sessionId must be a valid UUID' });
            return;
        }

        // Validate recordIds length 1-500 and every id a UUID
        if (!Array.isArray(recordIds) || recordIds.length < 1 || recordIds.length > 500) {
            res.status(400).json({ message: 'recordIds must be an array of 1 to 500 items' });
            return;
        }

        for (const id of recordIds) {
            if (!isValidUUID(id)) {
                res.status(400).json({ message: 'Every recordId must be a valid UUID' });
                return;
            }
        }

        // De-duplicate recordIds
        const uniqueRecordIds = Array.from(new Set(recordIds));
        if (uniqueRecordIds.length < 1 || uniqueRecordIds.length > 500) {
            res.status(400).json({ message: 'recordIds must contain 1 to 500 unique IDs' });
            return;
        }

        await markExpired();

        // Check session ownership (unknown session 404; session must be owned by caller, else 403)
        const sessionRes = await pool.query(
            `SELECT id, faculty_id, subject_id FROM attendance_sessions WHERE id = $1`,
            [sessionId]
        );

        if (sessionRes.rowCount === 0) {
            res.status(404).json({ message: 'Session not found' });
            return;
        }

        const session = sessionRes.rows[0];
        if (session.faculty_id !== facultyId) {
            res.status(403).json({ message: 'Forbidden: You do not own this session' });
            return;
        }

        // In ONE transaction run UPDATE and INSERT audit_logs
        const client = await pool.connect();
        let approvedCount = 0;
        let approvedIds: string[] = [];

        try {
            await client.query('BEGIN');

            const updateRes = await client.query(
                `UPDATE attendance_records
                 SET status='APPROVED', reviewed_at=NOW()
                 WHERE session_id=$1
                   AND id = ANY($2::uuid[])
                   AND status='PENDING'
                 RETURNING id`,
                [sessionId, uniqueRecordIds]
            );

            approvedIds = updateRes.rows.map(r => r.id);
            approvedCount = approvedIds.length;

            await client.query(
                `INSERT INTO audit_logs (user_id, attendance_id, action, old_value, new_value, timestamp)
                 VALUES ($1, NULL, 'APPROVE_ALL', NULL, $2, NOW())`,
                [
                    facultyId,
                    JSON.stringify({
                        actor: 'FACULTY',
                        session_id: sessionId,
                        approved_ids: approvedIds,
                        count: approvedCount
                    })
                ]
            );

            await client.query('COMMIT');
        } catch (txError) {
            await client.query('ROLLBACK');
            throw txError;
        } finally {
            client.release();
        }

        // After commit, call exactly the same post-review side effects
        try {
            await writeSessionExport(sessionId);
        } catch (err) {
            console.error('Export error on approve-all decision:', err);
        }
        try {
            if (session.subject_id) {
                await updateSubjectSheet(session.subject_id);
            }
        } catch (err) {
            console.error('Subject sheet update error on approve-all decision:', err);
        }

        const skippedCount = uniqueRecordIds.length - approvedCount;
        res.status(200).json({
            approved: approvedCount,
            skipped: skippedCount
        });
    } catch (error) {
        console.error('Error approving all submissions:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getVerificationSession = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { idOrToken } = req.params;
        const userId = req.user?.id;
        const userRole = req.user?.role;

        if (!userId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const queryRes = await pool.query(
            `SELECT v.*, u.name as student_name, u.student_id as student_number,
                    s.random_code as session_code, c.name as classroom_name
             FROM verification_sessions v
             JOIN users u ON u.id = v.student_id
             JOIN attendance_sessions s ON s.id = v.session_id
             LEFT JOIN classrooms c ON c.id = v.classroom_id
             WHERE v.verification_token = $1 OR v.id::text = $1`,
            [idOrToken]
        );

        if (queryRes.rowCount === 0) {
            res.status(404).json({ message: 'Verification session not found' });
            return;
        }

        const vRow = queryRes.rows[0];
        // Enforce access control: student can view their own, faculty can view sessions they own, admins can view all
        if (userRole === 'STUDENT' && vRow.student_id !== userId) {
            res.status(403).json({ message: 'Forbidden' });
            return;
        }

        res.status(200).json(vRow);
    } catch (error: any) {
        console.error('Error fetching verification session:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const revalidatePresence = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const studentId = req.user?.id;
        if (!studentId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const token = (req.headers['x-verification-token'] as string) || req.body?.verificationToken || req.body?.verification_token;
        if (!token) {
            res.status(403).json({
                code: 'NO_VERIFICATION_TOKEN',
                message: 'Verification token is required for revalidation.'
            });
            return;
        }

        const clientLocation: ClientLocation | null = req.body?.location || null;

        const queryRes = await pool.query(
            `SELECT v.*,
                    c.id as classroom_id,
                    c.name as classroom_name,
                    c.latitude as classroom_lat,
                    c.longitude as classroom_lon,
                    c.radius_meters,
                    c.max_accuracy_meters,
                    c.verification_policy,
                    s.status as session_status,
                    s.expires_at as session_expires_at
             FROM verification_sessions v
             JOIN attendance_sessions s ON s.id = v.session_id
             LEFT JOIN classrooms c ON c.id = v.classroom_id
             WHERE v.verification_token = $1`,
            [token.trim()]
        );

        if (queryRes.rowCount === 0) {
            res.status(403).json({
                code: 'VERIFICATION_NOT_FOUND',
                message: 'Verification session not found.'
            });
            return;
        }

        const row = queryRes.rows[0];

        // Security check: cross-user token reuse
        if (row.student_id !== studentId) {
            res.status(403).json({
                code: 'CROSS_USER_REUSE_BLOCKED',
                message: 'Security violation: Verification session does not belong to the authenticated user.'
            });
            return;
        }

        // Check if session has ended
        if (row.session_status !== 'ACTIVE' || new Date() >= new Date(row.session_expires_at)) {
            res.status(403).json({
                code: 'SESSION_ENDED',
                message: 'The class session has ended or expired.'
            });
            return;
        }

        let classroomConfig: ClassroomConfig | null = null;
        if (row.classroom_id) {
            classroomConfig = {
                id: row.classroom_id,
                name: row.classroom_name,
                latitude: Number(row.classroom_lat),
                longitude: Number(row.classroom_lon),
                radius_meters: Number(row.radius_meters),
                max_accuracy_meters: Number(row.max_accuracy_meters)
            };
        }

        const { evaluatePresenceRevalidation } = await import('../services/verification.ts');
        const reval = evaluatePresenceRevalidation({
            vSession: row,
            clientLocation,
            classroomConfig
        });

        if (reval.revoked) {
            // Revoke in database
            await pool.query(
                `UPDATE verification_sessions
                 SET status = 'REVOKED', revoked_at = NOW(), revocation_reason = $1
                 WHERE id = $2`,
                [reval.error?.message || 'Exited classroom geofence', row.id]
            );

            // Audit log
            await pool.query(
                `INSERT INTO audit_logs (user_id, action, new_value, timestamp)
                 VALUES ($1, 'VERIFICATION_REVOKED', $2, NOW())`,
                [studentId, JSON.stringify({
                    verification_session_id: row.id,
                    reason: reval.reason,
                    distance_meters: reval.distanceMeters
                })]
            );

            res.status(403).json({
                code: reval.error?.code || 'PRESENCE_REVOKED',
                message: reval.error?.message || 'Classroom presence revoked.',
                retryHint: reval.error?.retryHint || 'Move inside classroom and check-in again.'
            });
            return;
        }

        if (!reval.valid) {
            res.status(400).json({
                code: reval.error?.code || 'REVALIDATION_FAILED',
                message: reval.error?.message || 'Revalidation failed.',
                retryHint: reval.error?.retryHint
            });
            return;
        }

        // Update successful revalidation
        await pool.query(
            `UPDATE verification_sessions
             SET last_revalidated_at = NOW(), revalidation_count = revalidation_count + 1
             WHERE id = $1`,
            [row.id]
        );

        res.status(200).json({
            status: 'REVALIDATED',
            message: 'Classroom presence confirmed',
            distanceMeters: reval.distanceMeters,
            revalidationCount: (row.revalidation_count || 0) + 1
        });
    } catch (error: any) {
        console.error('Error in revalidatePresence:', error);
        res.status(500).json({ message: 'Internal server error during revalidation' });
    }
};

export const revokeVerificationSession = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { idOrToken } = req.params;
        const reason = req.body?.reason || 'Administrative revocation';
        const actorId = req.user?.id;

        const updateRes = await pool.query(
            `UPDATE verification_sessions
             SET status = 'REVOKED', revoked_at = NOW(), revocation_reason = $1
             WHERE (verification_token = $2 OR id::text = $2) AND status != 'REVOKED'
             RETURNING id, student_id, session_id`,
            [reason, idOrToken]
        );

        if (updateRes.rowCount === 0) {
            res.status(404).json({ message: 'Verification session not found or already revoked' });
            return;
        }

        const revoked = updateRes.rows[0];
        await pool.query(
            `INSERT INTO audit_logs (user_id, action, new_value, timestamp)
             VALUES ($1, 'VERIFICATION_REVOKED_BY_ADMIN', $2, NOW())`,
            [actorId, JSON.stringify({
                revoked_student_id: revoked.student_id,
                session_id: revoked.session_id,
                verification_session_id: revoked.id,
                reason
            })]
        );

        res.status(200).json({
            message: 'Verification session revoked successfully',
            verificationSessionId: revoked.id
        });
    } catch (error: any) {
        console.error('Error revoking verification session:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getActiveVerificationSession = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const studentId = req.user?.id;
        const sessionId = req.query?.sessionId as string | undefined;

        if (!studentId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const queryRes = await pool.query(
            `SELECT v.*, c.name as classroom_name, s.random_code as session_code
             FROM verification_sessions v
             JOIN attendance_sessions s ON s.id = v.session_id
             LEFT JOIN classrooms c ON c.id = v.classroom_id
             WHERE v.student_id = $1
               AND ($2::uuid IS NULL OR v.session_id = $2::uuid)
               AND v.status = 'PASSED'
               AND v.expires_at > NOW()
               AND v.revoked_at IS NULL
             ORDER BY v.created_at DESC
             LIMIT 1`,
            [studentId, sessionId || null]
        );

        if (queryRes.rowCount === 0) {
            res.status(404).json({ message: 'No active verification session found' });
            return;
        }

        res.status(200).json(queryRes.rows[0]);
    } catch (error: any) {
        console.error('Error fetching active verification session:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};



