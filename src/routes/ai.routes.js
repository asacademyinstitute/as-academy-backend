import { Router } from 'express';
import aiService from '../services/ai.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isStudent } from '../middlewares/rbac.middleware.js';

const router = Router();

// Solve doubt (student)
router.post('/solve-doubt', authenticate, isStudent, asyncHandler(async (req, res) => {
    const { question, context } = req.body;

    if (!question) {
        return res.status(400).json({
            success: false,
            message: 'Question is required'
        });
    }

    const result = await aiService.solveDoubt(question, context);

    res.json({
        success: true,
        data: result
    });
}));

// Summarize content (student)
router.post('/summarize', authenticate, isStudent, asyncHandler(async (req, res) => {
    const { content } = req.body;

    if (!content) {
        return res.status(400).json({
            success: false,
            message: 'Content is required'
        });
    }

    const result = await aiService.summarizeContent(content);

    res.json({
        success: true,
        data: result
    });
}));

// Get study tips (student)
router.post('/study-tips', authenticate, isStudent, asyncHandler(async (req, res) => {
    const { topic } = req.body;

    if (!topic) {
        return res.status(400).json({
            success: false,
            message: 'Topic is required'
        });
    }

    const result = await aiService.getStudyTips(topic);

    res.json({
        success: true,
        data: result
    });
}));

export default router;
