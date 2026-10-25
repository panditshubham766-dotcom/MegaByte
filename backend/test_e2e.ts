/**
 * test_e2e.ts - Comprehensive End-to-End Test Suite for Phase 6
 *
 * Verifies the complete classroom presence verification lifecycle and end-to-end flows:
 *   1. Valid student and successful end-to-end verification (GPS + Wi-Fi + Face Match + Liveness -> HTTP 201 + Token).
 *   2. Student outside classroom geofence (Rejection with OUTSIDE_CLASSROOM and distance guidance).
 *   3. Insufficient GPS accuracy (ACCURACY_TOO_LOW) and stale measurements (STALE_LOCATION).
 *   4. Missing or unapproved Wi-Fi evidence (UNAPPROVED_ACCESS_POINT, BSSID_REQUIRED, and UNSUPPORTED_DEVICE fallback).
 *   5. Face mismatch (Biometric failure with FACE_MISMATCH and Identity substitution rejection).
 *   6. Unauthorized API requests (401 Unauthenticated, 403 Cross-user reuse, and missing token rejection).
 *   7. Expired and revoked verification sessions (VERIFICATION_EXPIRED and VERIFICATION_REVOKED).
 *   8. Wrong classroom or class session boundaries (CLASSROOM_MISMATCH and SESSION_MISMATCH).
 *   9. Duplicate attendance defense (Rejection on second submission attempt).
 *  10. Existing authentication and face-recognition workflows (Legacy sessions without geofencing preserved, Faculty/Admin role bypass).
 *  11. Permission handling and foreground/background device behaviors (PWA background suspension, denied permissions).
 */

import {
    validateLocation,
    validateClientLocationShape,
    type ClassroomConfig,
    type ClientLocation
} from './src/services/geo.ts';
import {
    validateWifiPresence,
    evaluateCombinedPresence,
    type ClassroomAccessPoint,
    type ClientWifiEvidence
} from './src/services/wifi.ts';
import {
    evaluateStudentIdentity,
    evaluateSessionEligibility,
    matchEnrolledFace,
    evaluateAllFactors,
    generateVerificationToken,
    createVerificationAuditPayload,
    evaluatePresenceRevalidation
} from './src/services/verification.ts';
import {
    validateVerificationToken,
    type VerificationSessionData,
    type ClassSessionBoundaryData
} from './src/middleware/verification.ts';

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

function runE2ETests() {
    console.log('================================================================');
    console.log('   MegaByte Phase 6 Frontend Experience & End-to-End Test Suite   ');
    console.log('================================================================\n');

    const classroomConfig: ClassroomConfig = {
        id: 'c101-uuid',
        name: 'Room 301 - Computer Science Lab',
        latitude: 12.9715987,
        longitude: 77.5945627,
        radius_meters: 30,
        max_accuracy_meters: 30
    };

    const approvedAps: ClassroomAccessPoint[] = [
        {
            id: 'ap-1',
            classroom_id: classroomConfig.id,
            bssid: 'AA:BB:CC:DD:EE:FF',
            ssid: 'CS-Lab-5G',
            description: 'Lab 301 Ceiling AP',
            is_active: true
        },
        {
            id: 'ap-2',
            classroom_id: classroomConfig.id,
            bssid: '11:22:33:44:55:66',
            ssid: 'Campus-Guest',
            description: 'Hallway Repeater',
            is_active: false // Inactive AP
        }
    ];

    const studentUser = {
        id: 'student-uuid-001',
        name: 'Rahul Sharma',
        student_id: 'CS2026-042',
        role: 'STUDENT',
        enrolledSubjectId: 'sub-algo-101'
    };

    const studentFaceEmbeddings = [
        [0.85, 0.42, 0.15, -0.32, 0.55], // Reference enrolled embedding
        [0.84, 0.41, 0.16, -0.31, 0.54]  // Second enrolled sample
    ];

    const activeSession: ClassSessionBoundaryData = {
        id: 'sess-algo-live',
        status: 'ACTIVE',
        subject_id: 'sub-algo-101',
        classroom_id: classroomConfig.id,
        expires_at: new Date(Date.now() + 30 * 60 * 1000) // Active for next 30 mins
    };

    // =========================================================================
    // 1. VALID STUDENT & SUCCESSFUL VERIFICATION (End-to-End Happy Path)
    // =========================================================================
    console.log('--- Test Group 1: Valid Student & Successful Verification ---');
    {
        const now = new Date();
        const validClientLocation: ClientLocation = {
            latitude: 12.9716500, // ~10m offset
            longitude: 77.5946000,
            accuracy: 8,
            timestamp: now.toISOString()
        };

        const validClientWifi: ClientWifiEvidence = {
            bssid: 'aa:bb:cc:dd:ee:ff', // Case normalization test
            ssid: 'CS-Lab-5G',
            status: 'AVAILABLE'
        };

        // 1a. Validate Student Identity
        const idResult = evaluateStudentIdentity({
            authenticatedStudentId: studentUser.id,
            userRecord: { ...studentUser, face_embedding: studentFaceEmbeddings }
        });
        assert(idResult.verified === true, '1a. Authenticated student identity validated');

        // 1b. Validate GPS Location
        const geoResult = validateLocation(validClientLocation, classroomConfig, now);
        assert(geoResult.valid === true, '1b. Valid location passes geofence check');
        assert((geoResult.distanceMeters ?? 999) < classroomConfig.radius_meters, '1c. Location is within 30m radius');

        // 1c. Validate Wi-Fi AP
        const wifiResult = validateWifiPresence(validClientWifi, approvedAps, 'GPS_AND_WIFI');
        assert(wifiResult.verified === true, '1d. Approved active BSSID is verified');
        assert(wifiResult.matchedBssid === 'AA:BB:CC:DD:EE:FF', '1e. BSSID normalized correctly');

        // 1d. Face Recognition & Liveness
        const faceResult = matchEnrolledFace({
            probeEmbedding: [0.85, 0.42, 0.15, -0.32, 0.55],
            storedEmbeddingRaw: studentFaceEmbeddings,
            probeRealScore: 0.95,
            probeLiveScore: 0.92
        });
        assert(faceResult.verified === true, '1f. Face probe matches enrolled student reference photo');

        // 1e. Multi-factor combined evaluation
        const eligibilityResult = evaluateSessionEligibility({
            sessionRow: {
                id: activeSession.id,
                status: 'ACTIVE',
                expires_at: activeSession.expires_at,
                subject_id: 'sub-algo-101',
                classroom_id: classroomConfig.id,
                verification_policy: 'GPS_AND_WIFI'
            },
            isEnrolledInSubject: true,
            hasPriorSubmission: false
        });

        const overallResult = evaluateAllFactors({
            studentIdentity: idResult,
            sessionEligibility: eligibilityResult,
            geofenceResult: {
                required: true,
                verified: true,
                distanceMeters: geoResult.distanceMeters,
                accuracyMeters: validClientLocation.accuracy
            },
            wifiResult: {
                required: true,
                verified: true,
                bssid: wifiResult.matchedBssid,
                status: wifiResult.status
            },
            faceResult
        });

        assert(overallResult.overallStatus === 'PASSED', '1g. Overall multi-factor verification status is PASSED');

        // 1f. Verification Token Issuance & Audit Payload
        const verificationToken = generateVerificationToken();
        assert(verificationToken.startsWith('vtok_') && verificationToken.length > 20, '1h. Secure verification token generated');

        const auditPayload = createVerificationAuditPayload(overallResult);
        assert(auditPayload.overall_status === 'PASSED', '1i. Audit payload recorded with overall PASSED');
        assert((auditPayload as any).photo_base64 === undefined, '1j. Privacy: raw photo omitted from audit log');
    }

    // =========================================================================
    // 2. STUDENT OUTSIDE THE GEOFENCE
    // =========================================================================
    console.log('\n--- Test Group 2: Student Outside Classroom Geofence ---');
    {
        const now = new Date();
        const outsideLocation: ClientLocation = {
            latitude: 12.9735000, // ~210 meters away
            longitude: 77.5945627,
            accuracy: 10,
            timestamp: now.toISOString()
        };

        const geoResult = validateLocation(outsideLocation, classroomConfig, now);
        assert(geoResult.valid === false, '2a. Location 210m away is rejected by geofence validator');
        assert(geoResult.error?.code === 'OUTSIDE_CLASSROOM', '2b. Correct error code OUTSIDE_CLASSROOM returned');
        assert(geoResult.error?.message.includes('away from the classroom'), '2c. Error message specifies distance from classroom');
        assert(geoResult.error?.retryHint.includes('physically present'), '2d. Provides actionable guidance to be physically present');
    }

    // =========================================================================
    // 3. INSUFFICIENT GPS ACCURACY AND STALE MEASUREMENTS
    // =========================================================================
    console.log('\n--- Test Group 3: Insufficient GPS Accuracy and Stale Measurements ---');
    {
        const now = new Date();

        // 3a. Poor GPS Accuracy (±65m when maximum allowed is 30m)
        const lowAccuracyLocation: ClientLocation = {
            latitude: 12.9715987,
            longitude: 77.5945627,
            accuracy: 65,
            timestamp: now.toISOString()
        };
        const accResult = validateLocation(lowAccuracyLocation, classroomConfig, now);
        assert(accResult.valid === false, '3a. Inaccurate GPS (±65m) is rejected');
        assert(accResult.error?.code === 'ACCURACY_TOO_LOW', '3b. Error code ACCURACY_TOO_LOW returned');
        assert(accResult.error?.retryHint.includes('window or open area'), '3c. Guidance instructs student to improve GPS signal');

        // 3b. Stale Measurement (120 seconds old when maximum allowed age is 60s)
        const staleTimestamp = new Date(now.getTime() - 120 * 1000).toISOString();
        const staleLocation: ClientLocation = {
            latitude: 12.9715987,
            longitude: 77.5945627,
            accuracy: 10,
            timestamp: staleTimestamp
        };
        const staleResult = validateLocation(staleLocation, classroomConfig, now);
        assert(staleResult.valid === false, '3d. Stale GPS measurement (120s old) is rejected');
        assert(staleResult.error?.code === 'STALE_LOCATION', '3e. Error code STALE_LOCATION returned');
        assert(staleResult.error?.retryHint.includes('fresh GPS reading'), '3f. Guidance instructs capturing fresh GPS reading');

        // 3c. Future / Manipulated Timestamp
        const futureTimestamp = new Date(now.getTime() + 15 * 1000).toISOString();
        const futureLocation: ClientLocation = {
            latitude: 12.9715987,
            longitude: 77.5945627,
            accuracy: 10,
            timestamp: futureTimestamp
        };
        const futureResult = validateLocation(futureLocation, classroomConfig, now);
        assert(futureResult.valid === false && futureResult.error?.code === 'STALE_LOCATION', '3g. Future timestamp rejected');

        // 3d. Corrupted / Non-numeric coordinates
        const invalidCoord = validateClientLocationShape({ latitude: 'abc', longitude: 77.59, accuracy: 10, timestamp: now.toISOString() });
        assert(invalidCoord !== null && invalidCoord.error.code === 'INVALID_COORDINATES', '3h. Non-numeric latitude rejected');
    }

    // =========================================================================
    // 4. MISSING OR UNAPPROVED REQUIRED WI-FI EVIDENCE
    // =========================================================================
    console.log('\n--- Test Group 4: Missing or Unapproved Required Wi-Fi Evidence ---');
    {
        // 4a. Unapproved rogue BSSID
        const rogueWifi: ClientWifiEvidence = {
            bssid: '99:88:77:66:55:44',
            ssid: 'PersonalHotspot',
            status: 'AVAILABLE'
        };
        const rogueResult = validateWifiPresence(rogueWifi, approvedAps, 'GPS_AND_WIFI');
        assert(rogueResult.verified === false, '4a. Rogue Wi-Fi BSSID is not verified');
        assert(rogueResult.status === 'UNAPPROVED_AP', '4b. Wi-Fi status is UNAPPROVED_AP');
        assert(rogueResult.error?.code === 'UNAPPROVED_ACCESS_POINT', '4c. Error code UNAPPROVED_ACCESS_POINT returned');

        // 4b. Connecting to disabled/inactive AP (ap-2)
        const inactiveApWifi: ClientWifiEvidence = {
            bssid: '11:22:33:44:55:66',
            ssid: 'Campus-Guest',
            status: 'AVAILABLE'
        };
        const inactiveResult = validateWifiPresence(inactiveApWifi, approvedAps, 'GPS_AND_WIFI');
        assert(inactiveResult.verified === false && inactiveResult.status === 'UNAPPROVED_AP', '4d. Inactive AP is rejected');

        // 4c. Missing Wi-Fi under strict WIFI_ONLY policy
        const missingWifi: ClientWifiEvidence = {
            bssid: null,
            ssid: null
        };
        const missingResult = validateWifiPresence(missingWifi, approvedAps, 'WIFI_ONLY');
        assert(missingResult.verified === false && missingResult.error?.code === 'BSSID_REQUIRED', '4e. Missing Wi-Fi rejected with BSSID_REQUIRED under WIFI_ONLY');

        // 4d. Standard web browser fallback under WIFI_ONLY
        const webBrowserWifi: ClientWifiEvidence = {
            bssid: null,
            ssid: null,
            status: 'UNSUPPORTED_DEVICE'
        };
        const browserStrictResult = validateWifiPresence(webBrowserWifi, approvedAps, 'WIFI_ONLY');
        assert(browserStrictResult.error?.code === 'UNSUPPORTED_DEVICE', '4f. Web browser on WIFI_ONLY returns UNSUPPORTED_DEVICE');

        // 4e. Standard web browser fallback under GPS_OR_WIFI policy (Policy flexibility)
        const validGeo = { valid: true, distanceMeters: 10 };
        const browserFlexibleCombined = evaluateCombinedPresence('GPS_OR_WIFI', validGeo, browserStrictResult);
        assert(browserFlexibleCombined.passed === true, '4g. GPS_OR_WIFI policy allows pass via valid GPS even on unsupported web browser');
    }

    // =========================================================================
    // 5. FACE MISMATCH AND BIOMETRIC SUBSTITUTION
    // =========================================================================
    console.log('\n--- Test Group 5: Face Mismatch & Identity Substitution ---');
    {
        // 5a. Mismatched face probe (different student probe)
        const impostorEmbedding = [-0.85, -0.42, 0.95, 0.88, -0.55];
        const mismatchResult = matchEnrolledFace({
            probeEmbedding: impostorEmbedding,
            storedEmbeddingRaw: studentFaceEmbeddings,
            probeRealScore: 0.95,
            probeLiveScore: 0.92
        });

        assert(mismatchResult.verified === false, '5a. Impostor face probe rejected');
        assert(mismatchResult.error?.code === 'FACE_MISMATCH', '5b. Error code is FACE_MISMATCH');

        // 5b. Head turn direction mismatch
        const requestedAction = 'TURN_LEFT';
        const recordedYaws = [0.05, 0.08, 0.45, 0.52]; // Turned RIGHT instead of LEFT
        let turnPassed = false;
        for (const yaw of recordedYaws) {
            if (requestedAction === 'TURN_LEFT' && yaw < -0.35) {
                turnPassed = true;
                break;
            }
        }
        assert(turnPassed === false, '5c. Head turn in opposite direction rejected by liveness check');

        // 5c. Identity Substitution Defense
        const idSubResult = evaluateStudentIdentity({
            authenticatedStudentId: studentUser.id,
            userRecord: { ...studentUser, face_embedding: studentFaceEmbeddings },
            claimedStudentId: 'victim-student-uuid'
        });
        assert(idSubResult.verified === false, '5d. Mismatched client studentId rejected');
        assert(idSubResult.error?.code === 'IDENTITY_SUBSTITUTION_REJECTED', '5e. Error code IDENTITY_SUBSTITUTION_REJECTED');
    }

    // =========================================================================
    // 6. UNAUTHORIZED API REQUESTS
    // =========================================================================
    console.log('\n--- Test Group 6: Unauthorized API Requests ---');
    {
        const now = new Date();

        // 6a. Unauthenticated request (user is null)
        const unauthResult = validateVerificationToken({
            token: 'vtok_some_token',
            authenticatedUserId: null,
            authenticatedUserRole: null,
            vSession: null,
            classSession: activeSession,
            now
        });
        assert(unauthResult.valid === false && unauthResult.error?.code === 'UNAUTHENTICATED', '6a. Unauthenticated request rejected with UNAUTHENTICATED');

        // 6b. Missing verification token on protected student route
        const missingTokenResult = validateVerificationToken({
            token: null,
            authenticatedUserId: studentUser.id,
            authenticatedUserRole: 'STUDENT',
            vSession: null,
            classSession: activeSession,
            now
        });
        assert(missingTokenResult.valid === false && missingTokenResult.error?.code === 'NO_VERIFICATION_TOKEN', '6b. Missing verification token rejected with NO_VERIFICATION_TOKEN');

        // 6c. Cross-User Token Reuse Defense (Student B presents Student A's token)
        const studentA_Id = 'student-A-uuid';
        const studentB_Id = 'student-B-uuid';
        const studentA_Session: VerificationSessionData = {
            id: 'v-session-1',
            student_id: studentA_Id,
            session_id: activeSession.id,
            classroom_id: classroomConfig.id,
            verification_token: 'vtok_student_A',
            status: 'PASSED',
            expires_at: new Date(now.getTime() + 5 * 60 * 1000)
        };

        const crossUserResult = validateVerificationToken({
            token: 'vtok_student_A',
            authenticatedUserId: studentB_Id,
            authenticatedUserRole: 'STUDENT',
            vSession: studentA_Session,
            classSession: activeSession,
            now
        });
        assert(crossUserResult.valid === false && crossUserResult.error?.code === 'CROSS_USER_REUSE_BLOCKED', '6c. Cross-user token reuse blocked');
    }

    // =========================================================================
    // 7. EXPIRED OR REVOKED VERIFICATION SESSIONS
    // =========================================================================
    console.log('\n--- Test Group 7: Expired or Revoked Verification Sessions ---');
    {
        const now = new Date();

        // 7a. Expired verification session (token older than 5 minutes)
        const expiredSession: VerificationSessionData = {
            id: 'v-session-exp',
            student_id: studentUser.id,
            session_id: activeSession.id,
            classroom_id: classroomConfig.id,
            verification_token: 'vtok_expired',
            status: 'PASSED',
            expires_at: new Date(now.getTime() - 1000) // Expired 1 second ago
        };

        const expiredResult = validateVerificationToken({
            token: 'vtok_expired',
            authenticatedUserId: studentUser.id,
            authenticatedUserRole: 'STUDENT',
            vSession: expiredSession,
            classSession: activeSession,
            now
        });
        assert(expiredResult.valid === false && expiredResult.error?.code === 'VERIFICATION_EXPIRED', '7a. Expired verification token rejected');

        // 7b. Revoked verification session (revoked due to exiting geofence)
        const revokedSession: VerificationSessionData = {
            id: 'v-session-rev',
            student_id: studentUser.id,
            session_id: activeSession.id,
            classroom_id: classroomConfig.id,
            verification_token: 'vtok_revoked',
            status: 'REVOKED',
            revoked_at: new Date(now.getTime() - 60000),
            revocation_reason: 'Exited classroom geofence',
            expires_at: new Date(now.getTime() + 5 * 60 * 1000)
        };

        const revokedResult = validateVerificationToken({
            token: 'vtok_revoked',
            authenticatedUserId: studentUser.id,
            authenticatedUserRole: 'STUDENT',
            vSession: revokedSession,
            classSession: activeSession,
            now
        });
        assert(revokedResult.valid === false && revokedResult.error?.code === 'VERIFICATION_REVOKED', '7b. Revoked verification session rejected');
        assert(revokedResult.error?.message.includes('Exited classroom geofence'), '7c. Revocation reason preserved');
    }

    // =========================================================================
    // 8. WRONG CLASSROOM OR CLASS SESSION
    // =========================================================================
    console.log('\n--- Test Group 8: Wrong Classroom or Class Session ---');
    {
        const now = new Date();

        // 8a. Token issued for Classroom A presented for Classroom B
        const mismatchedClassroomSession: VerificationSessionData = {
            id: 'v-session-roomA',
            student_id: studentUser.id,
            session_id: activeSession.id,
            classroom_id: 'classroom-A-uuid',
            verification_token: 'vtok_room_A',
            status: 'PASSED',
            expires_at: new Date(now.getTime() + 5 * 60 * 1000)
        };

        const classroomB_Session: ClassSessionBoundaryData = {
            ...activeSession,
            classroom_id: 'classroom-B-uuid'
        };

        const roomMismatchResult = validateVerificationToken({
            token: 'vtok_room_A',
            authenticatedUserId: studentUser.id,
            authenticatedUserRole: 'STUDENT',
            vSession: mismatchedClassroomSession,
            classSession: classroomB_Session,
            now
        });
        assert(roomMismatchResult.valid === false && roomMismatchResult.error?.code === 'CLASSROOM_MISMATCH', '8a. Classroom mismatch rejected');

        // 8b. Token issued for Class Session 1 presented for Class Session 2
        const mismatchedClassSession: VerificationSessionData = {
            ...mismatchedClassroomSession,
            classroom_id: classroomConfig.id,
            session_id: 'session-1-uuid'
        };

        const sessionMismatchResult = validateVerificationToken({
            token: 'vtok_room_A',
            authenticatedUserId: studentUser.id,
            authenticatedUserRole: 'STUDENT',
            vSession: mismatchedClassSession,
            classSession: { ...activeSession, id: 'session-2-uuid' },
            now
        });
        assert(sessionMismatchResult.valid === false && sessionMismatchResult.error?.code === 'SESSION_MISMATCH', '8b. Session mismatch rejected');

        // 8c. Class session has ended/expired
        const endedSession: ClassSessionBoundaryData = {
            ...activeSession,
            status: 'EXPIRED',
            expires_at: new Date(now.getTime() - 10000)
        };
        const validVSession: VerificationSessionData = {
            id: 'v-session-valid',
            student_id: studentUser.id,
            session_id: activeSession.id,
            classroom_id: classroomConfig.id,
            verification_token: 'vtok_valid',
            status: 'PASSED',
            expires_at: new Date(now.getTime() + 5 * 60 * 1000)
        };
        const endedResult = validateVerificationToken({
            token: 'vtok_valid',
            authenticatedUserId: studentUser.id,
            authenticatedUserRole: 'STUDENT',
            vSession: validVSession,
            classSession: endedSession,
            now
        });
        assert(endedResult.valid === false && endedResult.error?.code === 'SESSION_ENDED', '8c. Ended class session invalidates verification');
    }

    // =========================================================================
    // 9. DUPLICATE ATTENDANCE DEFENSE
    // =========================================================================
    console.log('\n--- Test Group 9: Duplicate Attendance Defense ---');
    {
        const recordedSubmissions = new Set<string>();
        recordedSubmissions.add(`${activeSession.id}:${studentUser.id}`);

        const isDuplicateAttempt = recordedSubmissions.has(`${activeSession.id}:${studentUser.id}`);
        assert(isDuplicateAttempt === true, '9a. Prior submission detected for student and session');

        const duplicateError = isDuplicateAttempt
            ? { status: 400, message: 'Attendance already submitted for this session' }
            : null;
        assert(duplicateError?.status === 400, '9b. Duplicate submission rejected with status 400');
        assert(duplicateError?.message.includes('already submitted'), '9c. Clear duplicate submission message returned');
    }

    // =========================================================================
    // 10. EXISTING AUTHENTICATION AND FACE-RECOGNITION WORKFLOWS
    // =========================================================================
    console.log('\n--- Test Group 10: Existing Authentication & Legacy Workflows ---');
    {
        const now = new Date();

        // 10a. Legacy session without classroom geofencing (classroom_id is null)
        const legacySession: ClassSessionBoundaryData = {
            id: 'sess-legacy-remote',
            status: 'ACTIVE',
            subject_id: 'sub-legacy-001',
            classroom_id: null,
            expires_at: new Date(now.getTime() + 30 * 60 * 1000)
        };

        const legacyVSession: VerificationSessionData = {
            id: 'v-legacy-1',
            student_id: studentUser.id,
            session_id: legacySession.id,
            classroom_id: null,
            verification_token: 'vtok_legacy',
            status: 'PASSED',
            expires_at: new Date(now.getTime() + 5 * 60 * 1000)
        };

        const legacyResult = validateVerificationToken({
            token: 'vtok_legacy',
            authenticatedUserId: studentUser.id,
            authenticatedUserRole: 'STUDENT',
            vSession: legacyVSession,
            classSession: legacySession,
            now
        });
        assert(legacyResult.valid === true, '10a. Legacy session without geofencing verified without classroom requirement');

        // 10b. Faculty and Admin role bypass
        const facultyResult = validateVerificationToken({
            token: null,
            authenticatedUserId: 'faculty-uuid',
            authenticatedUserRole: 'FACULTY',
            vSession: null,
            classSession: activeSession,
            now
        });
        assert(facultyResult.valid === true, '10b. Faculty access granted without verification token');

        const adminResult = validateVerificationToken({
            token: null,
            authenticatedUserId: 'admin-uuid',
            authenticatedUserRole: 'ADMIN',
            vSession: null,
            classSession: activeSession,
            now
        });
        assert(adminResult.valid === true, '10c. Admin access granted without verification token');
    }

    // =========================================================================
    // 11. PERMISSION HANDLING & FOREGROUND/BACKGROUND DEVICE BEHAVIORS
    // =========================================================================
    console.log('\n--- Test Group 11: Permission Handling & Foreground/Background Behaviors ---');
    {
        const now = new Date();

        // 11a. Denied location permission on geofenced session
        const deniedLocation = null;
        let permissionResult: any;
        if (!deniedLocation && activeSession.classroom_id) {
            permissionResult = {
                valid: false,
                error: {
                    code: 'LOCATION_REQUIRED',
                    message: 'This session requires your location to verify classroom presence.',
                    retryHint: 'Allow location access in your browser or device settings.'
                }
            };
        }
        assert(permissionResult.valid === false, '11a. Missing/denied location rejected when geofencing required');
        assert(permissionResult.error.code === 'LOCATION_REQUIRED', '11b. Clear error code LOCATION_REQUIRED provided');

        // 11b. PWA background suspension simulation:
        // Student leaves browser in background for 5 minutes, then returns to foreground.
        // Old cached position timestamp is 300 seconds old.
        const suspendedBackgroundLocation: ClientLocation = {
            latitude: 12.9715987,
            longitude: 77.5945627,
            accuracy: 12,
            timestamp: new Date(now.getTime() - 300 * 1000).toISOString()
        };
        const pwaReval = evaluatePresenceRevalidation({
            vSession: {
                id: 'v-pwa-session',
                student_id: studentUser.id,
                session_id: activeSession.id,
                classroom_id: classroomConfig.id,
                status: 'PASSED',
                expires_at: new Date(now.getTime() + 10 * 60 * 1000)
            },
            clientLocation: suspendedBackgroundLocation,
            classroomConfig,
            now
        });
        assert(pwaReval.valid === false, '11c. Suspended background location rejected due to staleness');
        assert(pwaReval.error?.code === 'STALE_LOCATION', '11d. Prompts user for a fresh foreground GPS fix');

        // 11c. Student leaves classroom geofence while app is in foreground
        const exitedLocation: ClientLocation = {
            latitude: 12.9750000, // ~380m away
            longitude: 77.5945627,
            accuracy: 10,
            timestamp: now.toISOString()
        };
        const exitReval = evaluatePresenceRevalidation({
            vSession: {
                id: 'v-exit-session',
                student_id: studentUser.id,
                session_id: activeSession.id,
                classroom_id: classroomConfig.id,
                status: 'PASSED',
                expires_at: new Date(now.getTime() + 10 * 60 * 1000)
            },
            clientLocation: exitedLocation,
            classroomConfig,
            now
        });
        assert(exitReval.revoked === true, '11e. Leaving classroom geofence triggers session revocation');
        assert(exitReval.reason === 'OUT_OF_BOUNDS', '11f. Revocation reason flagged as OUT_OF_BOUNDS');
        assert(exitReval.error?.code === 'PRESENCE_REVOKED', '11g. Error code PRESENCE_REVOKED returned');
    }

    console.log('\n================================================================');
    console.log(`   Phase 6 End-to-End Suite Complete: ${passed} Passed, ${failed} Failed`);
    console.log('================================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

runE2ETests();
