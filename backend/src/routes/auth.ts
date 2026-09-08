import { Router } from 'express';
import { login, me } from '../controllers/auth';
import { verifyToken } from '../middleware/auth';

const router = Router();

router.post('/login', login);
router.get('/me', verifyToken, me);

export default router;
