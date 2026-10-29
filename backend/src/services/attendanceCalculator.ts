/**
 * Shared attendance calculation service.
 * Used across:
 * 1. Faculty subject history grid (getSubjectHistory)
 * 2. Student My Records screen (getMyAttendance)
 * 3. Excel master sheet generator (performUpdateSubjectSheet)
 * 4. Master sheet view API (viewSubjectSheetController)
 *
 * Rules:
 * - present: records with status Present ('APPROVED' or 'Present')
 * - total: all non-deleted sessions of the subject
 * - percentage: present / total (rounded to nearest integer; 0 if total is 0)
 * - Pending records count as not present until approved.
 */

export interface AttendanceStats {
    present: number;
    total: number;
    percentage: number;
}

/**
 * Checks if an attendance record status counts as "Present".
 * 'APPROVED' and 'Present' count as present.
 * 'PENDING', 'REJECTED', 'Absent', null, undefined count as not present.
 */
export function isRecordPresent(status: string | null | undefined): boolean {
    if (!status) return false;
    const s = status.trim().toUpperCase();
    return s === 'APPROVED' || s === 'PRESENT';
}

/**
 * Calculates present, total, and percentage.
 */
export function calculateAttendanceStats(totalSessions: number, presentSessions: number): AttendanceStats {
    const present = Math.max(0, presentSessions);
    const total = Math.max(0, totalSessions);
    const percentage = total > 0 ? Math.round((present / total) * 100) : 0;
    return { present, total, percentage };
}

/**
 * Computes attendance stats for a student given a list of non-deleted session IDs
 * and a status lookup function.
 */
export function computeStudentAttendance(
    sessionIds: string[],
    getRecordStatus: (sessionId: string) => string | null | undefined
): AttendanceStats {
    let present = 0;
    for (const sid of sessionIds) {
        if (isRecordPresent(getRecordStatus(sid))) {
            present++;
        }
    }
    return calculateAttendanceStats(sessionIds.length, present);
}
