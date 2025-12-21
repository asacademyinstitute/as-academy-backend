import { Router } from 'express';
import courseService from '../services/course.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate, optionalAuth } from '../middlewares/auth.middleware.js';
import { isAdmin, isTeacherOrAdmin } from '../middlewares/rbac.middleware.js';
import { createCourseValidation, paginationValidation } from '../middlewares/validation.middleware.js';

const router = Router();

// Get all courses (public with optional auth)
router.get('/', optionalAuth, paginationValidation, asyncHandler(async (req, res) => {
    const { status, teacherId, search, page = 1, limit = 20 } = req.query;

    const result = await courseService.getCourses(
        { status, teacherId, search },
        parseInt(page),
        parseInt(limit)
    );

    res.json({
        success: true,
        data: result
    });
}));

// Get course by ID (public with optional auth)
router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
    const course = await courseService.getCourseById(req.params.id, req.user?.id);

    res.json({
        success: true,
        data: course
    });
}));

// Create course (admin only)
router.post('/', authenticate, isAdmin, createCourseValidation, asyncHandler(async (req, res) => {
    const course = await courseService.createCourse(req.body, req.user.id);

    res.status(201).json({
        success: true,
        message: 'Course created successfully',
        data: course
    });
}));

// Update course (admin or assigned teacher)
router.put('/:id', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const course = await courseService.updateCourse(req.params.id, req.body, req.user.id);

    res.json({
        success: true,
        message: 'Course updated successfully',
        data: course
    });
}));

// Delete course (admin only)
router.delete('/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const result = await courseService.deleteCourse(req.params.id, req.user.id);

    res.json({
        success: true,
        message: result.message
    });
}));

// Get course statistics
router.get('/:id/stats', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const stats = await courseService.getCourseStats(req.params.id);

    res.json({
        success: true,
        data: stats
    });
}));

// Get courses by teacher
router.get('/teacher/:teacherId', authenticate, asyncHandler(async (req, res) => {
    const courses = await courseService.getCoursesByTeacher(req.params.teacherId);

    res.json({
        success: true,
        data: courses
    });
}));

export default router;
