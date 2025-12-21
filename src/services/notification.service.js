import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import supabase from '../config/database.js';

class NotificationService {
    constructor() {
        this.transporter = nodemailer.createTransporter({
            host: config.email.host,
            port: config.email.port,
            secure: config.email.secure,
            auth: {
                user: config.email.user,
                pass: config.email.password
            }
        });
    }

    // Send email
    async sendEmail(to, subject, html) {
        try {
            const info = await this.transporter.sendMail({
                from: config.email.from,
                to,
                subject,
                html
            });

            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.error('Email send error:', error);
            return { success: false, error: error.message };
        }
    }

    // Send welcome email
    async sendWelcomeEmail(user) {
        const subject = 'Welcome to AS Academy!';
        const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e40af;">Welcome to AS Academy!</h2>
        <p>Dear ${user.name},</p>
        <p>Thank you for joining AS Academy. We're excited to have you on board!</p>
        <p>You can now browse our courses and start your learning journey.</p>
        <p>If you have any questions, feel free to reach out to our support team.</p>
        <p>Best regards,<br>AS Academy Team</p>
      </div>
    `;

        return this.sendEmail(user.email, subject, html);
    }

    // Send enrollment confirmation
    async sendEnrollmentEmail(user, course) {
        const subject = `Enrollment Confirmed: ${course.title}`;
        const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e40af;">Enrollment Confirmed!</h2>
        <p>Dear ${user.name},</p>
        <p>You have been successfully enrolled in:</p>
        <h3 style="color: #3b82f6;">${course.title}</h3>
        <p>You can now access all course materials and start learning.</p>
        <p><a href="${config.frontendUrl}/student/courses/${course.id}" style="background-color: #1e40af; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Start Learning</a></p>
        <p>Best regards,<br>AS Academy Team</p>
      </div>
    `;

        return this.sendEmail(user.email, subject, html);
    }

    // Send course expiry reminder
    async sendExpiryReminder(user, course, daysLeft) {
        const subject = `Course Expiring Soon: ${course.title}`;
        const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Course Expiring Soon!</h2>
        <p>Dear ${user.name},</p>
        <p>Your access to <strong>${course.title}</strong> will expire in ${daysLeft} days.</p>
        <p>Make sure to complete any pending lectures and quizzes before your access expires.</p>
        <p>If you'd like to extend your access, please contact our support team.</p>
        <p>Best regards,<br>AS Academy Team</p>
      </div>
    `;

        return this.sendEmail(user.email, subject, html);
    }

    // Send certificate issued email
    async sendCertificateEmail(user, course, certificateNumber) {
        const subject = `Certificate Issued: ${course.title}`;
        const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #059669;">Congratulations!</h2>
        <p>Dear ${user.name},</p>
        <p>Congratulations on completing <strong>${course.title}</strong>!</p>
        <p>Your certificate has been generated and is now available for download.</p>
        <p>Certificate Number: <strong>${certificateNumber}</strong></p>
        <p><a href="${config.frontendUrl}/student/certificates" style="background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">View Certificate</a></p>
        <p>Best regards,<br>AS Academy Team</p>
      </div>
    `;

        return this.sendEmail(user.email, subject, html);
    }

    // Create in-app notification
    async createNotification(userId, title, message, type = 'info') {
        const { data, error } = await supabase
            .from('notifications')
            .insert({
                user_id: userId,
                title,
                message,
                type
            })
            .select()
            .single();

        if (error) {
            console.error('Notification creation error:', error);
            return null;
        }

        return data;
    }

    // Get user notifications
    async getUserNotifications(userId, unreadOnly = false) {
        let query = supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (unreadOnly) {
            query = query.eq('read', false);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Fetch notifications error:', error);
            return [];
        }

        return data;
    }

    // Mark notification as read
    async markAsRead(notificationId) {
        const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('id', notificationId);

        return !error;
    }

    // Mark all notifications as read
    async markAllAsRead(userId) {
        const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('user_id', userId)
            .eq('read', false);

        return !error;
    }

    // Create course request notification (for teachers)
    async createCourseRequest(teacherId, teacherName, courseDetails) {
        // Get all admin users
        const { data: admins } = await supabase
            .from('users')
            .select('id')
            .eq('role', 'admin');

        if (!admins || admins.length === 0) {
            return { success: false, message: 'No admin users found' };
        }

        const message = `Teacher ${teacherName} has requested to create a new course:\n\nTitle: ${courseDetails.title}\nDescription: ${courseDetails.description}\nCategory: ${courseDetails.category}\nLevel: ${courseDetails.level}`;

        // Create notification for all admins
        const notifications = await Promise.all(
            admins.map(admin =>
                this.createNotification(
                    admin.id,
                    'New Course Request',
                    message,
                    'info'
                )
            )
        );

        return { success: true, notifications };
    }
}

export default new NotificationService();

