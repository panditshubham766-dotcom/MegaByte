import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';

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
        const { durationMinutes } = req.body;
        const facultyId = req.user?.id;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
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
            RETURNING *`,
            [facultyId, subjectId, classId, randomCode, 'ACTIVE', expiresAt]
        );

        res.status(201).json(insertSession.rows[0]);
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
