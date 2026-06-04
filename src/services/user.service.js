import bcrypt from 'bcryptjs';
import supabase from '../config/database.js';
import { config } from '../config/config.js';
import { AppError } from '../middlewares/error.middleware.js';
import auditService from './audit.service.js';

class UserService {
    // Get all users with filters
    async getUsers(filters = {}, page = 1, limit = 50) {
        let query = supabase
            .from('users')
            .select('id, name, email, phone, enrollment_number, college_name, semester, role, status, created_at', { count: 'exact' })
            .order('created_at', { ascending: false });

        // Apply filters
        if (filters.role) {
            query = query.eq('role', filters.role);
        }

        if (filters.status) {
            query = query.eq('status', filters.status);
        }

        if (filters.search) {
            query = query.or(`name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
        }

        // Pagination
        const offset = (page - 1) * limit;
        query = query.range(offset, offset + limit - 1);

        const { data: users, error, count } = await query;

        if (error) {
            throw new AppError('Failed to fetch users', 500);
        }

        return {
            users,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit)
            }
        };
    }

    // Get user by ID
    async getUserById(userId) {
        const { data: user, error } = await supabase
            .from('users')
            .select('id, name, email, phone, enrollment_number, college_name, semester, role, status, created_at, updated_at')
            .eq('id', userId)
            .single();

        if (error || !user) {
            throw new AppError('User not found', 404);
        }

        return user;
    }

    // Create user (admin only)
    async createUser(userData, adminId) {
        const { name, email, phone, password, enrollment_number, college_name, semester, role } = userData;

        // Check if user exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (existingUser) {
            throw new AppError('User with this email already exists', 400);
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, config.bcryptRounds);

        // Create user
        const { data: user, error } = await supabase
            .from('users')
            .insert({
                name,
                email,
                phone,
                password_hash,
                enrollment_number,
                college_name,
                semester,
                role,
                status: 'active'
            })
            .select('id, name, email, phone, role, enrollment_number, college_name, semester, created_at')
            .single();

        if (error) {
            throw new AppError('Failed to create user', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'USER_CREATED',
            `Created ${role} user: ${name} (${email})`
        );

        return user;
    }

    // Update user
    async updateUser(userId, updateData, adminId) {
        const allowedFields = ['name', 'phone', 'enrollment_number', 'college_name', 'semester', 'status'];
        const updates = {};

        for (const field of allowedFields) {
            if (updateData[field] !== undefined) {
                updates[field] = updateData[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            throw new AppError('No valid fields to update', 400);
        }

        const { data: user, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', userId)
            .select('id, name, email, phone, enrollment_number, college_name, semester, role, status')
            .single();

        if (error) {
            throw new AppError('Failed to update user', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'USER_UPDATED',
            `Updated user: ${user.name} (${user.email})`
        );

        return user;
    }

    // Delete user
    async deleteUser(userId, adminId) {
        const { error } = await supabase
            .from('users')
            .delete()
            .eq('id', userId);

        if (error) {
            throw new AppError('Failed to delete user', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'USER_DELETED',
            `Deleted user with ID: ${userId}`
        );

        return { success: true, message: 'User deleted successfully' };
    }

    // Block/Unblock user
    async toggleUserStatus(userId, status, adminId) {
        const { data: user, error } = await supabase
            .from('users')
            .update({ status })
            .eq('id', userId)
            .select('id, name, email, status')
            .single();

        if (error) {
            throw new AppError('Failed to update user status', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'USER_STATUS_CHANGED',
            `Changed user status to ${status}: ${user.name} (${user.email})`
        );

        return user;
    }

    // Get user's enrolled courses
    async getUserCourses(userId) {
        const { data: enrollments, error } = await supabase
            .from('enrollments')
            .select(`
        *,
        courses:course_id (
          id,
          title,
          description,
          thumbnail_url,
          users:teacher_id (
            name
          )
        )
      `)
            .eq('student_id', userId)
            .eq('status', 'active');

        if (error) {
            throw new AppError('Failed to fetch user courses', 500);
        }

        return enrollments;
    }

    // Get user statistics
    async getUserStats(userId) {
        // Fetch user role first
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            throw new AppError('User not found', 404);
        }

        if (user.role === 'teacher') {
            // Teacher Stats
            const { count: coursesCount } = await supabase
                .from('courses')
                .select('*', { count: 'exact', head: true })
                .eq('teacher_id', userId);

            const { data: teacherCourses } = await supabase
                .from('courses')
                .select('id')
                .eq('teacher_id', userId);

            let uniqueStudentsCount = 0;
            let totalLecturesCount = 0;

            if (teacherCourses && teacherCourses.length > 0) {
                const courseIds = teacherCourses.map(c => c.id);

                // Enrolled students count (active only)
                const { data: enrollments } = await supabase
                    .from('enrollments')
                    .select('student_id')
                    .in('course_id', courseIds)
                    .eq('status', 'active');

                const uniqueStudents = new Set(enrollments?.map(e => e.student_id) || []);
                uniqueStudentsCount = uniqueStudents.size;

                // Content count (lectures)
                const { data: chapters } = await supabase
                    .from('chapters')
                    .select('id')
                    .in('course_id', courseIds);

                if (chapters && chapters.length > 0) {
                    const chapterIds = chapters.map(ch => ch.id);
                    const { count: lecturesCount } = await supabase
                        .from('lectures')
                        .select('*', { count: 'exact', head: true })
                        .in('chapter_id', chapterIds);
                    totalLecturesCount = lecturesCount || 0;
                }
            }

            return {
                totalCourses: coursesCount || 0,
                totalStudents: uniqueStudentsCount || 0,
                totalLectures: totalLecturesCount || 0
            };
        }

        // Student Stats (default)
        const { count: coursesCount } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', userId)
            .eq('status', 'active');

        const { count: completedLectures } = await supabase
            .from('lecture_progress')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', userId)
            .eq('completed', true);

        const { count: certificatesCount } = await supabase
            .from('certificates')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', userId);

        const { count: quizAttempts } = await supabase
            .from('quiz_attempts')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', userId);

        return {
            enrolledCourses: coursesCount || 0,
            completedLectures: completedLectures || 0,
            certificates: certificatesCount || 0,
            quizAttempts: quizAttempts || 0
        };
    }

    // Get user devices
    async getUserDevices(userId) {
        const { data: devices, error } = await supabase
            .from('user_devices')
            .select('*')
            .eq('user_id', userId)
            .order('last_active', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch user devices', 500);
        }

        return devices || [];
    }
}

export default new UserService();

