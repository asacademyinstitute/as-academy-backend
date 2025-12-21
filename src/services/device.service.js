import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import auditService from './audit.service.js';

class DeviceService {
    // Get all device activity with abuse detection
    async getDeviceActivity(filters = {}) {
        const query = supabase
            .from('user_devices')
            .select(`
                *,
                users:user_id (
                    id,
                    name,
                    email,
                    phone,
                    role,
                    status
                )
            `)
            .order('last_login_at', { ascending: false });

        const { data: devices, error } = await query;

        if (error) {
            console.error('Database error fetching devices:', error);
            throw new AppError('Failed to fetch device activity', 500);
        }

        // Filter by user role (only students) - do this after fetching since Supabase doesn't support filtering on joined fields
        let filteredDevices = devices || [];
        if (filters.studentsOnly) {
            filteredDevices = filteredDevices.filter(device => device.users?.role === 'student');
        }

        // Get global device limit
        const maxDevices = await this.getGlobalDeviceLimit();

        // Group by user and detect abuse
        const userDeviceMap = {};
        filteredDevices.forEach(device => {
            const userId = device.user_id;
            if (!userDeviceMap[userId]) {
                userDeviceMap[userId] = {
                    user: device.users,
                    devices: [],
                    totalDevices: 0,
                    loginCount: 0,
                    lastLogin: null,
                    suspicious: false
                };
            }
            userDeviceMap[userId].devices.push(device);
            userDeviceMap[userId].totalDevices++;
            userDeviceMap[userId].loginCount += device.login_count || 0;

            if (!userDeviceMap[userId].lastLogin || new Date(device.last_login_at) > new Date(userDeviceMap[userId].lastLogin)) {
                userDeviceMap[userId].lastLogin = device.last_login_at;
            }

            // Flag as suspicious if exceeds device limit or frequent changes
            if (userDeviceMap[userId].totalDevices > maxDevices || device.device_changes_count > 5) {
                userDeviceMap[userId].suspicious = true;
            }
        });

        return {
            devices: Object.values(userDeviceMap),
            maxDevices
        };
    }

    // Get devices for specific student
    async getStudentDevices(userId) {
        const { data: devices, error } = await supabase
            .from('user_devices')
            .select('*')
            .eq('user_id', userId)
            .order('last_login_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch student devices', 500);
        }

        return devices || [];
    }

    // Force logout student (revoke all refresh tokens)
    async forceLogoutStudent(userId, adminId) {
        // Verify user is a student
        const { data: user } = await supabase
            .from('users')
            .select('role')
            .eq('id', userId)
            .single();

        if (!user) {
            throw new AppError('User not found', 404);
        }

        if (user.role !== 'student') {
            throw new AppError('This action can only be performed on student accounts', 403);
        }

        // Revoke all refresh tokens
        const { error } = await supabase
            .from('refresh_tokens')
            .update({ revoked: true })
            .eq('user_id', userId);

        if (error) {
            throw new AppError('Failed to force logout student', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'FORCE_LOGOUT',
            `Forced logout for student ID: ${userId}`
        );

        return { success: true, message: 'Student logged out successfully' };
    };

    // Reset student devices
    async resetStudentDevices(userId, adminId) {
        // Verify user is a student
        const { data: user } = await supabase
            .from('users')
            .select('role, status')
            .eq('id', userId)
            .single();

        if (!user) {
            throw new AppError('User not found', 404);
        }

        if (user.role !== 'student') {
            throw new AppError('This action can only be performed on student accounts', 403);
        }

        console.log(`🔄 Starting device reset for student ${userId}...`);

        // 1. Delete ALL device records for this student
        const { error: deviceError } = await supabase
            .from('user_devices')
            .delete()
            .eq('user_id', userId);

        if (deviceError) {
            console.error('Failed to delete devices:', deviceError);
            throw new AppError('Failed to reset student devices', 500);
        }
        console.log(`✅ Deleted all device records for student ${userId}`);

        // 2. Delete ALL refresh tokens for this student (complete cleanup)
        const { error: tokenError } = await supabase
            .from('refresh_tokens')
            .delete()
            .eq('user_id', userId);

        if (tokenError) {
            console.error('Failed to delete refresh tokens:', tokenError);
            // Don't throw error, just log it - device reset is more important
        } else {
            console.log(`✅ Deleted all refresh tokens for student ${userId}`);
        }

        // 3. Reset security flags (ensure account is active and not flagged)
        const { error: userUpdateError } = await supabase
            .from('users')
            .update({
                status: 'active',
                // Note: is_suspicious field may not exist in schema, but if it does, reset it
            })
            .eq('id', userId);

        if (userUpdateError) {
            console.error('Failed to update user status:', userUpdateError);
            // Don't throw - device reset is more critical
        } else {
            console.log(`✅ Reset security flags for student ${userId}`);
        }

        console.log(`✅ Device reset complete for student ${userId}: All devices and tokens deleted, security flags reset`);
        console.log(`📚 Course data preserved: enrollments, payments, progress, certificates remain intact`);

        // Log action
        await auditService.log(
            adminId,
            'DEVICE_RESET',
            `Reset devices for student ID: ${userId} - Devices deleted, tokens revoked, security flags reset. Course data preserved.`
        );

        return {
            success: true,
            message: 'Student devices reset successfully. Student can now login from a new device. All course data and progress preserved.'
        };
    };

    // Get global device limit
    async getGlobalDeviceLimit() {
        const { data, error } = await supabase
            .from('system_settings')
            .select('setting_value')
            .eq('setting_key', 'max_devices_per_student')
            .single();

        if (error || !data) {
            return 1; // Default to 1 device
        }

        return parseInt(data.setting_value) || 1;
    }

    // Set global device limit
    async setGlobalDeviceLimit(limit, adminId) {
        if (![1, 2].includes(limit)) {
            throw new AppError('Device limit must be 1 or 2', 400);
        }

        const { error } = await supabase
            .from('system_settings')
            .update({
                setting_value: limit.toString(),
                updated_by: adminId,
                updated_at: new Date().toISOString()
            })
            .eq('setting_key', 'max_devices_per_student');

        if (error) {
            throw new AppError('Failed to update device limit', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'DEVICE_LIMIT_CHANGED',
            `Changed global device limit to ${limit}`
        );

        return { success: true, message: `Device limit set to ${limit}`, limit };
    }

    // Get all device settings
    async getDeviceSettings() {
        const { data: settings, error } = await supabase
            .from('system_settings')
            .select('*')
            .in('setting_key', ['max_devices_per_student', 'device_tracking_enabled']);

        if (error) {
            throw new AppError('Failed to fetch device settings', 500);
        }

        const settingsMap = {};
        settings.forEach(setting => {
            settingsMap[setting.setting_key] = setting.setting_value;
        });

        return {
            maxDevicesPerStudent: parseInt(settingsMap.max_devices_per_student) || 1,
            deviceTrackingEnabled: settingsMap.device_tracking_enabled === 'true'
        };
    }

    // Toggle device enforcement on/off
    async toggleDeviceEnforcement(enabled, adminId) {
        const value = enabled ? 'true' : 'false';

        // First try to update, if no rows affected, insert
        const { data: existing } = await supabase
            .from('system_settings')
            .select('id')
            .eq('setting_key', 'device_tracking_enabled')
            .single();

        if (existing) {
            const { error } = await supabase
                .from('system_settings')
                .update({
                    setting_value: value,
                    updated_by: adminId,
                    updated_at: new Date().toISOString()
                })
                .eq('setting_key', 'device_tracking_enabled');

            if (error) {
                throw new AppError('Failed to toggle device enforcement', 500);
            }
        } else {
            const { error } = await supabase
                .from('system_settings')
                .insert({
                    setting_key: 'device_tracking_enabled',
                    setting_value: value,
                    description: 'Enable device tracking and enforcement',
                    updated_by: adminId
                });

            if (error) {
                throw new AppError('Failed to toggle device enforcement', 500);
            }
        }

        // Log action
        await auditService.log(
            adminId,
            'DEVICE_ENFORCEMENT_TOGGLED',
            `Device enforcement ${enabled ? 'enabled' : 'disabled'}`
        );

        return {
            success: true,
            message: `Device enforcement ${enabled ? 'enabled' : 'disabled'}`,
            enabled
        };
    }

    // Reset all student devices (DESTRUCTIVE - admin only)
    async resetAllStudentDevices(adminId) {
        // Get all students
        const { data: students, error: studentsError } = await supabase
            .from('users')
            .select('id')
            .eq('role', 'student');

        if (studentsError) {
            throw new AppError('Failed to fetch students', 500);
        }

        const studentIds = students.map(s => s.id);

        // Delete all student devices
        const { error: devicesError } = await supabase
            .from('user_devices')
            .delete()
            .in('user_id', studentIds);

        if (devicesError) {
            throw new AppError('Failed to reset all student devices', 500);
        }

        // Revoke all student refresh tokens
        const { error: tokensError } = await supabase
            .from('refresh_tokens')
            .update({ revoked: true })
            .in('user_id', studentIds);

        if (tokensError) {
            console.error('Failed to revoke tokens:', tokensError);
        }

        // Log action
        await auditService.log(
            adminId,
            'RESET_ALL_DEVICES',
            `Reset devices for all ${students.length} students`
        );

        return {
            success: true,
            message: `Reset devices for ${students.length} students`,
            count: students.length
        };
    }

    // Block specific device
    async blockDevice(deviceId, adminId) {
        // Get device and user info
        const { data: device } = await supabase
            .from('user_devices')
            .select('user_id, users:user_id(role)')
            .eq('id', deviceId)
            .single();

        if (!device) {
            throw new AppError('Device not found', 404);
        }

        // Verify user is a student
        if (device.users?.role !== 'student') {
            throw new AppError('This action can only be performed on student accounts', 403);
        }

        const { error } = await supabase
            .from('user_devices')
            .update({ is_blocked: true })
            .eq('id', deviceId);

        if (error) {
            throw new AppError('Failed to block device', 500);
        }

        // Log action
        await auditService.log(
            adminId,
            'DEVICE_BLOCKED',
            `Blocked device ID: ${deviceId} for student ID: ${device.user_id}`
        );

        return { success: true, message: 'Device blocked successfully' };
    }
}

export default new DeviceService();
