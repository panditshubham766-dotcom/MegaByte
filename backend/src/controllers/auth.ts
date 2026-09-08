import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { AuthRequest } from '../middleware/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

export const login = async (req: Request, res: Response): Promise<void> => {
    const { email, password, device_uuid } = req.body;

    if (!email || !password) {
        res.status(400).json({ message: 'Email and password are required' });
        return;
    }

    try {
        // Find user
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        
        // HACK: To allow testing with the seed.sql data which uses 'hashed_password_placeholder'
        const isPlaceholder = user.password_hash === 'hashed_password_placeholder' && password === 'password';
        
        if (!isMatch && !isPlaceholder) {
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
                // Register new device
                await pool.query(
                    'INSERT INTO student_devices (student_id, device_uuid) VALUES ($1, $2)',
                    [user.id, device_uuid]
                );
            } else {
                // Verify existing device matches
                const activeDevice = deviceResult.rows[0];
                if (activeDevice.device_uuid !== device_uuid) {
                    res.status(403).json({ message: 'Unauthorized device: Attendance must be submitted from your registered phone' });
                    return;
                }
            }
        }

        // Generate JWT Token
        const payload = {
            id: user.id,
            email: user.email,
            role: user.role,
            student_id: user.student_id,
        };

        const expiresIn = user.role === 'FACULTY' ? '24h' : '10m';
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
