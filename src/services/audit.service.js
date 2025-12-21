import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';

class AuditService {
    // Log an action
    async log(userId, action, description, metadata = {}, req = null) {
        try {
            const logData = {
                user_id: userId,
                action,
                description,
                metadata,
            };

            if (req) {
                logData.ip_address = req.ip || req.connection?.remoteAddress;
                logData.user_agent = req.headers['user-agent'];
            }

            await supabase
                .from('audit_logs')
                .insert(logData);
        } catch (error) {
            console.error('Audit log error:', error);
            // Don't throw error, just log it
        }
    }

    // Get audit logs with filters
    async getLogs(filters = {}, page = 1, limit = 50) {
        let query = supabase
            .from('audit_logs')
            .select(`
        *,
        users:user_id (
          name,
          email,
          role
        )
      `, { count: 'exact' })
            .order('created_at', { ascending: false });

        // Apply filters
        if (filters.userId) {
            query = query.eq('user_id', filters.userId);
        }

        if (filters.action) {
            query = query.eq('action', filters.action);
        }

        if (filters.startDate) {
            query = query.gte('created_at', filters.startDate);
        }

        if (filters.endDate) {
            query = query.lte('created_at', filters.endDate);
        }

        // Pagination
        const offset = (page - 1) * limit;
        query = query.range(offset, offset + limit - 1);

        const { data: logs, error, count } = await query;

        if (error) {
            throw new AppError('Failed to fetch audit logs', 500);
        }

        return {
            logs,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit)
            }
        };
    }

    // Get user activity summary
    async getUserActivity(userId, days = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const { data: logs, error } = await supabase
            .from('audit_logs')
            .select('action, created_at')
            .eq('user_id', userId)
            .gte('created_at', startDate.toISOString())
            .order('created_at', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch user activity', 500);
        }

        // Group by action
        const actionCounts = logs.reduce((acc, log) => {
            acc[log.action] = (acc[log.action] || 0) + 1;
            return acc;
        }, {});

        return {
            totalActions: logs.length,
            actionCounts,
            recentLogs: logs.slice(0, 10)
        };
    }
}

export default new AuditService();
