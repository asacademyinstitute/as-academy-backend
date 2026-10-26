import B2 from 'backblaze-b2';
import crypto from 'crypto';
import { AppError } from '../middlewares/error.middleware.js';

class BackblazeService {
    constructor() {
        this.b2 = null;
        this.bucketId = null;
        this.bucketName = null;
        this.authToken = null;
        this.uploadUrl = null;
        this.downloadUrl = null;
        this.tokenExpiresAt = 0;
    }

    /**
     * Authorize with Backblaze B2 (refreshes auth token)
     */
    async authorize() {
        try {
            if (!this.bucketName) {
                this.bucketName = process.env.B2_BUCKET_NAME || 'academy-content-bucket';
            }
            if (!this.bucketId) {
                this.bucketId = process.env.B2_BUCKET_ID || 'cc4e03f6c336071b94b60118';
            }

            if (!this.b2) {
                const keyId = process.env.B2_KEY_ID || process.env.B2_APPLICATION_KEY_ID;
                const appKey = process.env.B2_APPLICATION_KEY;

                if (!keyId || !appKey) {
                    throw new AppError('B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY must be set in environment variables', 500);
                }

                console.log(`🔌 Initializing Backblaze B2 client with keyId: ${keyId}`);

                this.b2 = new B2({
                    applicationKeyId: keyId,
                    applicationKey: appKey,
                });
            }

            const response = await this.b2.authorize();
            this.authToken = response.data.authorizationToken;
            this.downloadUrl = response.data.downloadUrl;
            // B2 tokens are valid for 24 hours. Refresh after 20 hours to be safe.
            this.tokenExpiresAt = Date.now() + (20 * 60 * 60 * 1000);

            // Resolve bucketId: env var -> allowed scope -> listBuckets -> fallback
            if (response.data.allowed && response.data.allowed.bucketId) {
                this.bucketId = response.data.allowed.bucketId;
                if (!this.bucketName && response.data.allowed.bucketName) {
                    this.bucketName = response.data.allowed.bucketName;
                }
            } else if (!this.bucketId && this.bucketName) {
                try {
                    const bucketsRes = await this.b2.listBuckets();
                    const bucket = bucketsRes.data.buckets.find(b => b.bucketName === this.bucketName);
                    if (bucket) {
                        this.bucketId = bucket.bucketId;
                    }
                } catch (listErr) {
                    console.warn('⚠️ Could not list buckets for dynamic ID resolution:', listErr.message);
                }
            }

            // Ensure fallback bucketId is never null
            if (!this.bucketId) {
                this.bucketId = 'cc4e03f6c336071b94b60118';
            }

            console.log('✅ Backblaze B2 authorized successfully. Bucket ID:', this.bucketId);
            return response.data;
        } catch (error) {
            if (error instanceof AppError) throw error;
            console.error('B2 Authorization Error:', error.message || error);
            throw new AppError('Failed to authorize with Backblaze B2: ' + (error.message || error), 500);
        }
    }

    /**
     * Ensure we have a valid, non-expired authorization token
     */
    async ensureAuthorized(force = false) {
        const isExpired = !this.tokenExpiresAt || Date.now() >= this.tokenExpiresAt;
        if (!this.authToken || isExpired || force) {
            await this.authorize();
        }
    }

    /**
     * Helper to run a B2 operation with automatic retry on token expiry (401)
     */
    async _executeWithRetry(operation) {
        await this.ensureAuthorized();
        try {
            return await operation();
        } catch (error) {
            const isAuthError =
                error?.response?.status === 401 ||
                error?.status === 401 ||
                (error?.message && (
                    error.message.includes('auth') ||
                    error.message.includes('token') ||
                    error.message.includes('expired')
                ));

            if (isAuthError) {
                console.warn('⚠️ B2 auth token expired or invalid. Re-authorizing and retrying...');
                await this.ensureAuthorized(true);
                return await operation();
            }
            throw error;
        }
    }

    /**
     * Get upload URL for bucket
     */
    async getUploadUrl() {
        return this._executeWithRetry(async () => {
            const response = await this.b2.getUploadUrl({
                bucketId: this.bucketId,
            });
            this.uploadUrl = response.data.uploadUrl;
            return response.data;
        });
    }

    /**
     * Upload file to B2
     * @param {Buffer} fileBuffer - File buffer
     * @param {string} fileName - File name with path (e.g., 'videos/lecture_123.mp4')
     * @param {string} contentType - MIME type
     */
    async uploadFile(fileBuffer, fileName, contentType = 'application/octet-stream') {
        return this._executeWithRetry(async () => {
            const uploadData = await this.getUploadUrl();
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
        });
    }

    /**
     * Generate signed download URL (expires in validitySeconds)
     * @param {string} fileId - B2 file ID
     * @param {number} validitySeconds - URL validity in seconds (default: 7200 = 2 hours)
     */
    async getSignedUrl(fileId, validitySeconds = 7200) {
        return this._executeWithRetry(async () => {
            const fileInfo = await this.b2.getFileInfo({ fileId });
            const fileName = fileInfo.data.fileName;
            const validUntil = Date.now() + (validitySeconds * 1000);

            const downloadAuth = await this.b2.getDownloadAuthorization({
                bucketId: this.bucketId,
                fileNamePrefix: fileName,
                validDurationInSeconds: validitySeconds,
            });

            const signedUrl = `${this.downloadUrl}/file/${this.bucketName}/${fileName}?Authorization=${downloadAuth.data.authorizationToken}`;

            return {
                url: signedUrl,
                expiresAt: new Date(validUntil).toISOString(),
                fileId: fileId,
                fileName: fileName,
            };
        });
    }

    /**
     * Generate signed download URL by fileName (expires in validitySeconds)
     * @param {string} fileName - B2 file name with path (e.g., 'videos/lecture_123.mp4')
     * @param {number} validitySeconds - URL validity in seconds (default: 7200 = 2 hours)
     */
    async getSignedUrlByFileName(fileName, validitySeconds = 7200) {
        return this._executeWithRetry(async () => {
            const validUntil = Date.now() + (validitySeconds * 1000);

            const downloadAuth = await this.b2.getDownloadAuthorization({
                bucketId: this.bucketId,
                fileNamePrefix: fileName,
                validDurationInSeconds: validitySeconds,
            });

            const signedUrl = `${this.downloadUrl}/file/${this.bucketName}/${fileName}?Authorization=${downloadAuth.data.authorizationToken}`;

            return {
                url: signedUrl,
                expiresAt: new Date(validUntil).toISOString(),
                fileName: fileName,
            };
        });
    }

    /**
     * Delete file from B2
     * @param {string} fileId - B2 file ID
     * @param {string} fileName - File name
     */
    async deleteFile(fileId, fileName) {
        return this._executeWithRetry(async () => {
            await this.b2.deleteFileVersion({
                fileId: fileId,
                fileName: fileName,
            });
            return { success: true, message: 'File deleted successfully' };
        });
    }

    /**
     * List files in bucket
     * @param {string} prefix - File name prefix (e.g., 'videos/')
     * @param {number} maxFileCount - Maximum files to return
     */
    async listFiles(prefix = '', maxFileCount = 100) {
        return this._executeWithRetry(async () => {
            const response = await this.b2.listFileNames({
                bucketId: this.bucketId,
                startFileName: prefix,
                maxFileCount: maxFileCount,
                prefix: prefix,
            });
            return response.data.files;
        });
    }

    /**
     * Get file info
     * @param {string} fileId - B2 file ID
     */
    async getFileInfo(fileId) {
        return this._executeWithRetry(async () => {
            const response = await this.b2.getFileInfo({ fileId });
            return response.data;
        });
    }
}

export default new BackblazeService();
