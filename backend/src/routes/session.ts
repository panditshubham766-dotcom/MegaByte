import { Router } from 'express';
import { createSession } from '../controllers/session';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();

router.post('/create', verifyToken, requireRole('FACULTY'), createSession);

export default router;
