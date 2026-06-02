import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// Generate a device fingerprint from request
export const generateDeviceId = (req) => {
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.connection.remoteAddress || '';

    // Create a hash from user agent and IP
    const hash = crypto
        .createHash('sha256')
        .update(userAgent + ip)
        .digest('hex');

    return hash;
};

// Track device on each request
export const trackDevice = async (req, res, next) => {
    if (!req.user) {
        return next();
    }

    try {
        const deviceId = generateDeviceId(req);
        const userAgent = req.headers['user-agent'] || '';
        const ip = req.ip || req.connection.remoteAddress || '';

        // Store device ID in request for later use
        req.deviceId = deviceId;

        const supabase = (await import('../config/database.js')).default;

        // For all users, use upsert to track devices
        await supabase
            .from('user_devices')
            .upsert({
                user_id: req.user.id,
                device_id: deviceId,
                device_name: extractDeviceName(userAgent),
                ip_address: ip,
                user_agent: userAgent,
                last_active: new Date().toISOString()
            }, {
                onConflict: 'user_id,device_id'
            });

        next();
    } catch (error) {
        console.error('Device tracking error:', error);
        next();
    }
};

// Check device limit for students - use global device limit setting
export const checkDeviceLimit = async (req, res, next) => {
    if (!req.user || req.user.role !== 'student') {
        return next();
    }

    try {
        const deviceId = req.deviceId || generateDeviceId(req);
        const supabase = (await import('../config/database.js')).default;
        const settingsService = (await import('../services/settings.service.js')).default;

        // Check if device restriction enforcement is globally enabled
        const trackingEnabled = await settingsService.getSetting('device_tracking_enabled').catch(() => ({ setting_value: 'true' }));
        if (trackingEnabled.setting_value !== 'true') {
            return next();
        }

        // Get global device limit for all students
        const deviceLimit = await settingsService.getStudentDeviceLimit();

        // Get all devices for this user
        const { data: devices, error } = await supabase
            .from('user_devices')
            .select('device_id')
            .eq('user_id', req.user.id);

        if (error) {
            console.error('Device limit check error:', error);
            return next();
        }

        if (!devices || devices.length === 0) {
            // First login - allow and device will be registered
            return next();
        }

        // Check if current device is already registered
        const isDeviceRegistered = devices.some(d => d.device_id === deviceId);

        if (isDeviceRegistered) {
            // Device already registered - allow
            return next();
        }

        // New device - check if global limit reached
        if (devices.length >= deviceLimit) {
            const { AppError } = await import('./error.middleware.js');
            return next(
                new AppError(
                    'Your account has reached the maximum allowed devices. Contact admin.',
                    403
                )
            );
        }

        next();
    } catch (error) {
        console.error('Device limit check error:', error);
        next();
    }
};

// Extract device name from user agent
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
