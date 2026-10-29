import crypto from 'crypto';

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function getCodeWindowSeconds(): number {
    const val = parseInt(process.env.CODE_WINDOW_SECONDS || '30', 10);
    return isNaN(val) || val <= 0 ? 30 : val;
}

export function isRotatingCodeEnabled(): boolean {
    const val = process.env.ROTATING_CODE;
    if (val === undefined || val === null || val === '') return true;
    return val !== 'false' && val !== '0';
}

/**
 * Computes a 6-character TOTP-style live code.
 * HMAC-SHA256(secret, String(windowIndex)) mapped to the unambiguous alphabet.
 */
export function liveCode(secret: string, windowIndex: number | bigint): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(String(windowIndex));
    const digest = hmac.digest();
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
    }
    return code;
}

/**
 * Gets live code and remaining milliseconds in the current server window.
 */
export function getLiveCodeDetails(secret: string, nowMs: number = Date.now()): { code: string; expires_in_ms: number } {
    const windowSeconds = getCodeWindowSeconds();
    const windowMs = windowSeconds * 1000;
    const windowIndex = Math.floor(nowMs / windowMs);
    const code = liveCode(secret, windowIndex);
    const expiresInMs = (windowIndex + 1) * windowMs - nowMs;
    return { code, expires_in_ms: expiresInMs };
}

// In-memory rate limiter for failed code attempts (max 5 failures per student per minute)
const failedAttemptsByStudent = new Map<string, number[]>();

export function checkCodeRateLimit(studentId: string): { limited: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const history = (failedAttemptsByStudent.get(studentId) || []).filter(ts => now - ts < windowMs);
    failedAttemptsByStudent.set(studentId, history);

    if (history.length >= 5) {
        const oldest = history[0];
        const remainingMs = Math.max(1000, oldest + windowMs - now);
        const retryAfterSeconds = Math.ceil(remainingMs / 1000);
        return { limited: true, retryAfterSeconds };
    }
    return { limited: false, retryAfterSeconds: 0 };
}

export function recordCodeFailure(studentId: string): void {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const history = (failedAttemptsByStudent.get(studentId) || []).filter(ts => now - ts < windowMs);
    history.push(now);
    failedAttemptsByStudent.set(studentId, history);
}

// Helper to reset rate limits (useful in verification tests)
export function resetCodeRateLimits(): void {
    failedAttemptsByStudent.clear();
}
