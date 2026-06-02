import express from 'express';
import paymentService from '../services/payment.service.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin } from '../middlewares/rbac.middleware.js';

const router = express.Router();

/**
 * Create Razorpay order
 * POST /api/payments/create-order
 */
router.post('/create-order', authenticate, async (req, res, next) => {
    try {
        const { courseId, amount } = req.body;
        const userId = req.user.id;

        const order = await paymentService.createOrder(amount, courseId, userId);

        res.status(200).json({
            success: true,
            data: order,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Verify payment
 * POST /api/payments/verify
 */
router.post('/verify', authenticate, async (req, res, next) => {
    try {
        const { orderId, paymentId, signature } = req.body;

        const result = await paymentService.processPayment(orderId, paymentId, signature);

        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Razorpay webhook
 * POST /api/payments/webhook
 */
router.post('/webhook', async (req, res, next) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const event = req.body;

        await paymentService.handleWebhook(event, signature);

        res.status(200).json({ success: true });
    } catch (error) {
        next(error);
    }
});

/**
 * Offline enrollment (admin only)
 * POST /api/payments/offline-enroll
 */
router.post('/offline-enroll', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { studentId, courseId, amount } = req.body;
        const result = await paymentService.offlineEnrollment(studentId, courseId, amount, req.user.id);
        res.status(200).json({
            success: true,
            message: result.message,
            data: {
                payment: result.payment,
                enrollment: result.enrollment
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Get payment history
 * GET /api/payments/history
 */
router.get('/history', authenticate, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const payments = await paymentService.getPaymentHistory(userId);

        res.status(200).json({
            success: true,
            data: {
                payments: payments || []
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Get payment statistics (admin only)
 * GET /api/payments/stats
 */
router.get('/stats', authenticate, isAdmin, async (req, res, next) => {
    try {
        const stats = await paymentService.getPaymentStats();
        res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Get advanced payment analytics (admin only)
 * GET /api/payments/analytics/advanced
 */
router.get('/analytics/advanced', authenticate, isAdmin, async (req, res, next) => {
    try {
        const stats = await paymentService.getAdvancedStats();
        res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Get revenue by month (admin only)
 * GET /api/payments/analytics/by-month
 */
router.get('/analytics/by-month', authenticate, isAdmin, async (req, res, next) => {
    try {
        const data = await paymentService.getRevenueByMonth();
        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Get revenue by course (admin only)
 * GET /api/payments/analytics/by-course
 */
router.get('/analytics/by-course', authenticate, isAdmin, async (req, res, next) => {
    try {
        const data = await paymentService.getRevenueByCourse();
        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Get filtered payments (admin only)
 * GET /api/payments/filtered
 */
router.get('/filtered', authenticate, isAdmin, async (req, res, next) => {
    try {
        const { month, courseId, paymentMethod, status, page = 1, limit = 50 } = req.query;
        const filters = { month, courseId, paymentMethod, status };
        const result = await paymentService.getFilteredPayments(filters, parseInt(page), parseInt(limit));
        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
});

export default router;
