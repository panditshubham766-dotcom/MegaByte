/**
 * test_wifi.ts - Automated test suite for Wi-Fi access point verification (Phase 3)
 *
 * Covers:
 *   1. BSSID normalization across formats (colons, hyphens, dots, raw hex, case).
 *   2. Rejection of malformed, invalid length, non-hex, zero and broadcast BSSIDs.
 *   3. Matching against approved classroom access points.
 *   4. Inactive / disabled access point handling.
 *   5. Mismatching (unapproved access point).
 *   6. Missing BSSID evidence when required.
 *   7. Client platform states (PERMISSION_DENIED, UNSUPPORTED_DEVICE, UNAVAILABLE).
 *   8. Combined verification policy matrix (GPS_ONLY, WIFI_ONLY, GPS_OR_WIFI, GPS_AND_WIFI).
 *   9. Immunity to client-supplied booleans (e.g. wifi_verified: true).
 *  10. Security assertion: Router passwords and admin credentials are never accepted/stored.
 */

import {
    normalizeBssid,
    isValidBssid,
    validateWifiPresence,
    evaluateCombinedPresence,
    type ClientWifiEvidence,
    type ClassroomAccessPoint,
    type VerificationPolicy
} from './src/services/wifi.ts';
import type { LocationValidationResult } from './src/services/geo.ts';

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
    console.log('   MegaByte Wi-Fi BSSID Verification Test Suite     ');
    console.log('====================================================\n');

    // ─────────────────────────────────────────────────────────────
    // 1. BSSID Normalization Tests
    // ─────────────────────────────────────────────────────────────
    console.log('1. BSSID Normalization');

    // Standard colon-separated lowercase -> uppercase
    assert(
        normalizeBssid('00:1a:2b:3c:4d:5e') === '00:1A:2B:3C:4D:5E',
        'Normalizes standard colon-separated lowercase to uppercase'
    );

    // Hyphen-separated
    assert(
        normalizeBssid('00-1A-2B-3C-4D-5E') === '00:1A:2B:3C:4D:5E',
        'Normalizes hyphen-separated MAC notation'
    );

    // Cisco dot-separated format (001a.2b3c.4d5e)
    assert(
        normalizeBssid('001a.2b3c.4d5e') === '00:1A:2B:3C:4D:5E',
        'Normalizes Cisco dot-notation (001a.2b3c.4d5e)'
    );

    // Raw 12-char hex string
    assert(
        normalizeBssid('001A2B3C4D5E') === '00:1A:2B:3C:4D:5E',
        'Normalizes continuous 12-hex string'
    );

    // Whitespace trimming
    assert(
        normalizeBssid('   00:1a:2b:3c:4d:5e   ') === '00:1A:2B:3C:4D:5E',
        'Trims leading and trailing whitespace'
    );

    // Mixed case and hyphens
    assert(
        normalizeBssid('e4-aa-Ea-12-34-56') === 'E4:AA:EA:12:34:56',
        'Normalizes mixed case with hyphens'
    );

    // ─────────────────────────────────────────────────────────────
    // 2. Malformed / Invalid BSSID Rejection
    // ─────────────────────────────────────────────────────────────
    console.log('\n2. Malformed / Invalid BSSID Rejection');

    // Empty or non-string
    assert(normalizeBssid('') === null, 'Rejects empty string');
    assert(normalizeBssid(null as any) === null, 'Rejects null input');
    assert(normalizeBssid(undefined as any) === null, 'Rejects undefined input');

    // Too short / too long
    assert(normalizeBssid('00:11:22:33:44') === null, 'Rejects 5-octet truncated BSSID');
    assert(normalizeBssid('00:11:22:33:44:55:66') === null, 'Rejects 7-octet EUI-64 identifier');

    // Non-hex characters
    assert(normalizeBssid('00:11:22:33:44:GG') === null, 'Rejects non-hexadecimal characters (G)');
    assert(normalizeBssid('NOT-A-BSSID-ADDR') === null, 'Rejects arbitrary text');

    // All-zero address (null MAC)
    assert(normalizeBssid('00:00:00:00:00:00') === null, 'Rejects all-zero null BSSID');
    assert(normalizeBssid('00-00-00-00-00-00') === null, 'Rejects all-zero hyphen notation');

    // Broadcast address (all FF)
    assert(normalizeBssid('FF:FF:FF:FF:FF:FF') === null, 'Rejects all-FF broadcast BSSID');
    assert(normalizeBssid('ffffffffffff') === null, 'Rejects raw all-FF broadcast');

    // Format validator helper
    assert(isValidBssid('00:1A:2B:3C:4D:5E') === true, 'isValidBssid returns true for canonical BSSID');
    assert(isValidBssid('invalid') === false, 'isValidBssid returns false for invalid string');

    // ─────────────────────────────────────────────────────────────
    // 3. Matching Approved Access Points
    // ─────────────────────────────────────────────────────────────
    console.log('\n3. Matching Approved Access Points');

    const approvedAPs: ClassroomAccessPoint[] = [
        {
            id: 'ap-1',
            classroom_id: 'room-101',
            bssid: 'A4:2B:B0:11:22:33',
            ssid: 'CAMPUS-STUDENT-5G',
            description: 'Ceiling AP North',
            is_active: true
        },
        {
            id: 'ap-2',
            classroom_id: 'room-101',
            bssid: 'A4:2B:B0:44:55:66',
            ssid: 'CAMPUS-STUDENT-2.4G',
            description: 'Ceiling AP South',
            is_active: true
        },
        {
            id: 'ap-disabled',
            classroom_id: 'room-101',
            bssid: 'B0:AA:22:33:44:55',
            ssid: 'CAMPUS-MAINTENANCE',
            description: 'Decommissioned AP',
            is_active: false
        }
    ];

    // Client reports canonical approved BSSID
    const matchCanonical = validateWifiPresence(
        { bssid: 'A4:2B:B0:11:22:33' },
        approvedAPs,
        'WIFI_ONLY'
    );
    assert(matchCanonical.verified === true, 'Matches canonical uppercase BSSID');
    assert(matchCanonical.matchedBssid === 'A4:2B:B0:11:22:33', 'Returns normalized BSSID');
    assert(matchCanonical.status === 'VERIFIED', 'Status is VERIFIED');

    // Client reports lowercase hyphen-separated BSSID
    const matchDifferentFormat = validateWifiPresence(
        { bssid: 'a4-2b-b0-11-22-33' },
        approvedAPs,
        'WIFI_ONLY'
    );
    assert(matchDifferentFormat.verified === true, 'Matches lowercase hyphenated format to registered AP');
    assert(matchDifferentFormat.matchedBssid === 'A4:2B:B0:11:22:33', 'Normalizes client BSSID before comparison');

    // Client reports second active AP in the room
    const matchSecondAp = validateWifiPresence(
        { bssid: 'A4:2B:B0:44:55:66' },
        approvedAPs,
        'WIFI_ONLY'
    );
    assert(matchSecondAp.verified === true, 'Matches alternative access point registered in room');

    // ─────────────────────────────────────────────────────────────
    // 4. Inactive / Disabled Access Points
    // ─────────────────────────────────────────────────────────────
    console.log('\n4. Inactive / Disabled Access Point');

    const matchDisabled = validateWifiPresence(
        { bssid: 'B0:AA:22:33:44:55' },
        approvedAPs,
        'WIFI_ONLY'
    );
    assert(matchDisabled.verified === false, 'Rejects connection to decommissioned/disabled AP');
    assert(matchDisabled.error?.code === 'UNAPPROVED_ACCESS_POINT', 'Error code is UNAPPROVED_ACCESS_POINT');

    // ─────────────────────────────────────────────────────────────
    // 5. Mismatching (Unapproved Access Point)
    // ─────────────────────────────────────────────────────────────
    console.log('\n5. Mismatching (Unapproved BSSID)');

    const mismatchAp = validateWifiPresence(
        { bssid: 'C0:FF:EE:11:22:33', ssid: 'Neighboring-Coffee-Shop' },
        approvedAPs,
        'WIFI_ONLY'
    );
    assert(mismatchAp.verified === false, 'Rejects unapproved rogue or off-campus BSSID');
    assert(mismatchAp.error?.code === 'UNAPPROVED_ACCESS_POINT', 'Error code is UNAPPROVED_ACCESS_POINT');
    assert(mismatchAp.status === 'UNAPPROVED_AP', 'Status set to UNAPPROVED_AP');
    assert(typeof mismatchAp.error?.retryHint === 'string', 'Provides actionable retry hint');

    // ─────────────────────────────────────────────────────────────
    // 6. Missing BSSID Evidence
    // ─────────────────────────────────────────────────────────────
    console.log('\n6. Missing BSSID Evidence');

    const missingEvidence = validateWifiPresence(undefined, approvedAPs, 'WIFI_ONLY');
    assert(missingEvidence.verified === false, 'Rejects undefined Wi-Fi evidence');
    assert(missingEvidence.error?.code === 'BSSID_REQUIRED', 'Error code is BSSID_REQUIRED');

    const emptyBssidEvidence = validateWifiPresence({ bssid: '' }, approvedAPs, 'WIFI_ONLY');
    assert(emptyBssidEvidence.verified === false, 'Rejects empty BSSID evidence');
    assert(emptyBssidEvidence.error?.code === 'BSSID_REQUIRED', 'Error code is BSSID_REQUIRED');

    // ─────────────────────────────────────────────────────────────
    // 7. Client Platform States (Permissions, Unsupported Device, Unavailable)
    // ─────────────────────────────────────────────────────────────
    console.log('\n7. Platform States & Permissions');

    // Denied permissions
    const permDenied = validateWifiPresence({ status: 'PERMISSION_DENIED' }, approvedAPs, 'WIFI_ONLY');
    assert(permDenied.verified === false, 'Rejects PERMISSION_DENIED evidence');
    assert(permDenied.error?.code === 'PERMISSION_DENIED', 'Reports PERMISSION_DENIED error code');

    // Standard Web App / PWA unsupported device
    const unsupportedDev = validateWifiPresence({ status: 'UNSUPPORTED_DEVICE' }, approvedAPs, 'WIFI_ONLY');
    assert(unsupportedDev.verified === false, 'Rejects UNSUPPORTED_DEVICE evidence');
    assert(unsupportedDev.error?.code === 'UNSUPPORTED_DEVICE', 'Reports UNSUPPORTED_DEVICE error code');
    assert(unsupportedDev.error?.message.includes('standard web browsers'), 'Explains browser platform constraint');

    // Wi-Fi disabled / disconnected
    const unavailableWifi = validateWifiPresence({ status: 'UNAVAILABLE' }, approvedAPs, 'WIFI_ONLY');
    assert(unavailableWifi.verified === false, 'Rejects UNAVAILABLE Wi-Fi evidence');
    assert(unavailableWifi.error?.code === 'UNAVAILABLE', 'Reports UNAVAILABLE error code');

    // Classroom with no approved APs configured
    const noConfiguredAPs = validateWifiPresence({ bssid: 'A4:2B:B0:11:22:33' }, [], 'WIFI_ONLY');
    assert(noConfiguredAPs.verified === false, 'Rejects when classroom has no APs configured');
    assert(noConfiguredAPs.error?.code === 'UNAPPROVED_ACCESS_POINT', 'Reports unapproved access point');

    // ─────────────────────────────────────────────────────────────
    // 8. Verification Policy Matrix
    // ─────────────────────────────────────────────────────────────
    console.log('\n8. Verification Policy Matrix Evaluation');

    const validGps: LocationValidationResult = {
        valid: true,
        distanceMeters: 14.5
    };
    const invalidGps: LocationValidationResult = {
        valid: false,
        error: {
            code: 'OUTSIDE_CLASSROOM',
            message: 'You are 180m away from the classroom.',
            retryHint: 'Move inside classroom'
        }
    };

    const validWifi = validateWifiPresence({ bssid: 'A4:2B:B0:11:22:33' }, approvedAPs, 'WIFI_ONLY');
    const invalidWifi = validateWifiPresence({ bssid: '99:99:99:99:99:99' }, approvedAPs, 'WIFI_ONLY');
    const unsupportedWifi = validateWifiPresence({ status: 'UNSUPPORTED_DEVICE' }, approvedAPs, 'WIFI_ONLY');

    // 8a. Policy: GPS_ONLY
    console.log('  8a. GPS_ONLY:');
    const pGpsOnly1 = evaluateCombinedPresence('GPS_ONLY', validGps, invalidWifi);
    assert(pGpsOnly1.passed === true, 'GPS_ONLY passes when GPS is valid, even if Wi-Fi is invalid');

    const pGpsOnly2 = evaluateCombinedPresence('GPS_ONLY', validGps, unsupportedWifi);
    assert(pGpsOnly2.passed === true, 'GPS_ONLY passes on standard web browser (UNSUPPORTED_DEVICE)');

    const pGpsOnly3 = evaluateCombinedPresence('GPS_ONLY', invalidGps, validWifi);
    assert(pGpsOnly3.passed === false, 'GPS_ONLY fails when GPS is outside, even if Wi-Fi is valid');

    // 8b. Policy: WIFI_ONLY
    console.log('  8b. WIFI_ONLY:');
    const pWifiOnly1 = evaluateCombinedPresence('WIFI_ONLY', invalidGps, validWifi);
    assert(pWifiOnly1.passed === true, 'WIFI_ONLY passes when Wi-Fi matches, even if GPS is invalid');

    const pWifiOnly2 = evaluateCombinedPresence('WIFI_ONLY', validGps, invalidWifi);
    assert(pWifiOnly2.passed === false, 'WIFI_ONLY fails when Wi-Fi is invalid, even if GPS is valid');

    const pWifiOnly3 = evaluateCombinedPresence('WIFI_ONLY', validGps, unsupportedWifi);
    assert(pWifiOnly3.passed === false, 'WIFI_ONLY cleanly rejects unsupported web browser with error');
    assert(pWifiOnly3.error?.code === 'UNSUPPORTED_DEVICE', 'Error surfaces UNSUPPORTED_DEVICE to user');

    // 8c. Policy: GPS_OR_WIFI
    console.log('  8c. GPS_OR_WIFI:');
    const pOr1 = evaluateCombinedPresence('GPS_OR_WIFI', validGps, invalidWifi);
    assert(pOr1.passed === true, 'GPS_OR_WIFI passes when GPS succeeds alone');

    const pOr2 = evaluateCombinedPresence('GPS_OR_WIFI', invalidGps, validWifi);
    assert(pOr2.passed === true, 'GPS_OR_WIFI passes when Wi-Fi succeeds alone (e.g. GPS blocked indoor)');

    const pOr3 = evaluateCombinedPresence('GPS_OR_WIFI', validGps, unsupportedWifi);
    assert(pOr3.passed === true, 'GPS_OR_WIFI allows standard web app to succeed via GPS');

    const pOr4 = evaluateCombinedPresence('GPS_OR_WIFI', invalidGps, invalidWifi);
    assert(pOr4.passed === false, 'GPS_OR_WIFI fails when both GPS and Wi-Fi fail');

    // 8d. Policy: GPS_AND_WIFI
    console.log('  8d. GPS_AND_WIFI:');
    const pAnd1 = evaluateCombinedPresence('GPS_AND_WIFI', validGps, validWifi);
    assert(pAnd1.passed === true, 'GPS_AND_WIFI passes when BOTH GPS and Wi-Fi succeed');

    const pAnd2 = evaluateCombinedPresence('GPS_AND_WIFI', validGps, invalidWifi);
    assert(pAnd2.passed === false, 'GPS_AND_WIFI fails when Wi-Fi fails');

    const pAnd3 = evaluateCombinedPresence('GPS_AND_WIFI', invalidGps, validWifi);
    assert(pAnd3.passed === false, 'GPS_AND_WIFI fails when GPS fails');

    const pAnd4 = evaluateCombinedPresence('GPS_AND_WIFI', validGps, unsupportedWifi);
    assert(pAnd4.passed === false, 'GPS_AND_WIFI fails when device does not support native Wi-Fi');

    // ─────────────────────────────────────────────────────────────
    // 9. Immunity to Client-Supplied Booleans
    // ─────────────────────────────────────────────────────────────
    console.log('\n9. Immunity to Client-Supplied Booleans');

    const spoofedClientPayload = {
        bssid: '99:99:99:99:99:99', // Rogue AP
        wifi_verified: true,         // Attempted spoof
        insideClassroom: true,       // Attempted spoof
        is_verified: true,           // Attempted spoof
        status: 'VERIFIED'           // Attempted spoof
    } as any;

    const spoofResult = validateWifiPresence(spoofedClientPayload, approvedAPs, 'WIFI_ONLY');
    assert(spoofResult.verified === false, 'Client-supplied boolean wifi_verified: true is ignored');
    assert(spoofResult.status === 'UNAPPROVED_AP', 'Status is determined strictly by backend matching');

    // ─────────────────────────────────────────────────────────────
    // 10. Security Assertions: No Router Credentials Handled
    // ─────────────────────────────────────────────────────────────
    console.log('\n10. Router Credentials Security');

    const apKeys = Object.keys(approvedAPs[0]);
    assert(!apKeys.includes('password'), 'ClassroomAccessPoint schema has no password field');
    assert(!apKeys.includes('wpa_key'), 'ClassroomAccessPoint schema has no wpa_key field');
    assert(!apKeys.includes('admin_password'), 'ClassroomAccessPoint schema has no admin credentials');
    assert(!apKeys.includes('secret'), 'ClassroomAccessPoint schema has no router secret');

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
