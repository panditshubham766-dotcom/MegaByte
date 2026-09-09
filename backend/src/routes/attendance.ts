import { Router } from 'express';
import { submitAttendance, getPendingSubmissions, reviewSubmission } from '../controllers/attendance';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();

router.post('/submit', verifyToken, requireRole('STUDENT'), submitAttendance);
router.get('/session/:sessionId/pending', verifyToken, requireRole('FACULTY'), getPendingSubmissions);
router.post('/review', verifyToken, requireRole('FACULTY'), reviewSubmission);

export default router;
