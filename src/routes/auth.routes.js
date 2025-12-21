import { Router } from 'express';
import authService from '../services/auth.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { registerValidation, loginValidation } from '../middlewares/validation.middleware.js';
import { generateDeviceId } from '../middlewares/deviceTracking.middleware.js';

const router = Router();

// Register
router.post('/register', registerValidation, asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: result
    });
}));

// Login
router.post('/login', loginValidation, asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const deviceId = generateDeviceId(req);

    const result = await authService.login(email, password, deviceId);

    res.json({
        success: true,
        message: 'Login successful',
        data: result
    });
}));

// Refresh token
router.post('/refresh', asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({
            success: false,
            message: 'Refresh token is required'
        });
    }

    const result = await authService.refreshAccessToken(refreshToken);

    res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: result
    });
}));

// Logout
router.post('/logout', authenticate, asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    await authService.logout(refreshToken);

    res.json({
        success: true,
        message: 'Logout successful'
    });
}));

// Change password
router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    const result = await authService.changePassword(req.user.id, currentPassword, newPassword);

    res.json({
        success: true,
        message: result.message
    });
}));

// Get current user
router.get('/me', authenticate, asyncHandler(async (req, res) => {
    res.json({
        success: true,
        data: req.user
    });
}));

export default router;
