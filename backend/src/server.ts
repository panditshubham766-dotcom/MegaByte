import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import sessionRoutes from './routes/session';
import attendanceRoutes from './routes/attendance';
import subjectRoutes from './routes/subject';
import { markExpired } from './controllers/session';
import { initFaceService } from './services/face';

dotenv.config();

// Load models from the package once at startup
initFaceService().catch((err: any) => console.error('Error initializing face models at startup:', err));

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/subjects', subjectRoutes);

app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// Periodic sweep every 5s to mark expired sessions
setInterval(async () => {
    try {
        await markExpired();
    } catch (error) {
        console.error('Error in markExpired sweep:', error);
    }
}, 5000);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
