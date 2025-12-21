import AWS from 'aws-sdk';
import crypto from 'crypto';
import { config } from '../config/config.js';
import { AppError } from '../middlewares/error.middleware.js';
import enrollmentService from './enrollment.service.js';
import lectureService from './lecture.service.js';
import auditService from './audit.service.js';

class StreamingService {
    constructor() {
        // Validate B2 configuration
        if (!config.backblaze.applicationKeyId || !config.backblaze.applicationKey) {
            console.error('❌ Backblaze B2 configuration is missing!');
            console.error('Required: B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY');
            console.error('Current config:', {
                applicationKeyId: config.backblaze.applicationKeyId ? '✓ Set' : '✗ Missing',
                applicationKey: config.backblaze.applicationKey ? '✓ Set' : '✗ Missing',
                bucketName: config.backblaze.bucketName ? '✓ Set' : '✗ Missing',
                endpoint: config.backblaze.endpoint ? '✓ Set' : '✗ Missing'
            });
        }

        // Configure AWS SDK for Backblaze B2 (S3-compatible)
        // IMPORTANT: Region must match the actual bucket location
        this.s3 = new AWS.S3({
            endpoint: config.backblaze.endpoint,
            region: 'ca-east-006', // Backblaze B2 region - must match bucket location
            accessKeyId: config.backblaze.applicationKeyId,
            secretAccessKey: config.backblaze.applicationKey,
            s3ForcePathStyle: true,
            signatureVersion: 'v4'
        });

        console.log('✅ Streaming service initialized with B2 configuration');
    }

    // Upload file to Backblaze B2
    async uploadFile(file, folder = 'lectures') {
        // Validate configuration
        if (!config.backblaze.applicationKeyId || !config.backblaze.applicationKey) {
            throw new AppError('Backblaze B2 storage is not configured. Please contact administrator.', 500);
        }

        if (!file) {
            throw new AppError('No file provided', 400);
        }

        console.log('📤 Uploading file:', {
            originalName: file.originalname,
            size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
            mimeType: file.mimetype,
            folder
        });

        const fileName = `${folder}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}_${file.originalname}`;

        const params = {
            Bucket: config.backblaze.bucketName,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: 'private' // Important: keep files private
        };

        try {
            const result = await this.s3.upload(params).promise();
            console.log('✅ File uploaded successfully:', result.Key);

            return {
                fileUrl: result.Key, // Store the key, not the full URL
                fileName: file.originalname,
                fileSize: file.size,
                mimeType: file.mimetype
            };
        } catch (error) {
            console.error('❌ File upload error:', {
                message: error.message,
                code: error.code,
                statusCode: error.statusCode,
                bucket: config.backblaze.bucketName,
                endpoint: config.backblaze.endpoint
            });

            // Provide more specific error messages
            if (error.code === 'InvalidAccessKeyId') {
                throw new AppError('Invalid Backblaze B2 credentials. Please check configuration.', 500);
            } else if (error.code === 'NoSuchBucket') {
                throw new AppError('Backblaze B2 bucket not found. Please check bucket name.', 500);
            } else if (error.code === 'NetworkingError') {
                throw new AppError('Network error while uploading to B2. Please try again.', 500);
            }

            throw new AppError(`Failed to upload file: ${error.message}`, 500);
        }
    }

    // Generate signed URL for video/PDF access
    async getSignedUrl(fileKey, expirySeconds = null) {
        const expiry = expirySeconds || config.cloudfront.signedUrlExpiry;

        const params = {
            Bucket: config.backblaze.bucketName,
            Key: fileKey,
            Expires: expiry
        };

        try {
            const url = await this.s3.getSignedUrlPromise('getObject', params);
            return url;
        } catch (error) {
            console.error('Signed URL generation error:', error);
            throw new AppError('Failed to generate signed URL', 500);
        }
    }

    // Get video URL with access validation
    async getVideoUrl(lectureId, studentId) {
        // Get lecture details
        const lecture = await lectureService.getLectureById(lectureId);

        if (lecture.type !== 'video') {
            throw new AppError('This lecture is not a video', 400);
        }

        // Get course ID from lecture
        const courseId = lecture.chapters.course_id;

        // Check if student has access
        const { hasAccess, reason } = await enrollmentService.checkAccess(studentId, courseId);

        if (!hasAccess) {
            throw new AppError(`Access denied: ${reason}`, 403);
        }

        // Generate signed URL
        const signedUrl = await this.getSignedUrl(lecture.file_url);

        // Log access
        await auditService.log(
            studentId,
            'VIDEO_ACCESSED',
            `Accessed video: ${lecture.title}`,
            { lectureId, courseId }
        );

        return {
            url: signedUrl,
            lecture: {
                id: lecture.id,
                title: lecture.title,
                duration: lecture.duration
            },
            expiresIn: config.cloudfront.signedUrlExpiry
        };
    }

    // Get PDF URL with access validation
    async getPdfUrl(lectureId, studentId) {
        // Get lecture details
        const lecture = await lectureService.getLectureById(lectureId);

        if (lecture.type !== 'pdf') {
            throw new AppError('This lecture is not a PDF', 400);
        }

        // Get course ID from lecture
        const courseId = lecture.chapters.course_id;

        // Check if student has access
        const { hasAccess, reason } = await enrollmentService.checkAccess(studentId, courseId);

        if (!hasAccess) {
            throw new AppError(`Access denied: ${reason}`, 403);
        }

        // Generate signed URL
        const signedUrl = await this.getSignedUrl(lecture.file_url);

        // Log access
        await auditService.log(
            studentId,
            'PDF_ACCESSED',
            `Accessed PDF: ${lecture.title}`,
            { lectureId, courseId }
        );

        return {
            url: signedUrl,
            lecture: {
                id: lecture.id,
                title: lecture.title
            },
            expiresIn: config.cloudfront.signedUrlExpiry
        };
    }

    // Stream PDF file directly (fixes CORS issues)
    async streamPdf(lectureId, studentId) {
        // Get lecture details
        const lecture = await lectureService.getLectureById(lectureId);

        if (lecture.type !== 'pdf') {
            throw new AppError('This lecture is not a PDF', 400);
        }

        // Check access
        const courseId = lecture.chapters.course_id;
        const { hasAccess, reason } = await enrollmentService.checkAccess(studentId, courseId);

        if (!hasAccess) {
            throw new AppError(`Access denied: ${reason}`, 403);
        }

        // Log access
        await auditService.log(
            studentId,
            'PDF_STREAMED',
            `Streamed PDF: ${lecture.title}`,
            { lectureId, courseId }
        );

        // Return S3 stream parameters
        return {
            params: {
                Bucket: config.backblaze.bucketName,
                Key: lecture.file_url
            },
            s3: this.s3
        };
    }

    // Delete file from B2
    async deleteFile(fileKey) {
        const params = {
            Bucket: config.backblaze.bucketName,
            Key: fileKey
        };

        try {
            await this.s3.deleteObject(params).promise();
            return { success: true, message: 'File deleted successfully' };
        } catch (error) {
            console.error('File deletion error:', error);
            throw new AppError('Failed to delete file', 500);
        }
    }

    // Get watermark data for student
    getWatermarkData(user) {
        return {
            name: user.name,
            email: user.email,
            phone: user.phone,
            userId: user.id
        };
    }
}

export default new StreamingService();
