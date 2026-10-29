/**
 * geo.ts - Session Anchor proximity verification service for MegaByte
 *
 * Rule: A student passes only if their phone is within GEO_RADIUS_M (default 100 m)
 * of the faculty laptop's live location anchor.
 * Server-side Haversine against session's current stored anchor, never client-supplied.
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
 * Proximity radius in metres.
 * Override via GEO_RADIUS_M env var (default: 100m).
 */
export function getGeoRadiusM(): number {
    const v = parseInt(process.env.GEO_RADIUS_M || '', 10);
    return Number.isFinite(v) && v > 0 ? v : 100;
}

/** Retained for backwards compatibility if needed */
export function getGeoMaxAccuracyM(): number {
    const v = parseInt(process.env.GEO_MAX_ACCURACY_M || '', 10);
    return Number.isFinite(v) && v > 0 ? v : 100;
}

/** Retained for backwards compatibility if needed */
export function getGeoToleranceCapM(): number {
    const v = parseInt(process.env.GEO_TOLERANCE_CAP_M || '', 10);
    return Number.isFinite(v) && v >= 0 ? v : 50;
}

export type GeoErrorCode =
    | 'LOCATION_REQUIRED'
    | 'LOCATION_TOO_FAR'
    | 'LOCATION_INACCURATE'
    | 'OUTSIDE_CLASSROOM'
    | 'ANCHOR_REQUIRED';

export interface GeoError {
    code: string;
    message: string;
    retryHint: string;
}

export interface ClientLocation {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: string;
}

export interface ClassroomConfig {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radius_meters: number;
    max_accuracy_meters: number;
    accuracy_meters?: number | null;
    accuracy?: number | null;
}

export interface GeoValidationResult {
    valid: boolean;
    distanceMeters?: number;
    accuracyMeters?: number;
    error?: GeoError;
}

export interface LocationEvaluationError {
    statusCode: number; // 422
    code: 'LOCATION_REQUIRED' | 'LOCATION_TOO_FAR' | 'ANCHOR_REQUIRED' | 'LOCATION_INACCURATE' | 'OUTSIDE_CLASSROOM';
    message: string;
    retryHint: string;
    distance_m?: number;
    distanceMeters?: number;
    accuracy_m?: number;
    accuracyMeters?: number;
}

export interface EvaluateLocationResult {
    valid: boolean;
    location_status: string | null;
    distance_m: number | null;
    geo_accuracy_m: number | null;
    error?: LocationEvaluationError;
}

export interface SessionAnchorConfig {
    id?: string;
    anchor_lat?: number | null;
    anchor_lng?: number | null;
    anchor_accuracy_m?: number | null;
    anchor_updated_at?: Date | string | null;
    [key: string]: any;
}

export interface ClientLocationInput {
    lat?: number | null;
    lng?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    lon?: number | null;
    accuracy?: number | null;
    accuracy_m?: number | null;
    timestamp?: string | number | null;
    [key: string]: any;
}

/**
 * Log one server line per check: session id, radius, distance_m, accuracy, result.
 */
export function logGeofenceCheck(
    sessionId: string,
    radius: number,
    distanceM?: number | null,
    accuracy?: number | null,
    result: string = 'PASSED'
): void {
    const distStr = distanceM !== undefined && distanceM !== null && Number.isFinite(distanceM)
        ? Math.round(distanceM * 10) / 10
        : 'N/A';
    const accStr = accuracy !== undefined && accuracy !== null && Number.isFinite(accuracy)
        ? Math.round(accuracy * 10) / 10
        : 'N/A';
    console.log(`session: ${sessionId}, radius: ${radius}m, dist: ${distStr}m, acc: ${accStr}m, result: ${result}`);
}

/**
 * Single source of truth for location evaluation across challenge and submit.
 * Evaluates student location against the session's CURRENT faculty laptop anchor.
 *
 * Rule:
 * - A session with no anchor -> reject (fail closed): 422 LOCATION_REQUIRED.
 * - Missing/invalid student location -> 422 LOCATION_REQUIRED.
 * - distance_m <= GEO_RADIUS_M (default 100) -> pass.
 * - distance_m > GEO_RADIUS_M -> 422 LOCATION_TOO_FAR with {distance_m}.
 */
export function evaluateLocation(
    session: SessionAnchorConfig | null | undefined,
    classroomOrLoc?: any,
    locOrUndefined?: any
): EvaluateLocationResult {
    const loc: ClientLocationInput | null | undefined = locOrUndefined !== undefined
        ? locOrUndefined
        : classroomOrLoc;

    // Fail-closed if session has no anchor configured
    const aLat = session?.anchor_lat !== null && session?.anchor_lat !== undefined ? Number(session.anchor_lat) : NaN;
    const aLng = session?.anchor_lng !== null && session?.anchor_lng !== undefined ? Number(session.anchor_lng) : NaN;

    const anchorValid = Number.isFinite(aLat) && Number.isFinite(aLng) &&
        aLat >= -90 && aLat <= 90 && aLng >= -180 && aLng <= 180 &&
        !(aLat === 0 && aLng === 0);

    if (!anchorValid) {
        return {
            valid: false,
            location_status: null,
            distance_m: null,
            geo_accuracy_m: null,
            error: {
                statusCode: 422,
                code: 'LOCATION_REQUIRED',
                message: 'Session has no faculty laptop location anchor configured.',
                retryHint: 'Faculty must provide location anchor to start session.',
            },
        };
    }

    // Student location validation
    if (!loc || typeof loc !== 'object') {
        return {
            valid: false,
            location_status: null,
            distance_m: null,
            geo_accuracy_m: null,
            error: {
                statusCode: 422,
                code: 'LOCATION_REQUIRED',
                message: 'Location data is required to verify classroom attendance.',
                retryHint: 'Enable location access on your device and try again.',
            },
        };
    }

    const lat = loc.lat !== undefined && loc.lat !== null
        ? Number(loc.lat)
        : (loc.latitude !== undefined && loc.latitude !== null ? Number(loc.latitude) : NaN);
    const lng = loc.lng !== undefined && loc.lng !== null
        ? Number(loc.lng)
        : (loc.longitude !== undefined && loc.longitude !== null ? Number(loc.longitude) : (loc.lon !== undefined && loc.lon !== null ? Number(loc.lon) : NaN));
    const acc = loc.accuracy !== undefined && loc.accuracy !== null
        ? Number(loc.accuracy)
        : (loc.accuracy_m !== undefined && loc.accuracy_m !== null ? Number(loc.accuracy_m) : NaN);

    const coordsValid = Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(acc) &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
        !(lat === 0 && lng === 0) &&
        acc >= 0;

    if (!coordsValid) {
        return {
            valid: false,
            location_status: null,
            distance_m: null,
            geo_accuracy_m: Number.isFinite(acc) ? acc : null,
            error: {
                statusCode: 422,
                code: 'LOCATION_REQUIRED',
                message: 'Valid GPS coordinates and accuracy are required and cannot be null or (0,0).',
                retryHint: 'Enable location services on your device and try again.',
            },
        };
    }

    const distanceM = haversineDistance(lat, lng, aLat, aLng);
    const radiusM = getGeoRadiusM(); // default 100

    if (distanceM <= radiusM) {
        return {
            valid: true,
            location_status: 'INSIDE',
            distance_m: distanceM,
            geo_accuracy_m: acc,
        };
    } else {
        return {
            valid: false,
            location_status: null,
            distance_m: distanceM,
            geo_accuracy_m: acc,
            error: {
                statusCode: 422,
                code: 'LOCATION_TOO_FAR',
                message: `You are ${Math.round(distanceM)} m from the faculty laptop (must be within ${radiusM} m).`,
                distance_m: distanceM,
                distanceMeters: distanceM,
                accuracy_m: acc,
                accuracyMeters: acc,
                retryHint: `You must be within ${radiusM} m of the faculty laptop to verify attendance.`,
            },
        };
    }
}

/** Backwards compatibility wrappers */
export function validateLocation(
    location: any,
    classroom: any,
    _serverNow: Date = new Date()
) {
    const res = evaluateLocation(classroom, location);
    return {
        valid: res.valid,
        distanceMeters: res.distance_m ?? undefined,
        accuracyMeters: res.geo_accuracy_m ?? undefined,
        error: res.error,
    };
}

export function validateClientLocationShape(loc: unknown) {
    if (!loc || typeof loc !== 'object') {
        return { error: { code: 'LOCATION_REQUIRED', message: 'Location required' } };
    }
    return null;
}
