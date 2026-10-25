import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { normalizeEmail, checkCollegeEmail, sendMail } from '../utils/email';
import { checkFrontalFrame, compareSimilarity, getLivenessMinScore, FaceError } from '../services/face';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Password blocklist
const PASSWORD_BLOCKLIST = new Set([
    'password',
    'password123',
    '12345678',
    'qwertyuiop',
    'admin123',
    'student123',
    'faculty123',
    'changeme',
    'iloveyou',
    'welcome123'
]);

export function validatePassword(password: string, email: string): { valid: boolean; message?: string } {
    if (!password || typeof password !== 'string') {
        return { valid: false, message: 'Password is required' };
    }
    if (password.length < 8) {
        return { valid: false, message: 'Password must be at least 8 characters long' };
    }
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    if (!hasLetter || !hasNumber) {
        return { valid: false, message: 'Password must contain at least one letter and one number' };
    }
    if (password.toLowerCase() === email.toLowerCase()) {
        return { valid: false, message: 'Password cannot be equal to your email address' };
    }
    if (PASSWORD_BLOCKLIST.has(password.toLowerCase())) {
        return { valid: false, message: 'Password is too common and not allowed' };
    }
    return { valid: true };
}

// In-memory rate limiting buckets
const ipBuckets = new Map<string, number[]>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const timestamps = (ipBuckets.get(key) || []).filter(ts => now - ts < windowMs);
    if (timestamps.length >= maxRequests) {
        ipBuckets.set(key, timestamps);
        return false;
    }
    timestamps.push(now);
    ipBuckets.set(key, timestamps);
    return true;
}

function getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
}

export const requestOtp = async (req: Request, res: Response): Promise<void> => {
    const standardResponse = { message: 'If this email can be used, a code has been sent.' };
    const { email, purpose, role } = req.body;

    if (!email || !purpose || (purpose !== 'signup' && purpose !== 'reset')) {
        res.status(200).json(standardResponse);
        return;
    }

    let normalizedEmail: string;
    try {
        normalizedEmail = normalizeEmail(email);
    } catch {
        res.status(200).json(standardResponse);
        return;
    }

    // IP Limiter: 10 per hour
    const clientIp = getClientIp(req);
    if (!checkRateLimit(`otp:${clientIp}`, 10, 60 * 60 * 1000)) {
        res.status(200).json(standardResponse);
        return;
    }

    try {
        const userRes = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
        const userExists = userRes.rows.length > 0;

        if (purpose === 'signup') {
            if (!role || (role !== 'student' && role !== 'faculty')) {
                res.status(200).json(standardResponse);
                return;
            }
            const check = checkCollegeEmail(normalizedEmail, role);
            if (!check.valid || userExists) {
                res.status(200).json(standardResponse);
                return;
            }
        } else if (purpose === 'reset') {
            if (!userExists) {
                res.status(200).json(standardResponse);
                return;
            }
        }

        // Email + purpose rate limits: 60s cooldown and max 5 per hour
        const recentOtps = await pool.query(
            `SELECT created_at FROM auth_otps
             WHERE email = $1 AND purpose = $2 AND created_at > NOW() - INTERVAL '1 hour'
             ORDER BY created_at DESC`,
            [normalizedEmail, purpose]
        );

        if (recentOtps.rows.length >= 5) {
            res.status(200).json(standardResponse);
            return;
        }

        if (recentOtps.rows.length > 0) {
            const lastTime = new Date(recentOtps.rows[0].created_at).getTime();
            if (Date.now() - lastTime < 60 * 1000) {
                res.status(200).json(standardResponse);
                return;
            }
        }

        // Generate 6-digit code
        const code = crypto.randomInt(100000, 1000000).toString();
        const codeHash = crypto.createHmac('sha256', JWT_SECRET).update(`${code}${normalizedEmail}${purpose}`).digest('hex');

        // Mark older unused codes as used
        await pool.query(
            'UPDATE auth_otps SET used_at = NOW() WHERE email = $1 AND purpose = $2 AND used_at IS NULL',
            [normalizedEmail, purpose]
        );

        // Store new OTP
        await pool.query(
            `INSERT INTO auth_otps (email, purpose, code_hash, expires_at)
             VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
            [normalizedEmail, purpose, codeHash]
        );

        // Send mail
        await sendMail(
            normalizedEmail,
            'Your MegaByte Verification Code',
            `Your MegaByte code is ${code}. It expires in 10 minutes. If you didn't request it, ignore this email.`
        );

        res.status(200).json(standardResponse);
    } catch (error) {
        console.error('Error in requestOtp:', error);
        res.status(200).json(standardResponse);
    }
};

export async function verifyOtp(email: string, purpose: 'signup' | 'reset', code: string): Promise<string> {
    if (!code || typeof code !== 'string') {
        throw new Error('Invalid or expired code');
    }
    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
        throw new Error('Invalid or expired code');
    }

    const normalizedEmail = normalizeEmail(email);

    const otpRes = await pool.query(
        `SELECT id, code_hash, attempts FROM auth_otps
         WHERE email = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [normalizedEmail, purpose]
    );

    if (otpRes.rows.length === 0) {
        throw new Error('Invalid or expired code');
    }

    const otpRow = otpRes.rows[0];
    if (otpRow.attempts >= 5) {
        throw new Error('Invalid or expired code');
    }

    const expectedHash = crypto.createHmac('sha256', JWT_SECRET).update(`${cleanCode}${normalizedEmail}${purpose}`).digest('hex');
    const expectedBuf = Buffer.from(expectedHash, 'utf8');
    const actualBuf = Buffer.from(otpRow.code_hash, 'utf8');

    const isMatch = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

    if (!isMatch) {
        await pool.query('UPDATE auth_otps SET attempts = attempts + 1 WHERE id = $1', [otpRow.id]);
        throw new Error('Invalid or expired code');
    }

    return otpRow.id;
}

export const signupStudent = async (req: Request, res: Response): Promise<void> => {
    const clientIp = getClientIp(req);
    if (!checkRateLimit(`signup:${clientIp}`, 10, 60 * 60 * 1000)) {
        res.status(429).json({ message: 'Too many signup attempts. Please try again later.' });
        return;
    }

    const { name, email, password, subjectCode, code, photos } = req.body;

    if (!email || !name || !password || !subjectCode || !code) {
        res.status(400).json({ message: 'All fields are required' });
        return;
    }

    let normalizedEmail: string;
    try {
        normalizedEmail = normalizeEmail(email);
    } catch {
        res.status(400).json({ message: 'Use your college email (<roll number>@iiitdwd.ac.in)' });
        return;
    }

    const collegeCheck = checkCollegeEmail(normalizedEmail, 'student');
    if (!collegeCheck.valid) {
        res.status(400).json({ message: collegeCheck.error });
        return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) {
        res.status(400).json({ message: 'Name must be between 2 and 80 characters' });
        return;
    }

    const pwCheck = validatePassword(password, normalizedEmail);
    if (!pwCheck.valid) {
        res.status(400).json({ message: pwCheck.message });
        return;
    }

    const localPart = normalizedEmail.substring(0, normalizedEmail.lastIndexOf('@'));
    const student_id = localPart.toUpperCase();

    // Verify OTP outside transaction
    let otpRowId: string;
    try {
        otpRowId = await verifyOtp(normalizedEmail, 'signup', code);
    } catch {
        res.status(400).json({ message: 'Invalid or expired code' });
        return;
    }

    try {
        // Verify subject code exists
        const subjectRes = await pool.query(
            'SELECT id FROM subjects WHERE UPPER(code) = UPPER($1) LIMIT 1',
            [subjectCode.trim()]
        );
        if (subjectRes.rows.length === 0) {
            res.status(400).json({ message: 'Subject code does not exist' });
            return;
        }
        const subjectId = subjectRes.rows[0].id;

        // Check duplicate email or student_id
        const dupRes = await pool.query(
            'SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR student_id = $2',
            [normalizedEmail, student_id]
        );
        if (dupRes.rows.length > 0) {
            res.status(409).json({ message: 'Email or roll number already registered' });
            return;
        }

        // Validate photos
        if (!Array.isArray(photos) || photos.length < 3 || photos.length > 5) {
            res.status(400).json({ message: 'Please provide between 3 and 5 photos' });
            return;
        }

        const photoEmbeddings: number[][] = [];
        const minLiveness = getLivenessMinScore();

        for (let i = 0; i < photos.length; i++) {
            const rawPhoto = photos[i];
            if (!rawPhoto || typeof rawPhoto !== 'string') {
                res.status(422).json({ message: `Photo ${i + 1}: Invalid photo data` });
                return;
            }

            const b64Data = rawPhoto.replace(/^data:image\/\w+;base64,/, '');
            const buf = Buffer.from(b64Data, 'base64');

            if (buf.length > 400 * 1024) {
                res.status(422).json({ message: `Photo ${i + 1}: Image exceeds 400KB` });
                return;
            }

            // JPEG magic bytes: 0xFF, 0xD8, 0xFF
            if (buf.length < 3 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) {
                res.status(422).json({ message: `Photo ${i + 1}: Must be a JPEG image` });
                return;
            }

            let result;
            try {
                result = await checkFrontalFrame(buf);
            } catch (err: any) {
                if (err instanceof FaceError) {
                    if (err.code === 'NO_FACE') {
                        res.status(422).json({ message: `Photo ${i + 1}: No face detected` });
                        return;
                    }
                    if (err.code === 'MULTIPLE_FACES') {
                        res.status(422).json({ message: `Photo ${i + 1}: Multiple faces detected` });
                        return;
                    }
                }
                res.status(422).json({ message: `Photo ${i + 1}: Face detection failed` });
                return;
            }

            if (result.real < minLiveness) {
                res.status(422).json({ message: `Photo ${i + 1}: Liveness check failed` });
                return;
            }

            if (i > 0) {
                const sim = compareSimilarity(photoEmbeddings[0], result.embedding);
                if (sim < 0.5) {
                    res.status(422).json({ message: `Photo ${i + 1}: Face does not match first photo` });
                    return;
                }
            }

            photoEmbeddings.push(result.embedding);
        }

        // Atomic transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const consumeRes = await client.query(
                'UPDATE auth_otps SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id',
                [otpRowId]
            );
            if (consumeRes.rows.length === 0) {
                await client.query('ROLLBACK');
                res.status(400).json({ message: 'Invalid or expired code' });
                return;
            }

            const passwordHash = await bcrypt.hash(password, 10);
            const userInsert = await client.query(
                `INSERT INTO users (name, email, password_hash, role, student_id, face_embedding, face_enrolled_at)
                 VALUES ($1, $2, $3, 'STUDENT', $4, $5, NOW())
                 RETURNING id, name, email, role, student_id`,
                [trimmedName, normalizedEmail, passwordHash, student_id, JSON.stringify(photoEmbeddings)]
            );
            const newStudentId = userInsert.rows[0].id;

            // Ensure a class row exists
            let classRes = await client.query('SELECT id FROM classes LIMIT 1');
            let classId = classRes.rows[0]?.id;
            if (!classId) {
                const newClass = await client.query(
                    'INSERT INTO classes (name, department, semester, section) VALUES ($1, $2, $3, $4) RETURNING id',
                    ['Computer Science 1st Year', 'Computer Science', 1, 'A']
                );
                classId = newClass.rows[0].id;
            }

            await client.query(
                `INSERT INTO enrollments (student_id, subject_id, class_id, created_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (student_id, subject_id) DO NOTHING`,
                [newStudentId, subjectId, classId]
            );

            await client.query('COMMIT');
            res.status(201).json({ message: 'Signup successful', user: userInsert.rows[0] });
        } catch (txErr: any) {
            await client.query('ROLLBACK');
            if (txErr?.code === '23505') {
                res.status(409).json({ message: 'Email or roll number already registered' });
                return;
            }
            throw txErr;
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error('Student signup error:', err);
        if (err?.code === '23505') {
            res.status(409).json({ message: 'Email or roll number already registered' });
            return;
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const signupFaculty = async (req: Request, res: Response): Promise<void> => {
    const clientIp = getClientIp(req);
    if (!checkRateLimit(`signup:${clientIp}`, 10, 60 * 60 * 1000)) {
        res.status(429).json({ message: 'Too many signup attempts. Please try again later.' });
        return;
    }

    const { name, email, password, inviteCode, subjectCode, subjectName, code } = req.body;

    if (!email || !name || !password || !inviteCode || !subjectCode || !subjectName || !code) {
        res.status(400).json({ message: 'All fields are required' });
        return;
    }

    let normalizedEmail: string;
    try {
        normalizedEmail = normalizeEmail(email);
    } catch {
        res.status(400).json({ message: 'Use your faculty college email (<name>@iiitdwd.ac.in)' });
        return;
    }

    const collegeCheck = checkCollegeEmail(normalizedEmail, 'faculty');
    if (!collegeCheck.valid) {
        res.status(400).json({ message: collegeCheck.error });
        return;
    }

    // Verify invite code vs FACULTY_SIGNUP_CODE via timingSafeEqual
    const facultySignupCode = process.env.FACULTY_SIGNUP_CODE;
    if (!facultySignupCode) {
        res.status(503).json({ message: 'Faculty registration is currently unavailable' });
        return;
    }

    const inviteBuf = Buffer.from(String(inviteCode), 'utf8');
    const envBuf = Buffer.from(facultySignupCode, 'utf8');
    const isInviteMatch = inviteBuf.length === envBuf.length && crypto.timingSafeEqual(inviteBuf, envBuf);
    if (!isInviteMatch) {
        res.status(400).json({ message: 'Invalid invite code' });
        return;
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) {
        res.status(400).json({ message: 'Name must be between 2 and 80 characters' });
        return;
    }

    const pwCheck = validatePassword(password, normalizedEmail);
    if (!pwCheck.valid) {
        res.status(400).json({ message: pwCheck.message });
        return;
    }

    // Verify OTP outside transaction
    let otpRowId: string;
    try {
        otpRowId = await verifyOtp(normalizedEmail, 'signup', code);
    } catch {
        res.status(400).json({ message: 'Invalid or expired code' });
        return;
    }

    try {
        // Check duplicate email
        const dupUser = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
        if (dupUser.rows.length > 0) {
            res.status(409).json({ message: 'Email already registered' });
            return;
        }

        // Check subject code unique
        const cleanSubjectCode = subjectCode.trim().toUpperCase();
        const dupSubject = await pool.query('SELECT id FROM subjects WHERE UPPER(code) = UPPER($1)', [cleanSubjectCode]);
        if (dupSubject.rows.length > 0) {
            res.status(409).json({ message: 'Subject code already in use' });
            return;
        }

        // Transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const consumeRes = await client.query(
                'UPDATE auth_otps SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id',
                [otpRowId]
            );
            if (consumeRes.rows.length === 0) {
                await client.query('ROLLBACK');
                res.status(400).json({ message: 'Invalid or expired code' });
                return;
            }

            const passwordHash = await bcrypt.hash(password, 10);
            const userInsert = await client.query(
                `INSERT INTO users (name, email, password_hash, role)
                 VALUES ($1, $2, $3, 'FACULTY')
                 RETURNING id, name, email, role`,
                [trimmedName, normalizedEmail, passwordHash]
            );
            const facultyId = userInsert.rows[0].id;

            await client.query(
                `INSERT INTO subjects (name, code, faculty_id)
                 VALUES ($1, $2, $3)`,
                [subjectName.trim(), cleanSubjectCode, facultyId]
            );

            await client.query('COMMIT');
            res.status(201).json({ message: 'Faculty registered successfully', user: userInsert.rows[0] });
        } catch (txErr: any) {
            await client.query('ROLLBACK');
            if (txErr?.code === '23505') {
                res.status(409).json({ message: 'Email or subject code already registered' });
                return;
            }
            throw txErr;
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error('Faculty signup error:', err);
        if (err?.code === '23505') {
            res.status(409).json({ message: 'Email or subject code already registered' });
            return;
        }
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
    const clientIp = getClientIp(req);
    if (!checkRateLimit(`reset:${clientIp}`, 10, 60 * 60 * 1000)) {
        res.status(429).json({ message: 'Too many password reset attempts. Please try again later.' });
        return;
    }

    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
        res.status(400).json({ message: 'Invalid or expired code' });
        return;
    }

    let normalizedEmail: string;
    try {
        normalizedEmail = normalizeEmail(email);
    } catch {
        res.status(400).json({ message: 'Invalid or expired code' });
        return;
    }

    try {
        const userRes = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
        if (userRes.rows.length === 0) {
            res.status(400).json({ message: 'Invalid or expired code' });
            return;
        }
        const user = userRes.rows[0];

        const pwCheck = validatePassword(newPassword, normalizedEmail);
        if (!pwCheck.valid) {
            res.status(400).json({ message: pwCheck.message });
            return;
        }

        let otpRowId: string;
        try {
            otpRowId = await verifyOtp(normalizedEmail, 'reset', code);
        } catch {
            res.status(400).json({ message: 'Invalid or expired code' });
            return;
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const consumeRes = await client.query(
                'UPDATE auth_otps SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id',
                [otpRowId]
            );
            if (consumeRes.rows.length === 0) {
                await client.query('ROLLBACK');
                res.status(400).json({ message: 'Invalid or expired code' });
                return;
            }

            const passwordHash = await bcrypt.hash(newPassword, 10);
            await client.query(
                'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
                [passwordHash, user.id]
            );

            await client.query(
                `INSERT INTO audit_logs (user_id, action, old_value, new_value)
                 VALUES ($1, 'PASSWORD_RESET', '{"action": "password_reset"}'::jsonb, '{"status": "success"}'::jsonb)`,
                [user.id]
            );

            await client.query('COMMIT');
            res.status(200).json({ message: 'Password reset successfully' });
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Password reset error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const login = async (req: Request, res: Response): Promise<void> => {
    const clientIp = getClientIp(req);
    // IP Limiter: 20 per 15 minutes
    if (!checkRateLimit(`login:${clientIp}`, 20, 15 * 60 * 1000)) {
        res.status(429).json({ message: 'Too many login attempts. Please try again later.' });
        return;
    }

    const { email, password, portal, device_uuid } = req.body;

    if (!portal || (portal !== 'student' && portal !== 'faculty')) {
        res.status(400).json({ message: "portal is required ('student' or 'faculty')" });
        return;
    }

    if (!email || !password) {
        res.status(400).json({ message: 'Email and password are required' });
        return;
    }

    let normalizedEmail: string;
    try {
        normalizedEmail = normalizeEmail(email);
    } catch {
        res.status(401).json({ message: 'Invalid credentials' });
        return;
    }

    try {
        // Find user
        const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
        const user = result.rows[0];

        if (!user) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        // Verify portal role matches user role
        const expectedRole = portal.toUpperCase();
        if (user.role !== expectedRole) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        // Student Device Binding
        if (user.role === 'STUDENT') {
            if (!device_uuid) {
                res.status(400).json({ message: 'Device UUID is required for students' });
                return;
            }

            const deviceResult = await pool.query(
                'SELECT * FROM student_devices WHERE student_id = $1 AND is_active = true',
                [user.id]
            );

            if (deviceResult.rows.length === 0) {
                await pool.query(
                    'INSERT INTO student_devices (student_id, device_uuid) VALUES ($1, $2) ON CONFLICT (student_id, device_uuid) DO NOTHING',
                    [user.id, device_uuid]
                );
            } else {
                const activeDevice = deviceResult.rows[0];
                if (activeDevice.device_uuid !== device_uuid) {
                    await pool.query(
                        'UPDATE student_devices SET device_uuid = $1 WHERE student_id = $2 AND is_active = true',
                        [device_uuid, user.id]
                    );
                }
            }
        }

        // Generate JWT Token
        const payload = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            student_id: user.student_id,
        };

        const expiresIn = user.role === 'FACULTY' ? '24h' : '2h';
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn });

        res.json({ token, user: payload });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const me = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (!req.user) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        const result = await pool.query(
            'SELECT id, name, email, role, student_id, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ message: 'User not found' });
            return;
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Me error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
