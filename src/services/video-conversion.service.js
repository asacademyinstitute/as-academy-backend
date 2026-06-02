import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import { AppError } from '../middlewares/error.middleware.js';

class VideoConversionService {
    /**
     * Convert MP4 to HLS with multiple quality variants
     * @param {string} inputPath - Path to input MP4 file
     * @param {string} outputDir - Directory for HLS output
     * @param {Function} onProgress - Progress callback
     */
    async convertToHLS(inputPath, outputDir, onProgress) {
        try {
            // Ensure output directory exists
            await fs.mkdir(outputDir, { recursive: true });

            return new Promise((resolve, reject) => {
                let command = ffmpeg(inputPath);

                // Get video duration for progress calculation
                ffmpeg.ffprobe(inputPath, (err, metadata) => {
                    if (err) {
                        reject(new AppError('Failed to probe video', 500));
                        return;
                    }

                    const duration = metadata.format.duration;

                    command
                        // 360p variant
                        .output(path.join(outputDir, '360p.m3u8'))
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .size('640x360')
                        .videoBitrate('800k')
                        .audioBitrate('96k')
                        .outputOptions([
                            '-profile:v baseline',
                            '-level 3.0',
                            '-start_number 0',
                            '-hls_time 10',
                            '-hls_list_size 0',
                            '-f hls',
                            '-preset ultrafast',
                            '-threads 1'
                        ])

                        // 480p variant
                        .output(path.join(outputDir, '480p.m3u8'))
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .size('854x480')
                        .videoBitrate('1400k')
                        .audioBitrate('128k')
                        .outputOptions([
                            '-profile:v main',
                            '-level 3.1',
                            '-start_number 0',
                            '-hls_time 10',
                            '-hls_list_size 0',
                            '-f hls',
                            '-preset ultrafast',
                            '-threads 1'
                        ])

                        // 720p variant
                        .output(path.join(outputDir, '720p.m3u8'))
                        .videoCodec('libx264')
                        .audioCodec('aac')
                        .size('1280x720')
                        .videoBitrate('2800k')
                        .audioBitrate('192k')
                        .outputOptions([
                            '-profile:v main',
                            '-level 4.0',
                            '-start_number 0',
                            '-hls_time 10',
                            '-hls_list_size 0',
                            '-f hls',
                            '-preset ultrafast',
                            '-threads 1'
                        ])

                        .on('progress', (progress) => {
                            if (onProgress && duration) {
                                const percent = (progress.timemark / duration) * 100;
                                onProgress(Math.min(percent, 100));
                            }
                        })

                        .on('end', async () => {
                            // Create master playlist
                            await this.createMasterPlaylist(outputDir);
                            resolve({
                                success: true,
                                outputDir,
                                variants: ['360p', '480p', '720p'],
                            });
                        })

                        .on('error', (err) => {
                            console.error('FFmpeg Error:', err);
                            reject(new AppError(`Conversion failed: ${err.message}`, 500));
                        })

                        .run();
                });
            });
        } catch (error) {
            console.error('Video Conversion Error:', error);
            throw new AppError('Failed to convert video', 500);
        }
    }

    /**
     * Create master playlist for adaptive streaming
     * @param {string} outputDir - Directory containing variant playlists
     */
    async createMasterPlaylist(outputDir) {
        const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=640x360
360p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1528000,RESOLUTION=854x480
480p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2992000,RESOLUTION=1280x720
720p.m3u8
`;

        await fs.writeFile(path.join(outputDir, 'playlist.m3u8'), masterPlaylist);
    }

    /**
     * Generate thumbnail from video
     * @param {string} videoPath - Path to video file
     * @param {string} outputPath - Path for thumbnail output
     * @param {string} timestamp - Timestamp for thumbnail (e.g., '00:00:05')
     */
    async generateThumbnail(videoPath, outputPath, timestamp = '00:00:05') {
        try {
            return new Promise((resolve, reject) => {
                ffmpeg(videoPath)
                    .screenshots({
                        timestamps: [timestamp],
                        filename: path.basename(outputPath),
                        folder: path.dirname(outputPath),
                        size: '1280x720',
                    })
                    .on('end', () => {
                        resolve({ success: true, thumbnailPath: outputPath });
                    })
                    .on('error', (err) => {
                        console.error('Thumbnail Generation Error:', err);
                        reject(new AppError('Failed to generate thumbnail', 500));
                    });
            });
        } catch (error) {
            console.error('Thumbnail Error:', error);
            throw new AppError('Failed to generate thumbnail', 500);
        }
    }

    /**
     * Get video metadata
     * @param {string} videoPath - Path to video file
     */
    async getVideoMetadata(videoPath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    reject(new AppError('Failed to get video metadata', 500));
                    return;
                }

                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

                resolve({
                    duration: metadata.format.duration,
                    size: metadata.format.size,
                    bitrate: metadata.format.bit_rate,
                    video: videoStream ? {
                        codec: videoStream.codec_name,
                        width: videoStream.width,
                        height: videoStream.height,
                        fps: eval(videoStream.r_frame_rate),
                    } : null,
                    audio: audioStream ? {
                        codec: audioStream.codec_name,
                        sampleRate: audioStream.sample_rate,
                        channels: audioStream.channels,
                    } : null,
                });
            });
        });
    }

    /**
     * Clean up temporary files
     * @param {string} directory - Directory to clean
     */
    async cleanup(directory) {
        try {
            await fs.rm(directory, { recursive: true, force: true });
        } catch (error) {
            console.error('Cleanup Error:', error);
        }
    }
}

export default new VideoConversionService();
