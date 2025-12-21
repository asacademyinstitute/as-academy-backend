import { AppError } from './error.middleware.js';

/**
 * Validate device ID for students
 * Ensures the device ID in the JWT matches the device ID in the request header
 * Only enforced for students - Admin and Teacher are exempt
 * Only enforced when device_tracking_enabled is true in system_settings
 */
export const validateDevice = async (req, res, next) => {
    try {
        // Skip validation if no user (will be caught by authenticate middleware)
        if (!req.user) {
            return next();
        }

        // Skip validation for Admin and Teacher (they don't have deviceId in token)
        if (req.user.role === 'admin' || req.user.role === 'teacher') {
            console.log(`✅ Device validation skipped for ${req.user.role}: ${req.user.userId}`);
            return next();
        }

        // For students, check if device enforcement is enabled globally
        if (req.user.role === 'student') {
            // Check global enforcement setting
            const supabase = (await import('../config/database.js')).default;
            const { data: enforcementSetting } = await supabase
                .from('system_settings')
                .select('setting_value')
                .eq('setting_key', 'device_tracking_enabled')
                .single();

            const isEnforcementEnabled = enforcementSetting?.setting_value === 'true';

            // If enforcement is disabled, skip validation
            if (!isEnforcementEnabled) {
                console.log(`✅ Device enforcement disabled - skipping validation for student: ${req.user.userId}`);
                return next();
            }

            const tokenDeviceId = req.user.deviceId; // From JWT payload
            const requestDeviceId = req.headers['x-device-id']; // From request header

            // If token doesn't have deviceId, skip validation (backward compatibility)
            if (!tokenDeviceId) {
                console.log(`⚠️ Student token without deviceId (legacy): ${req.user.userId}`);
                return next();
            }

            // If token has device ID but request doesn't
            if (tokenDeviceId && !requestDeviceId) {
                console.error(`🚫 Device validation failed for user ${req.user.userId}: No device ID in request`);
                const error = new AppError('Session invalidated due to device reset or device change', 403);
                error.code = 'DEVICE_SESSION_INVALID';
                return next(error);
            }

            // If device IDs don't match
            if (tokenDeviceId && requestDeviceId && tokenDeviceId !== requestDeviceId) {
                console.error(`🚫 Device mismatch for user ${req.user.userId}: Token=${tokenDeviceId.substring(0, 8)}... Request=${requestDeviceId.substring(0, 8)}...`);

                // Revoke all tokens for this user (force logout)
                await supabase
                    .from('refresh_tokens')
                    .update({ revoked: true })
                    .eq('user_id', req.user.userId);

                const error = new AppError('Session invalidated due to device reset or device change', 403);
                error.code = 'DEVICE_SESSION_INVALID';
                return next(error);
            }

            console.log(`✅ Device validated for student: ${req.user.userId}`);
        }

        next();
    } catch (error) {
        console.error('Device validation error:', error);
        // Don't block request on validation error, just log it
        console.error('⚠️ Device validation error, allowing request to proceed');
        next();
    }
};

export default validateDevice;
