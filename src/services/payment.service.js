import Razorpay from 'razorpay';
import crypto from 'crypto';
import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import couponService from './coupon.service.js';

class PaymentService {
    constructor() {
        this.razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
    }

    /**
     * Create Razorpay order with strict server-side price validation
     * @param {number} amount - Client-submitted amount (for validation)
     * @param {string} courseId - Course ID
     * @param {string} userId - User ID
     * @param {string} couponCode - Optional coupon code
     */
    async createOrder(amount, courseId, userId, couponCode = null) {
        try {
            // Get course details from trusted database
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
                .select('id')
                .eq('student_id', userId)
                .eq('course_id', courseId)
                .eq('status', 'active')
                .maybeSingle();

            if (existingEnrollment) {
                throw new AppError('Already enrolled in this course', 400);
            }

            // SERVER-SIDE PRICE & COUPON CALCULATION (SECURITY: Never trust client-supplied amount)
            const originalPrice = Number(course.price);
            let finalPayable = originalPrice;
            let validatedCoupon = null;
            let discountAmount = 0;

            if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
                validatedCoupon = await couponService.validateCoupon(couponCode.trim(), courseId, userId);
                discountAmount = couponService.calculateDiscount(validatedCoupon, originalPrice);
                finalPayable = Math.max(0, originalPrice - discountAmount);
            }

            // Verify client amount against server-side calculation to prevent price tampering
            if (amount !== undefined && amount !== null && Math.abs(Number(amount) - finalPayable) > 1.0) {
                console.warn(`Price tampering detected: user ${userId} submitted ₹${amount}, expected ₹${finalPayable} (Original: ₹${originalPrice}, Coupon: ${couponCode || 'None'})`);
                throw new AppError(`Price mismatch detected. Expected ₹${finalPayable}, received ₹${amount}. Please re-apply coupon and try again.`, 400);
            }

            // Handle 100% discount / free course directly without Razorpay
            if (finalPayable === 0) {
                const { data: freePayment, error: freePayError } = await supabase
                    .from('payments')
                    .insert({
                        student_id: userId,
                        course_id: courseId,
                        amount: 0,
                        currency: 'INR',
                        status: 'success',
                        payment_method: validatedCoupon ? 'coupon' : 'free',
                    })
                    .select()
                    .single();

                if (freePayError) {
                    throw new AppError('Failed to record free enrollment payment', 500);
                }

                if (validatedCoupon) {
                    await couponService.applyCoupon(validatedCoupon.id, userId, freePayment.id, discountAmount);
                }

                const validityDays = course?.validity_days || 365;
                const validUntil = new Date();
                validUntil.setDate(validUntil.getDate() + validityDays);

                const { data: enrollment, error: enrollError } = await supabase
                    .from('enrollments')
                    .insert({
                        student_id: userId,
                        course_id: courseId,
                        payment_type: 'online',
                        status: 'active',
                        valid_until: validUntil.toISOString(),
                    })
                    .select()
                    .single();

                if (enrollError) {
                    throw new AppError('Failed to activate course enrollment', 500);
                }

                return {
                    isFree: true,
                    enrollment,
                    message: 'Course enrolled successfully with 100% discount',
                };
            }

            // Create Razorpay order with server-calculated price
            const shortCourse = courseId.replace(/-/g, '').substring(0, 8);
            const shortUser = userId.replace(/-/g, '').substring(0, 8);
            const shortTs = Date.now().toString().slice(-8);
            const receipt = `c${shortCourse}u${shortUser}t${shortTs}`;

            const order = await this.razorpay.orders.create({
                amount: Math.round(finalPayable * 100), // Convert to paise
                currency: 'INR',
                receipt,
                notes: {
                    courseId,
                    userId,
                    courseName: course.title,
                    couponId: validatedCoupon ? validatedCoupon.id : '',
                    discountAmount: discountAmount.toString(),
                },
            });

            const { data: payment, error: paymentError } = await supabase
                .from('payments')
                .insert({
                    student_id: userId,
                    course_id: courseId,
                    razorpay_order_id: order.id,
                    amount: finalPayable,
                    currency: 'INR',
                    status: 'pending',
                    payment_method: 'online',
                })
                .select()
                .single();

            if (paymentError) {
                console.error('Payment insert error details:', JSON.stringify(paymentError));
                throw new AppError(`Failed to save payment record: ${paymentError.message}`, 500);
            }

            return {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                keyId: process.env.RAZORPAY_KEY_ID,
                courseName: course.title,
                paymentId: payment.id,
                isFree: false,
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
     * Complete payment and enroll student (single source of truth)
     * @param {object} paymentRecord - Existing record from supabase payments
     * @param {string} paymentId - Razorpay payment ID (optional)
     * @param {string} signature - Razorpay signature (optional)
     */
    async completePaymentAndEnroll(paymentRecord, paymentId = null, signature = null) {
        // 1. Idempotency: check if active enrollment already exists
        const { data: existingEnrollment } = await supabase
            .from('enrollments')
            .select('*')
            .eq('student_id', paymentRecord.student_id)
            .eq('course_id', paymentRecord.course_id)
            .eq('status', 'active')
            .maybeSingle();

        // 2. Update payment status to success
        const updateData = {
            status: 'success',
            updated_at: new Date().toISOString(),
        };
        if (paymentId) updateData.razorpay_payment_id = paymentId;
        if (signature) updateData.razorpay_signature = signature;

        await supabase
            .from('payments')
            .update(updateData)
            .eq('id', paymentRecord.id);

        if (existingEnrollment) {
            return {
                success: true,
                enrollment: existingEnrollment,
                message: 'Payment verified and student already enrolled',
            };
        }

        // 3. Get course validity
        const { data: course } = await supabase
            .from('courses')
            .select('validity_days, title')
            .eq('id', paymentRecord.course_id)
            .single();

        const validityDays = course?.validity_days || 365;
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + validityDays);

        // 4. Create new active enrollment
        const { data: enrollment, error: enrollError } = await supabase
            .from('enrollments')
            .insert({
                student_id: paymentRecord.student_id,
                course_id: paymentRecord.course_id,
                payment_type: 'online',
                status: 'active',
                valid_until: validUntil.toISOString(),
            })
            .select()
            .single();

        if (enrollError) {
            console.error('Enrollment insert failed in completePaymentAndEnroll:', enrollError);
            throw new AppError(`Failed to create enrollment: ${enrollError.message}`, 500);
        }

        // 5. Track coupon usage if a coupon was used for this order
        if (paymentRecord.razorpay_order_id) {
            try {
                const rzpOrder = await this.razorpay.orders.fetch(paymentRecord.razorpay_order_id);
                if (rzpOrder && rzpOrder.notes && rzpOrder.notes.couponId) {
                    const couponId = rzpOrder.notes.couponId;
                    const discountAmount = parseFloat(rzpOrder.notes.discountAmount) || 0;
                    const { data: existingUsage } = await supabase
                        .from('coupon_usage')
                        .select('id')
                        .eq('payment_id', paymentRecord.id)
                        .maybeSingle();

                    if (!existingUsage) {
                        await couponService.applyCoupon(couponId, paymentRecord.student_id, paymentRecord.id, discountAmount);
                    }
                }
            } catch (couponErr) {
                console.error('Failed to apply coupon usage on payment completion:', couponErr);
            }
        }

        console.log(`[PaymentService] Successfully auto-enrolled student ${paymentRecord.student_id} in course ${paymentRecord.course_id}`);
        return {
            success: true,
            enrollment,
            message: 'Payment verified and enrolled in course successfully',
        };
    }

    /**
     * Process successful payment
     * @param {string} orderId - Razorpay order ID
     * @param {string} paymentId - Razorpay payment ID
     * @param {string} signature - Razorpay signature
     */
    async processPayment(orderId, paymentId, signature) {
        try {
            if (!orderId && !paymentId) {
                console.error('processPayment: Missing orderId and paymentId');
                throw new AppError('orderId or paymentId is required to verify payment', 400);
            }

            // 1. Try local HMAC signature verification if all 3 fields are present
            let isValid = false;
            if (orderId && paymentId && signature) {
                isValid = this.verifyPayment(orderId, paymentId, signature);
            }

            // 2. Direct Razorpay API fallback: if signature failed, missing, or altered
            if (!isValid && (paymentId || orderId)) {
                try {
                    if (paymentId) {
                        const rzpPayment = await this.razorpay.payments.fetch(paymentId);
                        if (rzpPayment && (rzpPayment.status === 'captured' || rzpPayment.status === 'authorized')) {
                            isValid = true;
                            if (!orderId && rzpPayment.order_id) orderId = rzpPayment.order_id;
                        }
                    } else if (orderId) {
                        const rzpOrder = await this.razorpay.orders.fetch(orderId);
                        if (rzpOrder && (rzpOrder.status === 'paid' || rzpOrder.amount_paid > 0)) {
                            isValid = true;
                        }
                    }
                } catch (rzpErr) {
                    console.error('Direct Razorpay API verification check failed:', rzpErr.message);
                }
            }

            if (!isValid) {
                console.error('processPayment: Verification failed for', { orderId, paymentId, signaturePresent: !!signature });
                throw new AppError('Invalid payment verification: payment not confirmed by gateway', 400);
            }

            // 3. Locate the payment record in Supabase
            let query = supabase.from('payments').select('*');
            if (orderId) {
                query = query.eq('razorpay_order_id', orderId);
            } else {
                query = query.eq('razorpay_payment_id', paymentId);
            }

            const { data: payment, error: paymentError } = await query.maybeSingle();

            if (paymentError || !payment) {
                console.error('processPayment: Payment record not found for orderId:', orderId, paymentError);
                throw new AppError('Payment record not found', 404);
            }

            // 4. Complete enrollment
            return await this.completePaymentAndEnroll(payment, paymentId, signature);
        } catch (error) {
            console.error('Process Payment Error:', error);
            throw error instanceof AppError ? error : new AppError('Failed to process payment', 500);
        }
    }

    /**
     * Direct order verification and synchronization
     * Useful when mobile client reloads or misses the checkout callback
     * @param {string} orderId - Razorpay order ID
     * @param {string} userId - Current user ID (optional validation)
     */
    async verifyOrderDirect(orderId, userId = null) {
        try {
            if (!orderId) {
                throw new AppError('Order ID is required', 400);
            }

            const { data: paymentRecord, error: pErr } = await supabase
                .from('payments')
                .select('*')
                .eq('razorpay_order_id', orderId)
                .maybeSingle();

            if (pErr || !paymentRecord) {
                throw new AppError('Payment record not found', 404);
            }

            if (userId && paymentRecord.student_id !== userId) {
                throw new AppError('Unauthorized access to order', 403);
            }

            // If already marked success and enrolled, return early
            const { data: existingEnrollment } = await supabase
                .from('enrollments')
                .select('*')
                .eq('student_id', paymentRecord.student_id)
                .eq('course_id', paymentRecord.course_id)
                .eq('status', 'active')
                .maybeSingle();

            if (existingEnrollment && paymentRecord.status === 'success') {
                return {
                    success: true,
                    isPaid: true,
                    isEnrolled: true,
                    enrollment: existingEnrollment,
                    message: 'Already enrolled in course',
                };
            }

            // Check Razorpay API
            const rzpOrder = await this.razorpay.orders.fetch(orderId);
            if (rzpOrder.status === 'paid' || rzpOrder.amount_paid > 0) {
                let paymentId = paymentRecord.razorpay_payment_id;
                try {
                    const paymentsList = await this.razorpay.orders.fetchPayments(orderId);
                    const capturedPayment = paymentsList.items?.find(p => p.status === 'captured');
                    if (capturedPayment) {
                        paymentId = capturedPayment.id;
                    }
                } catch (e) {
                    // Ignore payment listing error
                }

                const result = await this.completePaymentAndEnroll(paymentRecord, paymentId);
                return {
                    success: true,
                    isPaid: true,
                    isEnrolled: true,
                    enrollment: result.enrollment,
                    message: result.message,
                };
            }

            return {
                success: true,
                isPaid: false,
                isEnrolled: !!existingEnrollment,
                orderStatus: rzpOrder.status,
            };
        } catch (error) {
            console.error('verifyOrderDirect error:', error);
            throw error instanceof AppError ? error : new AppError('Failed to verify order status', 500);
        }
    }

    /**
     * Auto-sync any recently created pending payments for a student
     * This acts as an automated self-healing safety net
     * @param {string} studentId - Student UUID
     * @param {string} courseId - Optional Course UUID filter
     */
    async autoSyncPendingPayments(studentId, courseId = null) {
        try {
            if (!studentId) return [];

            // Look back up to 48 hours for pending online orders
            const sinceDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
            let query = supabase
                .from('payments')
                .select('*')
                .eq('student_id', studentId)
                .eq('status', 'pending')
                .not('razorpay_order_id', 'is', null)
                .gte('created_at', sinceDate)
                .order('created_at', { ascending: false });

            if (courseId) {
                query = query.eq('course_id', courseId);
            }

            const { data: pendingPayments } = await query;
            if (!pendingPayments || pendingPayments.length === 0) {
                return [];
            }

            const syncedEnrollments = [];
            for (const payment of pendingPayments) {
                try {
                    const rzpOrder = await this.razorpay.orders.fetch(payment.razorpay_order_id);
                    if (rzpOrder && (rzpOrder.status === 'paid' || rzpOrder.amount_paid > 0)) {
                        let paymentId = payment.razorpay_payment_id;
                        try {
                            const paymentsList = await this.razorpay.orders.fetchPayments(payment.razorpay_order_id);
                            const captured = paymentsList.items?.find(p => p.status === 'captured');
                            if (captured) paymentId = captured.id;
                        } catch (pErr) {}

                        const result = await this.completePaymentAndEnroll(payment, paymentId);
                        if (result?.enrollment) {
                            syncedEnrollments.push(result.enrollment);
                        }
                    }
                } catch (err) {
                    console.warn(`[AutoSync] Could not check order ${payment.razorpay_order_id}:`, err.message);
                }
            }

            return syncedEnrollments;
        } catch (error) {
            console.error('[AutoSync] Error in autoSyncPendingPayments:', error);
            return [];
        }
    }

    /**
     * Handle Razorpay webhook
     * @param {object} event - Webhook event
     * @param {string} signature - Webhook signature
     */
    async handleWebhook(event, signature) {
        try {
            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
            if (!webhookSecret) {
                console.error('RAZORPAY_WEBHOOK_SECRET is not configured on server');
                throw new AppError('Webhook secret not configured', 500);
            }

            if (!signature) {
                console.error('Missing Razorpay webhook signature header');
                throw new AppError('Webhook signature header missing', 400);
            }

            const expectedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(typeof event === 'string' ? event : JSON.stringify(event))
                .digest('hex');

            if (expectedSignature !== signature) {
                console.error('Invalid webhook signature');
                throw new AppError('Invalid webhook signature', 400);
            }

            // Handle different event types
            switch (event.event) {
                case 'payment.captured':
                case 'order.paid': {
                    const paymentEntity = event.payload?.payment?.entity;
                    const orderEntity = event.payload?.order?.entity;
                    const orderId = paymentEntity?.order_id || orderEntity?.id;
                    const paymentId = paymentEntity?.id;
                    if (orderId) {
                        await this.handlePaymentCaptured({ order_id: orderId, id: paymentId });
                    }
                    break;
                }
                case 'payment.failed': {
                    const paymentEntity = event.payload?.payment?.entity;
                    if (paymentEntity) {
                        await this.handlePaymentFailed(paymentEntity);
                    }
                    break;
                }
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
        const orderId = payment.order_id;
        if (!orderId) {
            console.warn('handlePaymentCaptured: No order_id present');
            return;
        }

        const { data: paymentRecord } = await supabase
            .from('payments')
            .select('*')
            .eq('razorpay_order_id', orderId)
            .maybeSingle();

        if (paymentRecord && paymentRecord.status !== 'success') {
            await this.completePaymentAndEnroll(paymentRecord, payment.id, null);
        }
    }

    /**
     * Handle payment failed event
     */
    async handlePaymentFailed(payment) {
        const orderId = payment.order_id;
        if (!orderId) return;

        await supabase
            .from('payments')
            .update({
                razorpay_payment_id: payment.id,
                status: 'failed',
                error_description: payment.error_description || 'Payment failed',
            })
            .eq('razorpay_order_id', orderId);
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
                    email,
                    phone
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
        } else if (filters.startDate && filters.endDate) {
            // Custom date range
            const start = new Date(filters.startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(filters.endDate);
            end.setHours(23, 59, 59, 999);
            query = query.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
        } else if (filters.startDate) {
            const start = new Date(filters.startDate);
            start.setHours(0, 0, 0, 0);
            query = query.gte('created_at', start.toISOString());
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

        // Calculate summary for filtered results
        let filteredRevenue = 0;
        let filteredCount = 0;
        payments?.forEach(p => {
            if (p.status === 'success') {
                filteredRevenue += parseFloat(p.amount) || 0;
                filteredCount++;
            }
        });

        return {
            payments,
            summary: {
                totalAmount: filteredRevenue,
                successCount: filteredCount,
                totalCount: count
            },
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
            // Check if student is already enrolled in this course
            const { data: existingEnrollment } = await supabase
                .from('enrollments')
                .select('id')
                .eq('student_id', studentId)
                .eq('course_id', courseId)
                .eq('status', 'active')
                .maybeSingle();

            if (existingEnrollment) {
                throw new AppError('Student is already enrolled in this course', 400);
            }

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
                })
                .select()
                .single();

            if (paymentError) {
                console.error('Offline payment insert error:', JSON.stringify(paymentError));
                throw new AppError(`Failed to create offline payment record: ${paymentError.message}`, 500);
            }

            // Create enrollment record
            const { data: enrollment, error: enrollError } = await supabase
                .from('enrollments')
                .insert({
                    student_id: studentId,
                    course_id: courseId,
                    payment_type: 'offline',
                    status: 'active',
                    valid_until: validUntil.toISOString(),
                })
                .select()
                .single();

            if (enrollError) {
                console.error('Offline enrollment insert error:', JSON.stringify(enrollError));
                throw new AppError(`Failed to create enrollment: ${enrollError.message}`, 500);
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
