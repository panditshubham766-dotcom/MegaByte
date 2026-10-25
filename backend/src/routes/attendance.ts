import express, { Router } from 'express';
import {
    requestChallenge,
    submitAttendance,
    getPendingSubmissions,
    reviewSubmission,
    editAttendance,
    getMyAttendance,
    getVerificationSession,
    revalidatePresence,
    revokeVerificationSession,
    getActiveVerificationSession
} from '../controllers/attendance';
import { verifyToken, requireRole } from '../middleware/auth';
import { requireClassroomVerification } from '../middleware/verification';

const router = Router();
const json8mb = express.json({ limit: '8mb' });

// Student check-in pipeline
router.post('/challenge', verifyToken, requireRole('STUDENT'), requestChallenge);
router.post('/submit', json8mb, verifyToken, requireRole('STUDENT'), submitAttendance);

// Verification sessions & presence monitoring
router.get('/verification/active', verifyToken, requireRole('STUDENT'), getActiveVerificationSession);
router.get('/verification/:idOrToken', verifyToken, getVerificationSession);
router.post('/revalidate', verifyToken, requireRole('STUDENT'), revalidatePresence);
router.post('/verification/:idOrToken/revoke', verifyToken, requireRole('FACULTY'), revokeVerificationSession);

// Faculty attendance management
router.get('/session/:sessionId/pending', verifyToken, requireRole('FACULTY'), getPendingSubmissions);
router.post('/review', verifyToken, requireRole('FACULTY'), reviewSubmission);
router.post('/edit', verifyToken, requireRole('FACULTY'), editAttendance);

// Student personal records
router.get('/me', verifyToken, requireRole('STUDENT'), getMyAttendance);

export default router;
