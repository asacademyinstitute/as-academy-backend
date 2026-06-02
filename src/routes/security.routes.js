import express from 'express';
import securityService from '../services/security.service.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';

const router = express.Router();

// Get watermark data for current user
router.get('/watermark-data', authenticate, async (req, res, next) => {
    try {
        const watermarkData = await securityService.getWatermarkData(req.user.userId);
        res.json({ watermarkData });
    } catch (error) {
        next(error);
    }
});

// Report security violation
router.post('/report-violation', authenticate, async (req, res, next) => {
    try {
        const { violationType, deviceInfo } = req.body;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];

        await securityService.logViolation(
            req.user.userId,
            violationType,
            deviceInfo,
            ipAddress,
            userAgent
        );

        res.json({ success: true, message: 'Violation logged' });
    } catch (error) {
        next(error);
    }
});

// Get security violations (Admin only)
router.get('/violations', authenticate, authorize(['admin']), async (req, res, next) => {
    try {
        const { userId, violationType, limit } = req.query;

        const violations = await securityService.getViolations({
            userId,
            violationType,
            limit: limit ? parseInt(limit) : 100,
        });

        res.json({ violations });
    } catch (error) {
        next(error);
    }
});

// Get security statistics (Admin only)
router.get('/stats', authenticate, authorize(['admin']), async (req, res, next) => {
    try {
        const stats = await securityService.getSecurityStats();
        res.json({ stats });
    } catch (error) {
        next(error);
    }
});

export default router;
