import { Router } from 'express';
import lectureService from '../services/lecture.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isTeacherOrAdmin, isStudent } from '../middlewares/rbac.middleware.js';
import { createLectureValidation } from '../middlewares/validation.middleware.js';

const router = Router();

// Get lectures by chapter
router.get('/chapter/:chapterId', authenticate, asyncHandler(async (req, res) => {
    const lectures = await lectureService.getLecturesByChapter(req.params.chapterId);

    res.json({
        success: true,
        data: lectures
    });
}));

// Get lecture by ID
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const lecture = await lectureService.getLectureById(req.params.id);

    res.json({
        success: true,
        data: lecture
    });
}));

// Create lecture (teacher or admin)
router.post('/', authenticate, isTeacherOrAdmin, createLectureValidation, asyncHandler(async (req, res) => {
    const lecture = await lectureService.createLecture(req.body);

    res.status(201).json({
        success: true,
        message: 'Lecture created successfully',
        data: lecture
    });
}));

// Update lecture (teacher or admin)
router.put('/:id', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const lecture = await lectureService.updateLecture(req.params.id, req.body);

    res.json({
        success: true,
        message: 'Lecture updated successfully',
        data: lecture
    });
}));

// Delete lecture (teacher or admin)
router.delete('/:id', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const result = await lectureService.deleteLecture(req.params.id);

    res.json({
        success: true,
        message: result.message
    });
}));

// Reorder lectures (teacher or admin)
router.post('/chapter/:chapterId/reorder', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const { lectureOrders } = req.body;

    const result = await lectureService.reorderLectures(req.params.chapterId, lectureOrders);

    res.json({
        success: true,
        message: result.message
    });
}));

// Get lecture progress (student)
router.get('/:id/progress', authenticate, isStudent, asyncHandler(async (req, res) => {
    const progress = await lectureService.getLectureProgress(req.user.id, req.params.id);

    res.json({
        success: true,
        data: progress
    });
}));

// Update lecture progress (student)
router.post('/:id/progress', authenticate, isStudent, asyncHandler(async (req, res) => {
    const progress = await lectureService.updateLectureProgress(req.user.id, req.params.id, req.body);

    res.json({
        success: true,
        message: 'Progress updated successfully',
        data: progress
    });
}));

export default router;
