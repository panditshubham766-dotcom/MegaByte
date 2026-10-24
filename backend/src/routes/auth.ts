import express, { Router } from 'express';
import {
    login,
    me,
    requestOtp,
    signupStudent,
    signupFaculty,
    resetPassword
} from '../controllers/auth';
import { verifyToken } from '../middleware/auth';

const router = Router();

router.post('/otp/request', requestOtp);
router.post('/signup/student', express.json({ limit: '4mb' }), signupStudent);
router.post('/signup/faculty', signupFaculty);
router.post('/password/reset', resetPassword);
router.post('/login', login);
router.get('/me', verifyToken, me);

export default router;
