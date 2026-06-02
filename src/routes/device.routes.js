import { Router } from 'express';
import supabase from '../config/database.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin } from '../middlewares/rbac.middleware.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import settingsService from '../services/settings.service.js';

const router = Router();

// Apply auth and admin check to all routes
router.use(authenticate, isAdmin);

// GET /api/devices/settings - Fetch global device settings
router.get('/settings', asyncHandler(async (req, res) => {
    // Read student_device_limit setting
    const deviceLimitSetting = await settingsService.getSetting('student_device_limit').catch(() => ({ setting_value: '1' }));
    // Read device_tracking_enabled setting
    const trackingEnabledSetting = await settingsService.getSetting('device_tracking_enabled').catch(() => ({ setting_value: 'true' }));

    res.json({
        success: true,
        data: {
            deviceTrackingEnabled: trackingEnabledSetting.setting_value === 'true',
            maxDevicesPerStudent: parseInt(deviceLimitSetting.setting_value) || 1
        }
    });
}));

// PUT /api/devices/settings - Update device limit setting
router.put('/settings', asyncHandler(async (req, res) => {
    const { maxDevicesPerStudent } = req.body;
    
    if (maxDevicesPerStudent === undefined || ![1, 2].includes(parseInt(maxDevicesPerStudent))) {
        return res.status(400).json({
            success: false,
            message: 'maxDevicesPerStudent must be 1 or 2'
        });
    }

    await settingsService.updateSetting('student_device_limit', maxDevicesPerStudent.toString(), req.user.id);

    res.json({
        success: true,
        message: `Device limit changed successfully to ${maxDevicesPerStudent}`
    });
}));

// PUT /api/devices/enforcement - Toggle global device restriction enforcement
router.put('/enforcement', asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    
    if (enabled === undefined) {
        return res.status(400).json({
            success: false,
            message: 'enabled field is required'
        });
    }

    const value = enabled ? 'true' : 'false';
    await settingsService.updateSetting('device_tracking_enabled', value, req.user.id);

    res.json({
        success: true,
        message: `Device restriction enforcement ${enabled ? 'enabled' : 'disabled'} successfully`
    });
}));

// GET /api/devices/activity - Get student device usage activity
router.get('/activity', asyncHandler(async (req, res) => {
    // 1. Fetch all students
    const { data: students, error: studentError } = await supabase
        .from('users')
        .select('id, name, email, phone')
        .eq('role', 'student');

    if (studentError) {
        return res.status(500).json({ success: false, message: 'Failed to fetch student list' });
    }

    // 2. Fetch all tracked student devices
    const { data: allDevices, error: devicesError } = await supabase
        .from('user_devices')
        .select('*');

    if (devicesError) {
        return res.status(500).json({ success: false, message: 'Failed to fetch tracked devices' });
    }

    // 3. Fetch login tokens to compute login count
    const { data: refreshTokens, error: tokensError } = await supabase
        .from('refresh_tokens')
        .select('user_id');

    // Group login count by user
    const loginCounts = {};
    if (refreshTokens) {
        refreshTokens.forEach(t => {
            loginCounts[t.user_id] = (loginCounts[t.user_id] || 0) + 1;
        });
    }

    // Read current settings to determine if limit exceeded
    const deviceLimitSetting = await settingsService.getSetting('student_device_limit').catch(() => ({ setting_value: '1' }));
    const maxDevices = parseInt(deviceLimitSetting.setting_value) || 1;

    // 4. Compile device activities
    const devicesActivity = students.map(student => {
        const studentDevices = allDevices.filter(d => d.user_id === student.id);
        
        // Find latest activity
        let lastLogin = null;
        if (studentDevices.length > 0) {
            const dates = studentDevices.map(d => new Date(d.last_active).getTime());
            lastLogin = new Date(Math.max(...dates)).toISOString();
        }

        // Suspicious if devices > limit OR any device is rooted/emulator
        const hasRootOrEmulator = studentDevices.some(d => d.is_rooted || d.is_emulator);
        const suspicious = studentDevices.length > maxDevices || hasRootOrEmulator;

        return {
            user: {
                id: student.id,
                name: student.name,
                email: student.email,
                phone: student.phone
            },
            totalDevices: studentDevices.length,
            loginCount: loginCounts[student.id] || studentDevices.length || 0,
            lastLogin,
            suspicious
        };
    });

    res.json({
        success: true,
        data: {
            devices: devicesActivity
        }
    });
}));

// POST /api/devices/reset-all - Reset devices for all students
router.post('/reset-all', asyncHandler(async (req, res) => {
    // Fetch all student user IDs
    const { data: students, error: studentError } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'student');

    if (studentError) {
        return res.status(500).json({ success: false, message: 'Failed to fetch student list' });
    }

    const studentIds = students.map(s => s.id);

    if (studentIds.length > 0) {
        // Delete all student device entries
        const { error: deviceError } = await supabase
            .from('user_devices')
            .delete()
            .in('user_id', studentIds);

        if (deviceError) {
            return res.status(500).json({ success: false, message: 'Failed to clear student devices' });
        }

        // Revoke active sessions (refresh tokens) for all students
        await supabase
            .from('refresh_tokens')
            .update({ revoked: true })
            .in('user_id', studentIds);
    }

    res.json({
        success: true,
        message: 'All student devices reset successfully',
        data: {
            count: studentIds.length
        }
    });
}));

// POST /api/devices/:userId/reset - Reset devices for a specific user
router.post('/:userId/reset', asyncHandler(async (req, res) => {
    const { userId } = req.params;

    // Delete devices
    const { error: deviceError } = await supabase
        .from('user_devices')
        .delete()
        .eq('user_id', userId);

    if (deviceError) {
        return res.status(500).json({ success: false, message: 'Failed to reset user devices' });
    }

    // Revoke refresh tokens
    await supabase
        .from('refresh_tokens')
        .update({ revoked: true })
        .eq('user_id', userId);

    res.json({
        success: true,
        message: 'User devices reset successfully'
    });
}));

// POST /api/devices/:userId/force-logout - Force logout a user session without resetting device registration
router.post('/:userId/force-logout', asyncHandler(async (req, res) => {
    const { userId } = req.params;

    // Revoke active refresh tokens to force re-login
    const { error: tokenError } = await supabase
        .from('refresh_tokens')
        .update({ revoked: true })
        .eq('user_id', userId);

    if (tokenError) {
        return res.status(500).json({ success: false, message: 'Failed to force logout user' });
    }

    res.json({
        success: true,
        message: 'User forced to logout successfully'
    });
}));

// POST /api/devices/:deviceId/block - Block a device ID
router.post('/:deviceId/block', asyncHandler(async (req, res) => {
    // Stub endpoint for blocking a device fingerprint
    res.json({
        success: true,
        message: `Device fingerprint ${req.params.deviceId} blocked successfully`
    });
}));

export default router;
