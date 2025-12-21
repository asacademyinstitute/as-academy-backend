import { Router } from 'express';
import couponService from '../services/coupon.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin } from '../middlewares/rbac.middleware.js';
import supabase from '../config/database.js';

const router = Router();

// Create coupon (admin only)
router.post('/', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const coupon = await couponService.createCoupon(req.body, req.user.id);

    res.status(201).json({
        success: true,
        data: coupon,
        message: 'Coupon created successfully',
    });
}));

// Get all coupons (admin only)
router.get('/', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { is_active, search, page = 1, limit = 50 } = req.query;

    const result = await couponService.getAllCoupons(
        { is_active: is_active === 'true' ? true : is_active === 'false' ? false : undefined, search },
        parseInt(page),
        parseInt(limit)
    );

    res.json({
        success: true,
        data: result,
    });
}));

// Get single coupon (admin only)
router.get('/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const coupon = await couponService.getCouponById(req.params.id);

    res.json({
        success: true,
        data: coupon,
    });
}));

// Update coupon (admin only)
router.put('/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const coupon = await couponService.updateCoupon(req.params.id, req.body);

    res.json({
        success: true,
        data: coupon,
        message: 'Coupon updated successfully',
    });
}));

// Toggle coupon status (admin only)
router.patch('/:id/toggle', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const coupon = await couponService.toggleCoupon(req.params.id);

    res.json({
        success: true,
        data: coupon,
        message: `Coupon ${coupon.is_active ? 'enabled' : 'disabled'} successfully`,
    });
}));

// Delete coupon (admin only)
router.delete('/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    await couponService.deleteCoupon(req.params.id);

    res.json({
        success: true,
        message: 'Coupon deleted successfully',
    });
}));

// Validate coupon (student)
router.post('/validate', authenticate, asyncHandler(async (req, res) => {
    const { code, courseId } = req.body;

    if (!code || !courseId) {
        return res.status(400).json({
            success: false,
            message: 'Coupon code and course ID are required',
        });
    }

    const coupon = await couponService.validateCoupon(code, courseId, req.user.id);

    // Get course price to calculate discount
    const { data: course } = await supabase
        .from('courses')
        .select('price')
        .eq('id', courseId)
        .single();

    const discountAmount = couponService.calculateDiscount(coupon, course.price);
    const finalAmount = course.price - discountAmount;

    res.json({
        success: true,
        data: {
            coupon_id: coupon.id,
            code: coupon.code,
            discount_type: coupon.discount_type,
            discount_value: coupon.discount_value,
            original_amount: course.price,
            discount_amount: discountAmount,
            final_amount: finalAmount,
        },
        message: 'Coupon applied successfully',
    });
}));

// Get usage statistics (admin only)
router.get('/:id/stats', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const stats = await couponService.getUsageStats(req.params.id);

    res.json({
        success: true,
        data: stats,
    });
}));

export default router;
