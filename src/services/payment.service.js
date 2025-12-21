import Razorpay from 'razorpay';
import crypto from 'crypto';
import supabase from '../config/database.js';
import { config } from '../config/config.js';
import { AppError } from '../middlewares/error.middleware.js';
import enrollmentService from './enrollment.service.js';
import auditService from './audit.service.js';
import couponService from './coupon.service.js';

class PaymentService {
    constructor() {
        this.razorpay = new Razorpay({
            key_id: config.razorpay.keyId,
            key_secret: config.razorpay.keySecret
        });
    }

    // Create Razorpay order (with optional coupon)
    async createOrder(studentId, courseId, couponCode = null) {
        // Get course details
        const { data: course, error } = await supabase
            .from('courses')
            .select('id, title, price')
            .eq('id', courseId)
            .single();

        if (error || !course) {
            throw new AppError('Course not found', 404);
        }

        // Check if already enrolled
        const { data: existing } = await supabase
            .from('enrollments')
            .select('id')
            .eq('student_id', studentId)
            .eq('course_id', courseId)
            .single();

        if (existing) {
            throw new AppError('You are already enrolled in this course', 400);
        }

        let finalAmount = course.price;
        let discountAmount = 0;
        let couponId = null;

        // Validate and apply coupon if provided
        if (couponCode) {
            try {
                const coupon = await couponService.validateCoupon(couponCode, courseId, studentId);
                discountAmount = couponService.calculateDiscount(coupon, course.price);
                finalAmount = course.price - discountAmount;
                couponId = coupon.id;
            } catch (error) {
                // If coupon validation fails, throw the error
                throw error;
            }
        }

        // Create Razorpay order with final amount
        const orderOptions = {
            amount: Math.round(finalAmount * 100), // Convert to paise
            currency: 'INR',
            receipt: `order_${Date.now()}`,
            notes: {
                student_id: studentId,
                course_id: courseId,
                course_title: course.title,
                original_amount: course.price,
                discount_amount: discountAmount,
                coupon_code: couponCode || 'none'
            }
        };

        try {
            const order = await this.razorpay.orders.create(orderOptions);

            // Save payment record with coupon info
            await supabase
                .from('payments')
                .insert({
                    razorpay_order_id: order.id,
                    student_id: studentId,
                    course_id: courseId,
                    amount: finalAmount,
                    original_amount: course.price,
                    discount_amount: discountAmount,
                    coupon_id: couponId,
                    currency: 'INR',
                    status: 'pending'
                });

            return {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                keyId: config.razorpay.keyId,
                originalAmount: course.price,
                discountAmount: discountAmount,
                finalAmount: finalAmount
            };
        } catch (error) {
            console.error('Razorpay order creation error:', error);
            throw new AppError('Failed to create payment order', 500);
        }
    }

    // Verify payment and enroll student
    async verifyPayment(paymentData) {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentData;

        // Verify signature
        const generatedSignature = crypto
            .createHmac('sha256', config.razorpay.keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (generatedSignature !== razorpay_signature) {
            throw new AppError('Payment verification failed. Invalid signature.', 400);
        }

        // Get payment record
        const { data: payment, error } = await supabase
            .from('payments')
            .select('*')
            .eq('razorpay_order_id', razorpay_order_id)
            .single();

        if (error || !payment) {
            throw new AppError('Payment record not found', 404);
        }

        // Update payment record
        const { data: updatedPayment } = await supabase
            .from('payments')
            .update({
                razorpay_payment_id,
                razorpay_signature,
                status: 'success',
                payment_method: 'online'
            })
            .eq('razorpay_order_id', razorpay_order_id)
            .select()
            .single();

        // Record coupon usage if coupon was used
        if (payment.coupon_id && payment.discount_amount > 0) {
            await couponService.applyCoupon(
                payment.coupon_id,
                payment.student_id,
                updatedPayment.id,
                payment.discount_amount
            );
        }

        // Enroll student
        const enrollment = await enrollmentService.enrollStudent(
            payment.student_id,
            payment.course_id,
            'online'
        );

        // Log action
        await auditService.log(
            payment.student_id,
            'PAYMENT_SUCCESS',
            `Payment successful for course: ${payment.course_id}`,
            {
                orderId: razorpay_order_id,
                paymentId: razorpay_payment_id,
                amount: payment.amount,
                discount: payment.discount_amount || 0,
                coupon_used: payment.coupon_id ? true : false
            }
        );

        return {
            success: true,
            message: 'Payment verified and enrollment successful',
            enrollment
        };
    }

    // Offline payment enrollment (admin only)
    async offlineEnrollment(studentId, courseId, amount, adminId) {
        // Get course details
        const { data: course } = await supabase
            .from('courses')
            .select('id, title, price')
            .eq('id', courseId)
            .single();

        if (!course) {
            throw new AppError('Course not found', 404);
        }

        // Create payment record
        const { data: payment, error } = await supabase
            .from('payments')
            .insert({
                student_id: studentId,
                course_id: courseId,
                amount: amount || course.price,
                currency: 'INR',
                status: 'success',
                payment_method: 'offline'
            })
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to create payment record', 500);
        }

        // Enroll student
        const enrollment = await enrollmentService.enrollStudent(studentId, courseId, 'offline');

        // Log action
        await auditService.log(
            adminId,
            'OFFLINE_ENROLLMENT',
            `Offline enrollment for student: ${studentId}, course: ${course.title}`,
            { studentId, courseId, amount: payment.amount }
        );

        return {
            success: true,
            message: 'Offline enrollment successful',
            payment,
            enrollment
        };
    }

    // Get payment history
    async getPaymentHistory(filters = {}, page = 1, limit = 50) {
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

        // Apply filters
        if (filters.studentId) {
            query = query.eq('student_id', filters.studentId);
        }

        if (filters.courseId) {
            query = query.eq('course_id', filters.courseId);
        }

        if (filters.status) {
            query = query.eq('status', filters.status);
        }

        if (filters.paymentMethod) {
            query = query.eq('payment_method', filters.paymentMethod);
        }

        // Pagination
        const offset = (page - 1) * limit;
        query = query.range(offset, offset + limit - 1);

        const { data: payments, error, count } = await query;

        if (error) {
            throw new AppError('Failed to fetch payment history', 500);
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

    // Get payment statistics
    async getPaymentStats() {
        // Total revenue
        const { data: successPayments } = await supabase
            .from('payments')
            .select('amount')
            .eq('status', 'success');

        const totalRevenue = successPayments?.reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

        // Payment counts by status
        const { data: allPayments } = await supabase
            .from('payments')
            .select('status');

        const statusCounts = allPayments?.reduce((acc, p) => {
            acc[p.status] = (acc[p.status] || 0) + 1;
            return acc;
        }, {});

        // Revenue by payment method
        const onlineRevenue = successPayments?.filter(p => p.payment_method === 'online')
            .reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

        const offlineRevenue = successPayments?.filter(p => p.payment_method === 'offline')
            .reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

        return {
            totalRevenue,
            onlineRevenue,
            offlineRevenue,
            totalPayments: allPayments?.length || 0,
            successfulPayments: statusCounts?.success || 0,
            failedPayments: statusCounts?.failed || 0,
            pendingPayments: statusCounts?.pending || 0
        };
    }

    // Get advanced payment analytics
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

    // Get revenue by month (last 12 months)
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

        // Group by month
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

    // Get revenue by course
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

        // Group by course
        const courseRevenue = {};
        payments?.forEach(payment => {
            const courseId = payment.courses?.id;
            const courseTitle = payment.courses?.title || 'Unknown Course';

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
        });

        return Object.values(courseRevenue).sort((a, b) => b.revenue - a.revenue);
    }

    // Get filtered payments with advanced filters
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

        // Filter by month (YYYY-MM format)
        if (filters.month) {
            const [year, month] = filters.month.split('-');
            const startDate = new Date(year, month - 1, 1).toISOString();
            const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();
            query = query.gte('created_at', startDate).lte('created_at', endDate);
        }

        // Filter by course
        if (filters.courseId) {
            query = query.eq('course_id', filters.courseId);
        }

        // Filter by payment mode
        if (filters.paymentMethod) {
            query = query.eq('payment_method', filters.paymentMethod);
        }

        // Filter by status
        if (filters.status) {
            query = query.eq('status', filters.status);
        }

        // Pagination
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


    // Razorpay webhook handler
    async handleWebhook(webhookBody, webhookSignature) {
        // Verify webhook signature
        const expectedSignature = crypto
            .createHmac('sha256', config.razorpay.keySecret)
            .update(JSON.stringify(webhookBody))
            .digest('hex');

        if (expectedSignature !== webhookSignature) {
            throw new AppError('Invalid webhook signature', 400);
        }

        const event = webhookBody.event;
        const payload = webhookBody.payload.payment.entity;

        if (event === 'payment.captured') {
            // Update payment status
            await supabase
                .from('payments')
                .update({
                    status: 'success',
                    razorpay_payment_id: payload.id
                })
                .eq('razorpay_order_id', payload.order_id);
        } else if (event === 'payment.failed') {
            // Update payment status
            await supabase
                .from('payments')
                .update({ status: 'failed' })
                .eq('razorpay_order_id', payload.order_id);
        }

        return { success: true };
    }
}

export default new PaymentService();
