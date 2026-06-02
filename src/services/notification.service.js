import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';

class NotificationService {
    /**
     * Create in-app notification
     * @param {string} userId - User ID
     * @param {string} title - Notification title
     * @param {string} message - Notification message
     * @param {string} type - Notification type (live_class, new_content, etc.)
     * @param {object} data - Additional data
     */
    async createNotification(userId, title, message, type, data = {}) {
        try {
            const { error } = await supabase
                .from('notifications')
                .insert({
                    user_id: userId,
                    title,
                    body: message,
                    type,
                    data: JSON.stringify(data),
                    read: false,
                });

            if (error) {
                throw new AppError('Failed to create notification', 500);
            }

            return { success: true };
        } catch (error) {
            console.error('Create Notification Error:', error);
            throw error;
        }
    }

    /**
     * Get unread notifications for user
     * @param {string} userId - User ID
     */
    async getUnreadNotifications(userId) {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .eq('read', false)
            .order('created_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch notifications', 500);
        }

        return data;
    }

    /**
     * Get all notifications for user
     * @param {string} userId - User ID
     * @param {number} limit - Limit
     */
    async getNotifications(userId, limit = 50) {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            throw new AppError('Failed to fetch notifications', 500);
        }

        return data;
    }

    /**
     * Mark notification as read
     * @param {string} notificationId - Notification ID
     */
    async markAsRead(notificationId) {
        const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('id', notificationId);

        if (error) {
            throw new AppError('Failed to mark notification as read', 500);
        }

        return { success: true };
    }

    /**
     * Mark all notifications as read for user
     * @param {string} userId - User ID
     */
    async markAllAsRead(userId) {
        const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('user_id', userId)
            .eq('read', false);

        if (error) {
            throw new AppError('Failed to mark all as read', 500);
        }

        return { success: true };
    }

    /**
     * Notify students when course goes live
     * @param {string} courseId - Course ID
     */
    async notifyLiveClass(courseId) {
        try {
            // Get course details
            const { data: course } = await supabase
                .from('courses')
                .select('title, live_class_scheduled_at')
                .eq('id', courseId)
                .single();

            if (!course) return;

            // Get all enrolled students
            const { data: enrollments } = await supabase
                .from('enrollments')
                .select('user_id')
                .eq('course_id', courseId)
                .eq('status', 'active');

            if (!enrollments || enrollments.length === 0) return;

            // Create notification for each student
            const notifications = enrollments.map(enrollment => ({
                user_id: enrollment.user_id,
                title: 'Live Class Starting!',
                body: `${course.title} is going live now!`,
                type: 'live_class',
                data: JSON.stringify({ courseId, scheduledAt: course.live_class_scheduled_at }),
                read: false,
            }));

            await supabase.from('notifications').insert(notifications);

            return { success: true, notified: enrollments.length };
        } catch (error) {
            console.error('Notify Live Class Error:', error);
            throw error;
        }
    }

    /**
     * Notify students when new content is added
     * @param {string} courseId - Course ID
     * @param {string} contentType - Type of content (lecture, chapter, quiz)
     * @param {string} contentTitle - Title of new content
     */
    async notifyNewContent(courseId, contentType, contentTitle) {
        try {
            // Get course details
            const { data: course } = await supabase
                .from('courses')
                .select('title')
                .eq('id', courseId)
                .single();

            if (!course) return;

            // Get all enrolled students
            const { data: enrollments } = await supabase
                .from('enrollments')
                .select('user_id')
                .eq('course_id', courseId)
                .eq('status', 'active');

            if (!enrollments || enrollments.length === 0) return;

            // Create notification for each student
            const notifications = enrollments.map(enrollment => ({
                user_id: enrollment.user_id,
                title: 'New Content Added!',
                body: `New ${contentType} "${contentTitle}" added to ${course.title}`,
                type: 'new_content',
                data: JSON.stringify({ courseId, contentType, contentTitle }),
                read: false,
            }));

            await supabase.from('notifications').insert(notifications);

            return { success: true, notified: enrollments.length };
        } catch (error) {
            console.error('Notify New Content Error:', error);
            throw error;
        }
    }

    /**
     * Notify student of successful payment
     * @param {string} userId - User ID
     * @param {string} courseName - Course name
     */
    async notifyPaymentSuccess(userId, courseName) {
        await this.createNotification(
            userId,
            'Payment Successful!',
            `You are now enrolled in ${courseName}`,
            'payment_success',
            { courseName }
        );
    }

    /**
     * Get unread count for user
     * @param {string} userId - User ID
     */
    async getUnreadCount(userId) {
        const { count, error } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('read', false);

        if (error) {
            throw new AppError('Failed to get unread count', 500);
        }

        return count || 0;
    }
}

export default new NotificationService();
