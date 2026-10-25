/**
 * geo.ts - GPS geofencing service for MegaByte
 *
 * SECURITY NOTE - COORDINATE SPOOFING RISK:
 * Browser-supplied GPS coordinates are obtained via navigator.geolocation and
 * transmitted by the student browser over HTTPS.  A determined attacker can:
 *   1. Intercept and modify the request (mitigated by HTTPS + JWT auth).
 *   2. Use a browser extension or DevTools override to fabricate coordinates.
 *   3. Use a rooted/jailbroken device with a mock-location app.
 *
 * Mitigations implemented here:
 *   - Maximum staleness window (default 30 s): rejects cached or pre-recorded
 *     readings collected outside the classroom before the session started.
 *   - Maximum accuracy threshold: coarse readings are rejected.
 *   - Server-side Haversine: the server calculates the distance; the client
 *     is NEVER asked to supply a boolean like "insideClassroom: true".
 *   - All verified coordinates are stored in attendance_records for audit.
 *
 * None of these measures are cryptographically unbreakable, but they raise the
 * cost of spoofing significantly above walking to the classroom.
 */

/** Earth's mean radius in metres (WGS-84 approximation). */
const EARTH_RADIUS_M = 6_371_000;

/** Convert degrees to radians. */
function toRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

/**
 * Haversine formula - great-circle distance between two coordinate pairs.
 * @returns Distance in metres.
 */
export function haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const a =
        sinDLat * sinDLat +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinDLon * sinDLon;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_M * c;
}

/**
 * Maximum age of a client-supplied location timestamp in seconds.
 * Override via GEO_MAX_STALENESS_SECONDS env var.
 */
export function getMaxStalenessSecs(): number {
    const v = parseInt(process.env.GEO_MAX_STALENESS_SECONDS || '', 10);
    return Number.isFinite(v) && v > 0 ? v : 30;
}

export type GeoErrorCode =
    | 'LOCATION_REQUIRED'
    | 'INVALID_COORDINATES'
    | 'STALE_LOCATION'
    | 'ACCURACY_TOO_LOW'
    | 'OUTSIDE_CLASSROOM';

export interface GeoError {
    code: GeoErrorCode;
    message: string;
    /** Suggested action the student UI should show. */
    retryHint: string;
}

/** Raw GPS payload supplied by the student browser. */
export interface ClientLocation {
    /** WGS-84 latitude (-90..+90). */
    latitude: number;
    /** WGS-84 longitude (-180..+180). */
    longitude: number;
    /** Horizontal accuracy in metres (GeolocationCoordinates.accuracy). */
    accuracy: number;
    /** ISO-8601 timestamp when the reading was captured on the device. */
    timestamp: string;
}

/** Classroom row fetched from the database. */
export interface ClassroomConfig {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radius_meters: number;
    max_accuracy_meters: number;
}

export interface GeoValidationResult {
    /** True only when ALL checks pass. */
    valid: boolean;
    /** Haversine distance in metres (undefined on early-exit errors). */
    distanceMeters?: number;
    /** Populated when valid === false. */
    error?: GeoError;
}

/**
 * Validates a student-supplied GPS reading against a classroom geofence.
 * Must be called BEFORE issuing a liveness challenge.
 */
export function validateLocation(
    location: ClientLocation,
    classroom: ClassroomConfig,
    serverNow: Date = new Date()
): GeoValidationResult {
    // 1. Validate coordinate ranges
    const lat = Number(location.latitude);
    const lon = Number(location.longitude);
    const acc = Number(location.accuracy);

    if (
        !Number.isFinite(lat) || lat < -90  || lat > 90  ||
        !Number.isFinite(lon) || lon < -180 || lon > 180 ||
        !Number.isFinite(acc) || acc < 0
    ) {
        return {
            valid: false,
            error: {
                code: 'INVALID_COORDINATES',
                message: 'The supplied GPS coordinates are invalid or out of range.',
                retryHint: 'Enable location services and try again.',
            },
        };
    }

    // 2. Check timestamp freshness
    const clientTs = new Date(location.timestamp).getTime();
    if (!Number.isFinite(clientTs)) {
        return {
            valid: false,
            error: {
                code: 'INVALID_COORDINATES',
                message: 'Location timestamp is missing or unparseable.',
                retryHint: 'Enable location services and try again.',
            },
        };
    }

    const serverNowMs = serverNow.getTime();
    const maxStalenessMs = getMaxStalenessSecs() * 1000;
    const ageMs = serverNowMs - clientTs;

    // Allow up to 5 s of clock drift into the future
    if (ageMs < -5000 || ageMs > maxStalenessMs) {
        return {
            valid: false,
            error: {
                code: 'STALE_LOCATION',
                message: `Location reading is too old (${Math.round(ageMs / 1000)} s). Maximum allowed age is ${getMaxStalenessSecs()} s.`,
                retryHint: 'Move to the classroom and tap "Mark Attendance" again to capture a fresh GPS reading.',
            },
        };
    }

    // 3. Check accuracy
    if (acc > classroom.max_accuracy_meters) {
        return {
            valid: false,
            error: {
                code: 'ACCURACY_TOO_LOW',
                message: `GPS accuracy is too low (${Math.round(acc)} m reported; <= ${classroom.max_accuracy_meters} m required).`,
                retryHint: 'Move near a window or open area and wait for GPS to lock, then try again.',
            },
        };
    }

    // 4. Haversine distance
    const distanceMeters = haversineDistance(lat, lon, classroom.latitude, classroom.longitude);

    if (distanceMeters > classroom.radius_meters) {
        return {
            valid: false,
            distanceMeters,
            error: {
                code: 'OUTSIDE_CLASSROOM',
                message: `You appear to be ${Math.round(distanceMeters)} m away from the classroom (allowed radius: ${classroom.radius_meters} m).`,
                retryHint: 'You must be physically present in the classroom. Contact your faculty if you believe this is an error.',
            },
        };
    }

    return { valid: true, distanceMeters };
}

/**
 * Guards the raw request payload shape before calling validateLocation.
 * Returns null if sane, or a GeoError to immediately return to the client.
 */
export function validateClientLocationShape(
    loc: unknown
): { error: GeoError } | null {
    if (
        typeof loc !== 'object' ||
        loc === null ||
        typeof (loc as any).latitude  !== 'number' ||
        typeof (loc as any).longitude !== 'number' ||
        typeof (loc as any).accuracy  !== 'number' ||
        typeof (loc as any).timestamp !== 'string'
    ) {
        return {
            error: {
                code: 'INVALID_COORDINATES',
                message: 'Location payload is malformed. Expected { latitude, longitude, accuracy, timestamp }.',
                retryHint: 'Enable location services and try again.',
            },
        };
    }
    return null;
}
