import { Router } from 'express';
import multer from 'multer';
import streamingService from '../services/streaming.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isTeacherOrAdmin } from '../middlewares/rbac.middleware.js';

const router = Router();

// Configure multer memory storage for direct B2 uploads (500MB limit)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 500 * 1024 * 1024
    }
});

// Get video stream URL (student)
router.get('/video/:lectureId', authenticate, asyncHandler(async (req, res) => {
    const result = await streamingService.generateVideoStreamUrl(
        req.params.lectureId,
        req.user.id,
        req.user.role
    );

    res.json({
        success: true,
        data: result
    });
}));

// Stream Video directly with Range support (authenticated streaming proxy)
router.get('/stream/video/:lectureId', authenticate, asyncHandler(async (req, res) => {
    await streamingService.streamVideo(
        req.params.lectureId,
        req.user.id,
        req.user.role,
        req,
        res
    );
}));

// Get PDF stream URL (student)
router.get('/pdf/:lectureId', authenticate, asyncHandler(async (req, res) => {
    const result = await streamingService.generatePDFStreamUrl(
        req.params.lectureId,
        req.user.id,
        req.user.role
    );

    res.json({
        success: true,
        data: result
    });
}));

// Stream PDF directly (student/teacher/admin - requires valid auth and active course enrollment)
router.get('/stream/pdf/:lectureId', authenticate, asyncHandler(async (req, res) => {
    await streamingService.streamPDF(
        req.params.lectureId,
        req.user.id,
        req.user.role,
        res
    );
}));

// Upload lecture file (teacher or admin only)
router.post('/upload', authenticate, isTeacherOrAdmin, upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: 'No file uploaded'
        });
    }

    const folder = req.body.folder || 'lectures';
    const result = await streamingService.uploadFile(req.file, folder);

    res.json({
        success: true,
        data: result
    });
}));

// Get watermark data (student)
router.get('/watermark', authenticate, asyncHandler(async (req, res) => {
    res.json({
        success: true,
        data: {
            name: req.user.name,
            email: req.user.email,
            phone: req.user.phone
        }
    });
}));

// Get admin/teacher download URL for a lecture file (teacher or admin only)
router.get('/download/:lectureId', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const result = await streamingService.generateDownloadUrl(req.params.lectureId);
    res.json({
        success: true,
        data: result
    });
}));

export default router;
