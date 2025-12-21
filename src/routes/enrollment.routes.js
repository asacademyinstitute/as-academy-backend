import { Router } from 'express';
import enrollmentService from '../services/enrollment.service.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { isAdmin, isTeacherOrAdmin, isStudent } from '../middlewares/rbac.middleware.js';

const router = Router();

// Get student enrollments
router.get('/student/:studentId', authenticate, asyncHandler(async (req, res) => {
    const enrollments = await enrollmentService.getStudentEnrollments(req.params.studentId);

    res.json({
        success: true,
        data: enrollments
    });
}));

// Get course enrollments (teacher/admin)
router.get('/course/:courseId', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const enrollments = await enrollmentService.getCourseEnrollments(req.params.courseId);

    res.json({
        success: true,
        data: enrollments
    });
}));

// Check access
router.get('/check/:courseId', authenticate, isStudent, asyncHandler(async (req, res) => {
    const access = await enrollmentService.checkAccess(req.user.id, req.params.courseId);

    res.json({
        success: true,
        data: access
    });
}));

// Admin enroll student (admin only)
router.post('/admin-enroll', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { student_id, course_id, validity_days } = req.body;

    // Validate required fields
    if (!student_id || !course_id || !validity_days) {
        return res.status(400).json({
            success: false,
            message: 'student_id, course_id, and validity_days are required'
        });
    }

    // Validate validity_days
    if (validity_days < 1) {
        return res.status(400).json({
            success: false,
            message: 'validity_days must be at least 1'
        });
    }

    const enrollment = await enrollmentService.adminEnrollStudent(
        student_id,
        course_id,
        parseInt(validity_days),
        req.user.id
    );

    res.status(201).json({
        success: true,
        message: 'Student enrolled successfully',
        data: enrollment
    });
}));

// Extend enrollment (admin only)
router.post('/:enrollmentId/extend', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { additionalDays } = req.body;

    const enrollment = await enrollmentService.extendEnrollment(
        req.params.enrollmentId,
        additionalDays,
        req.user.id
    );

    res.json({
        success: true,
        message: 'Enrollment extended successfully',
        data: enrollment
    });
}));

// Cancel enrollment (teacher/admin)
router.post('/:enrollmentId/cancel', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const enrollment = await enrollmentService.cancelEnrollment(req.params.enrollmentId, req.user.id);

    res.json({
        success: true,
        message: 'Enrollment cancelled successfully',
        data: enrollment
    });
}));

// Delete enrollment (teacher/admin) - Permanently remove
router.delete('/:enrollmentId', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    await enrollmentService.deleteEnrollment(req.params.enrollmentId, req.user.id);

    res.json({
        success: true,
        message: 'Enrollment removed successfully'
    });
}));

// Unblock enrollment (teacher/admin) - Reactivate cancelled enrollment
router.post('/:enrollmentId/unblock', authenticate, isTeacherOrAdmin, asyncHandler(async (req, res) => {
    const enrollment = await enrollmentService.unblockEnrollment(req.params.enrollmentId, req.user.id);

    res.json({
        success: true,
        message: 'Enrollment unblocked successfully',
        data: enrollment
    });
}));

// Bulk remove students (admin only)
router.post('/course/:courseId/bulk-remove', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { studentIds } = req.body;

    const result = await enrollmentService.bulkRemoveStudents(req.params.courseId, studentIds, req.user.id);

    res.json({
        success: true,
        message: result.message
    });
}));

// Get course progress (student)
router.get('/course/:courseId/progress', authenticate, isStudent, asyncHandler(async (req, res) => {
    const progress = await enrollmentService.getCourseProgress(req.user.id, req.params.courseId);

    res.json({
        success: true,
        data: progress
    });
}));

export default router;
