import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { AppError } from './error.middleware.js';
import supabase from '../config/database.js';
export { authorize } from './rbac.middleware.js';

export const authenticate = async (req, res, next) => {
    try {
        // Get token from header or query parameter (for media tags)
        let token = null;
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        } else if (req.query && req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            throw new AppError('No token provided. Please login.', 401);
        }

        // Verify token
        const decoded = jwt.verify(token, config.jwtSecret);

        // Get user from database
        const { data: user, error } = await supabase
            .from('users')
            .select('id, name, email, phone, role, status')
            .eq('id', decoded.userId)
            .single();

        if (error || !user) {
            throw new AppError('User not found or token invalid', 401);
        }

        // Check if user is blocked
        if (user.status === 'blocked') {
            throw new AppError('Your account has been blocked. Please contact admin.', 403);
        }

        // Attach user to request (including device ID from JWT)
        req.user = { ...user, deviceId: decoded.deviceId };

        // Handle device tracking and validation for students
        if (user.role === 'student') {
            const tokenDeviceId = decoded.deviceId;
            const requestDeviceId = req.headers['x-device-id'] || req.query?.deviceId || tokenDeviceId;

            // 1. Device Tracking: Upsert device details
            try {
                const activeDeviceId = tokenDeviceId || requestDeviceId;
                if (activeDeviceId) {
                    const userAgent = req.headers['user-agent'] || '';
                    const ip = req.ip || req.connection.remoteAddress || '';
                    
                    await supabase
                        .from('user_devices')
                        .upsert({
                            user_id: user.id,
                            device_id: activeDeviceId,
                            device_name: extractDeviceName(userAgent),
                            ip_address: ip,
                            user_agent: userAgent,
                            last_active: new Date().toISOString()
                        }, {
                            onConflict: 'user_id,device_id'
                        });
                }
            } catch (trackError) {
                console.error('Device auto-tracking error in authenticate:', trackError);
            }

            // 2. Device Validation (only if global enforcement is enabled)
            const { data: enforcementSetting } = await supabase
                .from('system_settings')
                .select('setting_value')
                .eq('setting_key', 'device_tracking_enabled')
                .single();

            const isEnforcementEnabled = enforcementSetting?.setting_value === 'true';

            if (isEnforcementEnabled && tokenDeviceId) {
                // If token has device ID but request header doesn't
                if (!requestDeviceId) {
                    console.error(`🚫 Device validation failed for student ${user.id}: No device ID in header`);
                    const error = new AppError('Session invalidated due to device reset or device change', 403);
                    error.code = 'DEVICE_SESSION_INVALID';
                    throw error;
                }

                // If device IDs don't match
                if (requestDeviceId && tokenDeviceId !== requestDeviceId) {
                    console.error(`🚫 Device mismatch for student ${user.id}: Token=${tokenDeviceId} Request=${requestDeviceId}`);
                    
                    // Revoke all refresh tokens
                    await supabase
                        .from('refresh_tokens')
                        .update({ revoked: true })
                        .eq('user_id', user.id);

                    const error = new AppError('Session invalidated due to device reset or device change', 403);
                    error.code = 'DEVICE_SESSION_INVALID';
                    throw error;
                }
            }
        }

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return next(new AppError('Invalid token. Please login again.', 401));
        }
        if (error.name === 'TokenExpiredError') {
            return next(new AppError('Token expired. Please login again.', 401));
        }
        next(error);
    }
};

export const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            req.user = null;
            return next();
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, config.jwtSecret);

        const { data: user } = await supabase
            .from('users')
            .select('id, name, email, phone, role, status')
            .eq('id', decoded.userId)
            .single();

        req.user = user || null;
        next();
    } catch (error) {
        req.user = null;
        next();
    }
};

// Helper: Extract device name from user agent
function extractDeviceName(userAgent) {
    if (!userAgent) return 'Unknown Device';
    if (userAgent.includes('Windows')) return 'Windows PC';
    if (userAgent.includes('Mac')) return 'Mac';
    if (userAgent.includes('Linux')) return 'Linux PC';
    if (userAgent.includes('iPhone')) return 'iPhone';
    if (userAgent.includes('iPad')) return 'iPad';
    if (userAgent.includes('Android')) return 'Android Device';
    return 'Unknown Device';
}
