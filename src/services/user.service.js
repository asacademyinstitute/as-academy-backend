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
            .select('id, name, email, phone, college_name, semester, role, status, created_at', { count: 'exact' })
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
            .select('id, name, email, phone, college_name, semester, role, status, created_at, updated_at')
            .eq('id', userId)
            .single();

        if (error || !user) {
            throw new AppError('User not found', 404);
        }

        return user;
    }

    // Create user (admin only)
    async createUser(userData, adminId) {
        const { name, email, phone, password, college_name, semester, role } = userData;

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
                college_name,
                semester,
                role,
                status: 'active'
            })
            .select('id, name, email, phone, role, college_name, semester, created_at')
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
        const allowedFields = ['name', 'phone', 'college_name', 'semester', 'status'];
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
            .select('id, name, email, phone, college_name, semester, role, status')
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
        // Get enrolled courses count
        const { count: coursesCount } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', userId)
            .eq('status', 'active');

        // Get completed lectures count
        const { count: completedLectures } = await supabase
            .from('lecture_progress')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', userId)
            .eq('completed', true);

        // Get certificates count
        const { count: certificatesCount } = await supabase
            .from('certificates')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', userId);

        // Get quiz attempts count
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

