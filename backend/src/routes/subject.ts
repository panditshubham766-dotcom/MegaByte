import { Router } from 'express';
import multer from 'multer';
import {
    getPublicSubjects,
    enrollSubject,
    getFacultySubjects,
    createFacultySubject,
    renameFacultySubject,
    deleteFacultySubject,
    getSubjectHistory,
    uploadSubjectSheetController,
    downloadSubjectSheetController,
    viewSubjectSheetController
} from '../controllers/subject';
import { verifyToken, requireRole } from '../middleware/auth';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const router = Router();

router.get('/public', getPublicSubjects);
router.post('/enroll', verifyToken, requireRole('STUDENT'), enrollSubject);
router.get('/', verifyToken, requireRole('FACULTY'), getFacultySubjects);
router.post('/', verifyToken, requireRole('FACULTY'), createFacultySubject);
router.patch('/:id', verifyToken, requireRole('FACULTY'), renameFacultySubject);
router.delete('/:id', verifyToken, requireRole('FACULTY'), deleteFacultySubject);
router.get('/:id/history', verifyToken, requireRole('FACULTY'), getSubjectHistory);

router.post('/:id/sheet', verifyToken, requireRole('FACULTY'), upload.single('file'), uploadSubjectSheetController);
router.get('/:id/sheet/download', verifyToken, requireRole('FACULTY'), downloadSubjectSheetController);
router.get('/:id/sheet/view', verifyToken, viewSubjectSheetController);

export default router;
