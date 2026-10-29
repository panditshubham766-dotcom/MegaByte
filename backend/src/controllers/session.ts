import { Response } from 'express';
import axios from 'axios';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { writeSessionExport, buildSessionWorkbook } from '../services/sessionExport';
import { updateSubjectSheet } from '../services/subjectSheet';
import { isRotatingCodeEnabled, getLiveCodeDetails } from '../services/rotatingCode';

export const markExpired = async (): Promise<string[]> => {
    const res = await pool.query(
        `UPDATE attendance_sessions
         SET status = 'EXPIRED', ended_at = expires_at
         WHERE status = 'ACTIVE' AND expires_at <= NOW()
         RETURNING id, subject_id`
    );
    const expiredRows = res.rows;
    for (const row of expiredRows) {
        try {
            await writeSessionExport(row.id);
        } catch (err) {
            console.error(`Export error on session expired ${row.id}:`, err);
        }
    }
    const uniqueSubjectIds = [...new Set(expiredRows.map(r => r.subject_id).filter(Boolean))];
    for (const subId of uniqueSubjectIds) {
        try {
            await updateSubjectSheet(subId);
        } catch (err) {
            console.error(`Subject sheet update error on session expired for subject ${subId}:`, err);
        }
    }
    return expiredRows.map(r => r.id);
};

const generateRandomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

export const createSession = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const { durationSeconds, durationMinutes } = req.body;
        let totalSeconds: number;

        if (durationSeconds !== undefined) {
            const parsed = typeof durationSeconds === 'string' && durationSeconds.trim() !== ''
                ? Number(durationSeconds)
                : durationSeconds;
            if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 15 || parsed > 10800) {
                res.status(400).json({ message: 'durationSeconds must be an integer between 15 and 10800' });
                return;
            }
            totalSeconds = parsed;
        } else if (durationMinutes !== undefined) {
            const parsed = typeof durationMinutes === 'string' && durationMinutes.trim() !== ''
                ? Number(durationMinutes)
                : durationMinutes;
            if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 1 || parsed > 180) {
                res.status(400).json({ message: 'durationMinutes must be an integer between 1 and 180' });
                return;
            }
            totalSeconds = parsed * 60;
        } else {
            totalSeconds = 300; // default 5 minutes
        }

        const facultyId = req.user?.id;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        // Return 409 if faculty already has an ACTIVE unexpired session
        const activeRes = await pool.query(
            `SELECT id FROM attendance_sessions 
             WHERE faculty_id = $1 AND status = 'ACTIVE' AND expires_at > NOW() 
             LIMIT 1`,
            [facultyId]
        );
        if (activeRes.rowCount && activeRes.rowCount > 0) {
            res.status(409).json({ 
                message: 'Faculty already has an active session', 
                sessionId: activeRes.rows[0].id 
            });
            return;
        }
        
        // Require subject_id that belongs to logged-in faculty
        const rawSubjectId = req.body.subject_id || req.body.subjectId;
        if (!rawSubjectId) {
            res.status(400).json({ message: 'subject_id is required' });
            return;
        }

        const subjectCheck = await pool.query(
            'SELECT id, faculty_id, name, code FROM subjects WHERE id = $1',
            [rawSubjectId]
        );

        if (subjectCheck.rowCount === 0) {
            res.status(404).json({ message: 'Subject not found' });
            return;
        }

        if (subjectCheck.rows[0].faculty_id !== facultyId) {
            res.status(403).json({ message: 'Forbidden: You do not own this subject' });
            return;
        }

        const subjectId = rawSubjectId;

        // Ensure dummy class exists
        let classRes = await pool.query("SELECT id FROM classes WHERE name = 'Computer Science 1st Year' LIMIT 1");
        let classId;
        if (classRes.rowCount === 0) {
            const insertClass = await pool.query(
                "INSERT INTO classes (name, department, semester, section) VALUES ($1, $2, $3, $4) RETURNING id",
                ['Computer Science 1st Year', 'Computer Science', 1, 'A']
            );
            classId = insertClass.rows[0].id;
        } else {
            classId = classRes.rows[0].id;
        }

        // Optional classroom_id and location_mode (not required)
        let targetClassroomId = req.body.classroom_id || req.body.classroomId || null;
        let locationMode = 'STRICT';
        if (req.body.location_mode || req.body.locationMode) {
            const rawMode = (req.body.location_mode || req.body.locationMode).toString().toUpperCase();
            if (['STRICT', 'FLAG_ONLY', 'OFF'].includes(rawMode)) {
                locationMode = rawMode;
            }
        }

        let resolvedClassroomId: string | null = null;
        let geoLat: number | null = null;
        let geoLng: number | null = null;
        let geoRadiusM: number | null = null;
        let geoHardLimitM: number | null = null;

        if (targetClassroomId) {
            const classroomRes = await pool.query(
                `SELECT id, latitude, longitude, COALESCE(radius_m, radius_meters, 100) AS radius_m, COALESCE(hard_limit_m, 300) AS hard_limit_m
                 FROM classrooms WHERE id = $1 AND is_active = TRUE`,
                [targetClassroomId]
            );
            if (classroomRes.rowCount && classroomRes.rowCount > 0) {
                const cRow = classroomRes.rows[0];
                resolvedClassroomId = cRow.id;
                geoLat = Number(cRow.latitude);
                geoLng = Number(cRow.longitude);
                geoRadiusM = Number(cRow.radius_m || 100);
                geoHardLimitM = Number(cRow.hard_limit_m || 300);
            }
        }

        const anchorLatRaw = req.body.anchor_lat ?? req.body.anchorLat;
        const anchorLngRaw = req.body.anchor_lng ?? req.body.anchorLng;
        const anchorAccRaw = req.body.anchor_accuracy_m ?? req.body.anchorAccuracyM ?? req.body.anchor_accuracy ?? req.body.accuracy;

        const anchorLat = anchorLatRaw !== undefined && anchorLatRaw !== null ? Number(anchorLatRaw) : NaN;
        const anchorLng = anchorLngRaw !== undefined && anchorLngRaw !== null ? Number(anchorLngRaw) : NaN;
        const anchorAcc = anchorAccRaw !== undefined && anchorAccRaw !== null ? Number(anchorAccRaw) : NaN;

        const isAnchorValid =
            Number.isFinite(anchorLat) &&
            Number.isFinite(anchorLng) &&
            Number.isFinite(anchorAcc) &&
            anchorLat >= -90 && anchorLat <= 90 &&
            anchorLng >= -180 && anchorLng <= 180 &&
            !(anchorLat === 0 && anchorLng === 0) &&
            anchorAcc >= 0;

        if (!isAnchorValid) {
            res.status(422).json({
                code: 'ANCHOR_REQUIRED',
                message: 'Faculty laptop location anchor (anchor_lat, anchor_lng, anchor_accuracy_m) is required.'
            });
            return;
        }

        const randomCode = generateRandomCode();

        const insertSession = await pool.query(
            `INSERT INTO attendance_sessions 
            (faculty_id, subject_id, class_id, random_code, status, created_at, expires_at, classroom_id, location_mode, geo_lat, geo_lng, geo_radius_m, geo_hard_limit_m, anchor_lat, anchor_lng, anchor_accuracy_m, anchor_updated_at) 
            VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW() + make_interval(secs => $5), $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()) 
            RETURNING id, subject_id, random_code, status, created_at, expires_at, ended_at, classroom_id, location_mode, geo_lat, geo_lng, geo_radius_m, geo_hard_limit_m, anchor_lat, anchor_lng, anchor_accuracy_m, anchor_updated_at, NOW() as server_now`,
            [facultyId, subjectId, classId, randomCode, totalSeconds, resolvedClassroomId, locationMode, geoLat, geoLng, geoRadiusM, geoHardLimitM, anchorLat, anchorLng, anchorAcc]
        );

        const newSession = insertSession.rows[0];
        try {
            await writeSessionExport(newSession.id);
        } catch (err) {
            console.error('Export error on session create:', err);
        }

        res.status(201).json(newSession);
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getActiveSession = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const sessionRes = await pool.query(
            `SELECT s.id, s.subject_id, s.random_code, s.status, s.expires_at, s.ended_at, s.classroom_id,
                    s.location_mode, s.geo_lat, s.geo_lng, s.geo_radius_m, s.geo_hard_limit_m,
                    s.anchor_lat, s.anchor_lng, s.anchor_accuracy_m, s.anchor_updated_at,
                    c.name AS classroom_name,
                    sub.name AS subject_name, sub.code AS subject_code,
                    COALESCE(s.geo_lat, c.latitude) AS latitude,
                    COALESCE(s.geo_lng, c.longitude) AS longitude,
                    COALESCE(s.geo_radius_m, c.radius_m, c.radius_meters, 100) AS radius_meters,
                    COALESCE(s.geo_radius_m, c.radius_m, c.radius_meters, 100) AS radius_m,
                    COALESCE(s.geo_hard_limit_m, c.hard_limit_m, 300) AS hard_limit_m,
                    c.max_accuracy_meters, c.verification_policy,
                    NOW() as server_now 
             FROM attendance_sessions s
             LEFT JOIN classrooms c ON c.id = s.classroom_id
             LEFT JOIN subjects sub ON sub.id = s.subject_id
             WHERE s.faculty_id = $1 AND s.status = 'ACTIVE' AND s.expires_at > NOW() 
             ORDER BY s.created_at DESC LIMIT 1`,
            [facultyId]
        );

        if (sessionRes.rowCount === 0) {
            res.status(404).json({ message: 'No active session found' });
            return;
        }

        res.status(200).json(sessionRes.rows[0]);
    } catch (error) {
        console.error('Error fetching active session:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSessionById = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const sessionRes = await pool.query(
            `SELECT s.id, s.faculty_id, s.subject_id, s.random_code, s.status,
                    s.expires_at, s.ended_at, s.created_at, s.classroom_id,
                    s.location_mode, s.geo_lat, s.geo_lng, s.geo_radius_m, s.geo_hard_limit_m,
                    s.anchor_lat, s.anchor_lng, s.anchor_accuracy_m, s.anchor_updated_at,
                    c.name AS classroom_name,
                    sub.name AS subject_name, sub.code AS subject_code,
                    COALESCE(s.geo_lat, c.latitude) AS latitude,
                    COALESCE(s.geo_lng, c.longitude) AS longitude,
                    COALESCE(s.geo_radius_m, c.radius_m, c.radius_meters, 100) AS radius_meters,
                    COALESCE(s.geo_radius_m, c.radius_m, c.radius_meters, 100) AS radius_m,
                    COALESCE(s.geo_hard_limit_m, c.hard_limit_m, 300) AS hard_limit_m,
                    c.max_accuracy_meters, c.verification_policy,
                    NOW() as server_now
             FROM attendance_sessions s
             LEFT JOIN classrooms c ON c.id = s.classroom_id
             LEFT JOIN subjects sub ON sub.id = s.subject_id
             WHERE s.id = $1`,
            [id]
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

        const { faculty_id, ...data } = session;
        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching session by id:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const endSession = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const sessionRes = await pool.query(
            `SELECT id, faculty_id, subject_id, random_code, status, expires_at, ended_at, NOW() as server_now 
             FROM attendance_sessions 
             WHERE id = $1`,
            [id]
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

        if (session.status === 'ACTIVE') {
            const updateRes = await pool.query(
                `UPDATE attendance_sessions 
                 SET status = 'ENDED', ended_at = NOW() 
                 WHERE id = $1 
                 RETURNING id, random_code, status, expires_at, ended_at, NOW() as server_now`,
                [id]
            );
            try {
                await writeSessionExport(id);
            } catch (err) {
                console.error('Export error on end session:', err);
            }
            try {
                if (session.subject_id) {
                    await updateSubjectSheet(session.subject_id);
                }
            } catch (err) {
                console.error('Subject sheet update error on end session:', err);
            }
            res.status(200).json(updateRes.rows[0]);
            return;
        }

        // Idempotent: already ENDED or EXPIRED
        const { faculty_id, ...data } = session;
        res.status(200).json(data);
    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const exportSession = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const sessionRes = await pool.query(
            `SELECT id, faculty_id, random_code FROM attendance_sessions WHERE id = $1`,
            [id]
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

        // Regenerate and upsert
        await writeSessionExport(id);
        const buffer = await buildSessionWorkbook(id);

        const now = new Date();
        const yyyy = now.getUTCFullYear();
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(now.getUTCDate()).padStart(2, '0');
        const hh = String(now.getUTCHours()).padStart(2, '0');
        const min = String(now.getUTCMinutes()).padStart(2, '0');
        const filename = `attendance_${yyyy}${mm}${dd}-${hh}${min}_${session.random_code}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Error exporting session:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSessionAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const sessionRes = await pool.query(
            `SELECT id, faculty_id, subject_id FROM attendance_sessions WHERE id = $1`,
            [id]
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

        // Fetch enrolled students in session's subject prior to or at session creation
        const enrolledRes = await pool.query(
            `SELECT 
                u.id AS user_id,
                u.student_id,
                u.name,
                a.status,
                a.face_match_score,
                a.liveness_score,
                a.edit_reason,
                COALESCE(a.distance_m, a.location_distance_m) AS distance_m,
                COALESCE(a.geo_accuracy_m, a.location_accuracy_m) AS geo_accuracy_m,
                a.location_distance_m,
                a.location_accuracy_m,
                a.location_status,
                a.location_verified,
                a.wifi_bssid,
                a.wifi_verified,
                a.wifi_verification_status
             FROM enrollments e
             JOIN users u ON e.student_id = u.id
             LEFT JOIN attendance_records a ON a.session_id = $1 AND a.student_id = u.id
             WHERE e.subject_id = $2 AND e.created_at <= $3
             ORDER BY u.student_id ASC, u.name ASC`,
            [id, session.subject_id, session.created_at]
        );

        let rows = enrolledRes.rows;

        // If no students enrolled in subject, fallback to students who have records in this session
        if (rows.length === 0) {
            const fallbackRes = await pool.query(
                `SELECT 
                    u.id AS user_id,
                    u.student_id,
                    u.name,
                    a.status,
                    a.face_match_score,
                    a.liveness_score,
                    a.edit_reason,
                    COALESCE(a.distance_m, a.location_distance_m) AS distance_m,
                    COALESCE(a.geo_accuracy_m, a.location_accuracy_m) AS geo_accuracy_m,
                    a.location_distance_m,
                    a.location_accuracy_m,
                    a.location_status,
                    a.location_verified,
                    a.wifi_bssid,
                    a.wifi_verified,
                    a.wifi_verification_status
                 FROM attendance_records a
                 JOIN users u ON a.student_id = u.id
                 WHERE a.session_id = $1
                 ORDER BY u.student_id ASC, u.name ASC`,
                [id]
            );
            rows = fallbackRes.rows;
        }

        const formatted = rows.map(r => ({
            student_id: r.student_id || r.user_id,
            user_id: r.user_id,
            name: r.name,
            status: r.status || null,
            face_match_score: r.face_match_score !== null && r.face_match_score !== undefined ? Number(r.face_match_score) : null,
            liveness_score: r.liveness_score !== null && r.liveness_score !== undefined ? Number(r.liveness_score) : null,
            edit_reason: r.edit_reason || null,
            distance_m: r.distance_m !== null && r.distance_m !== undefined ? Number(r.distance_m) : null,
            geo_accuracy_m: r.geo_accuracy_m !== null && r.geo_accuracy_m !== undefined ? Number(r.geo_accuracy_m) : null,
            location_status: r.location_status || (r.location_verified ? 'INSIDE' : null),
            location_distance_m: r.distance_m !== null && r.distance_m !== undefined ? Number(r.distance_m) : (r.location_distance_m !== null && r.location_distance_m !== undefined ? Number(r.location_distance_m) : null),
            location_accuracy_m: r.geo_accuracy_m !== null && r.geo_accuracy_m !== undefined ? Number(r.geo_accuracy_m) : (r.location_accuracy_m !== null && r.location_accuracy_m !== undefined ? Number(r.location_accuracy_m) : null),
            location_verified: Boolean(r.location_verified || r.location_status === 'INSIDE'),
            wifi_bssid: r.wifi_bssid || null,
            wifi_verified: Boolean(r.wifi_verified),
            wifi_verification_status: r.wifi_verification_status || 'NOT_REQUIRED'
        }));

        res.status(200).json(formatted);
    } catch (error) {
        console.error('Error fetching session attendance:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteSession = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const sessionRes = await pool.query(
            `SELECT id, faculty_id, subject_id, random_code, status, created_at 
             FROM attendance_sessions 
             WHERE id = $1`,
            [id]
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

        // Query status breakdown for audit_logs
        const statusCountsRes = await pool.query(
            `SELECT status, COUNT(*)::int AS count 
             FROM attendance_records 
             WHERE session_id = $1 
             GROUP BY status`,
            [id]
        );

        const recordCounts: Record<string, number> = {
            APPROVED: 0,
            REJECTED: 0,
            PENDING: 0
        };
        let totalRecords = 0;
        for (const row of statusCountsRes.rows) {
            recordCounts[row.status] = row.count;
            totalRecords += row.count;
        }

        const oldValue = {
            session_id: session.id,
            subject_id: session.subject_id,
            code: session.random_code,
            status: session.status,
            created_at: session.created_at,
            actor: 'FACULTY',
            record_counts_by_status: recordCounts,
            record_counts: recordCounts,
            total_records: totalRecords
        };

        const client = await pool.connect();
        let deletedRecords = 0;
        let deletedChallenges = 0;
        let deletedSessions = 0;

        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO audit_logs (user_id, attendance_id, action, old_value, new_value, timestamp)
                 VALUES ($1, NULL, 'DELETE_SESSION', $2, NULL, NOW())`,
                [facultyId, JSON.stringify(oldValue)]
            );

            const delRecordsRes = await client.query(
                `DELETE FROM attendance_records WHERE session_id = $1`,
                [id]
            );
            deletedRecords = delRecordsRes.rowCount || 0;

            const delChallengesRes = await client.query(
                `DELETE FROM liveness_challenges WHERE session_id = $1`,
                [id]
            );
            deletedChallenges = delChallengesRes.rowCount || 0;

            await client.query(
                `DELETE FROM session_exports WHERE session_id = $1`,
                [id]
            );

            const delSessionRes = await client.query(
                `DELETE FROM attendance_sessions WHERE id = $1`,
                [id]
            );
            deletedSessions = delSessionRes.rowCount || 0;

            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        // Trigger subject master sheet update after commit
        try {
            if (session.subject_id) {
                await updateSubjectSheet(session.subject_id);
            }
        } catch (sheetErr) {
            console.error('Subject sheet update error on delete session:', sheetErr);
        }

        // After commit, delete that session's file in Supabase Storage bucket session-exports (<faculty_id>/<session_id>.xlsx); log errors only
        const storagePath = `${facultyId}/${id}.xlsx`;

        if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) {
            try {
                const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
                await axios.delete(
                    `${process.env.SUPABASE_URL}/storage/v1/object/session-exports/${storagePath}`,
                    {
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                            apikey: apiKey
                        }
                    }
                );
            } catch (restErr: any) {
                console.error(`Error deleting storage file via REST API for ${storagePath}:`, restErr?.message || restErr);
            }
        }

        res.status(200).json({
            message: 'Session deleted successfully',
            deleted: {
                session: deletedSessions,
                attendance_records: deletedRecords,
                liveness_challenges: deletedChallenges
            },
            counts: {
                records: deletedRecords,
                challenges: deletedChallenges,
                session: deletedSessions
            }
        });
    } catch (error) {
        console.error('Error deleting session:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSessionLiveCode = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const sessionRes = await pool.query(
            `SELECT id, faculty_id, random_code, code_secret, status, expires_at
             FROM attendance_sessions
             WHERE id = $1`,
            [id]
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

        if (session.status !== 'ACTIVE' || new Date(session.expires_at).getTime() <= Date.now()) {
            res.status(409).json({ message: 'Session is not active' });
            return;
        }

        if (!isRotatingCodeEnabled()) {
            const expiresInMs = Math.max(0, new Date(session.expires_at).getTime() - Date.now());
            res.status(200).json({
                code: session.random_code,
                expires_in_ms: expiresInMs
            });
            return;
        }

        const { code, expires_in_ms } = getLiveCodeDetails(session.code_secret);
        res.status(200).json({
            code,
            expires_in_ms
        });
    } catch (error) {
        console.error('Error fetching live code:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

