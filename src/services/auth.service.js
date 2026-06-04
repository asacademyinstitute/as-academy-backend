import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../config/database.js';
import { config } from '../config/config.js';
import { AppError } from '../middlewares/error.middleware.js';
import settingsService from './settings.service.js';

class AuthService {
    // Register new user
    async register(userData) {
        const { name, email, phone, password, enrollment_number, college_name, semester, role = 'student', deviceId } = userData;

        // Check if user already exists
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
            console.error('Registration error:', error);
            throw new AppError('Failed to create user', 500);
        }

        // Generate tokens (include deviceId so device locking works from first session)
        const { accessToken, refreshToken } = await this.generateTokens(user.id, user.role, deviceId || null);

        return {
            user,
            accessToken,
            refreshToken
        };
    }

    // Login user
    async login(email, password, deviceId) {
        // Get user
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            throw new AppError('Invalid email or password', 401);
        }

        // Check if user is blocked
        if (user.status === 'blocked') {
            throw new AppError('Your account has been blocked. Please contact admin.', 403);
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            throw new AppError('Invalid email or password', 401);
        }

        // For students, check device limit
        if (user.role === 'student' && deviceId) {
            await this.checkDeviceLimit(user.id, deviceId);
        }

        // Generate tokens
        const { accessToken, refreshToken } = await this.generateTokens(user.id, user.role, deviceId);

        // Remove password from response
        delete user.password_hash;

        return {
            user,
            accessToken,
            refreshToken
        };
    }

    // Generate access and refresh tokens
    async generateTokens(userId, role, deviceId = null) {
        // Include device_id in JWT for students to validate on every request
        const payload = { userId, role };
        if (role === 'student' && deviceId) {
            payload.deviceId = deviceId;
        }

        const accessToken = jwt.sign(
            payload,
            config.jwtSecret,
            { expiresIn: config.jwtExpiresIn }
        );

        const refreshToken = jwt.sign(
            { userId, role, tokenId: uuidv4() },
            config.jwtRefreshSecret,
            { expiresIn: config.jwtRefreshExpiresIn }
        );

        // Store refresh token in database
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

        await supabase
            .from('refresh_tokens')
            .insert({
                user_id: userId,
                token: refreshToken,
                device_id: deviceId,
                expires_at: expiresAt.toISOString()
            });

        // Register/update device in user_devices (only for students)
        if (role === 'student' && deviceId) {
            try {
                await supabase
                    .from('user_devices')
                    .upsert({
                        user_id: userId,
                        device_id: deviceId,
                        device_name: 'Registered Device',
                        last_active: new Date().toISOString()
                    }, {
                        onConflict: 'user_id,device_id'
                    });
            } catch (deviceRegError) {
                console.error('Failed to register device during login:', deviceRegError);
            }
        }

        return { accessToken, refreshToken };
    }

    // Refresh access token
    async refreshAccessToken(refreshToken) {
        try {
            // Verify refresh token
            const decoded = jwt.verify(refreshToken, config.jwtRefreshSecret);

            // Check if refresh token exists and is not revoked
            const { data: tokenRecord, error } = await supabase
                .from('refresh_tokens')
                .select('*')
                .eq('token', refreshToken)
                .eq('revoked', false)
                .single();

            if (error || !tokenRecord) {
                throw new AppError('Invalid refresh token', 401);
            }

            // Check if token is expired
            if (new Date(tokenRecord.expires_at) < new Date()) {
                throw new AppError('Refresh token expired', 401);
            }

            // Generate new access token
            const accessToken = jwt.sign(
                { userId: decoded.userId, role: decoded.role },
                config.jwtSecret,
                { expiresIn: config.jwtExpiresIn }
            );

            return { accessToken };
        } catch (error) {
            if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
                throw new AppError('Invalid or expired refresh token', 401);
            }
            throw error;
        }
    }

    // Logout user
    async logout(refreshToken) {
        if (!refreshToken) {
            return { success: true };
        }

        // Revoke refresh token
        await supabase
            .from('refresh_tokens')
            .update({ revoked: true })
            .eq('token', refreshToken);

        return { success: true };
    }

    // Check device limit for students - use global device limit setting
    async checkDeviceLimit(userId, currentDeviceId) {
        // Get global device limit for all students
        const deviceLimit = await settingsService.getStudentDeviceLimit();

        const { data: devices } = await supabase
            .from('user_devices')
            .select('device_id')
            .eq('user_id', userId);

        if (!devices || devices.length === 0) {
            // First login - allow
            return;
        }

        // Check if current device is already registered
        const isDeviceRegistered = devices.some(d => d.device_id === currentDeviceId);

        if (isDeviceRegistered) {
            // Device already registered - allow
            return;
        }

        // New device - check if global limit reached
        if (devices.length >= deviceLimit) {
            throw new AppError(
                'Your account has reached the maximum allowed devices. Contact admin.',
                403
            );
        }
    }

    // Reset device for student (admin only)
    async resetDevice(userId) {
        const { error: deviceError } = await supabase
            .from('user_devices')
            .delete()
            .eq('user_id', userId);

        if (deviceError) {
            throw new AppError('Failed to reset device', 500);
        }

        // Also delete/revoke active refresh tokens to force the student to re-login
        await supabase
            .from('refresh_tokens')
            .delete()
            .eq('user_id', userId);

        return { success: true, message: 'Device reset successfully' };
    }

    // Change password
    async changePassword(userId, currentPassword, newPassword) {
        // Get user
        const { data: user } = await supabase
            .from('users')
            .select('password_hash')
            .eq('id', userId)
            .single();

        if (!user) {
            throw new AppError('User not found', 404);
        }

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isPasswordValid) {
            throw new AppError('Current password is incorrect', 401);
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, config.bcryptRounds);

        // Update password
        const { error } = await supabase
            .from('users')
            .update({ password_hash: newPasswordHash })
            .eq('id', userId);

        if (error) {
            throw new AppError('Failed to change password', 500);
        }

        // Revoke all refresh tokens for this user
        await supabase
            .from('refresh_tokens')
            .update({ revoked: true })
            .eq('user_id', userId);

        return { success: true, message: 'Password changed successfully' };
    }
}

export default new AuthService();
