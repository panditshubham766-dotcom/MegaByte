export function normalizeEmail(raw: string): string {
    if (!raw || typeof raw !== 'string') {
        throw new Error('Email is required and must be a string');
    }
    const trimmed = raw.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
        throw new Error('Invalid email format');
    }
    return trimmed;
}

export interface CollegeEmailCheckResult {
    valid: boolean;
    error?: string;
}

export function checkCollegeEmail(email: string, role: string): CollegeEmailCheckResult {
    let normalized: string;
    try {
        normalized = normalizeEmail(email);
    } catch {
        return {
            valid: false,
            error: role.toLowerCase() === 'student'
                ? 'Use your college email (<roll number>@iiitdwd.ac.in)'
                : 'Use your faculty college email (<name>@iiitdwd.ac.in)'
        };
    }

    const atIndex = normalized.lastIndexOf('@');
    if (atIndex === -1) {
        return {
            valid: false,
            error: role.toLowerCase() === 'student'
                ? 'Use your college email (<roll number>@iiitdwd.ac.in)'
                : 'Use your faculty college email (<name>@iiitdwd.ac.in)'
        };
    }

    const localPart = normalized.substring(0, atIndex);
    const domain = normalized.substring(atIndex + 1);

    const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || 'iiitdwd.ac.in')
        .split(',')
        .map(d => d.trim().toLowerCase())
        .filter(Boolean);

    if (!domain || !allowedDomains.includes(domain)) {
        return {
            valid: false,
            error: role.toLowerCase() === 'student'
                ? 'Use your college email (<roll number>@iiitdwd.ac.in)'
                : 'Use your faculty college email (<name>@iiitdwd.ac.in)'
        };
    }

    const studentRegexStr = process.env.STUDENT_LOCAL_REGEX || '^(?=.*[0-9])[a-z0-9]{5,15}$';
    const facultyRegexStr = process.env.FACULTY_LOCAL_REGEX || '^[a-z][a-z._-]{2,40}$';

    const r = role.toLowerCase();
    if (r === 'student') {
        const re = new RegExp(studentRegexStr);
        if (!re.test(localPart)) {
            return {
                valid: false,
                error: 'Use your college email (<roll number>@iiitdwd.ac.in)'
            };
        }
    } else if (r === 'faculty') {
        const re = new RegExp(facultyRegexStr);
        if (!re.test(localPart)) {
            return {
                valid: false,
                error: 'Use your faculty college email (<name>@iiitdwd.ac.in)'
            };
        }
    } else {
        return {
            valid: false,
            error: 'Invalid role specified'
        };
    }

    return { valid: true };
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('BREVO_API_KEY is missing');
        }
        console.log(`[Brevo sendMail Dev Mode - Code in message]: ${text}`);
        return;
    }

    const senderName = process.env.MAIL_FROM_NAME || 'MegaByte';
    const senderEmail = process.env.MAIL_FROM_EMAIL || 'noreply@iiitdwd.ac.in';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: senderName, email: senderEmail },
                to: [{ email: to }],
                subject,
                textContent: text
            }),
            signal: controller.signal
        });

        if (!res.ok) {
            console.error('Brevo sendMail failed HTTP status:', res.status);
        }
    } catch (err: any) {
        console.error('Brevo sendMail network/timeout status:', err?.status || 'REQUEST_FAILED');
    } finally {
        clearTimeout(timeoutId);
    }
}
