import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import auditService from './audit.service.js';

class EnrollmentService {
    // Enroll student in course
    async enrollStudent(studentId, courseId, paymentType = 'online') {
        // Check if already enrolled
        const { data: existing } = await supabase
            .from('enrollments')
            .select('*')
            .eq('student_id', studentId)
            .eq('course_id', courseId)
            .single();

        if (existing) {
            throw new AppError('Student is already enrolled in this course', 400);
        }

        // Get course details
        const { data: course } = await supabase
            .from('courses')
            .select('validity_days')
            .eq('id', courseId)
            .single();

        if (!course) {
            throw new AppError('Course not found', 404);
        }

        // Calculate valid_until date
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + course.validity_days);

        // Create enrollment
        const { data: enrollment, error } = await supabase
            .from('enrollments')
            .insert({
                student_id: studentId,
                course_id: courseId,
                valid_until: validUntil.toISOString(),
                payment_type: paymentType,
                status: 'active'
            })
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to enroll student', 500);
        }

        // Log action
        await auditService.log(
            studentId,
            'STUDENT_ENROLLED',
            `Enrolled in course: ${courseId}`,
            { courseId, paymentType }
        );

        return enrollment;
    }

    // Admin enroll student (admin only)
    async adminEnrollStudent(studentId, courseId, validityDays, adminId) {
        // Check if already enrolled
        const { data: existing } = await supabase
            .from('enrollments')
            .select('*')
            .eq('student_id', studentId)
            .eq('course_id', courseId)
            .single();

        if (existing) {
            throw new AppError('Student is already enrolled in this course', 400);
        }

        // Verify student exists
        const { data: student } = await supabase
            .from('users')
            .select('id, name, email')
            .eq('id', studentId)
            .eq('role', 'student')
            .single();

        if (!student) {
            throw new AppError('Student not found', 404);
        }

        // Verify course exists
        const { data: course } = await supabase
            .from('courses')
            .select('id, title')
            .eq('id', courseId)
            .single();

        if (!course) {
            throw new AppError('Course not found', 404);
        }

        // Calculate valid_until date
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + validityDays);

        // Create enrollment
        const { data: enrollment, error } = await supabase
            .from('enrollments')
            .insert({
                student_id: studentId,
                course_id: courseId,
                valid_until: validUntil.toISOString(),
                payment_type: 'offline',
                status: 'active'
            })
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to enroll student', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'ADMIN_STUDENT_ENROLLED',
            `Admin enrolled ${student.name} in course: ${course.title}`,
            { studentId, courseId, validityDays, paymentType: 'offline' }
        );

        return enrollment;
    }

    // Get student enrollments
    async getStudentEnrollments(studentId) {
        const { data: enrollments, error } = await supabase
            .from('enrollments')
            .select(`
        *,
        courses:course_id (
          id,
          title,
          description,
          thumbnail_url,
          live_class_link,
          live_class_title,
          live_class_scheduled_at,
          users:teacher_id (
            name
          )
        )
      `)
            .eq('student_id', studentId)
            .order('enrolled_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch enrollments', 500);
        }

        // Check and update expired enrollments
        for (const enrollment of enrollments) {
            if (new Date(enrollment.valid_until) < new Date() && enrollment.status === 'active') {
                await supabase
                    .from('enrollments')
                    .update({ status: 'expired' })
                    .eq('id', enrollment.id);
                enrollment.status = 'expired';
            }
        }

        return enrollments;
    }

    // Get course enrollments (for teacher/admin)
    async getCourseEnrollments(courseId) {
        const { data: enrollments, error } = await supabase
            .from('enrollments')
            .select(`
        *,
        users:student_id (
          id,
          name,
          email,
          phone
        )
      `)
            .eq('course_id', courseId)
            .order('enrolled_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch course enrollments', 500);
        }

        return enrollments;
    }

    // Check if student has access to course
    async checkAccess(studentId, courseId) {
        const { data: enrollment, error } = await supabase
            .from('enrollments')
            .select('*')
            .eq('student_id', studentId)
            .eq('course_id', courseId)
            .eq('status', 'active')
            .single();

        if (error || !enrollment) {
            return { hasAccess: false, reason: 'Not enrolled' };
        }

        // Check validity
        if (new Date(enrollment.valid_until) < new Date()) {
            // Update status to expired
            await supabase
                .from('enrollments')
                .update({ status: 'expired' })
                .eq('id', enrollment.id);

            return { hasAccess: false, reason: 'Enrollment expired' };
        }

        return { hasAccess: true, enrollment };
    }

    // Extend enrollment validity (admin only)
    async extendEnrollment(enrollmentId, additionalDays, adminId) {
        const { data: enrollment } = await supabase
            .from('enrollments')
            .select('*, courses:course_id(title)')
            .eq('id', enrollmentId)
            .single();

        if (!enrollment) {
            throw new AppError('Enrollment not found', 404);
        }

        const newValidUntil = new Date(enrollment.valid_until);
        newValidUntil.setDate(newValidUntil.getDate() + additionalDays);

        const { data: updated, error } = await supabase
            .from('enrollments')
            .update({
                valid_until: newValidUntil.toISOString(),
                status: 'active'
            })
            .eq('id', enrollmentId)
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to extend enrollment', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'ENROLLMENT_EXTENDED',
            `Extended enrollment by ${additionalDays} days for course: ${enrollment.courses.title}`,
            { enrollmentId, additionalDays }
        );

        return updated;
    }

    // Cancel enrollment (admin only)
    async cancelEnrollment(enrollmentId, adminId) {
        const { data: updated, error } = await supabase
            .from('enrollments')
            .update({ status: 'cancelled' })
            .eq('id', enrollmentId)
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to cancel enrollment', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'ENROLLMENT_CANCELLED',
            `Cancelled enrollment ID: ${enrollmentId}`
        );

        return updated;
    }

    // Delete enrollment (admin only) - Permanently remove
    async deleteEnrollment(enrollmentId, adminId) {
        // Get enrollment details before deleting for audit log
        const { data: enrollment } = await supabase
            .from('enrollments')
            .select('*, courses:course_id(title), users:student_id(name)')
            .eq('id', enrollmentId)
            .single();

        const { error } = await supabase
            .from('enrollments')
            .delete()
            .eq('id', enrollmentId);

        if (error) {
            throw new AppError('Failed to delete enrollment', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'ENROLLMENT_DELETED',
            `Deleted enrollment: ${enrollment?.users?.name} from ${enrollment?.courses?.title}`,
            { enrollmentId }
        );

        return { success: true, message: 'Enrollment deleted successfully' };
    }

    // Unblock enrollment (admin only) - Reactivate cancelled enrollment
    async unblockEnrollment(enrollmentId, adminId) {
        const { data: updated, error } = await supabase
            .from('enrollments')
            .update({ status: 'active' })
            .eq('id', enrollmentId)
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to unblock enrollment', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'ENROLLMENT_UNBLOCKED',
            `Unblocked enrollment ID: ${enrollmentId}`
        );

        return updated;
    }

    // Bulk remove students from course (admin only)
    async bulkRemoveStudents(courseId, studentIds, adminId) {
        const { error } = await supabase
            .from('enrollments')
            .delete()
            .eq('course_id', courseId)
            .in('student_id', studentIds);

        if (error) {
            throw new AppError('Failed to remove students', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'BULK_STUDENTS_REMOVED',
            `Removed ${studentIds.length} students from course: ${courseId}`
        );

        return { success: true, message: `${studentIds.length} students removed successfully` };
    }

    // Get course progress for student
    async getCourseProgress(studentId, courseId) {
        // Get all lectures in the course
        const { data: chapters } = await supabase
            .from('chapters')
            .select('id')
            .eq('course_id', courseId);

        if (!chapters || chapters.length === 0) {
            return { totalLectures: 0, completedLectures: 0, progressPercentage: 0 };
        }

        const chapterIds = chapters.map(c => c.id);

        const { data: lectures } = await supabase
            .from('lectures')
            .select('id')
            .in('chapter_id', chapterIds);

        const totalLectures = lectures?.length || 0;

        if (totalLectures === 0) {
            return { totalLectures: 0, completedLectures: 0, progressPercentage: 0 };
        }

        // Get completed lectures
        const lectureIds = lectures.map(l => l.id);

        const { data: progress } = await supabase
            .from('lecture_progress')
            .select('lecture_id')
            .eq('student_id', studentId)
            .in('lecture_id', lectureIds)
            .eq('completed', true);

        const completedLectures = progress?.length || 0;
        const progressPercentage = Math.round((completedLectures / totalLectures) * 100);

        return {
            totalLectures,
            completedLectures,
            progressPercentage
        };
    }
}

export default new EnrollmentService();
