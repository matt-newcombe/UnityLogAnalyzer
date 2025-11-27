/**
 * Summary Query
 * Aggregates statistics across asset imports, pipeline refreshes, and processes.
 */

class SummaryQuery {
    constructor(db, logId) {
        this.db = db;
        this.logId = logId;
    }

    /**
     * Build complete summary statistics for a log
     * @returns {Promise<Object>} Summary object with all aggregated stats
     */
    async build() {
        const [assetImports, refreshes, processes, metadata] = await Promise.all([
            this.db.asset_imports.toArray(),
            this.db.pipeline_refreshes.toArray(),
            this.db.processes.toArray(),
            this.db.log_metadata.get(this.logId)
        ]);

        return {
            asset_imports: this._buildAssetImportStats(assetImports),
            by_category: this._aggregateBy(assetImports, 'asset_category', 'Other'),
            by_type: this._aggregateBy(assetImports, 'asset_type', 'Unknown'),
            by_importer: this._aggregateBy(assetImports, 'importer_type', 'Unknown'),
            pipeline_refreshes: this._buildPipelineStats(refreshes),
            script_compilation: this._buildScriptCompilationStats(processes),
            unity_version: metadata?.unity_version || null,
            project_load_time_seconds: this._getProjectLoadTime(refreshes)
        };
    }

    /**
     * Build asset import statistics
     */
    _buildAssetImportStats(assetImports) {
        if (assetImports.length === 0) {
            return {};
        }

        const totalTime = assetImports.reduce((sum, a) => sum + (a.duration_ms || 0), 0);
        const maxTime = Math.max(...assetImports.map(a => a.duration_ms || 0));

        return {
            count: assetImports.length,
            total_time: totalTime,
            avg_time: totalTime / assetImports.length,
            max_time: maxTime
        };
    }

    /**
     * Aggregate assets by a given field
     * @param {Array} assets - Asset imports array
     * @param {string} field - Field to group by
     * @param {string} defaultValue - Default value for missing fields
     * @returns {Array} Sorted array of aggregated stats
     */
    _aggregateBy(assets, field, defaultValue) {
        if (assets.length === 0) {
            return [];
        }

        const groups = {};
        
        for (const asset of assets) {
            const key = asset[field] || defaultValue;
            if (!groups[key]) {
                groups[key] = { count: 0, total_time: 0 };
            }
            groups[key].count++;
            groups[key].total_time += asset.duration_ms || 0;
        }

        return Object.entries(groups)
            .map(([key, data]) => ({
                [field]: key,
                count: data.count,
                total_time: data.total_time,
                avg_time: data.total_time / data.count
            }))
            .sort((a, b) => b.total_time - a.total_time);
    }

    /**
     * Build pipeline refresh statistics
     */
    _buildPipelineStats(refreshes) {
        if (refreshes.length === 0) {
            return {};
        }

        const totalTime = refreshes.reduce((sum, r) => sum + (r.total_time_seconds || 0), 0);
        
        return {
            count: refreshes.length,
            total_time_seconds: totalTime
        };
    }

    /**
     * Build script compilation statistics
     */
    _buildScriptCompilationStats(processes) {
        const scriptCompOps = processes.filter(op => op.process_type === 'Script Compilation');
        
        return {
            count: scriptCompOps.length,
            total_time_ms: scriptCompOps.reduce((sum, op) => sum + (op.duration_ms || 0), 0)
        };
    }

    /**
     * Get project load time from largest pipeline refresh
     */
    _getProjectLoadTime(refreshes) {
        if (refreshes.length === 0) {
            return null;
        }

        const maxRefresh = refreshes.reduce((max, r) =>
            (r.total_time_seconds || 0) > (max.total_time_seconds || 0) ? r : max
        );
        
        return maxRefresh.total_time_seconds;
    }
}

// Export for use in other modules
window.SummaryQuery = SummaryQuery;

