import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import crypto from 'crypto';

class StreamingService {
    // Generate signed URL for HLS video streaming
    async generateVideoStreamUrl(lectureId, userId) {
        try {
            // Get lecture details
            const { data: lecture, error: lectureError } = await supabase
                .from('lectures')
                .select('*, chapters(course_id)')
                .eq('id', lectureId)
                .eq('type', 'video')
                .single();

            if (lectureError || !lecture) {
                throw new AppError('Lecture not found', 404);
            }

            // Check enrollment
            const { data: enrollment, error: enrollError } = await supabase
                .from('enrollments')
                .select('*')
                .eq('user_id', userId)
                .eq('course_id', lecture.chapters.course_id)
                .eq('status', 'active')
                .single();

            if (enrollError || !enrollment) {
                throw new AppError('Not enrolled in this course', 403);
            }

            // Check validity
            if (enrollment.valid_until && new Date(enrollment.valid_until) < new Date()) {
                throw new AppError('Course enrollment has expired', 403);
            }

            // Generate signed URL (expires in 2 hours)
            const expiresAt = Date.now() + (2 * 60 * 60 * 1000);
            const signature = this._generateSignature(lectureId, userId, expiresAt);

            // For now, return the file URL directly
            // In production, this would be a Backblaze B2 signed URL
            const streamUrl = `${lecture.file_url}?signature=${signature}&expires=${expiresAt}&user=${userId}`;

            return {
                url: streamUrl,
                expiresAt: new Date(expiresAt).toISOString(),
            };
        } catch (error) {
            throw error;
        }
    }

    // Generate signed URL for PDF viewing
    async generatePDFStreamUrl(lectureId, userId) {
        try {
            // Get lecture details
            const { data: lecture, error: lectureError } = await supabase
                .from('lectures')
                .select('*, chapters(course_id)')
                .eq('id', lectureId)
                .eq('type', 'pdf')
                .single();

            if (lectureError || !lecture) {
                throw new AppError('Lecture not found', 404);
            }

            // Check enrollment
            const { data: enrollment, error: enrollError } = await supabase
                .from('enrollments')
                .select('*')
                .eq('user_id', userId)
                .eq('course_id', lecture.chapters.course_id)
                .eq('status', 'active')
                .single();

            if (enrollError || !enrollment) {
                throw new AppError('Not enrolled in this course', 403);
            }

            // Check validity
            if (enrollment.valid_until && new Date(enrollment.valid_until) < new Date()) {
                throw new AppError('Course enrollment has expired', 403);
            }

            // Generate signed URL (expires in 2 hours)
            const expiresAt = Date.now() + (2 * 60 * 60 * 1000);
            const signature = this._generateSignature(lectureId, userId, expiresAt);

            // For now, return the file URL directly
            // In production, this would be a Backblaze B2 signed URL
            const streamUrl = `${lecture.file_url}?signature=${signature}&expires=${expiresAt}&user=${userId}`;

            return {
                url: streamUrl,
                expiresAt: new Date(expiresAt).toISOString(),
            };
        } catch (error) {
            throw error;
        }
    }

    // Generate signature for URL validation
    _generateSignature(lectureId, userId, expiresAt) {
        const secret = process.env.JWT_SECRET || 'your-secret-key';
        const data = `${lectureId}:${userId}:${expiresAt}`;
        return crypto.createHmac('sha256', secret).update(data).digest('hex');
    }

    // Verify signature
    verifySignature(lectureId, userId, expiresAt, signature) {
        const expectedSignature = this._generateSignature(lectureId, userId, expiresAt);
        return signature === expectedSignature && Date.now() < expiresAt;
    }
}

export default new StreamingService();
