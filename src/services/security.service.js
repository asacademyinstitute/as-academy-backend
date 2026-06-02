import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';

class SecurityService {
    // Validate device fingerprint format (SHA-256 hash)
    validateDeviceFingerprint(fingerprint) {
        const sha256Regex = /^[a-f0-9]{64}$/i;
        return sha256Regex.test(fingerprint);
    }

    // Get watermark data for user (name, email, phone)
    async getWatermarkData(userId) {
        try {
            const { data: user, error } = await supabase
                .from('users')
                .select('name, email, phone')
                .eq('id', userId)
                .single();

            if (error || !user) {
                throw new AppError('User not found', 404);
            }

            return {
                name: user.name,
                email: user.email,
                phone: user.phone,
            };
        } catch (error) {
            throw error;
        }
    }

    // Log security violation
    async logViolation(userId, violationType, deviceInfo, ipAddress, userAgent) {
        try {
            const { error } = await supabase
                .from('security_violations')
                .insert({
                    user_id: userId,
                    violation_type: violationType,
                    device_info: deviceInfo,
                    ip_address: ipAddress,
                    user_agent: userAgent,
                });

            if (error) {
                console.error('Failed to log security violation:', error);
            }

            return { success: true };
        } catch (error) {
            console.error('Failed to log security violation:', error);
            return { success: false };
        }
    }

    // Get security violations for admin
    async getViolations(filters = {}) {
        try {
            let query = supabase
                .from('security_violations')
                .select(`
                    *,
                    users (
                        name,
                        email,
                        role
                    )
                `)
                .order('created_at', { ascending: false });

            if (filters.userId) {
                query = query.eq('user_id', filters.userId);
            }

            if (filters.violationType) {
                query = query.eq('violation_type', filters.violationType);
            }

            if (filters.limit) {
                query = query.limit(filters.limit);
            }

            const { data, error } = await query;

            if (error) {
                throw new AppError('Failed to fetch violations', 500);
            }

            return data;
        } catch (error) {
            throw error;
        }
    }

    // Get security statistics for admin dashboard
    async getSecurityStats() {
        try {
            // Total violations
            const { count: totalViolations } = await supabase
                .from('security_violations')
                .select('*', { count: 'exact', head: true });

            // Violations by type
            const { data: violationsByType } = await supabase
                .from('security_violations')
                .select('violation_type')
                .then(({ data }) => {
                    const counts = {};
                    data?.forEach(v => {
                        counts[v.violation_type] = (counts[v.violation_type] || 0) + 1;
                    });
                    return { data: counts };
                });

            // Recent violations (last 24 hours)
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const { count: recentViolations } = await supabase
                .from('security_violations')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', yesterday.toISOString());

            return {
                total_violations: totalViolations || 0,
                violations_by_type: violationsByType || {},
                recent_violations_24h: recentViolations || 0,
            };
        } catch (error) {
            throw error;
        }
    }
}

export default new SecurityService();
