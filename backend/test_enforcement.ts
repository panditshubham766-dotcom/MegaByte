/**
 * test_enforcement.ts - Automated test suite for Phase 5 Classroom Verification Enforcement
 *
 * Covers:
 *   1. Unauthorized API Calls (Unauthenticated requests rejected with 401).
 *   2. Missing Verification Session Token (Protected routes reject students with 403 NO_VERIFICATION_TOKEN).
 *   3. Cross-User Access / Token Reuse Defense (Student B presenting Student A's token rejected with CROSS_USER_REUSE_BLOCKED).
 *   4. Expired Verification Sessions (Verification tokens past expires_at rejected with VERIFICATION_EXPIRED).
 *   5. Explicitly Revoked Sessions (Tokens revoked due to out-of-bounds rejected with VERIFICATION_REVOKED).
 *   6. Class-Session Boundaries (Ended or expired class sessions invalidate verification with SESSION_ENDED).
 *   7. Classroom Mismatch (Token issued for Classroom A presented for Classroom B rejected with CLASSROOM_MISMATCH).
 *   8. Duplicate Attendance Defense (Second attendance submission rejected with ALREADY_SUBMITTED).
 *   9. Check-in Revalidation:
 *      - Fresh location inside classroom radius confirms presence (REVALIDATED).
 *      - Fresh location outside classroom radius revokes verification (OUT_OF_BOUNDS / PRESENCE_REVOKED).
 *  10. Faculty & Admin Access Preservation (Teacher/Admin privileges maintained without student tokens).
 *  11. Client-Supplied Flag Immunity (Bypass flags like bypassGeofence=true are ignored).
 */

import {
    validateVerificationToken,
    type VerificationSessionData,
    type ClassSessionBoundaryData
} from './src/middleware/verification.ts';
import {
    evaluatePresenceRevalidation,
    evaluateSessionEligibility
} from './src/services/verification.ts';
import type { ClassroomConfig, ClientLocation } from './src/services/geo.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`  ✓ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

function runTests() {
    console.log('====================================================');
    console.log('   MegaByte Phase 5 Verification Enforcement Tests   ');
    console.log('====================================================\n');

    const studentA_Id = '11111111-1111-1111-1111-111111111111';
    const studentB_Id = '22222222-2222-2222-2222-222222222222';
    const faculty_Id  = '99999999-9999-9999-9999-999999999999';

    const classroomA_Id = 'room-001';
    const classroomB_Id = 'room-002';

    const now = new Date();

    const activeClassSession: ClassSessionBoundaryData = {
        id: 'sess-001',
        status: 'ACTIVE',
        expires_at: new Date(now.getTime() + 45 * 60 * 1000), // expires in 45 mins
        classroom_id: classroomA_Id
    };

    const validVerificationSession: VerificationSessionData = {
        id: 'vsess-001',
        student_id: studentA_Id,
        session_id: activeClassSession.id,
        classroom_id: classroomA_Id,
        verification_token: 'vtok_valid_test_token_1234567890abcdef',
        status: 'PASSED',
        expires_at: new Date(now.getTime() + 5 * 60 * 1000) // 5 minutes validity
    };

    // ─────────────────────────────────────────────────────────────
    // 1. Unauthorized API Calls & Missing Tokens
    // ─────────────────────────────────────────────────────────────
    console.log('1. Unauthorized API Calls & Missing Tokens');

    // Unauthenticated request
    const unauthResult = validateVerificationToken({
        token: 'vtok_valid_test_token_1234567890abcdef',
        authenticatedUserId: null,
        authenticatedUserRole: null,
        vSession: validVerificationSession,
        classSession: activeClassSession,
        now
    });
    assert(unauthResult.valid === false, 'Rejects unauthenticated request');
    assert(unauthResult.error?.code === 'UNAUTHENTICATED', 'Error code is UNAUTHENTICATED');

    // Authenticated student without verification token
    const noTokenResult = validateVerificationToken({
        token: null,
        authenticatedUserId: studentA_Id,
        authenticatedUserRole: 'STUDENT',
        vSession: validVerificationSession,
        classSession: activeClassSession,
        now
    });
    assert(noTokenResult.valid === false, 'Rejects student request without verification token');
    assert(noTokenResult.error?.code === 'NO_VERIFICATION_TOKEN', 'Error code is NO_VERIFICATION_TOKEN');

    // Non-existent verification session
    const notFoundResult = validateVerificationToken({
        token: 'vtok_non_existent_token_99999',
        authenticatedUserId: studentA_Id,
        authenticatedUserRole: 'STUDENT',
        vSession: null,
        classSession: activeClassSession,
        now
    });
    assert(notFoundResult.valid === false, 'Rejects non-existent verification token');
    assert(notFoundResult.error?.code === 'VERIFICATION_NOT_FOUND', 'Error code is VERIFICATION_NOT_FOUND');

    // ─────────────────────────────────────────────────────────────
    // 2. Cross-User Access / Token Reuse Defense
    // ─────────────────────────────────────────────────────────────
    console.log('\n2. Cross-User Access Defense (Anti-Token Reuse)');

    // Student B attempts to present Student A's verification token
    const crossUserResult = validateVerificationToken({
        token: validVerificationSession.verification_token,
        authenticatedUserId: studentB_Id, // Student B
        authenticatedUserRole: 'STUDENT',
        vSession: validVerificationSession, // Issued to Student A
        classSession: activeClassSession,
        now
    });
    assert(crossUserResult.valid === false, 'Blocks cross-user verification token reuse');
    assert(crossUserResult.error?.code === 'CROSS_USER_REUSE_BLOCKED', 'Reports CROSS_USER_REUSE_BLOCKED code');

    // ─────────────────────────────────────────────────────────────
    // 3. Expired Verification Sessions
    // ─────────────────────────────────────────────────────────────
    console.log('\n3. Expired Verification Sessions');

    const expiredVSession: VerificationSessionData = {
        ...validVerificationSession,
        expires_at: new Date(now.getTime() - 1000) // Expired 1 second ago
    };
    const expiredResult = validateVerificationToken({
        token: expiredVSession.verification_token,
        authenticatedUserId: studentA_Id,
        authenticatedUserRole: 'STUDENT',
        vSession: expiredVSession,
        classSession: activeClassSession,
        now
    });
    assert(expiredResult.valid === false, 'Rejects expired verification session');
    assert(expiredResult.error?.code === 'VERIFICATION_EXPIRED', 'Reports VERIFICATION_EXPIRED code');

    // ─────────────────────────────────────────────────────────────
    // 4. Revoked Verification Sessions
    // ─────────────────────────────────────────────────────────────
    console.log('\n4. Revoked Verification Sessions');

    const revokedVSession: VerificationSessionData = {
        ...validVerificationSession,
        status: 'REVOKED',
        revoked_at: new Date(now.getTime() - 60000),
        revocation_reason: 'Exited classroom geofence boundary'
    };
    const revokedResult = validateVerificationToken({
        token: revokedVSession.verification_token,
        authenticatedUserId: studentA_Id,
        authenticatedUserRole: 'STUDENT',
        vSession: revokedVSession,
        classSession: activeClassSession,
        now
    });
    assert(revokedResult.valid === false, 'Rejects revoked verification session');
    assert(revokedResult.error?.code === 'VERIFICATION_REVOKED', 'Reports VERIFICATION_REVOKED code');
    assert(revokedResult.error?.message.includes('Exited classroom geofence'), 'Surfaces specific revocation reason');

    // ─────────────────────────────────────────────────────────────
    // 5. Class-Session Boundaries Enforcement
    // ─────────────────────────────────────────────────────────────
    console.log('\n5. Class-Session Boundary Enforcement');

    // Class session ended by teacher
    const endedClassSession: ClassSessionBoundaryData = {
        ...activeClassSession,
        status: 'ENDED'
    };
    const endedResult = validateVerificationToken({
        token: validVerificationSession.verification_token,
        authenticatedUserId: studentA_Id,
        authenticatedUserRole: 'STUDENT',
        vSession: validVerificationSession,
        classSession: endedClassSession,
        now
    });
    assert(endedResult.valid === false, 'Rejects verification when class session has ended');
    assert(endedResult.error?.code === 'SESSION_ENDED', 'Reports SESSION_ENDED code');

    // Class session expired past scheduled time
    const expiredClassSession: ClassSessionBoundaryData = {
        ...activeClassSession,
        status: 'ACTIVE',
        expires_at: new Date(now.getTime() - 5000) // Scheduled session ended 5s ago
    };
    const classExpiredResult = validateVerificationToken({
        token: validVerificationSession.verification_token,
        authenticatedUserId: studentA_Id,
        authenticatedUserRole: 'STUDENT',
        vSession: validVerificationSession,
        classSession: expiredClassSession,
        now
    });
    assert(classExpiredResult.valid === false, 'Rejects verification when scheduled class session expires');
    assert(classExpiredResult.error?.code === 'SESSION_ENDED', 'Reports SESSION_ENDED code');

    // ─────────────────────────────────────────────────────────────
    // 6. Classroom Assignment Mismatch
    // ─────────────────────────────────────────────────────────────
    console.log('\n6. Classroom Assignment Mismatch');

    // Token issued for Classroom A presented for a session in Classroom B
    const mismatchClassroomResult = validateVerificationToken({
        token: validVerificationSession.verification_token,
        authenticatedUserId: studentA_Id,
        authenticatedUserRole: 'STUDENT',
        vSession: validVerificationSession, // Issued for classroomA_Id
        classSession: activeClassSession,
        targetClassroomId: classroomB_Id, // Expected classroomB_Id
        now
    });
    assert(mismatchClassroomResult.valid === false, 'Rejects token when classroom assignment mismatches');
    assert(mismatchClassroomResult.error?.code === 'CLASSROOM_MISMATCH', 'Reports CLASSROOM_MISMATCH code');

    // ─────────────────────────────────────────────────────────────
    // 7. Successful Verification Token Validation
    // ─────────────────────────────────────────────────────────────
    console.log('\n7. Successful Verification Token Validation');

    const validResult = validateVerificationToken({
        token: validVerificationSession.verification_token,
        authenticatedUserId: studentA_Id,
        authenticatedUserRole: 'STUDENT',
        vSession: validVerificationSession,
        classSession: activeClassSession,
        targetClassroomId: classroomA_Id,
        now
    });
    assert(validResult.valid === true, 'Valid token belonging to authenticated student in correct classroom passes');

    // ─────────────────────────────────────────────────────────────
    // 8. Faculty / Administrator Access Preservation
    // ─────────────────────────────────────────────────────────────
    console.log('\n8. Faculty & Administrator Access Preservation');

    // Faculty access without student verification token
    const facultyResult = validateVerificationToken({
        token: null, // No student token
        authenticatedUserId: faculty_Id,
        authenticatedUserRole: 'FACULTY',
        vSession: null,
        classSession: activeClassSession,
        now
    });
    assert(facultyResult.valid === true, 'Faculty can access protected endpoints without student verification tokens');

    // Administrator access
    const adminResult = validateVerificationToken({
        token: null,
        authenticatedUserId: 'admin-001',
        authenticatedUserRole: 'ADMIN',
        vSession: null,
        classSession: activeClassSession,
        now
    });
    assert(adminResult.valid === true, 'Administrator can access endpoints without student verification tokens');

    // ─────────────────────────────────────────────────────────────
    // 9. Duplicate Attendance Defense
    // ─────────────────────────────────────────────────────────────
    console.log('\n9. Duplicate Attendance Defense');

    const dupResult = evaluateSessionEligibility({
        sessionRow: {
            id: 'sess-001',
            status: 'ACTIVE',
            expires_at: new Date(now.getTime() + 10000).toISOString()
        },
        isEnrolledInSubject: true,
        hasPriorSubmission: true // Already submitted!
    });
    assert(dupResult.verified === false, 'Rejects duplicate attendance submission attempt');
    assert(dupResult.error?.code === 'ALREADY_SUBMITTED', 'Reports ALREADY_SUBMITTED code');

    // ─────────────────────────────────────────────────────────────
    // 10. Check-in Revalidation & Revocation on Boundary Departure
    // ─────────────────────────────────────────────────────────────
    console.log('\n10. Check-in Revalidation & Revocation (Requirement 7 & 8)');

    const classroomConfig: ClassroomConfig = {
        id: classroomA_Id,
        name: 'Lecture Hall 101',
        latitude: 12.971598,
        longitude: 77.594566,
        radius_meters: 100,
        max_accuracy_meters: 30
    };

    // 10a. Fresh location inside classroom (revalidation succeeds)
    const insideLocation: ClientLocation = {
        latitude: classroomConfig.latitude + 0.00010, // ~11 meters away
        longitude: classroomConfig.longitude,
        accuracy: 10,
        timestamp: new Date(now.getTime() - 2000).toISOString() // 2 seconds old
    };
    const revalPass = evaluatePresenceRevalidation({
        vSession: validVerificationSession,
        clientLocation: insideLocation,
        classroomConfig,
        now
    });
    assert(revalPass.valid === true, 'Revalidation succeeds when fresh location is inside classroom radius');
    assert(revalPass.revoked === false, 'Session is not revoked');
    assert(revalPass.distanceMeters !== undefined && revalPass.distanceMeters < 30, 'Calculates distance correctly');

    // 10b. Student leaves the permitted area (e.g. 250m away) -> Revokes session!
    const outsideLocation: ClientLocation = {
        latitude: classroomConfig.latitude + 0.00225, // ~250 meters away
        longitude: classroomConfig.longitude,
        accuracy: 12,
        timestamp: new Date(now.getTime() - 2000).toISOString()
    };
    const revalRevoked = evaluatePresenceRevalidation({
        vSession: validVerificationSession,
        clientLocation: outsideLocation,
        classroomConfig,
        now
    });
    assert(revalRevoked.valid === false, 'Revalidation fails when student is outside classroom');
    assert(revalRevoked.revoked === true, 'Flags session as REVOKED upon departure from geofence');
    assert(revalRevoked.reason === 'OUT_OF_BOUNDS', 'Reason recorded as OUT_OF_BOUNDS');
    assert(revalRevoked.error?.code === 'PRESENCE_REVOKED', 'Surfaces PRESENCE_REVOKED error code');

    // 10c. Stale location measurement during revalidation
    const staleLocation: ClientLocation = {
        latitude: classroomConfig.latitude,
        longitude: classroomConfig.longitude,
        accuracy: 10,
        timestamp: new Date(now.getTime() - 45000).toISOString() // 45s old (stale)
    };
    const revalStale = evaluatePresenceRevalidation({
        vSession: validVerificationSession,
        clientLocation: staleLocation,
        classroomConfig,
        now
    });
    assert(revalStale.valid === false, 'Rejects stale location during revalidation');
    assert(revalStale.error?.code === 'STALE_LOCATION', 'Surfaces STALE_LOCATION error');

    // ─────────────────────────────────────────────────────────────
    // 11. Immunity to Client Bypass Flags
    // ─────────────────────────────────────────────────────────────
    console.log('\n11. Client-Supplied Bypass Flags Immunity');

    // An attacker sends forged client flags like bypassGeofence=true, isVerified=true
    const spoofedReqParams = {
        token: 'vtok_forged_or_invalid',
        authenticatedUserId: studentA_Id,
        authenticatedUserRole: 'STUDENT',
        vSession: null, // No DB record
        bypassGeofence: true,
        isVerified: true,
        faceVerified: true,
        now
    };
    const spoofBypassResult = validateVerificationToken(spoofedReqParams as any);
    assert(spoofBypassResult.valid === false, 'Client-supplied bypass flags (bypassGeofence=true) are ignored');
    assert(spoofBypassResult.error?.code === 'VERIFICATION_NOT_FOUND', 'Evaluated strictly against server records');

    // ─────────────────────────────────────────────────────────────
    // Final Summary
    // ─────────────────────────────────────────────────────────────
    console.log('\n====================================================');
    console.log(`Test Execution Finished: ${passed} passed, ${failed} failed`);
    console.log('====================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
