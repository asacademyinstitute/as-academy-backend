import express from 'express';
import paymentService from '../services/payment.service.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin } from '../middlewares/rbac.middleware.js';

const router = express.Router();
/**
 * Public payment gateway status (no auth required)
 * GET /api/payments/status
 */
router.get('/status', async (req, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const status = {
        razorpay_configured: !!(keyId && process.env.RAZORPAY_KEY_SECRET),
        razorpay_mode: keyId.startsWith('rzp_live') ? 'LIVE' : keyId.startsWith('rzp_test') ? 'TEST' : 'NOT_SET',
        key_prefix: keyId ? keyId.substring(0, 12) + '...' : 'NOT_SET',
        server_time: new Date().toISOString(),
    };
    try {
        await paymentService.razorpay.orders.all({ count: 1 });
        status.razorpay_api_ok = true;
    } catch (e) {
        status.razorpay_api_ok = false;
        status.razorpay_api_error = e?.error?.description || e?.message || 'Unknown error';
    }
    res.json({ success: true, data: status });
});

/**
 * Payment gateway health check (admin only)
 * GET /api/payments/ping
 * Tests Razorpay connectivity from the production server
 */
router.get('/ping', authenticate, isAdmin, async (req, res) => {
    const checks = {
        razorpay_key_id: !!process.env.RAZORPAY_KEY_ID,
        razorpay_key_secret: !!process.env.RAZORPAY_KEY_SECRET,
        key_mode: process.env.RAZORPAY_KEY_ID?.startsWith('rzp_live') ? 'LIVE âœ…' : 'TEST âš ï¸',
        supabase_url: !!process.env.SUPABASE_URL,
        supabase_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    // Try a lightweight Razorpay API call
    try {
        await paymentService.razorpay.orders.all({ count: 1 });
        checks.razorpay_api_reachable = true;
    } catch (e) {
        checks.razorpay_api_reachable = false;
        checks.razorpay_api_error = e?.error?.description || e?.message || String(e);
    }
    res.json({ success: true, data: checks });
});

/**
 * Create Razorpay order
 * POST /api/payments/create-order
 */
router.post('/create-order', authenticate, async (req, res, next) => {
    try {
        const { courseId, amount } = req.body;
        const couponCode = req.body.couponCode || req.body.coupon || req.body.code || req.body.coupon_code || req.body.appliedCoupon?.code || null;
        const userId = req.user.id;

        const order = await paymentService.createOrder(amount, courseId, userId, couponCode);

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
            // Accept both Razorpay native field names (razorpay_*) and plain names
        const orderId = req.body.orderId || req.body.razorpay_order_id;
        const paymentId = req.body.paymentId || req.body.razorpay_payment_id;
        const signature = req.body.signature || req.body.razorpay_signature;

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
 * Sync order status directly from Razorpay (fallback for mobile redirects & missed webhooks)
 * POST /api/payments/sync-order
 */
router.post('/sync-order', authenticate, async (req, res, next) => {
    try {
        const orderId = req.body.orderId || req.body.razorpay_order_id;
        const result = await paymentService.verifyOrderDirect(orderId, req.user.id);

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
        const { month, startDate, endDate, courseId, paymentMethod, status, page = 1, limit = 50 } = req.query;
        const filters = { month, startDate, endDate, courseId, paymentMethod, status };
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

