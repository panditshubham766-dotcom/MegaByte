import { Router } from 'express';
import {
    listClassrooms,
    listAllClassrooms,
    createClassroom,
    updateClassroom,
    deactivateClassroom,
    listAccessPoints,
    createAccessPoint,
    updateAccessPoint,
    deleteAccessPoint
} from '../controllers/classroom';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();

// Classroom configuration endpoints
router.get('/', verifyToken, requireRole('FACULTY'), listClassrooms);
router.get('/all', verifyToken, requireRole('FACULTY'), listAllClassrooms);
router.post('/', verifyToken, requireRole('FACULTY'), createClassroom);
router.patch('/:id', verifyToken, requireRole('FACULTY'), updateClassroom);
router.delete('/:id', verifyToken, requireRole('FACULTY'), deactivateClassroom);

// Classroom Wi-Fi Access Points management
router.get('/:classroomId/access-points', verifyToken, requireRole('FACULTY'), listAccessPoints);
router.post('/:classroomId/access-points', verifyToken, requireRole('FACULTY'), createAccessPoint);
router.patch('/access-points/:id', verifyToken, requireRole('FACULTY'), updateAccessPoint);
router.delete('/access-points/:id', verifyToken, requireRole('FACULTY'), deleteAccessPoint);

export default router;
