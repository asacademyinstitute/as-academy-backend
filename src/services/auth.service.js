import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../config/database.js';
import { config } from '../config/config.js';
import { AppError } from '../middlewares/error.middleware.js';

class AuthService {
    // Register new user
    async register(userData) {
        const { name, email, phone, password, college_name, semester, role = 'student', deviceId } = userData;

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
                college_name,
                semester,
                role,
                status: 'active'
            })
            .select('id, name, email, phone, role, college_name, semester, created_at')
            .single();

        if (error) {
            console.error('Registration error:', error);
            throw new AppError('Failed to create user', 500);
        }

        // Generate tokens (deviceId optional, will be bound for students if provided)
        const { accessToken, refreshToken } = await this.generateTokens(user.id, user.role, deviceId);

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

        // For students ONLY, check device limit (admin/teacher exempt)
        if (user.role === 'student' && deviceId) {
            await this.checkDeviceLimit(user.id, deviceId);
        }

        // CRITICAL: For students, enforce SINGLE ACTIVE SESSION
        // Revoke ALL existing tokens before issuing new one
        if (user.role === 'student') {
            console.log(`🔒 Enforcing single session for student ${user.id} - revoking all existing tokens`);

            const { error: revokeError } = await supabase
                .from('refresh_tokens')
                .delete()
                .eq('user_id', user.id);

            if (revokeError) {
                console.error('Failed to revoke existing tokens:', revokeError);
                // Continue anyway - new token will be issued
            } else {
                console.log(`✅ Revoked all existing tokens for student ${user.id}`);
            }
        }

        // Generate tokens (deviceId optional for admin/teacher, required for students)
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
        // For students, device ID is REQUIRED and bound to token
        // For admin/teacher, device ID is optional and not bound
        const tokenPayload = { userId, role };

        if (role === 'student' && deviceId) {
            tokenPayload.deviceId = deviceId; // Bind device to token
        }

        const accessToken = jwt.sign(
            tokenPayload,
            config.jwtSecret,
            { expiresIn: config.jwtExpiresIn }
        );

        const refreshTokenPayload = { ...tokenPayload, tokenId: uuidv4() };

        const refreshToken = jwt.sign(
            refreshTokenPayload,
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
                throw new AppError('Session expired. Please login again.', 401);
            }

            // Check if token is expired
            if (new Date(tokenRecord.expires_at) < new Date()) {
                throw new AppError('Refresh token expired. Please login again.', 401);
            }

            // Generate new access token with same payload as original
            const tokenPayload = { userId: decoded.userId, role: decoded.role };

            // For students, include deviceId in new access token
            if (decoded.role === 'student' && decoded.deviceId) {
                tokenPayload.deviceId = decoded.deviceId;
            }

            const accessToken = jwt.sign(
                tokenPayload,
                config.jwtSecret,
                { expiresIn: config.jwtExpiresIn }
            );

            return { accessToken };
        } catch (error) {
            if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
                throw new AppError('Invalid or expired refresh token. Please login again.', 401);
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

    // Check device limit for students
    async checkDeviceLimit(userId, currentDeviceId) {
        // First check if device enforcement is enabled globally
        const { data: enforcementSetting } = await supabase
            .from('system_settings')
            .select('setting_value')
            .eq('setting_key', 'device_tracking_enabled')
            .single();

        const isEnforcementEnabled = enforcementSetting?.setting_value === 'true';

        // If enforcement is disabled, skip all device checks
        if (!isEnforcementEnabled) {
            console.log(`✅ Device enforcement disabled - skipping device limit check for user ${userId}`);
            return;
        }

        // Get global device limit from database
        const { data: settingData } = await supabase
            .from('system_settings')
            .select('setting_value')
            .eq('setting_key', 'max_devices_per_student')
            .single();

        const maxDevices = settingData ? parseInt(settingData.setting_value) : 1;

        // Get user's devices
        const { data: devices } = await supabase
            .from('user_devices')
            .select('device_id, is_blocked')
            .eq('user_id', userId);

        if (!devices) return;

        // Check if current device is blocked
        const blockedDevice = devices.find(d => d.device_id === currentDeviceId && d.is_blocked);
        if (blockedDevice) {
            throw new AppError('This device has been blocked by admin. Please contact support.', 403);
        }

        const isDeviceRegistered = devices.some(d => d.device_id === currentDeviceId);

        if (!isDeviceRegistered && devices.length >= maxDevices) {
            throw new AppError(
                `Device limit reached. You can only access from ${maxDevices} device(s). Please contact admin to reset your device.`,
                403
            );
        }

        // Update or insert device record
        if (isDeviceRegistered) {
            // Update existing device - increment login count
            const { data: currentDevice } = await supabase
                .from('user_devices')
                .select('login_count')
                .eq('user_id', userId)
                .eq('device_id', currentDeviceId)
                .single();

            await supabase
                .from('user_devices')
                .update({
                    login_count: (currentDevice?.login_count || 0) + 1,
                    last_login_at: new Date().toISOString(),
                    last_active: new Date().toISOString()
                })
                .eq('user_id', userId)
                .eq('device_id', currentDeviceId);
        } else {
            // Track device change if user had previous devices
            if (devices.length > 0) {
                const { data: userDevices } = await supabase
                    .from('user_devices')
                    .select('device_changes_count')
                    .eq('user_id', userId)
                    .limit(1)
                    .single();

                await supabase
                    .from('user_devices')
                    .update({
                        device_changes_count: (userDevices?.device_changes_count || 0) + 1
                    })
                    .eq('user_id', userId);
            }
        }
    }


    // Reset device for student (admin only)
    async resetDevice(userId) {
        const { error } = await supabase
            .from('user_devices')
            .delete()
            .eq('user_id', userId);

        if (error) {
            throw new AppError('Failed to reset device', 500);
        }

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
