import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import crypto from 'crypto';
import backblazeService from './backblaze.service.js';

class StreamingService {
    // Generate signed URL for HLS video streaming
    async generateVideoStreamUrl(lectureId, userId, role = 'student') {
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

            // Only check enrollment if the user is a student
            if (role !== 'teacher' && role !== 'admin') {
                // Check enrollment
                const { data: enrollment, error: enrollError } = await supabase
                    .from('enrollments')
                    .select('*')
                    .eq('student_id', userId)
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
            }

            // Generate secure, signed URL using Backblaze B2 (expires in 2 hours)
            const streamUrl = await this.getSignedUrl(lecture.file_url, 7200);

            return {
                url: streamUrl,
                expiresAt: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString(),
            };
        } catch (error) {
            throw error;
        }
    }

    // Generate signed URL for PDF viewing
    async generatePDFStreamUrl(lectureId, userId, role = 'student') {
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

            // Only check enrollment if the user is a student
            if (role !== 'teacher' && role !== 'admin') {
                // Check enrollment
                const { data: enrollment, error: enrollError } = await supabase
                    .from('enrollments')
                    .select('*')
                    .eq('student_id', userId)
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
            }

            // Generate secure, signed URL using Backblaze B2 (expires in 2 hours)
            const streamUrl = await this.getSignedUrl(lecture.file_url, 7200);

            return {
                url: streamUrl,
                expiresAt: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString(),
            };
        } catch (error) {
            throw error;
        }
    }

    // Upload file to Backblaze B2
    async uploadFile(file, folder = 'lectures') {
        try {
            const fileBuffer = file.buffer;
            const originalName = file.originalname;
            const contentType = file.mimetype;

            // Generate unique fileName with folder prefix
            const uniqueName = `${folder}/${Date.now()}-${originalName}`;

            // Upload to Backblaze B2
            const result = await backblazeService.uploadFile(fileBuffer, uniqueName, contentType);

            // Construct full B2 file URL
            const fileUrl = `${backblazeService.downloadUrl}/file/${backblazeService.bucketName}/${result.fileName}`;

            return {
                fileId: result.fileId,
                fileName: result.fileName,
                fileUrl: fileUrl
            };
        } catch (error) {
            console.error('StreamingService uploadFile error:', error);
            throw error;
        }
    }

    // Get signed URL for secure viewing
    async getSignedUrl(fileUrl, validitySeconds = 7200) {
        try {
            const fileName = this._extractB2FileName(fileUrl);
            if (!fileName) {
                throw new AppError('Invalid file URL', 400);
            }

            const result = await backblazeService.getSignedUrlByFileName(fileName, validitySeconds);
            return result.url;
        } catch (error) {
            console.error('StreamingService getSignedUrl error:', error);
            throw error;
        }
    }

    // Delete file from Backblaze B2
    async deleteFile(fileUrl) {
        try {
            const fileName = this._extractB2FileName(fileUrl);
            if (!fileName) return;

            // We need a fileId or list to delete. Let's list files by prefix to find the file ID
            const files = await backblazeService.listFiles(fileName, 1);
            if (files && files.length > 0 && files[0].fileName === fileName) {
                await backblazeService.deleteFile(files[0].fileId, fileName);
                console.log('✅ File deleted from B2 successfully:', fileName);
            }
        } catch (error) {
            console.warn('⚠️ Failed to delete file from B2 storage:', error.message);
        }
    }

    // Helper to extract relative B2 filename path from a full URL
    _extractB2FileName(fileUrl) {
        if (!fileUrl) return null;
        
        // If it's already a relative path (e.g. lectures/xxx.pdf)
        if (!fileUrl.startsWith('http')) {
            return fileUrl;
        }

        // If it's a full B2 URL: https://f003.backblazeb2.com/file/bucket-name/lectures/xxx.pdf
        const match = fileUrl.match(/\/file\/[^/]+\/(.+)$/);
        if (match && match[1]) {
            return decodeURIComponent(match[1]);
        }

        return fileUrl;
    }

    // Generate signature for URL validation (legacy support)
    _generateSignature(lectureId, userId, expiresAt) {
        const secret = process.env.JWT_SECRET || 'your-secret-key';
        const data = `${lectureId}:${userId}:${expiresAt}`;
        return crypto.createHmac('sha256', secret).update(data).digest('hex');
    }

    // Verify signature (legacy support)
    verifySignature(lectureId, userId, expiresAt, signature) {
        const expectedSignature = this._generateSignature(lectureId, userId, expiresAt);
        return signature === expectedSignature && Date.now() < expiresAt;
    }
}

export default new StreamingService();
