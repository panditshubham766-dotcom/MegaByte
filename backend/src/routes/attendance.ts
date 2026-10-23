import express, { Router } from 'express';
import { requestChallenge, submitAttendance, getPendingSubmissions, reviewSubmission } from '../controllers/attendance';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();
const json8mb = express.json({ limit: '8mb' });

router.post('/challenge', verifyToken, requireRole('STUDENT'), requestChallenge);
router.post('/submit', json8mb, verifyToken, requireRole('STUDENT'), submitAttendance);
router.get('/session/:sessionId/pending', verifyToken, requireRole('FACULTY'), getPendingSubmissions);
router.post('/review', verifyToken, requireRole('FACULTY'), reviewSubmission);

export default router;
