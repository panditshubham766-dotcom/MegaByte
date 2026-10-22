import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { markExpired } from './session';
import { getEmbedding, compareSimilarity, getMatchThreshold, FaceError } from '../services/face';

export const submitAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const studentId = req.user?.id;
        if (!studentId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const { session_code, photo_base64 } = req.body;
        
        if (!session_code || !photo_base64) {
            res.status(400).json({ message: 'Session code and photo are required' });
            return;
        }

        // Find the active session matching the session_code
        const sessionRes = await pool.query(
            `SELECT id FROM attendance_sessions 
             WHERE random_code = $1 
             AND status = 'ACTIVE' 
             AND expires_at > NOW()`,
            [session_code.toUpperCase()]
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

        // Decode submitted selfie photo
        const base64Data = photo_base64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        let selfieEmbedding: number[];
        try {
            selfieEmbedding = await getEmbedding(imageBuffer);
        } catch (err: any) {
            if (err instanceof FaceError || (err && (err.code === 'NO_FACE' || err.code === 'MULTIPLE_FACES'))) {
                res.status(422).json({ code: err.code, message: err.message });
                return;
            }
            throw err;
        }

        // Compute similarity against all stored embeddings; use the highest score
        let highestScore = -1;
        for (const emb of storedEmbeddings) {
            const sim = compareSimilarity(selfieEmbedding, emb);
            if (sim > highestScore) {
                highestScore = sim;
            }
        }
        const score = highestScore;
        const threshold = getMatchThreshold();

        if (score < threshold) {
            res.status(422).json({
                code: 'FACE_MISMATCH',
                message: 'Face verification failed: photo does not match reference photo'
            });
            return;
        }

        // Insert new record with face_match_score
        await pool.query(
            `INSERT INTO attendance_records (session_id, student_id, status, photo_base64, face_match_score) 
             VALUES ($1, $2, $3, $4, $5)`,
            [sessionId, studentId, 'PENDING', photo_base64, score]
        );

        res.status(201).json({ message: 'Attendance submitted successfully' });
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
            `SELECT a.id as record_id, u.name, u.student_id, a.photo_base64, a.status, a.face_match_score 
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
            `UPDATE attendance_records SET status = $1 WHERE id = $2 RETURNING *`,
            [status, record_id]
        );

        if (updateRes.rowCount === 0) {
            res.status(404).json({ message: 'Record not found' });
            return;
        }

        res.status(200).json({ message: 'Submission reviewed successfully', record: updateRes.rows[0] });
    } catch (error) {
        console.error('Error reviewing submission:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
