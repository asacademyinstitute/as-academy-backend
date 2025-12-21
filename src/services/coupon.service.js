import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';

class CouponService {
    // Create new coupon
    async createCoupon(data, adminId) {
        const { code, discount_type, discount_value, applicable_to, course_ids, expiry_date, usage_limit } = data;

        // Validate discount value
        if (discount_type === 'percentage' && (discount_value < 0 || discount_value > 100)) {
            throw new AppError('Percentage discount must be between 0 and 100', 400);
        }

        const couponData = {
            code: code.toUpperCase().trim(),
            discount_type,
            discount_value,
            applicable_to: applicable_to || 'all',
            course_ids: applicable_to === 'specific' ? course_ids : [],
            expiry_date: expiry_date || null,
            usage_limit: usage_limit || null,
            created_by: adminId,
        };

        const { data: coupon, error } = await supabase
            .from('coupons')
            .insert(couponData)
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                throw new AppError('Coupon code already exists', 400);
            }
            throw new AppError('Failed to create coupon', 500);
        }

        return coupon;
    }

    // Get all coupons with filters
    async getAllCoupons(filters = {}, page = 1, limit = 50) {
        let query = supabase
            .from('coupons')
            .select('*, users:created_by(name, email)', { count: 'exact' })
            .order('created_at', { ascending: false });

        // Apply filters
        if (filters.is_active !== undefined) {
            query = query.eq('is_active', filters.is_active);
        }

        if (filters.search) {
            query = query.ilike('code', `%${filters.search}%`);
        }

        // Pagination
        const offset = (page - 1) * limit;
        query = query.range(offset, offset + limit - 1);

        const { data: coupons, error, count } = await query;

        if (error) {
            throw new AppError('Failed to fetch coupons', 500);
        }

        return {
            coupons,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    // Get single coupon
    async getCouponById(id) {
        const { data: coupon, error } = await supabase
            .from('coupons')
            .select('*, users:created_by(name, email)')
            .eq('id', id)
            .single();

        if (error || !coupon) {
            throw new AppError('Coupon not found', 404);
        }

        return coupon;
    }

    // Update coupon
    async updateCoupon(id, data) {
        const updateData = { ...data };

        if (updateData.code) {
            updateData.code = updateData.code.toUpperCase().trim();
        }

        if (updateData.discount_type === 'percentage' && updateData.discount_value) {
            if (updateData.discount_value < 0 || updateData.discount_value > 100) {
                throw new AppError('Percentage discount must be between 0 and 100', 400);
            }
        }

        const { data: coupon, error } = await supabase
            .from('coupons')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                throw new AppError('Coupon code already exists', 400);
            }
            throw new AppError('Failed to update coupon', 500);
        }

        return coupon;
    }

    // Toggle coupon active status
    async toggleCoupon(id) {
        const coupon = await this.getCouponById(id);

        const { data: updated, error } = await supabase
            .from('coupons')
            .update({ is_active: !coupon.is_active })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to toggle coupon status', 500);
        }

        return updated;
    }

    // Delete coupon
    async deleteCoupon(id) {
        const { error } = await supabase
            .from('coupons')
            .delete()
            .eq('id', id);

        if (error) {
            throw new AppError('Failed to delete coupon', 500);
        }

        return { message: 'Coupon deleted successfully' };
    }

    // Validate coupon (CRITICAL - server-side only)
    async validateCoupon(code, courseId, userId) {
        const { data: coupon, error } = await supabase
            .from('coupons')
            .select('*')
            .eq('code', code.toUpperCase().trim())
            .single();

        if (error || !coupon) {
            throw new AppError('Invalid coupon code', 400);
        }

        // Check if active
        if (!coupon.is_active) {
            throw new AppError('This coupon is no longer active', 400);
        }

        // Check expiry
        if (coupon.expiry_date && new Date(coupon.expiry_date) < new Date()) {
            throw new AppError('This coupon has expired', 400);
        }

        // Check usage limit
        if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
            throw new AppError('This coupon has reached its usage limit', 400);
        }

        // Check if applicable to course
        if (coupon.applicable_to === 'specific' && !coupon.course_ids.includes(courseId)) {
            throw new AppError('This coupon is not applicable to this course', 400);
        }

        // Check if user already used this coupon
        const { data: previousUsage } = await supabase
            .from('coupon_usage')
            .select('id')
            .eq('coupon_id', coupon.id)
            .eq('user_id', userId)
            .single();

        if (previousUsage) {
            throw new AppError('You have already used this coupon', 400);
        }

        return coupon;
    }

    // Calculate discount amount
    calculateDiscount(coupon, originalAmount) {
        if (coupon.discount_type === 'percentage') {
            return Math.round((originalAmount * coupon.discount_value) / 100);
        } else {
            return Math.min(coupon.discount_value, originalAmount);
        }
    }

    // Apply coupon and record usage
    async applyCoupon(couponId, userId, paymentId, discountAmount) {
        // Record usage
        const { error: usageError } = await supabase
            .from('coupon_usage')
            .insert({
                coupon_id: couponId,
                user_id: userId,
                payment_id: paymentId,
                discount_amount: discountAmount,
            });

        if (usageError) {
            console.error('Failed to record coupon usage:', usageError);
        }

        // Increment usage count
        const { error: updateError } = await supabase.rpc('increment_coupon_usage', {
            coupon_id: couponId,
        });

        if (updateError) {
            console.error('Failed to increment coupon usage:', updateError);
        }
    }

    // Get usage statistics
    async getUsageStats(couponId) {
        const { data: usage, error } = await supabase
            .from('coupon_usage')
            .select('*, users:user_id(name, email), payments:payment_id(amount)')
            .eq('coupon_id', couponId)
            .order('used_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch usage statistics', 500);
        }

        const totalDiscount = usage.reduce((sum, u) => sum + parseFloat(u.discount_amount), 0);

        return {
            usage_count: usage.length,
            total_discount: totalDiscount,
            usage_details: usage,
        };
    }
}

export default new CouponService();
