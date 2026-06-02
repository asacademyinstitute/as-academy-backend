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
                .eq('student_id', userId)
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
                    student_id: userId,
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
                    student_id: payment.student_id,
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
            .eq('student_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch payment history', 500);
        }

        return data;
    }

    /**
     * Get payment statistics (admin only)
     */
    async getPaymentStats() {
        const { data: allPayments, error } = await supabase
            .from('payments')
            .select('amount, status, payment_method');

        if (error) {
            throw new AppError('Failed to fetch payment statistics', 500);
        }

        let totalRevenue = 0;
        let onlineRevenue = 0;
        let offlineRevenue = 0;

        const statusCounts = {
            success: 0,
            failed: 0,
            pending: 0
        };

        allPayments?.forEach(payment => {
            const amount = parseFloat(payment.amount) || 0;
            const status = payment.status === 'success' ? 'success' : (payment.status === 'failed' ? 'failed' : 'pending');
            statusCounts[status]++;

            if (payment.status === 'success') {
                totalRevenue += amount;
                if (payment.payment_method === 'offline') {
                    offlineRevenue += amount;
                } else {
                    onlineRevenue += amount;
                }
            }
        });

        return {
            totalRevenue,
            onlineRevenue,
            offlineRevenue,
            totalPayments: allPayments?.length || 0,
            successfulPayments: statusCounts.success,
            failedPayments: statusCounts.failed,
            pendingPayments: statusCounts.pending
        };
    }

    /**
     * Get advanced payment analytics (admin only)
     */
    async getAdvancedStats() {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

        // Today's revenue
        const { data: todayPayments } = await supabase
            .from('payments')
            .select('amount')
            .eq('status', 'success')
            .gte('created_at', startOfToday);

        const todayRevenue = todayPayments?.reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

        // This month's revenue
        const { data: thisMonthPayments } = await supabase
            .from('payments')
            .select('amount')
            .eq('status', 'success')
            .gte('created_at', startOfMonth);

        const thisMonthRevenue = thisMonthPayments?.reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

        // Last month's revenue
        const { data: lastMonthPayments } = await supabase
            .from('payments')
            .select('amount')
            .eq('status', 'success')
            .gte('created_at', startOfLastMonth)
            .lte('created_at', endOfLastMonth);

        const lastMonthRevenue = lastMonthPayments?.reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

        // All-time revenue
        const { data: allPayments } = await supabase
            .from('payments')
            .select('amount')
            .eq('status', 'success');

        const totalRevenue = allPayments?.reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

        return {
            todayRevenue,
            thisMonthRevenue,
            lastMonthRevenue,
            totalRevenue,
            todayCount: todayPayments?.length || 0,
            thisMonthCount: thisMonthPayments?.length || 0,
            lastMonthCount: lastMonthPayments?.length || 0,
            totalCount: allPayments?.length || 0
        };
    }

    /**
     * Get revenue by month (last 12 months)
     */
    async getRevenueByMonth() {
        const { data: payments, error } = await supabase
            .from('payments')
            .select('amount, created_at')
            .eq('status', 'success')
            .gte('created_at', new Date(new Date().setMonth(new Date().getMonth() - 12)).toISOString())
            .order('created_at', { ascending: true });

        if (error) {
            throw new AppError('Failed to fetch revenue by month', 500);
        }

        const monthlyRevenue = {};
        payments?.forEach(payment => {
            const date = new Date(payment.created_at);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            if (!monthlyRevenue[monthKey]) {
                monthlyRevenue[monthKey] = {
                    month: monthKey,
                    revenue: 0,
                    count: 0
                };
            }

            monthlyRevenue[monthKey].revenue += parseFloat(payment.amount);
            monthlyRevenue[monthKey].count += 1;
        });

        return Object.values(monthlyRevenue).sort((a, b) => a.month.localeCompare(b.month));
    }

    /**
     * Get revenue by course
     */
    async getRevenueByCourse() {
        const { data: payments, error } = await supabase
            .from('payments')
            .select(`
                amount,
                courses:course_id (
                    id,
                    title
                )
            `)
            .eq('status', 'success');

        if (error) {
            throw new AppError('Failed to fetch revenue by course', 500);
        }

        const courseRevenue = {};
        payments?.forEach(payment => {
            const courseId = payment.courses?.id;
            const courseTitle = payment.courses?.title || 'Unknown Course';

            if (courseId) {
                if (!courseRevenue[courseId]) {
                    courseRevenue[courseId] = {
                        courseId,
                        courseTitle,
                        revenue: 0,
                        enrollments: 0
                    };
                }

                courseRevenue[courseId].revenue += parseFloat(payment.amount);
                courseRevenue[courseId].enrollments += 1;
            }
        });

        return Object.values(courseRevenue).sort((a, b) => b.revenue - a.revenue);
    }

    /**
     * Get filtered payments with advanced filters
     */
    async getFilteredPayments(filters = {}, page = 1, limit = 50) {
        let query = supabase
            .from('payments')
            .select(`
                *,
                users:student_id (
                    id,
                    name,
                    email
                ),
                courses:course_id (
                    id,
                    title
                )
            `, { count: 'exact' })
            .order('created_at', { ascending: false });

        if (filters.month) {
            const [year, month] = filters.month.split('-');
            const startDate = new Date(year, month - 1, 1).toISOString();
            const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
            query = query.gte('created_at', startDate).lte('created_at', endDate);
        }

        if (filters.courseId) {
            query = query.eq('course_id', filters.courseId);
        }

        if (filters.paymentMethod) {
            query = query.eq('payment_method', filters.paymentMethod);
        }

        if (filters.status) {
            query = query.eq('status', filters.status);
        }

        const offset = (page - 1) * limit;
        query = query.range(offset, offset + limit - 1);

        const { data: payments, error, count } = await query;

        if (error) {
            throw new AppError('Failed to fetch filtered payments', 500);
        }

        return {
            payments,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit)
            }
        };
    }

    /**
     * Create offline enrollment
     */
    async offlineEnrollment(studentId, courseId, amount, adminId) {
        try {
            // Get course validity
            const { data: course, error: courseError } = await supabase
                .from('courses')
                .select('validity_days, title')
                .eq('id', courseId)
                .single();

            if (courseError || !course) {
                throw new AppError('Course not found', 404);
            }

            const validityDays = course.validity_days || 365;
            const validUntil = new Date();
            validUntil.setDate(validUntil.getDate() + validityDays);

            // Create offline payment record
            const { data: payment, error: paymentError } = await supabase
                .from('payments')
                .insert({
                    student_id: studentId,
                    course_id: courseId,
                    amount: amount,
                    status: 'success',
                    payment_method: 'offline',
                    paid_at: new Date().toISOString(),
                })
                .select()
                .single();

            if (paymentError) {
                throw new AppError('Failed to create offline payment record', 500);
            }

            // Create enrollment record
            const { data: enrollment, error: enrollError } = await supabase
                .from('enrollments')
                .insert({
                    student_id: studentId,
                    course_id: courseId,
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
                message: 'Offline enrollment created successfully',
                payment,
                enrollment
            };
        } catch (error) {
            console.error('Offline Enrollment Error:', error);
            throw error instanceof AppError ? error : new AppError('Failed to complete offline enrollment', 500);
        }
    }
}

export default new PaymentService();
