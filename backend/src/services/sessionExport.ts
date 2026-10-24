import ExcelJS from 'exceljs';
import pool from '../config/db';

const sessionWriteQueues = new Map<string, Promise<void>>();
const submissionDebounceTimers = new Map<string, NodeJS.Timeout>();

/**
 * Escapes leading formula trigger characters (=, +, -, @) to prevent Excel formula injection
 * and ensures output is a plain string.
 */
function sanitizeText(val: any): string {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (/^[=+\-@]/.test(str)) {
        return `'${str}`;
    }
    return str;
}

/**
 * Builds an Excel workbook for the given attendance session.
 * Sheet "Attendance", header row 1 (bold, frozen, autofilter, sensible widths).
 * Columns: student_id, name, email, status, submitted_at, reviewed_at, face_match_score, liveness_score.
 * Status: APPROVED->PRESENT, REJECTED, PENDING, no record->ABSENT.
 * Rows: all students enrolled in the session's subject; if none, only students with a record.
 * Timestamps as real Excel date-times in UTC.
 * Text cells as plain strings (never formulas).
 */
export async function buildSessionWorkbook(sessionId: string): Promise<Buffer> {
    const sessionRes = await pool.query(
        `SELECT id, faculty_id, subject_id, random_code, created_at, expires_at, ended_at 
         FROM attendance_sessions 
         WHERE id = $1`,
        [sessionId]
    );

    if (sessionRes.rowCount === 0) {
        throw new Error(`Session not found: ${sessionId}`);
    }

    const session = sessionRes.rows[0];

    // 1. Fetch students enrolled in the session's subject
    const enrolledRes = await pool.query(
        `SELECT u.id AS user_id, u.student_id, u.name, u.email
         FROM enrollments e
         JOIN users u ON e.student_id = u.id
         WHERE e.subject_id = $1
         ORDER BY u.student_id ASC, u.name ASC`,
        [session.subject_id]
    );

    interface ExportRow {
        student_id: string;
        name: string;
        email: string;
        status: string;
        submitted_at: Date | null;
        reviewed_at: Date | null;
        face_match_score: number | null;
        liveness_score: number | null;
    }

    const exportRows: ExportRow[] = [];

    if (enrolledRes.rowCount && enrolledRes.rowCount > 0) {
        // Fetch attendance records for this session
        const recordsRes = await pool.query(
            `SELECT student_id, status, submitted_at, reviewed_at, face_match_score, liveness_score
             FROM attendance_records
             WHERE session_id = $1`,
            [sessionId]
        );

        const recordMap = new Map<string, any>();
        for (const rec of recordsRes.rows) {
            recordMap.set(rec.student_id, rec);
        }

        for (const student of enrolledRes.rows) {
            const rec = recordMap.get(student.user_id);
            let status = 'ABSENT';
            let submittedAt: Date | null = null;
            let reviewedAt: Date | null = null;
            let faceMatchScore: number | null = null;
            let livenessScore: number | null = null;

            if (rec) {
                if (rec.status === 'APPROVED') {
                    status = 'PRESENT';
                } else if (rec.status === 'REJECTED') {
                    status = 'REJECTED';
                } else if (rec.status === 'PENDING') {
                    status = 'PENDING';
                } else {
                    status = rec.status;
                }

                submittedAt = rec.submitted_at ? new Date(rec.submitted_at) : null;
                reviewedAt = rec.reviewed_at ? new Date(rec.reviewed_at) : null;
                faceMatchScore = rec.face_match_score !== null && rec.face_match_score !== undefined
                    ? Number(rec.face_match_score)
                    : null;
                livenessScore = rec.liveness_score !== null && rec.liveness_score !== undefined
                    ? Number(rec.liveness_score)
                    : null;
            }

            exportRows.push({
                student_id: student.student_id || '',
                name: student.name || '',
                email: student.email || '',
                status,
                submitted_at: submittedAt,
                reviewed_at: reviewedAt,
                face_match_score: faceMatchScore,
                liveness_score: livenessScore
            });
        }
    } else {
        // Fallback: if no students are enrolled in the subject, only students with a record
        const fallbackRes = await pool.query(
            `SELECT u.student_id, u.name, u.email,
                    a.status, a.submitted_at, a.reviewed_at, a.face_match_score, a.liveness_score
             FROM attendance_records a
             JOIN users u ON a.student_id = u.id
             WHERE a.session_id = $1
             ORDER BY u.student_id ASC, u.name ASC`,
            [sessionId]
        );

        for (const row of fallbackRes.rows) {
            let status = 'PENDING';
            if (row.status === 'APPROVED') {
                status = 'PRESENT';
            } else if (row.status === 'REJECTED') {
                status = 'REJECTED';
            } else if (row.status === 'PENDING') {
                status = 'PENDING';
            } else {
                status = row.status;
            }

            exportRows.push({
                student_id: row.student_id || '',
                name: row.name || '',
                email: row.email || '',
                status,
                submitted_at: row.submitted_at ? new Date(row.submitted_at) : null,
                reviewed_at: row.reviewed_at ? new Date(row.reviewed_at) : null,
                face_match_score: row.face_match_score !== null && row.face_match_score !== undefined
                    ? Number(row.face_match_score)
                    : null,
                liveness_score: row.liveness_score !== null && row.liveness_score !== undefined
                    ? Number(row.liveness_score)
                    : null
            });
        }
    }

    // 2. Build workbook with ExcelJS
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Smart Attendance System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Attendance', {
        views: [{ state: 'frozen', ySplit: 1 }]
    });

    worksheet.columns = [
        { header: 'student_id', key: 'student_id', width: 16 },
        { header: 'name', key: 'name', width: 24 },
        { header: 'email', key: 'email', width: 30 },
        { header: 'status', key: 'status', width: 14 },
        { header: 'submitted_at (UTC)', key: 'submitted_at', width: 22 },
        { header: 'reviewed_at (UTC)', key: 'reviewed_at', width: 22 },
        { header: 'face_match_score', key: 'face_match_score', width: 18 },
        { header: 'liveness_score', key: 'liveness_score', width: 18 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    worksheet.autoFilter = 'A1:H1';

    for (const item of exportRows) {
        const addedRow = worksheet.addRow({
            student_id: sanitizeText(item.student_id),
            name: sanitizeText(item.name),
            email: sanitizeText(item.email),
            status: sanitizeText(item.status),
            submitted_at: item.submitted_at,
            reviewed_at: item.reviewed_at,
            face_match_score: item.face_match_score,
            liveness_score: item.liveness_score,
        });

        // Plain string cells
        addedRow.getCell(1).numFmt = '@';
        addedRow.getCell(2).numFmt = '@';
        addedRow.getCell(3).numFmt = '@';
        addedRow.getCell(4).numFmt = '@';

        // Real Excel date-time format in UTC
        if (item.submitted_at) {
            addedRow.getCell(5).numFmt = 'yyyy-mm-dd hh:mm:ss';
        }
        if (item.reviewed_at) {
            addedRow.getCell(6).numFmt = 'yyyy-mm-dd hh:mm:ss';
        }

        // Decimal numbers
        if (item.face_match_score !== null && item.face_match_score !== undefined) {
            addedRow.getCell(7).numFmt = '0.00';
        }
        if (item.liveness_score !== null && item.liveness_score !== undefined) {
            addedRow.getCell(8).numFmt = '0.00';
        }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

/**
 * Internal worker to generate workbook and upsert into session_exports.
 */
async function performWriteSessionExport(sessionId: string): Promise<void> {
    const sessionRes = await pool.query(
        'SELECT faculty_id FROM attendance_sessions WHERE id = $1',
        [sessionId]
    );
    if (sessionRes.rowCount === 0) {
        return;
    }
    const facultyId = sessionRes.rows[0].faculty_id;
    const fileBuffer = await buildSessionWorkbook(sessionId);

    await pool.query(
        `INSERT INTO session_exports (session_id, faculty_id, file, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (session_id)
         DO UPDATE SET faculty_id = EXCLUDED.faculty_id, file = EXCLUDED.file, updated_at = NOW()`,
        [sessionId, facultyId, fileBuffer]
    );
}

/**
 * Upserts session export into session_exports in-memory without disk I/O.
 * Serializes writes per session in-process.
 */
export async function writeSessionExport(sessionId: string): Promise<void> {
    // Clear any pending debounced submission export for this session since we are writing now
    const pendingTimer = submissionDebounceTimers.get(sessionId);
    if (pendingTimer) {
        clearTimeout(pendingTimer);
        submissionDebounceTimers.delete(sessionId);
    }

    const previousPromise = sessionWriteQueues.get(sessionId) || Promise.resolve();
    const currentPromise = previousPromise
        .catch(() => {})
        .then(() => performWriteSessionExport(sessionId));

    sessionWriteQueues.set(sessionId, currentPromise);

    try {
        await currentPromise;
    } finally {
        if (sessionWriteQueues.get(sessionId) === currentPromise) {
            sessionWriteQueues.delete(sessionId);
        }
    }
}

/**
 * Debounces submission-triggered export calls per session by 2s (trailing).
 */
export function triggerDebouncedSubmissionExport(sessionId: string): void {
    const existing = submissionDebounceTimers.get(sessionId);
    if (existing) {
        clearTimeout(existing);
    }

    const timer = setTimeout(() => {
        submissionDebounceTimers.delete(sessionId);
        writeSessionExport(sessionId).catch(err => {
            console.error(`Error in debounced session export for ${sessionId}:`, err);
        });
    }, 2000);

    submissionDebounceTimers.set(sessionId, timer);
}
