import { Router } from 'express';
import deviceService from '../services/device.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin } from '../middlewares/rbac.middleware.js';

const router = Router();

// Get device activity (admin only)
router.get('/activity', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { studentsOnly = true } = req.query;

    const result = await deviceService.getDeviceActivity({ studentsOnly });

    res.json({
        success: true,
        data: result
    });
}));

// Get device settings (admin only)
router.get('/settings', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const settings = await deviceService.getDeviceSettings();

    res.json({
        success: true,
        data: settings
    });
}));

// Update global device limit (admin only)
router.put('/settings', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { maxDevicesPerStudent } = req.body;

    if (!maxDevicesPerStudent || ![1, 2].includes(parseInt(maxDevicesPerStudent))) {
        return res.status(400).json({
            success: false,
            message: 'maxDevicesPerStudent must be 1 or 2'
        });
    }

    const result = await deviceService.setGlobalDeviceLimit(
        parseInt(maxDevicesPerStudent),
        req.user.id
    );

    res.json({
        success: true,
        message: result.message,
        data: { limit: result.limit }
    });
}));

// Toggle device enforcement on/off (admin only)
router.put('/enforcement', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({
            success: false,
            message: 'enabled must be a boolean value'
        });
    }

    const result = await deviceService.toggleDeviceEnforcement(enabled, req.user.id);

    res.json({
        success: true,
        message: result.message,
        data: { enabled: result.enabled }
    });
}));


// Reset all student devices (admin only)
router.post('/reset-all', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const result = await deviceService.resetAllStudentDevices(req.user.id);

    res.json({
        success: true,
        message: result.message,
        data: { count: result.count }
    });
}));

// Force logout student (admin only)
router.post('/:userId/force-logout', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const result = await deviceService.forceLogoutStudent(req.params.userId, req.user.id);

    res.json({
        success: true,
        message: result.message
    });
}));

// Reset student devices (admin only)
router.post('/:userId/reset', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const result = await deviceService.resetStudentDevices(req.params.userId, req.user.id);

    res.json({
        success: true,
        message: result.message
    });
}));

// Block specific device (admin only)
router.post('/:deviceId/block', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const result = await deviceService.blockDevice(req.params.deviceId, req.user.id);

    res.json({
        success: true,
        message: result.message
    });
}));

export default router;
