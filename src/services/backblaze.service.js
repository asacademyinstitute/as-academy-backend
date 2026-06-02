import B2 from 'backblaze-b2';
import crypto from 'crypto';
import { AppError } from '../middlewares/error.middleware.js';

class BackblazeService {
    constructor() {
        this.b2 = new B2({
            applicationKeyId: process.env.B2_KEY_ID,
            applicationKey: process.env.B2_APPLICATION_KEY,
        });
        this.bucketId = process.env.B2_BUCKET_ID;
        this.bucketName = process.env.B2_BUCKET_NAME;
        this.authToken = null;
        this.uploadUrl = null;
        this.downloadUrl = null;
    }

    /**
     * Authorize with Backblaze B2
     */
    async authorize() {
        try {
            const response = await this.b2.authorize();
            this.authToken = response.data.authorizationToken;
            this.downloadUrl = response.data.downloadUrl;
            return response.data;
        } catch (error) {
            console.error('B2 Authorization Error:', error);
            throw new AppError('Failed to authorize with Backblaze B2', 500);
        }
    }

    /**
     * Get upload URL for bucket
     */
    async getUploadUrl() {
        try {
            if (!this.authToken) {
                await this.authorize();
            }

            const response = await this.b2.getUploadUrl({
                bucketId: this.bucketId,
            });

            this.uploadUrl = response.data.uploadUrl;
            return response.data;
        } catch (error) {
            console.error('B2 Get Upload URL Error:', error);
            throw new AppError('Failed to get upload URL', 500);
        }
    }

    /**
     * Upload file to B2
     * @param {Buffer} fileBuffer - File buffer
     * @param {string} fileName - File name with path (e.g., 'videos/lecture_123.mp4')
     * @param {string} contentType - MIME type
     */
    async uploadFile(fileBuffer, fileName, contentType = 'application/octet-stream') {
        try {
            const uploadData = await this.getUploadUrl();

            // Generate SHA1 hash of file
            const hash = crypto.createHash('sha1').update(fileBuffer).digest('hex');

            const response = await this.b2.uploadFile({
                uploadUrl: uploadData.uploadUrl,
                uploadAuthToken: uploadData.authorizationToken,
                fileName: fileName,
                data: fileBuffer,
                hash: hash,
                info: {
                    'Content-Type': contentType,
                },
            });

            return {
                fileId: response.data.fileId,
                fileName: response.data.fileName,
                contentLength: response.data.contentLength,
                contentType: response.data.contentType,
                uploadTimestamp: response.data.uploadTimestamp,
            };
        } catch (error) {
            console.error('B2 Upload Error:', error);
            throw new AppError('Failed to upload file to B2', 500);
        }
    }

    /**
     * Generate signed download URL (expires in 2 hours)
     * @param {string} fileId - B2 file ID
     * @param {number} validitySeconds - URL validity in seconds (default: 7200 = 2 hours)
     */
    async getSignedUrl(fileId, validitySeconds = 7200) {
        try {
            if (!this.authToken) {
                await this.authorize();
            }

            // Get file info
            const fileInfo = await this.b2.getFileInfo({ fileId });
            const fileName = fileInfo.data.fileName;

            // Generate authorization token for download
            const validUntil = Date.now() + (validitySeconds * 1000);
            const bucketId = this.bucketId;

            // Create download authorization
            const downloadAuth = await this.b2.getDownloadAuthorization({
                bucketId: bucketId,
                fileNamePrefix: fileName,
                validDurationInSeconds: validitySeconds,
            });

            // Construct signed URL
            const signedUrl = `${this.downloadUrl}/file/${this.bucketName}/${fileName}?Authorization=${downloadAuth.data.authorizationToken}`;

            return {
                url: signedUrl,
                expiresAt: new Date(validUntil).toISOString(),
                fileId: fileId,
                fileName: fileName,
            };
        } catch (error) {
            console.error('B2 Get Signed URL Error:', error);
            throw new AppError('Failed to generate signed URL', 500);
        }
    }

    /**
     * Delete file from B2
     * @param {string} fileId - B2 file ID
     * @param {string} fileName - File name
     */
    async deleteFile(fileId, fileName) {
        try {
            if (!this.authToken) {
                await this.authorize();
            }

            await this.b2.deleteFileVersion({
                fileId: fileId,
                fileName: fileName,
            });

            return { success: true, message: 'File deleted successfully' };
        } catch (error) {
            console.error('B2 Delete Error:', error);
            throw new AppError('Failed to delete file from B2', 500);
        }
    }

    /**
     * List files in bucket
     * @param {string} prefix - File name prefix (e.g., 'videos/')
     * @param {number} maxFileCount - Maximum files to return
     */
    async listFiles(prefix = '', maxFileCount = 100) {
        try {
            if (!this.authToken) {
                await this.authorize();
            }

            const response = await this.b2.listFileNames({
                bucketId: this.bucketId,
                startFileName: prefix,
                maxFileCount: maxFileCount,
                prefix: prefix,
            });

            return response.data.files;
        } catch (error) {
            console.error('B2 List Files Error:', error);
            throw new AppError('Failed to list files', 500);
        }
    }

    /**
     * Get file info
     * @param {string} fileId - B2 file ID
     */
    async getFileInfo(fileId) {
        try {
            if (!this.authToken) {
                await this.authorize();
            }

            const response = await this.b2.getFileInfo({ fileId });
            return response.data;
        } catch (error) {
            console.error('B2 Get File Info Error:', error);
            throw new AppError('Failed to get file info', 500);
        }
    }
}

export default new BackblazeService();
