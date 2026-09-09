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

export const getPendingSubmissions = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        const { sessionId } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        // Fetch pending records for this session, joined with users
        const pendingRes = await pool.query(
            `SELECT a.id as record_id, u.name, u.student_id, a.photo_base64, a.status 
             FROM attendance_records a
             JOIN users u ON a.student_id = u.id
             WHERE a.session_id = $1 AND a.status = 'PENDING'`,
            [sessionId]
        );

        res.status(200).json(pendingRes.rows);
    } catch (error) {
        console.error('Error fetching pending submissions:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const reviewSubmission = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
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
