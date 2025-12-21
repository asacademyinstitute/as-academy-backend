import { Router } from 'express';
import paymentService from '../services/payment.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin, isStudent } from '../middlewares/rbac.middleware.js';
import { paginationValidation } from '../middlewares/validation.middleware.js';

const router = Router();

// Create Razorpay order (student)
router.post('/create-order', authenticate, isStudent, asyncHandler(async (req, res) => {
    const { courseId, couponCode } = req.body;

    const order = await paymentService.createOrder(req.user.id, courseId, couponCode);

    res.json({
        success: true,
        message: 'Order created successfully',
        data: order
    });
}));

// Verify payment (student)
router.post('/verify', authenticate, isStudent, asyncHandler(async (req, res) => {
    const result = await paymentService.verifyPayment(req.body);

    res.json({
        success: true,
        message: result.message,
        data: result.enrollment
    });
}));

// Offline enrollment (admin only)
router.post('/offline-enroll', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { studentId, courseId, amount } = req.body;

    const result = await paymentService.offlineEnrollment(studentId, courseId, amount, req.user.id);

    res.json({
        success: true,
        message: result.message,
        data: {
            payment: result.payment,
            enrollment: result.enrollment
        }
    });
}));

// Get payment history
router.get('/history', authenticate, paginationValidation, asyncHandler(async (req, res) => {
    const { studentId, courseId, status, paymentMethod, page = 1, limit = 50 } = req.query;

    // Students can only see their own payments
    const filters = {
        studentId: req.user.role === 'student' ? req.user.id : studentId,
        courseId,
        status,
        paymentMethod
    };

    const result = await paymentService.getPaymentHistory(filters, parseInt(page), parseInt(limit));

    res.json({
        success: true,
        data: result
    });
}));

// Get payment statistics (admin only)
router.get('/stats', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const stats = await paymentService.getPaymentStats();

    res.json({
        success: true,
        data: stats
    });
}));

// Get advanced payment analytics (admin only)
router.get('/analytics/advanced', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const stats = await paymentService.getAdvancedStats();

    res.json({
        success: true,
        data: stats
    });
}));

// Get revenue by month (admin only)
router.get('/analytics/by-month', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const data = await paymentService.getRevenueByMonth();

    res.json({
        success: true,
        data
    });
}));

// Get revenue by course (admin only)
router.get('/analytics/by-course', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const data = await paymentService.getRevenueByCourse();

    res.json({
        success: true,
        data
    });
}));

// Get filtered payments (admin only)
router.get('/filtered', authenticate, isAdmin, paginationValidation, asyncHandler(async (req, res) => {
    const { month, courseId, paymentMethod, status, page = 1, limit = 50 } = req.query;

    const filters = { month, courseId, paymentMethod, status };
    const result = await paymentService.getFilteredPayments(filters, parseInt(page), parseInt(limit));

    res.json({
        success: true,
        data: result
    });
}));

// Razorpay webhook
router.post('/webhook', asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];

    await paymentService.handleWebhook(req.body, signature);

    res.json({ success: true });
}));

export default router;
