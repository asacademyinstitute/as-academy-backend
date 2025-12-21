import { Router } from 'express';
import courseRequestService from '../services/courseRequest.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin } from '../middlewares/rbac.middleware.js';

const router = Router();

// Create course request (teacher only)
router.post('/', authenticate, asyncHandler(async (req, res) => {
    console.log('🎯 [ROUTE] POST /course-requests hit');
    console.log('👤 [ROUTE] User:', { id: req.user.id, role: req.user.role, name: req.user.name });
    console.log('📦 [ROUTE] Request body:', req.body);

    // Only teachers can create course requests
    if (req.user.role !== 'teacher') {
        console.log('❌ [ROUTE] Access denied - not a teacher');
        return res.status(403).json({
            success: false,
            message: 'Only teachers can create course requests'
        });
    }

    console.log('✅ [ROUTE] Teacher role verified, creating request...');
    const request = await courseRequestService.createRequest(req.user.id, req.body);
    console.log('✅ [ROUTE] Request created successfully:', { id: request.id, title: request.title });

    res.status(201).json({
        success: true,
        message: 'Course request created successfully',
        data: request
    });
}));

// Get all course requests (admin only)
router.get('/', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { status, teacherId } = req.query;

    const requests = await courseRequestService.getAllRequests({ status, teacherId });

    res.json({
        success: true,
        data: requests
    });
}));

// Get teacher's own requests (teacher only)
router.get('/my', authenticate, asyncHandler(async (req, res) => {
    if (req.user.role !== 'teacher') {
        return res.status(403).json({
            success: false,
            message: 'Only teachers can view their course requests'
        });
    }

    const requests = await courseRequestService.getMyRequests(req.user.id);

    res.json({
        success: true,
        data: requests
    });
}));

// Approve course request (admin only)
router.put('/:id/approve', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const result = await courseRequestService.approveRequest(req.params.id, req.user.id);

    res.json({
        success: true,
        message: result.message,
        data: {
            course: result.course,
            request: result.request
        }
    });
}));

// Reject course request (admin only)
router.put('/:id/reject', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { adminNotes } = req.body;

    const result = await courseRequestService.rejectRequest(
        req.params.id,
        req.user.id,
        adminNotes
    );

    res.json({
        success: true,
        message: result.message,
        data: result.request
    });
}));

// Update course request (admin only)
router.put('/:id', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const request = await courseRequestService.updateRequest(
        req.params.id,
        req.body,
        req.user.id
    );

    res.json({
        success: true,
        message: 'Course request updated successfully',
        data: request
    });
}));

// Delete course request (admin or teacher who created it)
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
    const result = await courseRequestService.deleteRequest(req.params.id, req.user.id);

    res.json({
        success: true,
        message: result.message
    });
}));

export default router;
