import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { writeSessionExport, buildSessionWorkbook } from '../services/sessionExport';

export const markExpired = async (): Promise<string[]> => {
    const res = await pool.query(
        `UPDATE attendance_sessions
         SET status = 'EXPIRED', ended_at = expires_at
         WHERE status = 'ACTIVE' AND expires_at <= NOW()
         RETURNING id`
    );
    const expiredIds = res.rows.map(row => row.id);
    for (const id of expiredIds) {
        try {
            await writeSessionExport(id);
        } catch (err) {
            console.error(`Export error on session expired ${id}:`, err);
        }
    }
    return expiredIds;
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

        const { durationMinutes } = req.body;
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

        const duration = durationMinutes || 5;
        
        // Ensure dummy subject exists for this faculty (for rapid prototyping)
        let subjectRes = await pool.query('SELECT id FROM subjects WHERE faculty_id = $1 LIMIT 1', [facultyId]);
        let subjectId;
        if (subjectRes.rowCount === 0) {
            const insertSubject = await pool.query(
                'INSERT INTO subjects (name, code, faculty_id) VALUES ($1, $2, $3) RETURNING id',
                ['Introduction to Computer Science', 'CS101', facultyId]
            );
            subjectId = insertSubject.rows[0].id;
        } else {
            subjectId = subjectRes.rows[0].id;
        }

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

        const randomCode = generateRandomCode();
        
        // Calculate expiration
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + duration);

        const insertSession = await pool.query(
            `INSERT INTO attendance_sessions 
            (faculty_id, subject_id, class_id, random_code, status, expires_at) 
            VALUES ($1, $2, $3, $4, $5, $6) 
            RETURNING id, random_code, status, expires_at, ended_at, NOW() as server_now`,
            [facultyId, subjectId, classId, randomCode, 'ACTIVE', expiresAt]
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
            `SELECT id, random_code, status, expires_at, ended_at, NOW() as server_now 
             FROM attendance_sessions 
             WHERE faculty_id = $1 AND status = 'ACTIVE' AND expires_at > NOW() 
             ORDER BY created_at DESC LIMIT 1`,
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
            `SELECT id, faculty_id, random_code, status, expires_at, ended_at, NOW() as server_now 
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
            `SELECT id, faculty_id, random_code, status, expires_at, ended_at, NOW() as server_now 
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
