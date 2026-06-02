import { Router } from 'express';
import settingsService from '../services/settings.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Only admins can access settings'
        });
    }
    next();
};

// Get all settings
router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const settings = await settingsService.getAllSettings();
    res.json({
        success: true,
        data: settings
    });
}));

// Get specific setting
router.get('/:key', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const setting = await settingsService.getSetting(req.params.key);
    res.json({
        success: true,
        data: setting
    });
}));

// Update setting
router.put('/:key', authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const { value } = req.body;

    if (value === undefined || value === null) {
        return res.status(400).json({
            success: false,
            message: 'Setting value is required'
        });
    }

    const setting = await settingsService.updateSetting(
        req.params.key,
        value,
        req.user.id
    );

    res.json({
        success: true,
        message: 'Setting updated successfully',
        data: setting
    });
}));

export default router;
