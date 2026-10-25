import ExcelJS from 'exceljs';
import pool from '../config/db';
import { uploadSubjectSheet, downloadSubjectSheet } from './storageHelper';

const subjectQueues = new Map<string, Promise<void>>();

/**
 * Formats a Date object to "DD-MMM-YYYY HH:mm" in EXPORT_TIMEZONE (default: Asia/Kolkata).
 */
export function formatSessionHeader(date: Date): string {
    const tz = process.env.EXPORT_TIMEZONE || 'Asia/Kolkata';
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).formatToParts(date);

        const day = parts.find(p => p.type === 'day')?.value || '';
        const month = parts.find(p => p.type === 'month')?.value || '';
        const year = parts.find(p => p.type === 'year')?.value || '';
        const hour = parts.find(p => p.type === 'hour')?.value || '';
        const minute = parts.find(p => p.type === 'minute')?.value || '';
        return `${day}-${month}-${year} ${hour}:${minute}`;
    } catch {
        return date.toISOString().replace('T', ' ').substring(0, 16);
    }
}

/**
 * Worker that downloads the existing master workbook, removes 'MegaByte Attendance' if present,
 * rebuilds it from the database, and uploads the updated workbook back to Supabase Storage.
 */
async function performUpdateSubjectSheet(subjectId: string): Promise<void> {
    const subjectRes = await pool.query(
        `SELECT id, faculty_id, master_sheet_path 
         FROM subjects 
         WHERE id = $1`,
        [subjectId]
    );

    if (subjectRes.rowCount === 0) {
        return;
    }

    const subject = subjectRes.rows[0];
    if (!subject.master_sheet_path) {
        return;
    }

    const fileBuffer = await downloadSubjectSheet(subject.master_sheet_path, subjectId);
    if (!fileBuffer) {
        console.error(`Cannot update master sheet: file buffer not found for ${subject.master_sheet_path}`);
        return;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as any);

    // Remove existing "MegaByte Attendance" sheet if present
    const existingSheet = workbook.getWorksheet('MegaByte Attendance');
    if (existingSheet) {
        workbook.removeWorksheet(existingSheet.id);
    }

    // Add new "MegaByte Attendance" worksheet
    const worksheet = workbook.addWorksheet('MegaByte Attendance');

    // Bold frozen header and first two columns frozen
    worksheet.views = [
        { state: 'frozen', xSplit: 2, ySplit: 1 }
    ];

    // Query non-ACTIVE sessions of the subject (oldest -> newest)
    const sessionsRes = await pool.query(
        `SELECT id, created_at 
         FROM attendance_sessions 
         WHERE subject_id = $1 AND status != 'ACTIVE' 
         ORDER BY created_at ASC`,
        [subjectId]
    );
    const sessions = sessionsRes.rows;

    // Build session headers
    const sessionHeaders = sessions.map(s => formatSessionHeader(new Date(s.created_at)));
    const headers = ['Student ID', 'Name', ...sessionHeaders, 'Present', 'Total', '%'];

    const headerRow = worksheet.getRow(1);
    headerRow.values = headers;
    headerRow.font = { bold: true };

    // Query all students enrolled in the subject, sorted by student_id
    const studentsRes = await pool.query(
        `SELECT u.id AS user_id, u.student_id, u.name, e.created_at AS enrolled_at 
         FROM enrollments e 
         JOIN users u ON e.student_id = u.id 
         WHERE e.subject_id = $1 
         ORDER BY u.student_id ASC, u.name ASC`,
        [subjectId]
    );
    const students = studentsRes.rows;

    // Fetch attendance records for non-ACTIVE sessions
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

    // Fills for P and A
    const greenFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD4EDDA' }
    };
    const redFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8D7DA' }
    };

    // Populate rows
    for (const student of students) {
        let presentCount = 0;
        let studentTotal = 0;
        const cells: string[] = [];

        for (const session of sessions) {
            if (student.enrolled_at && new Date(session.created_at).getTime() < new Date(student.enrolled_at).getTime()) {
                cells.push('-');
                continue;
            }

            studentTotal++;
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

        const percentage = studentTotal > 0 ? Math.round((presentCount / studentTotal) * 100) : 0;

        const rowValues = [
            student.student_id || student.user_id,
            student.name,
            ...cells,
            presentCount,
            studentTotal,
            `${percentage}%`
        ];

        const addedRow = worksheet.addRow(rowValues);

        // Apply fills for session cells (columns 3 to 2 + sessionHeaders.length)
        for (let i = 0; i < cells.length; i++) {
            const cell = addedRow.getCell(3 + i);
            if (cells[i] === 'P') {
                cell.fill = greenFill;
            } else if (cells[i] === 'A') {
                cell.fill = redFill;
            }
        }
    }

    // Set sensible column widths
    worksheet.getColumn(1).width = 16;
    worksheet.getColumn(2).width = 24;
    for (let i = 0; i < sessionHeaders.length; i++) {
        worksheet.getColumn(3 + i).width = 20;
    }
    worksheet.getColumn(3 + sessionHeaders.length).width = 10;
    worksheet.getColumn(4 + sessionHeaders.length).width = 10;
    worksheet.getColumn(5 + sessionHeaders.length).width = 10;

    // Write workbook to buffer and upload
    const outBuffer = await workbook.xlsx.writeBuffer();
    await uploadSubjectSheet(
        subject.master_sheet_path,
        Buffer.from(outBuffer),
        subjectId,
        subject.faculty_id
    );

    // Update master_sheet_updated_at in DB
    await pool.query(
        `UPDATE subjects 
         SET master_sheet_updated_at = NOW() 
         WHERE id = $1`,
        [subjectId]
    );
}

/**
 * Updates the master attendance sheet for a subject.
 * Serializes writes per subject in-process. Never throws to callers (logs errors).
 */
export async function updateSubjectSheet(subjectId: string): Promise<void> {
    if (!subjectId) return;

    const previous = subjectQueues.get(subjectId) || Promise.resolve();
    const current = previous
        .catch(() => {})
        .then(() => performUpdateSubjectSheet(subjectId))
        .catch(err => {
            console.error(`Error in updateSubjectSheet for subject ${subjectId}:`, err);
        });

    subjectQueues.set(subjectId, current);

    try {
        await current;
    } finally {
        if (subjectQueues.get(subjectId) === current) {
            subjectQueues.delete(subjectId);
        }
    }
}
