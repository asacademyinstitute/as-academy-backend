import express from 'express';
import paymentService from '../services/payment.service.js';
import { authenticate } from '../middlewares/auth.middleware.js';

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
 * Get payment history
 * GET /api/payments/history
 */
router.get('/history', authenticate, async (req, res, next) => {
    try {
        const userId = req.user.id;

        const payments = await paymentService.getPaymentHistory(userId);

        res.status(200).json({
            success: true,
            data: payments,
        });
    } catch (error) {
        next(error);
    }
});

export default router;
