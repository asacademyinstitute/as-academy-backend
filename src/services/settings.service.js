import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import auditService from './audit.service.js';

class SettingsService {
    // Get a specific setting by key
    async getSetting(key) {
        const { data: setting, error } = await supabase
            .from('system_settings')
            .select('*')
            .eq('setting_key', key)
            .single();

        if (error || !setting) {
            throw new AppError(`Setting '${key}' not found`, 404);
        }

        return setting;
    }

    // Get all settings
    async getAllSettings() {
        const { data: settings, error } = await supabase
            .from('system_settings')
            .select('*')
            .order('setting_key');

        if (error) {
            throw new AppError('Failed to fetch settings', 500);
        }

        return settings || [];
    }

    // Update a setting
    async updateSetting(key, value, adminId) {
        // Validate value based on key
        if (key === 'student_device_limit') {
            const numValue = parseInt(value);
            if (![1, 2].includes(numValue)) {
                throw new AppError('student_device_limit must be 1 or 2', 400);
            }
            value = numValue.toString();
        }

        const { data: setting, error } = await supabase
            .from('system_settings')
            .update({
                setting_value: value,
                updated_at: new Date().toISOString(),
                updated_by: adminId
            })
            .eq('setting_key', key)
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to update setting', 500);
        }

        // Log the change
        await auditService.log(
            adminId,
            'SETTING_UPDATED',
            `Updated setting '${key}' to '${value}'`
        );

        return setting;
    }

    // Get student device limit (helper method)
    async getStudentDeviceLimit() {
        try {
            const setting = await this.getSetting('student_device_limit');
            return parseInt(setting.setting_value) || 1;
        } catch (error) {
            // If setting doesn't exist, return default
            console.error('Error fetching student_device_limit:', error);
            return 1;
        }
    }
}

export default new SettingsService();
