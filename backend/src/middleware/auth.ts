import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

export interface AuthUser {
    id: string;
    email: string;
    role: 'FACULTY' | 'STUDENT';
    student_id?: string;
}

export interface AuthRequest extends Request {
    user?: AuthUser;
}

export const verifyToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ message: 'No token provided' });
            return;
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

export const requireRole = (allowedRole: 'FACULTY' | 'STUDENT') => {
    return (req: AuthRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        if (req.user.role !== allowedRole) {
            res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
            return;
        }
        
        next();
    };
};
