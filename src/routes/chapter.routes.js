import { Router } from 'express';
import chapterService from '../services/chapter.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isTeacherOrAdmin } from '../middlewares/rbac.middleware.js';
import { createChapterValidation } from '../middlewares/validation.middleware.js';

const router = Router();

// Get chapters by course
router.get('/course/:courseId', authenticate, asyncHandler(async (req, res) => {
    const chapters = await chapterService.getChaptersByCourse(req.params.courseId);

    res.json({
        success: true,
        data: chapters
    });
}));

// Get chapter by ID
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const chapter = await chapterService.getChapterById(req.params.id);

    res.json({
        success: true,
        data: chapter
    });
}));

// Create chapter (teacher or admin)
router.post('/', authenticate, isTeacherOrAdmin, createChapterValidation, asyncHandler(async (req, res) => {
    const chapter = await chapterService.createChapter(req.body);

    res.status(201).json({
        success: true,
        message: 'Chapter created successfully',
        data: chapter
    });
}));

// Update chapter (teacher or admin)
router.put('/:id', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const chapter = await chapterService.updateChapter(req.params.id, req.body);

    res.json({
        success: true,
        message: 'Chapter updated successfully',
        data: chapter
    });
}));

// Delete chapter (teacher or admin)
router.delete('/:id', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const result = await chapterService.deleteChapter(req.params.id);

    res.json({
        success: true,
        message: result.message
    });
}));

// Reorder chapters (teacher or admin)
router.post('/course/:courseId/reorder', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const { chapterOrders } = req.body;

    const result = await chapterService.reorderChapters(req.params.courseId, chapterOrders);

    res.json({
        success: true,
        message: result.message
    });
}));

export default router;
