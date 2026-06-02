class AuditService {
    // Log an action (DEACTIVATED to optimize database performance and prevent storage bloat)
    async log(userId, action, description, metadata = {}, req = null) {
        // Logging deactivated
        return { success: true };
    }

    // Get audit logs with filters (DEACTIVATED)
    async getLogs(filters = {}, page = 1, limit = 50) {
        return {
            logs: [],
            pagination: {
                page,
                limit,
                total: 0,
                totalPages: 0
            }
        };
    }

    // Get user activity summary (DEACTIVATED)
    async getUserActivity(userId, days = 30) {
        return {
            totalActions: 0,
            actionCounts: {},
            recentLogs: []
        };
    }
}

export default new AuditService();
