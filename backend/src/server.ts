import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import sessionRoutes from './routes/session';
import attendanceRoutes from './routes/attendance';
import subjectRoutes from './routes/subject';
import classroomRoutes from './routes/classroom';
import { markExpired } from './controllers/session';
import { initFaceService } from './services/face';

dotenv.config();

// Load models from the package once at startup
initFaceService().catch((err: any) => console.error('Error initializing face models at startup:', err));

const app = express();
const PORT = process.env.PORT || 5000;
const defaultOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://localhost:5173',
    'https://localhost:5174'
];
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
const allowedOrigins = new Set([...defaultOrigins, ...envOrigins]);

const isLocalOrPrivateIp = (hostname: string): boolean => {
    return (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
    );
};

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const normalized = origin.trim().replace(/\/+$/, '');
        if (allowedOrigins.has(normalized) || /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/.test(normalized)) {
            return callback(null, true);
        }
        try {
            const url = new URL(normalized);
            if (isLocalOrPrivateIp(url.hostname)) {
                return callback(null, true);
            }
        } catch {}
        return callback(new Error('Not allowed by CORS'));
    }
}));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/classrooms', classroomRoutes);

app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// Periodic sweep every 30s to mark expired sessions
setInterval(async () => {
    try {
        await markExpired();
    } catch (error: any) {
        if (error?.code === 'ECONNREFUSED' || error?.message?.includes('ECONNREFUSED')) {
            // Database is offline or unreachable; silently wait for reconnect
            return;
        }
        console.error('Error in markExpired sweep:', error?.message || error);
    }
}, 30000);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
