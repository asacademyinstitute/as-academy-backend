import { Router } from 'express';
import multer from 'multer';
import streamingService from '../services/streaming.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isTeacherOrAdmin, isStudent } from '../middlewares/rbac.middleware.js';

const router = Router();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB max file size
    }
});

// Upload file (teacher or admin)
router.post('/upload', authenticate, isTeacherOrAdmin, upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: 'No file uploaded'
        });
    }

    const { folder = 'lectures' } = req.body;

    const result = await streamingService.uploadFile(req.file, folder);

    res.json({
        success: true,
        message: 'File uploaded successfully',
        data: result
    });
}));

// Get video URL (student)
router.get('/video/:lectureId', authenticate, isStudent, asyncHandler(async (req, res) => {
    const result = await streamingService.getVideoUrl(req.params.lectureId, req.user.id);

    res.json({
        success: true,
        data: result
    });
}));

// Get PDF URL (student) - keeping for backward compatibility
router.get('/pdf/:lectureId', authenticate, isStudent, asyncHandler(async (req, res) => {
    const result = await streamingService.getPdfUrl(req.params.lectureId, req.user.id);

    res.json({
        success: true,
        data: result
    });
}));

// Stream PDF directly (student) - fixes CORS
router.get('/stream/pdf/:lectureId', authenticate, isStudent, asyncHandler(async (req, res) => {
    const { params, s3 } = await streamingService.streamPdf(req.params.lectureId, req.user.id);

    // Set headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');

    // Pipe from S3 to response
    s3.getObject(params).createReadStream()
        .on('error', (err) => {
            console.error('Stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: 'Error streaming file' });
            }
        })
        .pipe(res);
}));

// Get watermark data (student)
router.get('/watermark', authenticate, isStudent, asyncHandler(async (req, res) => {
    const watermarkData = streamingService.getWatermarkData(req.user);

    res.json({
        success: true,
        data: watermarkData
    });
}));

// Delete file (admin only)
router.delete('/file', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const { fileKey } = req.body;

    const result = await streamingService.deleteFile(fileKey);

    res.json({
        success: true,
        message: result.message
    });
}));

export default router;
