/**
 * Process Queries
 * Handles queries for processes and pipeline refreshes.
 */

class ProcessQueries {
    constructor(db) {
        this.db = db;
    }

    /**
     * Get pipeline refreshes sorted by time
     */
    async getPipelineRefreshes() {
        const refreshes = await this.db.pipeline_refreshes.toArray();
        return refreshes.sort((a, b) => (a.total_time_seconds || 0) - (b.total_time_seconds || 0));
    }

    /**
     * Get processes breakdown grouped by type
     * @returns {Promise<Array>} Sorted array of process type statistics
     */
    async getBreakdown() {
        const processes = await this.db.processes.toArray();

        const breakdown = {};
        
        for (const op of processes) {
            const type = op.process_type || 'Unknown';
            if (!breakdown[type]) {
                breakdown[type] = {
                    type: type,
                    count: 0,
                    total_time_ms: 0
                };
            }
            breakdown[type].count++;
            breakdown[type].total_time_ms += op.duration_ms || 0;
        }

        return Object.values(breakdown).sort((a, b) => b.total_time_ms - a.total_time_ms);
    }

    /**
     * Get processes filtered by type
     * @param {string} processType - Type of process to filter by
     */
    async getByType(processType) {
        const processes = await this.db.processes
            .filter(op => op.process_type === processType)
            .toArray();

        return processes.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
    }
}

// Export for use in other modules
window.ProcessQueries = ProcessQueries;

