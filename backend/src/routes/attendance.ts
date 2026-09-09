import { Router } from 'express';
import { submitAttendance } from '../controllers/attendance';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();

router.post('/submit', verifyToken, requireRole('STUDENT'), submitAttendance);

export default router;
