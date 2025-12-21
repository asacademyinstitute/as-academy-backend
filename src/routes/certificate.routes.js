import { Router } from 'express';
import certificateService from '../services/certificate.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isStudent } from '../middlewares/rbac.middleware.js';

const router = Router();

// Generate certificate (student)
router.post('/generate', authenticate, isStudent, asyncHandler(async (req, res) => {
    const { courseId } = req.body;

    const certificate = await certificateService.generateCertificate(req.user.id, courseId);

    res.json({
        success: true,
        message: 'Certificate generated successfully',
        data: certificate
    });
}));

// Get student certificates
router.get('/student/:studentId', authenticate, asyncHandler(async (req, res) => {
    const certificates = await certificateService.getStudentCertificates(req.params.studentId);

    res.json({
        success: true,
        data: certificates
    });
}));

// Get certificate download URL
router.get('/:id/download', authenticate, isStudent, asyncHandler(async (req, res) => {
    const result = await certificateService.getCertificateUrl(req.params.id, req.user.id);

    res.json({
        success: true,
        data: result
    });
}));

// Verify certificate (public)
router.get('/verify/:certificateNumber', asyncHandler(async (req, res) => {
    const result = await certificateService.verifyCertificate(req.params.certificateNumber);

    res.json({
        success: true,
        data: result
    });
}));

export default router;
