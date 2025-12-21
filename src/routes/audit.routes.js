import { Router } from 'express';
import auditService from '../services/audit.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin } from '../middlewares/rbac.middleware.js';
import { paginationValidation } from '../middlewares/validation.middleware.js';

const router = Router();

// Get audit logs (admin only)
router.get('/', authenticate, isAdmin, paginationValidation, asyncHandler(async (req, res) => {
    const { userId, action, startDate, endDate, page = 1, limit = 50 } = req.query;

    const result = await auditService.getLogs(
        { userId, action, startDate, endDate },
        parseInt(page),
        parseInt(limit)
    );

    res.json({
        success: true,
        data: result
    });
}));

// Get user activity (admin only)
router.get('/user/:userId', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { days = 30 } = req.query;

    const activity = await auditService.getUserActivity(req.params.userId, parseInt(days));

    res.json({
        success: true,
        data: activity
    });
}));

export default router;
