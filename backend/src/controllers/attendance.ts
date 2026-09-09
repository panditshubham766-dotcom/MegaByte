import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';

export const submitAttendance = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
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

        // Insert new record
        await pool.query(
            `INSERT INTO attendance_records (session_id, student_id, status, photo_base64) 
             VALUES ($1, $2, $3, $4)`,
            [sessionId, studentId, 'PENDING', photo_base64]
        );

        res.status(201).json({ message: 'Attendance submitted successfully' });
    } catch (error) {
        console.error('Error submitting attendance:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
