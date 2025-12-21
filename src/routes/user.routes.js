import { Router } from 'express';
import userService from '../services/user.service.js';
import authService from '../services/auth.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin, isAdminOrSelf } from '../middlewares/rbac.middleware.js';
import { paginationValidation } from '../middlewares/validation.middleware.js';

const router = Router();

// Get all users (admin only)
router.get('/', authenticate, isAdmin, paginationValidation, asyncHandler(async (req, res) => {
    const { role, status, search, page = 1, limit = 50 } = req.query;

    const result = await userService.getUsers(
        { role, status, search },
        parseInt(page),
        parseInt(limit)
    );

    res.json({
        success: true,
        data: result
    });
}));

// Get user by ID
router.get('/:id', authenticate, isAdminOrSelf, asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.params.id);

    res.json({
        success: true,
        data: user
    });
}));

// Create user (admin only)
router.post('/', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const user = await userService.createUser(req.body, req.user.id);

    res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: user
    });
}));

// Update user
router.put('/:id', authenticate, isAdminOrSelf, asyncHandler(async (req, res) => {
    const user = await userService.updateUser(req.params.id, req.body, req.user.id);

    res.json({
        success: true,
        message: 'User updated successfully',
        data: user
    });
}));

// Delete user (admin only)
router.delete('/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const result = await userService.deleteUser(req.params.id, req.user.id);

    res.json({
        success: true,
        message: result.message
    });
}));

// Block/Unblock user (admin only)
router.patch('/:id/status', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { status } = req.body;

    const user = await userService.toggleUserStatus(req.params.id, status, req.user.id);

    res.json({
        success: true,
        message: 'User status updated successfully',
        data: user
    });
}));

// Get user's enrolled courses
router.get('/:id/courses', authenticate, isAdminOrSelf, asyncHandler(async (req, res) => {
    const courses = await userService.getUserCourses(req.params.id);

    res.json({
        success: true,
        data: courses
    });
}));

// Get user statistics
router.get('/:id/stats', authenticate, isAdminOrSelf, asyncHandler(async (req, res) => {
    const stats = await userService.getUserStats(req.params.id);

    res.json({
        success: true,
        data: stats
    });
}));

// Reset device (admin only)
router.post('/:id/reset-device', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const result = await authService.resetDevice(req.params.id);

    res.json({
        success: true,
        message: result.message
    });
}));

// Get user devices (admin only)
router.get('/:id/devices', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const devices = await userService.getUserDevices(req.params.id);

    res.json({
        success: true,
        data: devices
    });
}));

// Request course (teacher only)
router.post('/request-course', authenticate, asyncHandler(async (req, res) => {
    const { title, description, category, level } = req.body;

    // Only teachers can request courses
    if (req.user.role !== 'teacher') {
        return res.status(403).json({
            success: false,
            message: 'Only teachers can request courses'
        });
    }

    try {
        const notificationService = (await import('../services/notification.service.js')).default;
        await notificationService.createCourseRequest(
            req.user.id,
            req.user.name,
            { title, description, category, level }
        );
    } catch (error) {
        // Log error but don't fail the request
        console.log('Notification creation failed (non-critical):', error.message);
    }

    res.json({
        success: true,
        message: 'Course request submitted successfully. Admin will review your request.',
        data: { title, description, category, level, teacherName: req.user.name }
    });
}));

export default router;

