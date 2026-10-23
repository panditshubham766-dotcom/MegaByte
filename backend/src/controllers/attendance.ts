import crypto from 'crypto';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { markExpired } from './session';
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

        // Find active and unexpired session
        const sessionRes = await pool.query(
            `SELECT id FROM attendance_sessions 
             WHERE random_code = $1 
             AND status = 'ACTIVE' 
             AND expires_at > NOW()`,
            [sessionCode.toUpperCase()]
        );

        if (sessionRes.rowCount === 0) {
            res.status(400).json({ message: 'Invalid or expired session code' });
            return;
        }

        const sessionId = sessionRes.rows[0].id;

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

        // Random action via crypto ('TURN_LEFT' | 'TURN_RIGHT')
        const action = crypto.randomInt(0, 2) === 0 ? 'TURN_LEFT' : 'TURN_RIGHT';

        const insertRes = await pool.query(
            `INSERT INTO liveness_challenges (student_id, session_id, action, expires_at)
             VALUES ($1, $2, $3, NOW() + make_interval(secs => 60))
             RETURNING id, action`,
            [studentId, sessionId, action]
        );

        res.status(200).json({
            challengeId: insertRes.rows[0].id,
            action: insertRes.rows[0].action
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

        // Find the active session matching the session_code
        const sessionRes = await pool.query(
            `SELECT id FROM attendance_sessions 
             WHERE random_code = $1 
             AND status = 'ACTIVE' 
             AND expires_at > NOW()`,
            [sessionCode.toUpperCase()]
        );

        if (sessionRes.rowCount === 0) {
            res.status(400).json({ message: 'Invalid or expired session code' });
            return;
        }

        const sessionId = sessionRes.rows[0].id;

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
             RETURNING action`,
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
            res.status(422).json({
                code: 'FACE_MISMATCH',
                message: 'Face verification failed: photo does not match reference photo'
            });
            return;
        }

        // 5. On pass, store frontal frame as photo_base64 plus face_match_score and liveness_score (lower of real/live)
        const livenessScore = Math.min(frontalResult.real, frontalResult.live);
        const frontalBase64 = frames[frontalIdx];

        await pool.query(
            `INSERT INTO attendance_records (session_id, student_id, status, photo_base64, face_match_score, liveness_score, submitted_at) 
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [sessionId, studentId, 'PENDING', frontalBase64, faceMatchScore, livenessScore]
        );

        triggerDebouncedSubmissionExport(sessionId);

        res.status(201).json({
            message: 'Attendance submitted successfully',
            face_match_score: faceMatchScore,
            liveness_score: livenessScore
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
            `SELECT a.id as record_id, u.name, u.student_id, a.photo_base64, a.status, a.face_match_score, a.liveness_score 
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
            `SELECT DISTINCT s.id AS subject_id, s.name AS subject_name, s.code AS subject_code
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

            let presentCount = 0;
            const sessionList = [];

            for (const sess of sessions) {
                const rec = recordMap.get(sess.id);
                let statusDisplay = 'Absent';

                if (rec) {
                    if (rec.status === 'APPROVED') {
                        statusDisplay = 'Present';
                        presentCount++;
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

            const percentage = total > 0 ? Math.round((presentCount / total) * 100) : 0;

            result.push({
                subject_id: sub.subject_id,
                subject_name: sub.subject_name,
                subject_code: sub.subject_code,
                total,
                present: presentCount,
                percentage,
                sessions: sessionList
            });
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Error fetching student attendance summary:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
