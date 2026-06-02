import express from 'express';
import notificationService from '../services/notification.service.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';

const router = express.Router();

/**
 * Get all notifications for user
 * GET /api/notifications
 */
router.get('/', authenticate, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const notifications = await notificationService.getNotifications(userId);

        res.status(200).json({
            success: true,
            data: notifications,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Get unread notifications
 * GET /api/notifications/unread
 */
router.get('/unread', authenticate, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const notifications = await notificationService.getUnreadNotifications(userId);

        res.status(200).json({
            success: true,
            data: notifications,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Get unread count
 * GET /api/notifications/unread-count
 */
router.get('/unread-count', authenticate, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const count = await notificationService.getUnreadCount(userId);

        res.status(200).json({
            success: true,
            count,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Mark notification as read
 * PATCH /api/notifications/:id/read
 */
router.patch('/:id/read', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;
        await notificationService.markAsRead(id);

        res.status(200).json({
            success: true,
            message: 'Notification marked as read',
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Mark all as read
 * PATCH /api/notifications/mark-all-read
 */
router.patch('/mark-all-read', authenticate, async (req, res, next) => {
    try {
        const userId = req.user.id;
        await notificationService.markAllAsRead(userId);

        res.status(200).json({
            success: true,
            message: 'All notifications marked as read',
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Notify live class (Admin/Teacher only)
 * POST /api/notifications/live-class
 */
router.post('/live-class', authenticate, authorize(['admin', 'teacher']), async (req, res, next) => {
    try {
        const { courseId } = req.body;
        const result = await notificationService.notifyLiveClass(courseId);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Notify new content (Admin/Teacher only)
 * POST /api/notifications/new-content
 */
router.post('/new-content', authenticate, authorize(['admin', 'teacher']), async (req, res, next) => {
    try {
        const { courseId, contentType, contentTitle } = req.body;
        const result = await notificationService.notifyNewContent(courseId, contentType, contentTitle);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
