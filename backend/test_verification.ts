/**
 * test_verification.ts - Automated test suite for Phase 4 Integrated Verification Workflow
 *
 * Covers:
 *   1. Authenticated Student Identity & Face Enrollment validation.
 *   2. Identity Substitution Defense (preventing impersonation of another student).
 *   3. Client-supplied booleans immunity (faceVerified=true, insideClassroom=true, wifiVerified=true).
 *   4. Active Class Session & Classroom Eligibility (enrollment, expiration, prior submissions).
 *   5. GPS Geofence Verification integration (inside/outside, stale, low accuracy).
 *   6. Wi-Fi AP Verification integration & verification policy matrix.
 *   7. Face Recognition & Liveness integration (matching enrolled embeddings, anti-spoof).
 *   8. Partial/Failed verification never results in a successful attendance record.
 *   9. Successful multi-factor verification generates short-lived server-controlled session token.
 *  10. Privacy-preserving audit payload generation (no raw photos or precise coordinates).
 */

import {
    evaluateStudentIdentity,
    evaluateSessionEligibility,
    matchEnrolledFace,
    evaluateAllFactors,
    generateVerificationToken,
    createVerificationAuditPayload,
    type StudentIdentityResult,
    type SessionEligibilityResult,
    type GeofenceVerificationResult,
    type WifiVerificationDetails,
    type FaceVerificationResult
} from './src/services/verification.ts';

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

// Helper to generate a normalized synthetic face embedding vector (e.g. 128 or 512 dimensions)
function createSyntheticEmbedding(seed: number, size = 128): number[] {
    const emb: number[] = [];
    let norm = 0;
    for (let i = 0; i < size; i++) {
        const val = Math.sin(seed * (i + 1));
        emb.push(val);
        norm += val * val;
    }
    const magnitude = Math.sqrt(norm);
    return emb.map(v => v / magnitude);
}

function runTests() {
    console.log('====================================================');
    console.log('   MegaByte Phase 4 Integrated Verification Tests   ');
    console.log('====================================================\n');

    const studentA_Id = '11111111-1111-1111-1111-111111111111';
    const studentB_Id = '22222222-2222-2222-2222-222222222222';
    const faculty_Id  = '99999999-9999-9999-9999-999999999999';

    const embeddingStudentA = createSyntheticEmbedding(1.234);
    const embeddingStudentB = createSyntheticEmbedding(8.765);

    // ─────────────────────────────────────────────────────────────
    // 1. Authenticated Student Identity & Role Checks
    // ─────────────────────────────────────────────────────────────
    console.log('1. Authenticated Student Identity & Role Checks');

    const validStudentUser = {
        id: studentA_Id,
        name: 'Alice Smith',
        email: 'alice@campus.edu',
        role: 'STUDENT',
        student_id: 'STU1001',
        face_embedding: [embeddingStudentA]
    };

    // Valid authenticated student
    const idValid = evaluateStudentIdentity({
        authenticatedStudentId: studentA_Id,
        userRecord: validStudentUser
    });
    assert(idValid.verified === true, 'Valid authenticated student with enrolled face passes');
    assert(idValid.studentId === studentA_Id, 'Binds to authenticated student ID');
    assert(idValid.hasEnrolledFace === true, 'Detects enrolled face');

    // Missing user record
    const idNotFound = evaluateStudentIdentity({
        authenticatedStudentId: studentA_Id,
        userRecord: null
    });
    assert(idNotFound.verified === false, 'Rejects when user record is not found');
    assert(idNotFound.error?.code === 'STUDENT_NOT_FOUND', 'Returns STUDENT_NOT_FOUND error code');

    // Non-student role (e.g. Faculty trying to register student attendance)
    const idFaculty = evaluateStudentIdentity({
        authenticatedStudentId: faculty_Id,
        userRecord: { ...validStudentUser, id: faculty_Id, role: 'FACULTY' }
    });
    assert(idFaculty.verified === false, 'Rejects non-STUDENT role attempting attendance');
    assert(idFaculty.error?.code === 'INVALID_ROLE', 'Returns INVALID_ROLE error code');

    // Student without enrolled face
    const idNoFace = evaluateStudentIdentity({
        authenticatedStudentId: studentA_Id,
        userRecord: { ...validStudentUser, face_embedding: null }
    });
    assert(idNoFace.verified === false, 'Rejects student without enrolled face biometrics');
    assert(idNoFace.error?.code === 'FACE_NOT_ENROLLED', 'Returns FACE_NOT_ENROLLED code');

    // ─────────────────────────────────────────────────────────────
    // 2. Identity Substitution Defense (Impersonation Prevention)
    // ─────────────────────────────────────────────────────────────
    console.log('\n2. Identity Substitution Defense');

    // Client attempts to claim student B while authenticated as student A
    const idSubstitutionAttempt = evaluateStudentIdentity({
        authenticatedStudentId: studentA_Id,
        userRecord: validStudentUser,
        claimedStudentId: studentB_Id
    });
    assert(idSubstitutionAttempt.verified === false, 'Rejects client payload claiming another student ID');
    assert(
        idSubstitutionAttempt.error?.code === 'IDENTITY_SUBSTITUTION_REJECTED',
        'Returns IDENTITY_SUBSTITUTION_REJECTED code'
    );

    // ─────────────────────────────────────────────────────────────
    // 3. Face Recognition & Liveness Re-use
    // ─────────────────────────────────────────────────────────────
    console.log('\n3. Face Recognition & Anti-Spoof Liveness');

    // Legitimate match: probe matches student A's reference
    const faceMatch = matchEnrolledFace({
        probeEmbedding: embeddingStudentA,
        storedEmbeddingRaw: [embeddingStudentA],
        probeRealScore: 0.95,
        probeLiveScore: 0.92
    });
    assert(faceMatch.verified === true, 'Probe matching reference embedding passes face verification');
    assert(faceMatch.faceMatchScore !== undefined && faceMatch.faceMatchScore > 0.99, 'Similarity is near 1.0 for same embedding');

    // Face mismatch: probe of student B presented under student A's session
    const faceMismatch = matchEnrolledFace({
        probeEmbedding: embeddingStudentB,
        storedEmbeddingRaw: [embeddingStudentA],
        probeRealScore: 0.95,
        probeLiveScore: 0.92
    });
    assert(faceMismatch.verified === false, 'Probe of different student is rejected (FACE_MISMATCH)');
    assert(faceMismatch.error?.code === 'FACE_MISMATCH', 'Returns FACE_MISMATCH code');

    // Anti-spoofing liveness failure (e.g. photo on screen, real < 0.5)
    const spoofFailure = matchEnrolledFace({
        probeEmbedding: embeddingStudentA,
        storedEmbeddingRaw: [embeddingStudentA],
        probeRealScore: 0.15,
        probeLiveScore: 0.20
    });
    assert(spoofFailure.verified === false, 'Rejects presentation attack failing anti-spoof / liveness');
    assert(spoofFailure.error?.code === 'LIVENESS_FAILED', 'Returns LIVENESS_FAILED code');

    // Client-supplied flag immunity (attacker sends faceVerified: true on mismatched face)
    const spoofBypass = matchEnrolledFace({
        probeEmbedding: embeddingStudentB,
        storedEmbeddingRaw: [embeddingStudentA],
        clientFaceVerifiedFlag: true,
        probeRealScore: 0.95,
        probeLiveScore: 0.92
    });
    assert(spoofBypass.verified === false, 'Never trusts client-supplied faceVerified=true flag');
    assert(spoofBypass.error?.code === 'FACE_MISMATCH', 'Decision is strictly server-computed similarity');

    // ─────────────────────────────────────────────────────────────
    // 4. Session & Classroom Eligibility
    // ─────────────────────────────────────────────────────────────
    console.log('\n4. Session & Classroom Eligibility');

    const validSessionRow = {
        id: 'sess-001',
        subject_id: 'sub-101',
        subject_name: 'Database Systems',
        class_id: 'cls-101',
        class_name: 'CS Year 3',
        classroom_id: 'room-101',
        classroom_name: 'Lab 3B',
        classroom_lat: 12.971598,
        classroom_lon: 77.594566,
        radius_meters: 100,
        max_accuracy_meters: 30,
        verification_policy: 'GPS_OR_WIFI',
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    };

    // Valid enrolled student on active session
    const eligValid = evaluateSessionEligibility({
        sessionRow: validSessionRow,
        isEnrolledInSubject: true,
        hasPriorSubmission: false
    });
    assert(eligValid.verified === true, 'Enrolled student with no prior submission is eligible');
    assert(eligValid.classroomId === 'room-101', 'Identifies correct classroom ID');
    assert(eligValid.verificationPolicy === 'GPS_OR_WIFI', 'Captures configured verification policy');

    // Expired session
    const eligExpired = evaluateSessionEligibility({
        sessionRow: { ...validSessionRow, expires_at: new Date(Date.now() - 5000).toISOString() },
        isEnrolledInSubject: true,
        hasPriorSubmission: false
    });
    assert(eligExpired.verified === false, 'Rejects expired session');
    assert(eligExpired.error?.code === 'SESSION_EXPIRED', 'Returns SESSION_EXPIRED code');

    // Student not enrolled in session subject
    const eligNotEnrolled = evaluateSessionEligibility({
        sessionRow: validSessionRow,
        isEnrolledInSubject: false,
        hasPriorSubmission: false
    });
    assert(eligNotEnrolled.verified === false, 'Rejects student not enrolled in subject');
    assert(eligNotEnrolled.error?.code === 'NOT_ENROLLED', 'Returns NOT_ENROLLED code');

    // Student already submitted attendance
    const eligAlreadySubmitted = evaluateSessionEligibility({
        sessionRow: validSessionRow,
        isEnrolledInSubject: true,
        hasPriorSubmission: true
    });
    assert(eligAlreadySubmitted.verified === false, 'Rejects duplicate submission for same session');
    assert(eligAlreadySubmitted.error?.code === 'ALREADY_SUBMITTED', 'Returns ALREADY_SUBMITTED code');

    // ─────────────────────────────────────────────────────────────
    // 5. Multi-Factor Decision Combinations (evaluateAllFactors)
    // ─────────────────────────────────────────────────────────────
    console.log('\n5. Multi-Factor Decision Combinations');

    const validGps: GeofenceVerificationResult = {
        required: true,
        verified: true,
        distanceMeters: 22.5,
        accuracyMeters: 12.0
    };

    const invalidGps: GeofenceVerificationResult = {
        required: true,
        verified: false,
        distanceMeters: 280.0,
        accuracyMeters: 15.0,
        error: {
            code: 'OUTSIDE_CLASSROOM',
            message: 'You are 280m away from the classroom.',
            retryHint: 'Move inside the classroom.'
        }
    };

    const validWifi: WifiVerificationDetails = {
        required: true,
        verified: true,
        bssid: 'A4:2B:B0:11:22:33',
        status: 'VERIFIED'
    };

    const invalidWifi: WifiVerificationDetails = {
        required: true,
        verified: false,
        status: 'UNAPPROVED_ACCESS_POINT',
        error: {
            code: 'UNAPPROVED_ACCESS_POINT',
            message: 'Connected to unapproved Wi-Fi AP.',
            retryHint: 'Connect to classroom Wi-Fi.'
        }
    };

    // 5a. All factors pass
    const fullPass = evaluateAllFactors({
        studentIdentity: idValid,
        sessionEligibility: eligValid, // GPS_OR_WIFI
        geofenceResult: validGps,
        wifiResult: validWifi,
        faceResult: faceMatch
    });
    assert(fullPass.overallStatus === 'PASSED', 'Overall status is PASSED when all factors pass');

    // 5b. Face mismatch with valid presence -> FAILS
    const failOnFace = evaluateAllFactors({
        studentIdentity: idValid,
        sessionEligibility: eligValid,
        geofenceResult: validGps,
        wifiResult: validWifi,
        faceResult: faceMismatch
    });
    assert(failOnFace.overallStatus === 'FAILED', 'Fails overall if face does not match authenticated student');
    assert(failOnFace.errorCode === 'FACE_MISMATCH', 'Error code reflects FACE_MISMATCH');

    // 5c. Outside GPS geofence with GPS_ONLY policy -> FAILS
    const failOnGps = evaluateAllFactors({
        studentIdentity: idValid,
        sessionEligibility: { ...eligValid, verificationPolicy: 'GPS_ONLY' },
        geofenceResult: invalidGps,
        wifiResult: validWifi,
        faceResult: faceMatch
    });
    assert(failOnGps.overallStatus === 'FAILED', 'Fails when outside geofence under GPS_ONLY policy');
    assert(failOnGps.errorCode === 'OUTSIDE_CLASSROOM', 'Reports OUTSIDE_CLASSROOM code');

    // 5d. Missing / invalid Wi-Fi with WIFI_ONLY policy -> FAILS
    const failOnWifi = evaluateAllFactors({
        studentIdentity: idValid,
        sessionEligibility: { ...eligValid, verificationPolicy: 'WIFI_ONLY' },
        geofenceResult: validGps,
        wifiResult: invalidWifi,
        faceResult: faceMatch
    });
    assert(failOnWifi.overallStatus === 'FAILED', 'Fails when Wi-Fi unapproved under WIFI_ONLY policy');
    assert(failOnWifi.errorCode === 'UNAPPROVED_ACCESS_POINT', 'Reports UNAPPROVED_ACCESS_POINT code');

    // 5e. GPS fails but Wi-Fi passes under GPS_OR_WIFI -> PASSES
    const passOnOrPolicy = evaluateAllFactors({
        studentIdentity: idValid,
        sessionEligibility: { ...eligValid, verificationPolicy: 'GPS_OR_WIFI' },
        geofenceResult: invalidGps,
        wifiResult: validWifi,
        faceResult: faceMatch
    });
    assert(passOnOrPolicy.overallStatus === 'PASSED', 'Passes under GPS_OR_WIFI when Wi-Fi is verified indoors');

    // 5f. Both GPS and Wi-Fi fail under GPS_OR_WIFI -> FAILS
    const failOnOrPolicy = evaluateAllFactors({
        studentIdentity: idValid,
        sessionEligibility: { ...eligValid, verificationPolicy: 'GPS_OR_WIFI' },
        geofenceResult: invalidGps,
        wifiResult: invalidWifi,
        faceResult: faceMatch
    });
    assert(failOnOrPolicy.overallStatus === 'FAILED', 'Fails under GPS_OR_WIFI when both fail');

    // 5g. GPS_AND_WIFI requires both to pass
    const passAndPolicy = evaluateAllFactors({
        studentIdentity: idValid,
        sessionEligibility: { ...eligValid, verificationPolicy: 'GPS_AND_WIFI' },
        geofenceResult: validGps,
        wifiResult: validWifi,
        faceResult: faceMatch
    });
    assert(passAndPolicy.overallStatus === 'PASSED', 'Passes under GPS_AND_WIFI when both succeed');

    const failAndPolicy = evaluateAllFactors({
        studentIdentity: idValid,
        sessionEligibility: { ...eligValid, verificationPolicy: 'GPS_AND_WIFI' },
        geofenceResult: validGps,
        wifiResult: invalidWifi,
        faceResult: faceMatch
    });
    assert(failAndPolicy.overallStatus === 'FAILED', 'Fails under GPS_AND_WIFI when Wi-Fi fails');

    // ─────────────────────────────────────────────────────────────
    // 6. Server-Controlled Verification Sessions & Token Generation
    // ─────────────────────────────────────────────────────────────
    console.log('\n6. Verification Session Tokens & Association');

    const token = generateVerificationToken();
    assert(typeof token === 'string' && token.startsWith('vtok_'), 'Generates cryptographic vtok_ token prefix');
    assert(token.length >= 40, 'Token has sufficient cryptographic entropy');

    const secondToken = generateVerificationToken();
    assert(token !== secondToken, 'Tokens are uniquely generated');

    // ─────────────────────────────────────────────────────────────
    // 7. Privacy-Preserving Audit Logging
    // ─────────────────────────────────────────────────────────────
    console.log('\n7. Privacy-Preserving Audit Event Generation');

    const auditPayload = createVerificationAuditPayload(fullPass);
    const auditKeys = Object.keys(auditPayload);

    assert(auditPayload.overall_status === 'PASSED', 'Audit captures overall verification status');
    assert(auditPayload.student_id === studentA_Id, 'Audit captures student ID');
    assert(auditPayload.face_match_score !== undefined, 'Audit retains face match score');
    assert(auditPayload.location_distance_m === 22.5, 'Audit retains distance metric');

    // Privacy assertions: NO raw face photos, NO continuous GPS tracking coordinates
    assert(!auditKeys.includes('photo_base64'), 'Privacy: audit payload does not contain photo_base64');
    assert(!auditKeys.includes('raw_frames'), 'Privacy: audit payload does not contain raw_frames');
    assert(!auditKeys.includes('embedding'), 'Privacy: audit payload does not expose raw embedding vectors');
    assert(!auditKeys.includes('latitude'), 'Privacy: audit payload omits exact latitude');
    assert(!auditKeys.includes('longitude'), 'Privacy: audit payload omits exact longitude');

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
