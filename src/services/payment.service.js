import Razorpay from 'razorpay';
import crypto from 'crypto';
import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';

class PaymentService {
    constructor() {
        this.razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
    }

    /**
     * Create Razorpay order
     * @param {number} amount - Amount in INR
     * @param {string} courseId - Course ID
     * @param {string} userId - User ID
     */
    async createOrder(amount, courseId, userId) {
        try {
            // Get course details
            const { data: course, error: courseError } = await supabase
                .from('courses')
                .select('*')
                .eq('id', courseId)
                .single();

            if (courseError || !course) {
                throw new AppError('Course not found', 404);
            }

            // Check if already enrolled
            const { data: existingEnrollment } = await supabase
                .from('enrollments')
                .select('*')
                .eq('user_id', userId)
                .eq('course_id', courseId)
                .eq('status', 'active')
                .single();

            if (existingEnrollment) {
                throw new AppError('Already enrolled in this course', 400);
            }

            // Create Razorpay order
            const order = await this.razorpay.orders.create({
                amount: amount * 100, // Convert to paise
                currency: 'INR',
                receipt: `course_${courseId}_user_${userId}_${Date.now()}`,
                notes: {
                    courseId,
                    userId,
                    courseName: course.title,
                },
            });

            // Save order to database
            const { data: payment, error: paymentError } = await supabase
                .from('payments')
                .insert({
                    user_id: userId,
                    course_id: courseId,
                    order_id: order.id,
                    amount: amount,
                    currency: 'INR',
                    status: 'created',
                })
                .select()
                .single();

            if (paymentError) {
                throw new AppError('Failed to save payment record', 500);
            }

            return {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                keyId: process.env.RAZORPAY_KEY_ID,
                courseName: course.title,
                paymentId: payment.id,
            };
        } catch (error) {
            console.error('Create Order Error:', error);
            throw error instanceof AppError ? error : new AppError('Failed to create order', 500);
        }
    }

    /**
     * Verify payment signature
     * @param {string} orderId - Razorpay order ID
     * @param {string} paymentId - Razorpay payment ID
     * @param {string} signature - Razorpay signature
     */
    verifyPayment(orderId, paymentId, signature) {
        try {
            const text = orderId + '|' + paymentId;
            const generated = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(text)
                .digest('hex');

            return generated === signature;
        } catch (error) {
            console.error('Verify Payment Error:', error);
            return false;
        }
    }

    /**
     * Process successful payment
     * @param {string} orderId - Razorpay order ID
     * @param {string} paymentId - Razorpay payment ID
     * @param {string} signature - Razorpay signature
     */
    async processPayment(orderId, paymentId, signature) {
        try {
            // Verify signature
            const isValid = this.verifyPayment(orderId, paymentId, signature);
            if (!isValid) {
                throw new AppError('Invalid payment signature', 400);
            }

            // Get payment record
            const { data: payment, error: paymentError } = await supabase
                .from('payments')
                .select('*')
                .eq('order_id', orderId)
                .single();

            if (paymentError || !payment) {
                throw new AppError('Payment record not found', 404);
            }

            // Update payment status
            await supabase
                .from('payments')
                .update({
                    payment_id: paymentId,
                    signature: signature,
                    status: 'success',
                    paid_at: new Date().toISOString(),
                })
                .eq('id', payment.id);

            // Get course validity
            const { data: course } = await supabase
                .from('courses')
                .select('validity_days')
                .eq('id', payment.course_id)
                .single();

            const validityDays = course?.validity_days || 365;
            const validUntil = new Date();
            validUntil.setDate(validUntil.getDate() + validityDays);

            // Create enrollment
            const { data: enrollment, error: enrollError } = await supabase
                .from('enrollments')
                .insert({
                    user_id: payment.user_id,
                    course_id: payment.course_id,
                    payment_id: payment.id,
                    status: 'active',
                    valid_until: validUntil.toISOString(),
                })
                .select()
                .single();

            if (enrollError) {
                throw new AppError('Failed to create enrollment', 500);
            }

            return {
                success: true,
                enrollment,
                message: 'Payment successful and enrolled in course',
            };
        } catch (error) {
            console.error('Process Payment Error:', error);
            throw error instanceof AppError ? error : new AppError('Failed to process payment', 500);
        }
    }

    /**
     * Handle Razorpay webhook
     * @param {object} event - Webhook event
     * @param {string} signature - Webhook signature
     */
    async handleWebhook(event, signature) {
        try {
            // Verify webhook signature
            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
            const expectedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(JSON.stringify(event))
                .digest('hex');

            if (expectedSignature !== signature) {
                throw new AppError('Invalid webhook signature', 400);
            }

            // Handle different event types
            switch (event.event) {
                case 'payment.captured':
                    await this.handlePaymentCaptured(event.payload.payment.entity);
                    break;
                case 'payment.failed':
                    await this.handlePaymentFailed(event.payload.payment.entity);
                    break;
                default:
                    console.log('Unhandled webhook event:', event.event);
            }

            return { success: true };
        } catch (error) {
            console.error('Webhook Error:', error);
            throw error;
        }
    }

    /**
     * Handle payment captured event
     */
    async handlePaymentCaptured(payment) {
        const { data: paymentRecord } = await supabase
            .from('payments')
            .select('*')
            .eq('order_id', payment.order_id)
            .single();

        if (paymentRecord && paymentRecord.status !== 'success') {
            await this.processPayment(payment.order_id, payment.id, payment.signature);
        }
    }

    /**
     * Handle payment failed event
     */
    async handlePaymentFailed(payment) {
        await supabase
            .from('payments')
            .update({
                payment_id: payment.id,
                status: 'failed',
                error_description: payment.error_description,
            })
            .eq('order_id', payment.order_id);
    }

    /**
     * Get payment history for user
     * @param {string} userId - User ID
     */
    async getPaymentHistory(userId) {
        const { data, error } = await supabase
            .from('payments')
            .select(`
                *,
                courses(title, thumbnail_url)
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch payment history', 500);
        }

        return data;
    }
}

export default new PaymentService();
