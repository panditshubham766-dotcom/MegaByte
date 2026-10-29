import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { markExpired } from './session';
import { computeStudentAttendance, isRecordPresent } from '../services/attendanceCalculator';
import { formatSessionHeader, updateSubjectSheet } from '../services/subjectSheet';
import { uploadSubjectSheet, downloadSubjectSheet, deleteSubjectSheetFile, deleteSessionExportFile } from '../services/storageHelper';

export const getFacultySubjects = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const subjectsRes = await pool.query(
            `SELECT s.id, s.code, s.name, COUNT(sess.id)::int AS session_count
             FROM subjects s
             LEFT JOIN attendance_sessions sess ON sess.subject_id = s.id
             WHERE s.faculty_id = $1
             GROUP BY s.id, s.code, s.name
             ORDER BY s.name ASC`,
            [facultyId]
        );

        res.status(200).json(subjectsRes.rows);
    } catch (error) {
        console.error('Error fetching faculty subjects:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createFacultySubject = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const rawCode = typeof req.body.code === 'string' ? req.body.code.trim() : '';
        const rawName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        const cleanCode = rawCode.toUpperCase();
        const cleanName = rawName;

        // Code validation: 2-12 letters/digits only
        if (!/^[A-Z0-9]{2,12}$/.test(cleanCode)) {
            res.status(400).json({ message: 'Subject code must be 2-12 letters and digits only' });
            return;
        }

        // Name validation: 2-80 chars
        if (cleanName.length < 2 || cleanName.length > 80) {
            res.status(400).json({ message: 'Subject name must be between 2 and 80 characters' });
            return;
        }

        // Check duplicate code across all subjects case-insensitively
        const dupRes = await pool.query(
            'SELECT id FROM subjects WHERE UPPER(code) = UPPER($1) LIMIT 1',
            [cleanCode]
        );
        if (dupRes.rowCount && dupRes.rowCount > 0) {
            res.status(409).json({ code: 'SUBJECT_CODE_TAKEN', message: 'Subject code already taken' });
            return;
        }

        const insertRes = await pool.query(
            `INSERT INTO subjects (faculty_id, code, name)
             VALUES ($1, $2, $3)
             RETURNING id, code, name`,
            [facultyId, cleanCode, cleanName]
        );

        const newSub = insertRes.rows[0];
        res.status(201).json({
            id: newSub.id,
            code: newSub.code,
            name: newSub.name,
            session_count: 0
        });
    } catch (error: any) {
        if (error?.code === '23505') {
            res.status(409).json({ code: 'SUBJECT_CODE_TAKEN', message: 'Subject code already taken' });
            return;
        }
        console.error('Error creating subject:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const renameFacultySubject = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const subRes = await pool.query(
            'SELECT id, faculty_id FROM subjects WHERE id = $1',
            [id]
        );

        if (subRes.rowCount === 0) {
            res.status(404).json({ message: 'Subject not found' });
            return;
        }

        if (subRes.rows[0].faculty_id !== facultyId) {
            res.status(403).json({ message: 'Forbidden: You do not own this subject' });
            return;
        }

        const cleanName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        if (cleanName.length < 2 || cleanName.length > 80) {
            res.status(400).json({ message: 'Subject name must be between 2 and 80 characters' });
            return;
        }

        const updateRes = await pool.query(
            'UPDATE subjects SET name = $1 WHERE id = $2 RETURNING id, code, name',
            [cleanName, id]
        );

        res.status(200).json(updateRes.rows[0]);
    } catch (error) {
        console.error('Error renaming subject:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteFacultySubject = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const subRes = await pool.query(
            'SELECT id, faculty_id, code, master_sheet_path FROM subjects WHERE id = $1',
            [id]
        );

        if (subRes.rowCount === 0) {
            res.status(404).json({ message: 'Subject not found' });
            return;
        }

        const subject = subRes.rows[0];
        if (subject.faculty_id !== facultyId) {
            res.status(403).json({ message: 'Forbidden: You do not own this subject' });
            return;
        }

        // Check if subject has any ACTIVE session
        const activeSessRes = await pool.query(
            `SELECT id FROM attendance_sessions 
             WHERE subject_id = $1 AND status = 'ACTIVE' AND expires_at > NOW() 
             LIMIT 1`,
            [id]
        );
        if (activeSessRes.rowCount && activeSessRes.rowCount > 0) {
            res.status(409).json({
                code: 'SUBJECT_HAS_ACTIVE_SESSION',
                error: 'SUBJECT_HAS_ACTIVE_SESSION',
                message: 'End the live session first'
            });
            return;
        }

        // Check sessions of this subject
        const sessRes = await pool.query(
            'SELECT id FROM attendance_sessions WHERE subject_id = $1',
            [id]
        );
        const sessionIds = sessRes.rows.map(r => r.id);

        if (sessionIds.length > 0) {
            const rawConfirm = req.body?.confirm_code ?? req.body?.confirmCode;
            const confirmCode = typeof rawConfirm === 'string' ? rawConfirm.trim() : '';
            if (!confirmCode || confirmCode.toUpperCase() !== subject.code.toUpperCase()) {
                res.status(422).json({
                    code: 'CONFIRM_CODE_REQUIRED',
                    error: 'CONFIRM_CODE_REQUIRED',
                    message: 'Subject code confirmation required'
                });
                return;
            }
        }

        // In ONE database transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            if (sessionIds.length > 0) {
                await client.query('DELETE FROM attendance_records WHERE session_id = ANY($1::uuid[])', [sessionIds]);
                await client.query('DELETE FROM liveness_challenges WHERE session_id = ANY($1::uuid[])', [sessionIds]);
                await client.query('DELETE FROM verification_sessions WHERE session_id = ANY($1::uuid[])', [sessionIds]);
                await client.query('DELETE FROM session_exports WHERE session_id = ANY($1::uuid[])', [sessionIds]);
                await client.query('DELETE FROM attendance_sessions WHERE id = ANY($1::uuid[])', [sessionIds]);
            }

            await client.query('DELETE FROM subject_sheet_files WHERE subject_id = $1', [id]);
            await client.query('DELETE FROM enrollments WHERE subject_id = $1', [id]);
            await client.query('DELETE FROM subjects WHERE id = $1', [id]);

            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        // Storage cleanup after commit (log storage cleanup failures but don't fail request)
        for (const sId of sessionIds) {
            try {
                await deleteSessionExportFile(facultyId, sId);
            } catch (e) {
                console.error(`Storage cleanup failure for session export ${sId}:`, e);
            }
        }
        if (subject.master_sheet_path) {
            try {
                await deleteSubjectSheetFile(subject.master_sheet_path);
            } catch (e) {
                console.error(`Storage cleanup failure for master sheet ${subject.master_sheet_path}:`, e);
            }
        }

        res.status(200).json({ message: 'Subject deleted successfully' });
    } catch (error) {
        console.error('Error deleting subject:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSubjectHistory = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        // 1. Verify subject ownership
        const subjectRes = await pool.query(
            `SELECT id, code, name, faculty_id, master_sheet_path, master_sheet_updated_at 
             FROM subjects 
             WHERE id = $1`,
            [id]
        );

        if (subjectRes.rowCount === 0) {
            res.status(404).json({ message: 'Subject not found' });
            return;
        }

        const subject = subjectRes.rows[0];
        if (subject.faculty_id !== facultyId) {
            res.status(403).json({ message: 'Forbidden: You do not own this subject' });
            return;
        }

        // 2. Query non-ACTIVE sessions of this subject, newest first
        const sessionsRes = await pool.query(
            `SELECT id, created_at AS started_at, status 
             FROM attendance_sessions 
             WHERE subject_id = $1 AND status != 'ACTIVE' 
             ORDER BY created_at DESC`,
            [id]
        );

        const sessions = sessionsRes.rows;

        // 3. Query all students enrolled in the subject
        const enrolledRes = await pool.query(
            `SELECT u.id AS user_id, u.student_id, u.name, e.created_at AS enrolled_at 
             FROM enrollments e 
             JOIN users u ON e.student_id = u.id 
             WHERE e.subject_id = $1 
             ORDER BY u.student_id ASC, u.name ASC`,
            [id]
        );

        const enrolledStudents = enrolledRes.rows;

        // 4. Batch query attendance records if both sessions and enrolled students exist
        const recordsMap = new Map<string, { status: string; edited_at: any; edit_reason: string | null }>();

        if (sessions.length > 0 && enrolledStudents.length > 0) {
            const sessionIds = sessions.map(s => s.id);
            const studentIds = enrolledStudents.map(st => st.user_id);

            const recordsRes = await pool.query(
                `SELECT session_id, student_id, status, edit_reason, edited_at 
                 FROM attendance_records 
                 WHERE session_id = ANY($1::uuid[]) AND student_id = ANY($2::uuid[])`,
                [sessionIds, studentIds]
            );

            for (const r of recordsRes.rows) {
                recordsMap.set(`${r.student_id}:${r.session_id}`, {
                    status: r.status,
                    edited_at: r.edited_at,
                    edit_reason: r.edit_reason
                });
            }
        }

        // 5. Build students list using shared calculation
        const sessionIds = sessions.map(s => s.id);
        const students = enrolledStudents.map(student => {
            const stats = computeStudentAttendance(sessionIds, (sid) => recordsMap.get(`${student.user_id}:${sid}`)?.status);
            const records: Record<string, { status: 'APPROVED' | 'REJECTED' | 'PENDING' | null; edited: boolean; edit_reason: string | null }> = {};

            for (const session of sessions) {
                const rec = recordsMap.get(`${student.user_id}:${session.id}`);
                const status = (rec?.status as 'APPROVED' | 'REJECTED' | 'PENDING') || null;

                records[session.id] = {
                    status,
                    edited: Boolean(rec && (rec.edited_at || rec.edit_reason)),
                    edit_reason: rec?.edit_reason || null
                };
            }

            return {
                student_id: student.student_id || student.user_id,
                user_id: student.user_id,
                name: student.name,
                present: stats.present,
                total: stats.total,
                percentage: stats.percentage,
                records
            };
        });

        res.status(200).json({
            subject: {
                id: subject.id,
                code: subject.code,
                name: subject.name,
                master_sheet_path: subject.master_sheet_path || null,
                master_sheet_updated_at: subject.master_sheet_updated_at || null
            },
            sessions: sessions.map(s => ({
                id: s.id,
                started_at: s.started_at,
                status: s.status
            })),
            students
        });
    } catch (error) {
        console.error('Error fetching subject attendance history:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const uploadSubjectSheetController = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const subjectRes = await pool.query(
            `SELECT id, faculty_id, code FROM subjects WHERE id = $1`,
            [id]
        );

        if (subjectRes.rowCount === 0) {
            res.status(404).json({ message: 'Subject not found' });
            return;
        }

        const subject = subjectRes.rows[0];
        if (subject.faculty_id !== facultyId) {
            res.status(403).json({ message: 'Forbidden: You do not own this subject' });
            return;
        }

        if (!req.file || !req.file.buffer) {
            res.status(400).json({ message: 'No file uploaded' });
            return;
        }

        // Verify it opens with exceljs, else 400
        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.load(req.file.buffer as any);
        } catch (err) {
            res.status(400).json({ message: 'Invalid Excel file' });
            return;
        }

        const filePath = `${facultyId}/${id}.xlsx`;
        await uploadSubjectSheet(filePath, req.file.buffer as any, id, facultyId);

        await pool.query(
            `UPDATE subjects 
             SET master_sheet_path = $1, master_sheet_updated_at = NOW() 
             WHERE id = $2`,
            [filePath, id]
        );

        // Run updateSubjectSheet
        await updateSubjectSheet(id);

        res.status(200).json({
            message: 'Sheet uploaded successfully',
            master_sheet_path: filePath
        });
    } catch (error) {
        console.error('Error uploading master sheet:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const downloadSubjectSheetController = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        const { id } = req.params;

        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const subjectRes = await pool.query(
            `SELECT id, faculty_id, code, master_sheet_path FROM subjects WHERE id = $1`,
            [id]
        );

        if (subjectRes.rowCount === 0) {
            res.status(404).json({ message: 'Subject not found' });
            return;
        }

        const subject = subjectRes.rows[0];
        if (subject.faculty_id !== facultyId) {
            res.status(403).json({ message: 'Forbidden: You do not own this subject' });
            return;
        }

        if (!subject.master_sheet_path) {
            res.status(404).json({ error: 'NO_SHEET', message: 'No master sheet uploaded' });
            return;
        }

        // Run updateSubjectSheet then stream the file
        await updateSubjectSheet(id);

        const fileBuffer = await downloadSubjectSheet(subject.master_sheet_path, id);
        if (!fileBuffer) {
            res.status(404).json({ error: 'NO_SHEET', message: 'Master sheet file not found' });
            return;
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${subject.code}_master_attendance.xlsx"`);
        res.send(fileBuffer);
    } catch (error) {
        console.error('Error downloading master sheet:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const viewSubjectSheetController = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await markExpired();

        const user = req.user;
        const { id } = req.params;

        if (!user) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const subjectRes = await pool.query(
            `SELECT id, faculty_id, code, name, master_sheet_path, master_sheet_updated_at 
             FROM subjects 
             WHERE id = $1`,
            [id]
        );

        if (subjectRes.rowCount === 0) {
            res.status(404).json({ message: 'Subject not found' });
            return;
        }

        const subject = subjectRes.rows[0];

        if (user.role === 'FACULTY') {
            if (subject.faculty_id !== user.id) {
                res.status(403).json({ message: 'Forbidden: You do not own this subject' });
                return;
            }
        } else if (user.role === 'STUDENT') {
            const enrollRes = await pool.query(
                `SELECT id FROM enrollments WHERE subject_id = $1 AND student_id = $2`,
                [id, user.id]
            );
            if (enrollRes.rowCount === 0) {
                res.status(403).json({ message: 'Forbidden: You are not enrolled in this subject' });
                return;
            }
        } else {
            res.status(403).json({ message: 'Forbidden' });
            return;
        }

        if (!subject.master_sheet_path) {
            res.status(404).json({
                error: 'NO_SHEET',
                message: user.role === 'STUDENT'
                    ? "Your faculty hasn't set up the sheet yet"
                    : 'No master sheet uploaded'
            });
            return;
        }

        // Query non-ACTIVE sessions of the subject (oldest -> newest)
        const sessionsRes = await pool.query(
            `SELECT id, created_at 
             FROM attendance_sessions 
             WHERE subject_id = $1 AND status != 'ACTIVE' 
             ORDER BY created_at ASC`,
            [id]
        );
        const sessions = sessionsRes.rows;
        const sessionHeaders = sessions.map(s => formatSessionHeader(new Date(s.created_at)));

        // Query students based on role
        let students: Array<{ user_id: string; student_id: string; name: string; enrolled_at: any }> = [];
        if (user.role === 'FACULTY') {
            const studentsRes = await pool.query(
                `SELECT u.id AS user_id, u.student_id, u.name, e.created_at AS enrolled_at 
                 FROM enrollments e 
                 JOIN users u ON e.student_id = u.id 
                 WHERE e.subject_id = $1 
                 ORDER BY u.student_id ASC, u.name ASC`,
                [id]
            );
            students = studentsRes.rows;
        } else {
            // STUDENT: ONLY their own row
            const studentRes = await pool.query(
                `SELECT u.id AS user_id, u.student_id, u.name, e.created_at AS enrolled_at 
                 FROM users u
                 JOIN enrollments e ON e.student_id = u.id AND e.subject_id = $2
                 WHERE u.id = $1`,
                [user.id, id]
            );
            students = studentRes.rows;
        }

        // Fetch attendance records
        const recordsMap = new Map<string, string>();
        if (sessions.length > 0 && students.length > 0) {
            const sessionIds = sessions.map(s => s.id);
            const recordsRes = await pool.query(
                `SELECT session_id, student_id, status 
                 FROM attendance_records 
                 WHERE session_id = ANY($1::uuid[])`,
                [sessionIds]
            );
            for (const r of recordsRes.rows) {
                recordsMap.set(`${r.student_id}:${r.session_id}`, r.status);
            }
        }

        const sheetSessionIds = sessions.map(s => s.id);
        const rows = students.map(student => {
            const stats = computeStudentAttendance(sheetSessionIds, (sid) => recordsMap.get(`${student.user_id}:${sid}`));
            const cells: string[] = [];

            for (const session of sessions) {
                const status = recordsMap.get(`${student.user_id}:${session.id}`);
                let text = 'A';
                if (isRecordPresent(status)) {
                    text = 'P';
                } else if (status === 'REJECTED') {
                    text = 'R';
                } else if (status === 'PENDING') {
                    text = 'PEND';
                } else {
                    text = 'A';
                }
                cells.push(text);
            }

            return {
                student_id: student.student_id || student.user_id,
                name: student.name,
                cells,
                present: stats.present,
                total: stats.total,
                percentage: stats.percentage
            };
        });

        res.status(200).json({
            sessions: sessionHeaders,
            rows,
            updated_at: subject.master_sheet_updated_at || new Date().toISOString()
        });
    } catch (error) {
        console.error('Error viewing subject sheet:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

const publicSubjectIpBuckets = new Map<string, number[]>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const timestamps = (publicSubjectIpBuckets.get(key) || []).filter(ts => now - ts < windowMs);
    if (timestamps.length >= maxRequests) {
        publicSubjectIpBuckets.set(key, timestamps);
        return false;
    }
    timestamps.push(now);
    publicSubjectIpBuckets.set(key, timestamps);
    return true;
}

function getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
}

export const getPublicSubjects = async (req: Request, res: Response): Promise<void> => {
    const clientIp = getClientIp(req);
    // Rate limit: 60/hour per IP
    if (!checkRateLimit(`public_subjects:${clientIp}`, 60, 60 * 60 * 1000)) {
        res.status(429).json({ message: 'Too many requests. Please try again later.' });
        return;
    }

    try {
        const subjectsRes = await pool.query(
            `SELECT id, code, name 
             FROM subjects 
             ORDER BY name ASC`
        );
        res.status(200).json(subjectsRes.rows);
    } catch (error) {
        console.error('Error fetching public subjects:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const enrollSubject = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const studentId = req.user?.id;
        if (!studentId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        // Rate limit: 20/hour per user
        if (!checkRateLimit(`enroll:${studentId}`, 20, 60 * 60 * 1000)) {
            res.status(429).json({ message: 'Too many enrollment requests. Please try again later.' });
            return;
        }

        const { subjectId } = req.body;
        if (!subjectId || typeof subjectId !== 'string') {
            res.status(400).json({ message: 'Subject ID is required' });
            return;
        }

        // Subject must exist (400)
        const subjectRes = await pool.query(
            `SELECT id, code, name 
             FROM subjects 
             WHERE id = $1`,
            [subjectId.trim()]
        );

        if (subjectRes.rowCount === 0) {
            res.status(400).json({ message: 'Subject does not exist' });
            return;
        }

        const targetSubjectId = subjectRes.rows[0].id;

        // Get default class if exists
        let classRes = await pool.query('SELECT id FROM classes LIMIT 1');
        let classId = classRes.rows[0]?.id || null;

        // INSERT ... ON CONFLICT DO NOTHING
        await pool.query(
            `INSERT INTO enrollments (student_id, subject_id, class_id, created_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (student_id, subject_id) DO NOTHING`,
            [studentId, targetSubjectId, classId]
        );

        // Returns the student's updated enrolled subjects
        const enrolledRes = await pool.query(
            `SELECT s.id, s.code, s.name, e.created_at AS enrolled_at
             FROM enrollments e
             JOIN subjects s ON e.subject_id = s.id
             WHERE e.student_id = $1
             ORDER BY s.name ASC`,
            [studentId]
        );

        res.status(200).json(enrolledRes.rows);
    } catch (error) {
        console.error('Error enrolling subject:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

