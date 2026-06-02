import { Router } from 'express';
import streamingService from '../services/streaming.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();

// Get video stream URL (student)
router.get('/video/:lectureId', authenticate, asyncHandler(async (req, res) => {
    const result = await streamingService.generateVideoStreamUrl(
        req.params.lectureId,
        req.user.userId
    );

    res.json({
        success: true,
        data: result
    });
}));

// Get PDF stream URL (student)
router.get('/pdf/:lectureId', authenticate, asyncHandler(async (req, res) => {
    const result = await streamingService.generatePDFStreamUrl(
        req.params.lectureId,
        req.user.userId
    );

    res.json({
        success: true,
        data: result
    });
}));

export default router;
