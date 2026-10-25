/**
 * test_geo.ts - Automated test suite for GPS classroom geofencing
 *
 * Covers:
 *   1. Haversine distance calculations against known geodesic coordinates.
 *   2. Inside vs outside geofence radius boundary checks.
 *   3. Accuracy threshold checks (reporting <= max_accuracy_meters).
 *   4. Timestamp freshness (rejecting stale and excessively futuristic timestamps).
 *   5. Coordinate validity and range checks (-90..90, -180..180, non-negative accuracy).
 *   6. Client location payload shape validation.
 *   7. Client-supplied booleans (e.g., insideClassroom=true) are ignored.
 */

import {
    haversineDistance,
    validateLocation,
    validateClientLocationShape,
    type ClientLocation,
    type ClassroomConfig
} from './src/services/geo.ts';

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
    console.log('   MegaByte GPS Geofencing Automated Test Suite     ');
    console.log('====================================================\n');

    // Reference classroom coordinates (arbitrary test classroom)
    const classroom: ClassroomConfig = {
        id: 'c0000000-0000-0000-0000-000000000001',
        name: 'Lecture Hall 101',
        latitude: 12.971598,
        longitude: 77.594566,
        radius_meters: 100,
        max_accuracy_meters: 30
    };

    // ─────────────────────────────────────────────────────────────
    // 1. Haversine distance calculation tests
    // ─────────────────────────────────────────────────────────────
    console.log('1. Haversine Distance Calculation');

    const distZero = haversineDistance(
        classroom.latitude, classroom.longitude,
        classroom.latitude, classroom.longitude
    );
    assert(Math.abs(distZero) < 0.001, 'Same point distance is 0 meters');

    // 1 degree latitude is approximately 111,195 meters
    const distOneDegLat = haversineDistance(0, 0, 1, 0);
    assert(Math.abs(distOneDegLat - 111195) < 500, `1 degree of latitude is ~111.19 km (got ${(distOneDegLat / 1000).toFixed(2)} km)`);

    // A small offset of ~0.00045 degrees lat is approximately 50 meters
    const distSmall = haversineDistance(
        classroom.latitude,
        classroom.longitude,
        classroom.latitude + 0.00045,
        classroom.longitude
    );
    assert(distSmall > 40 && distSmall < 60, `Nearby point is ~50 meters (got ${distSmall.toFixed(1)} m)`);

    // ─────────────────────────────────────────────────────────────
    // 2. Inside vs Outside Geofence
    // ─────────────────────────────────────────────────────────────
    console.log('\n2. Inside vs Outside Geofence');

    // Inside geofence (~25 meters away, high accuracy, fresh timestamp)
    const insideLocation: ClientLocation = {
        latitude: classroom.latitude + 0.00020,
        longitude: classroom.longitude,
        accuracy: 10,
        timestamp: new Date().toISOString()
    };
    const insideResult = validateLocation(insideLocation, classroom);
    assert(insideResult.valid === true, 'Student located ~22m away is inside 100m geofence');
    assert(insideResult.distanceMeters !== undefined && insideResult.distanceMeters < 100, `Distance reported is < 100m (was ${insideResult.distanceMeters?.toFixed(1)}m)`);

    // Outside geofence (~220 meters away)
    const outsideLocation: ClientLocation = {
        latitude: classroom.latitude + 0.00200,
        longitude: classroom.longitude,
        accuracy: 15,
        timestamp: new Date().toISOString()
    };
    const outsideResult = validateLocation(outsideLocation, classroom);
    assert(outsideResult.valid === false, 'Student located ~222m away is rejected as outside classroom');
    assert(outsideResult.error?.code === 'OUTSIDE_CLASSROOM', 'Rejection code is OUTSIDE_CLASSROOM');
    assert(typeof outsideResult.error?.retryHint === 'string' && outsideResult.error.retryHint.length > 0, 'Clear retry hint is provided');

    // ─────────────────────────────────────────────────────────────
    // 3. Accuracy Threshold Validation
    // ─────────────────────────────────────────────────────────────
    console.log('\n3. GPS Accuracy Thresholds');

    // Inside geographically, but accuracy is 45m (> 30m max allowed)
    const lowAccuracyLocation: ClientLocation = {
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: 45,
        timestamp: new Date().toISOString()
    };
    const lowAccResult = validateLocation(lowAccuracyLocation, classroom);
    assert(lowAccResult.valid === false, 'Reading with 45m accuracy is rejected when max is 30m');
    assert(lowAccResult.error?.code === 'ACCURACY_TOO_LOW', 'Rejection code is ACCURACY_TOO_LOW');
    assert(lowAccResult.error?.retryHint.includes('window') || false, 'Retry hint provides guidance on GPS reception');

    // Exactly at threshold (30m)
    const exactAccuracyLocation: ClientLocation = {
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: 30,
        timestamp: new Date().toISOString()
    };
    const exactAccResult = validateLocation(exactAccuracyLocation, classroom);
    assert(exactAccResult.valid === true, 'Reading with exactly 30m accuracy passes');

    // ─────────────────────────────────────────────────────────────
    // 4. Timestamp Freshness and Clock Drift
    // ─────────────────────────────────────────────────────────────
    console.log('\n4. Timestamp Freshness and Clock Drift');

    // Fresh timestamp (3 seconds old)
    const freshLocation: ClientLocation = {
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: 10,
        timestamp: new Date(Date.now() - 3000).toISOString()
    };
    const freshResult = validateLocation(freshLocation, classroom);
    assert(freshResult.valid === true, 'Timestamp 3 seconds old is valid');

    // Stale timestamp (35 seconds old, threshold is 30s)
    const staleLocation: ClientLocation = {
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: 10,
        timestamp: new Date(Date.now() - 35000).toISOString()
    };
    const staleResult = validateLocation(staleLocation, classroom);
    assert(staleResult.valid === false, 'Timestamp 35 seconds old is rejected as stale');
    assert(staleResult.error?.code === 'STALE_LOCATION', 'Rejection code is STALE_LOCATION');

    // Clock drift: 2 seconds into future (within 5s tolerance)
    const slightFutureLocation: ClientLocation = {
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: 10,
        timestamp: new Date(Date.now() + 2000).toISOString()
    };
    const slightFutureResult = validateLocation(slightFutureLocation, classroom);
    assert(slightFutureResult.valid === true, 'Timestamp 2s in future is accepted within drift tolerance');

    // Excessive future clock drift: 15 seconds into future
    const excessiveFutureLocation: ClientLocation = {
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: 10,
        timestamp: new Date(Date.now() + 15000).toISOString()
    };
    const excessiveFutureResult = validateLocation(excessiveFutureLocation, classroom);
    assert(excessiveFutureResult.valid === false, 'Timestamp 15s in future is rejected');
    assert(excessiveFutureResult.error?.code === 'STALE_LOCATION', 'Rejection code for invalid future timestamp is STALE_LOCATION');

    // ─────────────────────────────────────────────────────────────
    // 5. Coordinate Range and Sanity Validation
    // ─────────────────────────────────────────────────────────────
    console.log('\n5. Coordinate Range and Sanity Validation');

    // Invalid latitude (> 90)
    const invalidLat = validateLocation({
        latitude: 95.0,
        longitude: 0,
        accuracy: 10,
        timestamp: new Date().toISOString()
    }, classroom);
    assert(invalidLat.valid === false && invalidLat.error?.code === 'INVALID_COORDINATES', 'Latitude > 90 rejected');

    // Invalid latitude (< -90)
    const invalidLatNeg = validateLocation({
        latitude: -90.5,
        longitude: 0,
        accuracy: 10,
        timestamp: new Date().toISOString()
    }, classroom);
    assert(invalidLatNeg.valid === false && invalidLatNeg.error?.code === 'INVALID_COORDINATES', 'Latitude < -90 rejected');

    // Invalid longitude (> 180)
    const invalidLon = validateLocation({
        latitude: 0,
        longitude: 185.0,
        accuracy: 10,
        timestamp: new Date().toISOString()
    }, classroom);
    assert(invalidLon.valid === false && invalidLon.error?.code === 'INVALID_COORDINATES', 'Longitude > 180 rejected');

    // Negative accuracy
    const negAccuracy = validateLocation({
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: -5,
        timestamp: new Date().toISOString()
    }, classroom);
    assert(negAccuracy.valid === false && negAccuracy.error?.code === 'INVALID_COORDINATES', 'Negative accuracy rejected');

    // Unparseable timestamp string
    const badTs = validateLocation({
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: 10,
        timestamp: 'invalid-date-string'
    }, classroom);
    assert(badTs.valid === false && badTs.error?.code === 'INVALID_COORDINATES', 'Unparseable timestamp string rejected');

    // ─────────────────────────────────────────────────────────────
    // 6. Request Payload Shape Validation
    // ─────────────────────────────────────────────────────────────
    console.log('\n6. Request Payload Shape Guard');

    assert(validateClientLocationShape(null) !== null, 'null payload is detected as invalid shape');
    assert(validateClientLocationShape('not-an-object') !== null, 'string payload is detected as invalid shape');
    assert(validateClientLocationShape({}) !== null, 'empty object is detected as invalid shape');
    assert(validateClientLocationShape({ latitude: '12.34', longitude: 56.78, accuracy: 10, timestamp: new Date().toISOString() }) !== null, 'string latitude is detected as invalid shape');
    assert(validateClientLocationShape({ latitude: 12.34, longitude: 56.78, accuracy: 10, timestamp: new Date().toISOString() }) === null, 'correct shape returns null (no error)');

    // ─────────────────────────────────────────────────────────────
    // 7. Security: Client-supplied booleans are ignored
    // ─────────────────────────────────────────────────────────────
    console.log('\n7. Security: Anti-Spoofing & Boolean Bypass Immunity');

    // Attacker sends { insideClassroom: true }, but is physically 500m away
    const attackerPayload = {
        latitude: classroom.latitude + 0.005,
        longitude: classroom.longitude,
        accuracy: 10,
        timestamp: new Date().toISOString(),
        insideClassroom: true, // Mock attempt
        is_verified: true
    };
    const attackerResult = validateLocation(attackerPayload as any, classroom);
    assert(attackerResult.valid === false, 'Attacker with insideClassroom=true but distant GPS is rejected');
    assert(attackerResult.error?.code === 'OUTSIDE_CLASSROOM', 'Server-side Haversine computation governs result, ignoring client booleans');

    // ─────────────────────────────────────────────────────────────
    // 8. Boundary Conditions & Exact Thresholds
    // ─────────────────────────────────────────────────────────────
    console.log('\n8. Boundary Conditions & Exact Thresholds');

    // Exact coordinate boundaries: (90, 180), (-90, -180), (0, 0)
    const poleClassroom: ClassroomConfig = {
        id: 'pole-1',
        name: 'North Pole Station',
        latitude: 90.0,
        longitude: 180.0,
        radius_meters: 100,
        max_accuracy_meters: 30
    };
    const poleLoc: ClientLocation = {
        latitude: 90.0,
        longitude: 180.0,
        accuracy: 5,
        timestamp: new Date().toISOString()
    };
    assert(validateLocation(poleLoc, poleClassroom).valid === true, 'Coordinates at exact WGS-84 extremes (90, 180) are valid');

    // NaN / Infinity coordinates
    assert(validateLocation({ latitude: NaN, longitude: 0, accuracy: 10, timestamp: new Date().toISOString() }, classroom).valid === false, 'NaN latitude is rejected');
    assert(validateLocation({ latitude: 0, longitude: Infinity, accuracy: 10, timestamp: new Date().toISOString() }, classroom).valid === false, 'Infinity longitude is rejected');
    assert(validateLocation({ latitude: 0, longitude: 0, accuracy: NaN, timestamp: new Date().toISOString() }, classroom).valid === false, 'NaN accuracy is rejected');

    // Accuracy = 0 is valid (highest possible theoretical accuracy)
    const zeroAcc = validateLocation({
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: 0,
        timestamp: new Date().toISOString()
    }, classroom);
    assert(zeroAcc.valid === true, 'Accuracy of 0 metres is accepted as valid');

    // Accuracy slightly over threshold (30.1m)
    const justOverAcc = validateLocation({
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        accuracy: 30.1,
        timestamp: new Date().toISOString()
    }, classroom);
    assert(justOverAcc.valid === false && justOverAcc.error?.code === 'ACCURACY_TOO_LOW', 'Accuracy of 30.1m is rejected when threshold is 30m');

    // ─────────────────────────────────────────────────────────────
    // 9. Configurable Geofence Radius
    // ─────────────────────────────────────────────────────────────
    console.log('\n9. Configurable Geofence Radius');

    // Tight 25m radius geofence
    const tightClassroom: ClassroomConfig = {
        ...classroom,
        radius_meters: 25
    };
    // 50m away reading
    const dist50mLoc: ClientLocation = {
        latitude: classroom.latitude + 0.00045,
        longitude: classroom.longitude,
        accuracy: 10,
        timestamp: new Date().toISOString()
    };
    assert(validateLocation(dist50mLoc, classroom).valid === true, '50m distance passes inside 100m geofence');
    assert(validateLocation(dist50mLoc, tightClassroom).valid === false, '50m distance is rejected inside tight 25m geofence');

    // Wide 500m radius geofence
    const wideClassroom: ClassroomConfig = {
        ...classroom,
        radius_meters: 500
    };
    const dist300mLoc: ClientLocation = {
        latitude: classroom.latitude + 0.0027,
        longitude: classroom.longitude,
        accuracy: 10,
        timestamp: new Date().toISOString()
    };
    assert(validateLocation(dist300mLoc, classroom).valid === false, '300m distance is rejected inside standard 100m geofence');
    assert(validateLocation(dist300mLoc, wideClassroom).valid === true, '300m distance passes inside wide 500m geofence');

    // ─────────────────────────────────────────────────────────────
    // 10. Staleness Config via Environment Variable
    // ─────────────────────────────────────────────────────────────
    console.log('\n10. Staleness Config via Environment Variable');

    const originalEnv = process.env.GEO_MAX_STALENESS_SECONDS;
    try {
        process.env.GEO_MAX_STALENESS_SECONDS = '60';
        const age45sLoc: ClientLocation = {
            latitude: classroom.latitude,
            longitude: classroom.longitude,
            accuracy: 10,
            timestamp: new Date(Date.now() - 45000).toISOString()
        };
        assert(validateLocation(age45sLoc, classroom).valid === true, 'Reading 45s old passes when GEO_MAX_STALENESS_SECONDS=60');

        process.env.GEO_MAX_STALENESS_SECONDS = '15';
        assert(validateLocation(age45sLoc, classroom).valid === false, 'Reading 45s old is rejected when GEO_MAX_STALENESS_SECONDS=15');
    } finally {
        if (originalEnv !== undefined) {
            process.env.GEO_MAX_STALENESS_SECONDS = originalEnv;
        } else {
            delete process.env.GEO_MAX_STALENESS_SECONDS;
        }
    }

    console.log('\n====================================================');
    console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
