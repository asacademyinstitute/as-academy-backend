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
        const { title, description, price, validity_days, teacher_id, thumbnail_url, category, semester, level } = courseData;

        const { data: course, error } = await supabase
            .from('courses')
            .insert({
                title,
                description,
                price,
                validity_days,
                teacher_id,
                thumbnail_url,
                category,
                semester,
                level: level || 'beginner',
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
        const allowedFields = ['title', 'description', 'price', 'validity_days', 'teacher_id', 'thumbnail_url', 'status', 'live_class_link', 'live_class_scheduled_at', 'live_class_title', 'category', 'semester', 'level'];
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

    // Delete course (with cascade delete of chapters, lectures, enrollments, and B2 files)
    async deleteCourse(courseId, userId) {
        try {
            // Step 1: Delete all enrollments for this course
            const { error: enrollmentError } = await supabase
                .from('enrollments')
                .delete()
                .eq('course_id', courseId);

            if (enrollmentError) {
                console.error('Error deleting enrollments:', enrollmentError);
            }

            // Step 2: Get all chapters for this course
            const { data: chapters } = await supabase
                .from('chapters')
                .select('id')
                .eq('course_id', courseId);

            // Step 3: Get all lectures and delete their files from B2
            if (chapters && chapters.length > 0) {
                const chapterIds = chapters.map(ch => ch.id);

                // Get all lectures with file_url
                const { data: lectures } = await supabase
                    .from('lectures')
                    .select('id, file_url')
                    .in('chapter_id', chapterIds);

                // Delete files from B2 storage
                if (lectures && lectures.length > 0) {
                    console.log(`🗑️ Deleting ${lectures.length} lecture files from B2 storage...`);
                    const streamingService = (await import('./streaming.service.js')).default;

                    for (const lecture of lectures) {
                        if (lecture.file_url) {
                            await streamingService.deleteFile(lecture.file_url);
                        }
                    }
                }

                // Delete lectures from database
                const { error: lectureError } = await supabase
                    .from('lectures')
                    .delete()
                    .in('chapter_id', chapterIds);

                if (lectureError) {
                    console.error('Error deleting lectures:', lectureError);
                }
            }

            // Step 4: Delete all chapters
            const { error: chapterError } = await supabase
                .from('chapters')
                .delete()
                .eq('course_id', courseId);

            if (chapterError) {
                console.error('Error deleting chapters:', chapterError);
            }

            // Step 5: Finally delete the course
            const { error: courseError } = await supabase
                .from('courses')
                .delete()
                .eq('id', courseId);

            if (courseError) {
                console.error('Delete course error:', courseError);
                throw new AppError(`Failed to delete course: ${courseError.message}`, 500);
            }

            // Log action
            await auditService.log(
                userId,
                'COURSE_DELETED',
                `Deleted course with ID: ${courseId} (including all chapters, lectures, enrollments, and B2 files)`
            );

            return { success: true, message: 'Course and all related data (including B2 files) deleted successfully' };
        } catch (error) {
            console.error('Delete course error:', error);
            throw error;
        }
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

    // Transfer/Copy all course contents (chapters and lectures) from one course to another
    async transferCourseContent(sourceCourseId, targetCourseId, userId) {
        if (sourceCourseId === targetCourseId) {
            throw new AppError('Source and target courses cannot be the same', 400);
        }

        // Verify target course exists
        const { data: targetCourse, error: targetError } = await supabase
            .from('courses')
            .select('id, title')
            .eq('id', targetCourseId)
            .single();

        if (targetError || !targetCourse) {
            throw new AppError('Target course not found', 404);
        }

        // Get all chapters and lectures of source course
        const { data: chapters, error: chaptersError } = await supabase
            .from('chapters')
            .select(`
                *,
                lectures (*)
            `)
            .eq('course_id', sourceCourseId)
            .order('chapter_order', { ascending: true });

        if (chaptersError) {
            throw new AppError('Failed to fetch source course chapters', 500);
        }

        if (!chapters || chapters.length === 0) {
            return {
                success: true,
                message: 'Source course has no chapters to transfer',
                copied_chapters: 0,
                copied_lectures: 0
            };
        }

        // Get max chapter_order of target course
        const { data: existingChapters } = await supabase
            .from('chapters')
            .select('chapter_order')
            .eq('course_id', targetCourseId)
            .order('chapter_order', { ascending: false })
            .limit(1);

        let baseOrder = 0;
        if (existingChapters && existingChapters.length > 0) {
            baseOrder = existingChapters[0].chapter_order;
        }

        let copiedChaptersCount = 0;
        let copiedLecturesCount = 0;

        // Loop through each chapter and copy it
        for (const chapter of chapters) {
            const newChapterOrder = baseOrder + chapter.chapter_order;

            const { data: newChapter, error: newChapterError } = await supabase
                .from('chapters')
                .insert({
                    course_id: targetCourseId,
                    title: chapter.title,
                    chapter_order: newChapterOrder
                })
                .select()
                .single();

            if (newChapterError) {
                console.error(`Failed to copy chapter "${chapter.title}":`, newChapterError);
                throw new AppError(`Failed to transfer chapter: ${newChapterError.message}`, 500);
            }

            copiedChaptersCount++;

            // If there are lectures, copy them in bulk
            if (chapter.lectures && chapter.lectures.length > 0) {
                const lecturesToInsert = chapter.lectures.map(lecture => ({
                    chapter_id: newChapter.id,
                    title: lecture.title,
                    type: lecture.type,
                    file_url: lecture.file_url,
                    duration: lecture.duration,
                    lecture_order: lecture.lecture_order
                }));

                const { error: newLecturesError } = await supabase
                    .from('lectures')
                    .insert(lecturesToInsert);

                if (newLecturesError) {
                    console.error(`Failed to copy lectures for chapter "${chapter.title}":`, newLecturesError);
                    throw new AppError(`Failed to transfer lectures: ${newLecturesError.message}`, 500);
                }

                copiedLecturesCount += lecturesToInsert.length;
            }
        }

        // Log action
        await auditService.log(
            userId,
            'COURSE_CONTENT_TRANSFERRED',
            `Transferred content from course ${sourceCourseId} to course ${targetCourse.title} (${targetCourseId})`
        );

        return {
            success: true,
            message: `Successfully transferred ${copiedChaptersCount} chapters and ${copiedLecturesCount} lectures to ${targetCourse.title}`,
            copied_chapters: copiedChaptersCount,
            copied_lectures: copiedLecturesCount
        };
    }
}

export default new CourseService();
