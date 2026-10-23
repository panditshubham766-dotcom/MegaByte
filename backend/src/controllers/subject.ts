import { Response } from 'express';
import ExcelJS from 'exceljs';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { markExpired } from './session';
import { formatSessionHeader, updateSubjectSheet } from '../services/subjectSheet';
import { uploadSubjectSheet, downloadSubjectSheet } from '../services/storageHelper';

export const getFacultySubjects = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const facultyId = req.user?.id;
        if (!facultyId) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const subjectsRes = await pool.query(
            `SELECT id, code, name 
             FROM subjects 
             WHERE faculty_id = $1 
             ORDER BY name ASC`,
            [facultyId]
        );

        res.status(200).json(subjectsRes.rows);
    } catch (error) {
        console.error('Error fetching faculty subjects:', error);
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
            `SELECT u.id AS user_id, u.student_id, u.name 
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

        // 5. Build students list
        const total = sessions.length;
        const students = enrolledStudents.map(student => {
            let presentCount = 0;
            const records: Record<string, { status: 'APPROVED' | 'REJECTED' | 'PENDING' | null; edited: boolean; edit_reason: string | null }> = {};

            for (const session of sessions) {
                const rec = recordsMap.get(`${student.user_id}:${session.id}`);
                const status = (rec?.status as 'APPROVED' | 'REJECTED' | 'PENDING') || null;

                if (status === 'APPROVED') {
                    presentCount++;
                }

                records[session.id] = {
                    status,
                    edited: Boolean(rec && (rec.edited_at || rec.edit_reason)),
                    edit_reason: rec?.edit_reason || null
                };
            }

            const percentage = total > 0 ? Math.round((presentCount / total) * 100) : 0;

            return {
                student_id: student.student_id || student.user_id,
                user_id: student.user_id,
                name: student.name,
                present: presentCount,
                total,
                percentage,
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
        let students: Array<{ user_id: string; student_id: string; name: string }> = [];
        if (user.role === 'FACULTY') {
            const studentsRes = await pool.query(
                `SELECT u.id AS user_id, u.student_id, u.name 
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
                `SELECT id AS user_id, student_id, name 
                 FROM users 
                 WHERE id = $1`,
                [user.id]
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

        const rows = students.map(student => {
            let presentCount = 0;
            const cells: string[] = [];

            for (const session of sessions) {
                const status = recordsMap.get(`${student.user_id}:${session.id}`);
                let text = 'A';
                if (status === 'APPROVED') {
                    text = 'P';
                    presentCount++;
                } else if (status === 'REJECTED') {
                    text = 'R';
                } else if (status === 'PENDING') {
                    text = 'PEND';
                } else {
                    text = 'A';
                }
                cells.push(text);
            }

            const total = sessions.length;
            const percentage = total > 0 ? Math.round((presentCount / total) * 100) : 0;

            return {
                student_id: student.student_id || student.user_id,
                name: student.name,
                cells,
                present: presentCount,
                total,
                percentage
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
