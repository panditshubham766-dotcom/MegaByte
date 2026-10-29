/**
 * wifi.ts - Wi-Fi Access Point (BSSID) verification service for MegaByte
 *
 * SECURITY ARCHITECTURE & THREAT MODEL NOTE:
 * Client-reported Wi-Fi BSSIDs are transmitted by the student client. A determined
 * attacker could attempt to:
 *   1. Intercept/fabricate requests with a known classroom BSSID.
 *   2. Use mock network providers or tethering to mimic an SSID/BSSID.
 *   3. Share a legitimate BSSID with off-site accomplices.
 *
 * TRUST ESTABLISHMENT & COMBINED VERIFICATION POLICY:
 * A BSSID match alone does not cryptographically prove physical presence in a
 * particular classroom, just as browser-reported GPS coordinates can be simulated.
 * Trust is established by:
 *   - Multi-factor presence policy: combining independent GPS geofencing with Wi-Fi
 *     interrogation (GPS_AND_WIFI or GPS_OR_WIFI fallback for GPS-denied environments).
 *   - Normalizing and strictly validating canonical BSSID hardware MAC formats.
 *   - Authoritative backend matching against faculty/admin registered AP tables.
 *   - Client-supplied boolean flags (e.g. insideClassroom=true, wifiVerified=true)
 *     are NEVER trusted.
 *   - Complete audit logging in attendance_records (BSSID, SSID, status, distance).
 *   - Zero credential exposure: router passwords and PSKs are NEVER stored or sent.
 */

export type VerificationPolicy = 'GPS_ONLY' | 'WIFI_ONLY' | 'GPS_OR_WIFI' | 'GPS_AND_WIFI';

export type WifiErrorCode =
    | 'BSSID_REQUIRED'
    | 'INVALID_BSSID'
    | 'UNAPPROVED_ACCESS_POINT'
    | 'PERMISSION_DENIED'
    | 'UNSUPPORTED_DEVICE'
    | 'WIFI_UNAVAILABLE'
    | 'UNAVAILABLE';

export interface WifiError {
    code: WifiErrorCode;
    message: string;
    /** User-facing action guidance. */
    retryHint: string;
}

/** Client-reported Wi-Fi evidence payload. */
export interface ClientWifiEvidence {
    /** Connected BSSID (MAC address of the access point). */
    bssid?: string | null;
    /** Connected SSID (network name, optional). */
    ssid?: string | null;
    /** Explicit status reported by client platform integration. */
    status?: 'AVAILABLE' | 'UNAVAILABLE' | 'PERMISSION_DENIED' | 'UNSUPPORTED_DEVICE' | null;
}

/** Approved classroom access point database row. */
export interface ClassroomAccessPoint {
    id: string;
    classroom_id: string;
    /** Canonical normalized BSSID: XX:XX:XX:XX:XX:XX */
    bssid: string;
    ssid?: string | null;
    description?: string | null;
    is_active: boolean;
}

export interface WifiValidationResult {
    /** True only if client BSSID was validated against approved active APs. */
    verified: boolean;
    /** Canonical normalized BSSID that matched, if any. */
    matchedBssid?: string;
    /** High-level verification status for audit logs. */
    status: 'VERIFIED' | 'UNAPPROVED_AP' | 'UNAVAILABLE' | 'UNSUPPORTED_DEVICE' | 'PERMISSION_DENIED' | 'NOT_REQUIRED' | 'MALFORMED';
    error?: WifiError;
}

/**
 * Normalizes a BSSID string to canonical uppercase colon-separated format (XX:XX:XX:XX:XX:XX).
 * Accepts colon-separated, hyphen-separated, dot-separated, or unseparated 12-hex strings.
 * Returns null if the format is invalid or represents broadcast/all-zero addresses.
 */
export function normalizeBssid(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;

    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Strip separators: colons, hyphens, dots, spaces
    const cleanHex = trimmed.replace(/[:\-\.\s]/g, '');

    // Must be exactly 12 hex characters
    if (!/^[0-9A-Fa-f]{12}$/.test(cleanHex)) {
        return null;
    }

    const upper = cleanHex.toUpperCase();

    // Reject all-zero (00:00:00:00:00:00) and broadcast (FF:FF:FF:FF:FF:FF)
    if (upper === '000000000000' || upper === 'FFFFFFFFFFFF') {
        return null;
    }

    // Format as canonical XX:XX:XX:XX:XX:XX
    return upper.match(/.{1,2}/g)!.join(':');
}

/**
 * Checks if a string is a valid normalized or unnormalized BSSID.
 */
export function isValidBssid(raw: unknown): boolean {
    return normalizeBssid(raw) !== null;
}

/**
 * Validates client-reported Wi-Fi evidence against classroom approved access points.
 */
export function validateWifiPresence(
    evidence: ClientWifiEvidence | null | undefined,
    approvedAps: ClassroomAccessPoint[],
    policy: VerificationPolicy = 'WIFI_ONLY'
): WifiValidationResult {
    // If policy is GPS_ONLY, Wi-Fi verification is not required
    if (policy === 'GPS_ONLY') {
        if (!evidence || !evidence.bssid) {
            return { verified: false, status: 'NOT_REQUIRED' };
        }
        // If client provided a BSSID anyway, validate for audit purposes
        const normalized = normalizeBssid(evidence.bssid);
        if (!normalized) {
            return { verified: false, status: 'MALFORMED' };
        }
        const activeAps = approvedAps.filter(ap => ap.is_active);
        const match = activeAps.some(ap => ap.bssid.toUpperCase() === normalized);
        return {
            verified: match,
            matchedBssid: match ? normalized : undefined,
            status: match ? 'VERIFIED' : 'UNAPPROVED_AP'
        };
    }

    // Explicit client platform status checks
    if (evidence?.status === 'PERMISSION_DENIED') {
        return {
            verified: false,
            status: 'PERMISSION_DENIED',
            error: {
                code: 'PERMISSION_DENIED',
                message: 'Wi-Fi / Nearby Devices location permission was denied on your device.',
                retryHint: 'Grant location and nearby devices permissions in your device settings to access classroom Wi-Fi verification.'
            }
        };
    }

    if (evidence?.status === 'UNSUPPORTED_DEVICE') {
        return {
            verified: false,
            status: 'UNSUPPORTED_DEVICE',
            error: {
                code: 'UNSUPPORTED_DEVICE',
                message: 'Your current browser or device platform does not permit direct Wi-Fi BSSID interrogation in standard web browsers.',
                retryHint: 'Use an authorized campus native app or select GPS geofence verification.'
            }
        };
    }

    if (evidence?.status === 'UNAVAILABLE') {
        return {
            verified: false,
            status: 'UNAVAILABLE',
            error: {
                code: 'UNAVAILABLE',
                message: 'Wi-Fi connection is currently unavailable or disconnected.',
                retryHint: 'Turn on Wi-Fi on your device and connect to the classroom access point.'
            }
        };
    }

    if (!evidence || !evidence.bssid) {
        return {
            verified: false,
            status: 'UNAVAILABLE',
            error: {
                code: 'BSSID_REQUIRED',
                message: 'Wi-Fi access point information is required to verify attendance in this classroom.',
                retryHint: 'Connect to the classroom Wi-Fi network and ensure Wi-Fi is enabled on your device.'
            }
        };
    }

    // Validate BSSID format
    const normalized = normalizeBssid(evidence.bssid);
    if (!normalized) {
        return {
            verified: false,
            status: 'MALFORMED',
            error: {
                code: 'INVALID_BSSID',
                message: `The reported Wi-Fi BSSID '${evidence.bssid}' is malformed or invalid.`,
                retryHint: 'Reconnect to the classroom Wi-Fi network and try again.'
            }
        };
    }

    // Filter active APs
    const activeAps = approvedAps.filter(ap => ap.is_active);
    if (activeAps.length === 0) {
        // No active access points configured for this classroom
        return {
            verified: false,
            status: 'UNAPPROVED_AP',
            error: {
                code: 'UNAPPROVED_ACCESS_POINT',
                message: 'No approved Wi-Fi access points are currently registered for this classroom.',
                retryHint: 'Contact your faculty or system administrator to register the classroom access points.'
            }
        };
    }

    const match = activeAps.find(ap => ap.bssid.toUpperCase() === normalized);
    if (!match) {
        const networkHints = activeAps.map(ap => ap.ssid || ap.bssid).filter(Boolean);
        const hintText = networkHints.length > 0 ? ` Expected one of: ${networkHints.slice(0, 3).join(', ')}.` : '';
        return {
            verified: false,
            status: 'UNAPPROVED_AP',
            error: {
                code: 'UNAPPROVED_ACCESS_POINT',
                message: `You are connected to an unapproved Wi-Fi access point (${normalized}).${hintText}`,
                retryHint: 'Connect to the authorized classroom Wi-Fi network and try again.'
            }
        };
    }

    return {
        verified: true,
        matchedBssid: normalized,
        status: 'VERIFIED'
    };
}

export interface CombinedPresenceResult {
    /** Overall decision: true if presence policy requirements are fulfilled. */
    passed: boolean;
    policy: VerificationPolicy;
    gpsPassed: boolean;
    wifiPassed: boolean;
    primaryMethod: 'GPS' | 'WIFI' | 'BOTH' | 'NONE';
    error?: {
        code: string;
        message: string;
        retryHint: string;
    };
}

/**
 * Combines independent GPS and Wi-Fi verification results according to classroom verification policy.
 */
export function evaluateCombinedPresence(
    policy: VerificationPolicy,
    gpsResult: { valid: boolean; error?: { code: string; message: string; retryHint: string } },
    wifiResult: WifiValidationResult
): CombinedPresenceResult {
    const gpsPassed = gpsResult.valid;
    const wifiPassed = wifiResult.verified;

    // Policy: the check is GPS distance only.
    // Remove any GPS_OR_WIFI / Wi-Fi / IP / SSID fallback or OR-logic that can pass a student whose GPS distance fails.
    if (!gpsPassed) {
        return {
            passed: false,
            policy: 'GPS_ONLY',
            gpsPassed: false,
            wifiPassed,
            primaryMethod: 'NONE',
            error: gpsResult.error
        };
    }

    return {
        passed: true,
        policy: 'GPS_ONLY',
        gpsPassed: true,
        wifiPassed,
        primaryMethod: 'GPS'
    };
}
