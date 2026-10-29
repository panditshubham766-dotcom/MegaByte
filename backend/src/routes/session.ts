import { Router } from 'express';
import { createSession, endSession, getSessionById, getActiveSession, exportSession, getSessionAttendance, deleteSession, getSessionLiveCode } from '../controllers/session';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();

router.post('/create', verifyToken, requireRole('FACULTY'), createSession);
router.post('/', verifyToken, requireRole('FACULTY'), createSession);
router.get('/active', verifyToken, requireRole('FACULTY'), getActiveSession);
router.get('/:id/live-code', verifyToken, requireRole('FACULTY'), getSessionLiveCode);
router.get('/:id/attendance', verifyToken, requireRole('FACULTY'), getSessionAttendance);
router.get('/:id/export', verifyToken, requireRole('FACULTY'), exportSession);
router.get('/:id', verifyToken, requireRole('FACULTY'), getSessionById);
router.post('/:id/end', verifyToken, requireRole('FACULTY'), endSession);
router.delete('/:id', verifyToken, requireRole('FACULTY'), deleteSession);

export default router;
