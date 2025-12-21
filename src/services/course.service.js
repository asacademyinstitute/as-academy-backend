import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import auditService from './audit.service.js';

class CourseService {
    // Get all courses with filters
    async getCourses(filters = {}, page = 1, limit = 20) {
        let query = supabase
            .from('courses')
            .select(`
        *,
        users:teacher_id (
          id,
          name,
          email
        )
      `, { count: 'exact' })
            .order('created_at', { ascending: false });

        // Apply filters
        if (filters.status) {
            query = query.eq('status', filters.status);
        }

        if (filters.teacherId) {
            query = query.eq('teacher_id', filters.teacherId);
        }

        if (filters.search) {
            query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
        }

        // Pagination
        const offset = (page - 1) * limit;
        query = query.range(offset, offset + limit - 1);

        const { data: courses, error, count } = await query;

        if (error) {
            throw new AppError('Failed to fetch courses', 500);
        }

        return {
            courses,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit)
            }
        };
    }

    // Get course by ID
    async getCourseById(courseId, userId = null) {
        const { data: course, error } = await supabase
            .from('courses')
            .select(`
        *,
        users:teacher_id (
          id,
          name,
          email
        )
      `)
            .eq('id', courseId)
            .single();

        if (error || !course) {
            throw new AppError('Course not found', 404);
        }

        // Get chapters and lectures
        const { data: chapters } = await supabase
            .from('chapters')
            .select(`
        *,
        lectures (
          id,
          title,
          type,
          duration,
          lecture_order
        )
      `)
            .eq('course_id', courseId)
            .order('chapter_order', { ascending: true });

        course.chapters = chapters || [];

        // If user is provided, check enrollment status
        if (userId) {
            const { data: enrollment } = await supabase
                .from('enrollments')
                .select('*')
                .eq('student_id', userId)
                .eq('course_id', courseId)
                .single();

            course.isEnrolled = !!enrollment;
            course.enrollment = enrollment;
        }

        return course;
    }

    // Create course
    async createCourse(courseData, userId) {
        const { title, description, price, validity_days, teacher_id, thumbnail_url } = courseData;

        const { data: course, error } = await supabase
            .from('courses')
            .insert({
                title,
                description,
                price,
                validity_days,
                teacher_id,
                thumbnail_url,
                status: 'active'
            })
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to create course', 500);
        }

        // Log action
        await auditService.log(
            userId,
            'COURSE_CREATED',
            `Created course: ${title}`
        );

        return course;
    }

    // Update course
    async updateCourse(courseId, updateData, userId) {
        const allowedFields = ['title', 'description', 'price', 'validity_days', 'teacher_id', 'thumbnail_url', 'status', 'live_class_link', 'live_class_scheduled_at', 'live_class_title'];
        const updates = {};

        for (const field of allowedFields) {
            if (updateData[field] !== undefined) {
                updates[field] = updateData[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            throw new AppError('No valid fields to update', 400);
        }

        const { data: course, error } = await supabase
            .from('courses')
            .update(updates)
            .eq('id', courseId)
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to update course', 500);
        }

        // Log action
        await auditService.log(
            userId,
            'COURSE_UPDATED',
            `Updated course: ${course.title}`
        );

        return course;
    }

    // Delete course
    async deleteCourse(courseId, userId) {
        const { error } = await supabase
            .from('courses')
            .delete()
            .eq('id', courseId);

        if (error) {
            throw new AppError('Failed to delete course', 500);
        }

        // Log action
        await auditService.log(
            userId,
            'COURSE_DELETED',
            `Deleted course with ID: ${courseId}`
        );

        return { success: true, message: 'Course deleted successfully' };
    }

    // Get course statistics
    async getCourseStats(courseId) {
        // Get enrolled students count
        const { count: studentsCount } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', courseId)
            .eq('status', 'active');

        // Get total revenue
        const { data: payments } = await supabase
            .from('payments')
            .select('amount')
            .eq('course_id', courseId)
            .eq('status', 'success');

        const totalRevenue = payments?.reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

        // Get chapters and lectures count
        const { count: chaptersCount } = await supabase
            .from('chapters')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', courseId);

        const { data: chapters } = await supabase
            .from('chapters')
            .select('id')
            .eq('course_id', courseId);

        let lecturesCount = 0;
        if (chapters && chapters.length > 0) {
            const chapterIds = chapters.map(c => c.id);
            const { count } = await supabase
                .from('lectures')
                .select('*', { count: 'exact', head: true })
                .in('chapter_id', chapterIds);
            lecturesCount = count || 0;
        }

        return {
            enrolledStudents: studentsCount || 0,
            totalRevenue,
            chapters: chaptersCount || 0,
            lectures: lecturesCount
        };
    }

    // Get courses by teacher
    async getCoursesByTeacher(teacherId) {
        const { data: courses, error } = await supabase
            .from('courses')
            .select('*')
            .eq('teacher_id', teacherId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch teacher courses', 500);
        }

        return courses;
    }
}

export default new CourseService();
