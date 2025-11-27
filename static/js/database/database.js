/**
 * Unity Log Database
 * 
 * Main database facade that provides a unified API for all database operations.
 * Delegates to specialized query classes for complex operations.
 * 
 * Architecture:
 * - UnityLogDatabaseCore: Schema, versioning, connection management, bulk inserts
 * - SummaryQuery: Aggregated statistics
 * - AssetQueries: Asset import queries with compound indexes
 * - FolderAnalysisQuery: Folder-based analysis
 * - ProcessQueries: Process and pipeline refresh queries
 * - TimelineBuilder: Timeline construction (existing)
 * - LogLinesQuery: Log line reading from file (existing)
 */

class UnityLogDatabase extends UnityLogDatabaseCore {
    constructor(version) {
        super(version);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUMMARY & STATISTICS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get summary statistics for a log
     */
    async getSummary(logId) {
        return await this.safeOperation(async () => {
            const query = new SummaryQuery(this.db, logId);
            return await query.build();
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ASSET QUERIES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get all assets for a log (sorted by import_time_ms)
     */
    async getAssets(logId) {
        await this.open();
        const queries = new AssetQueries(this.db);
        return await queries.getAll();
    }

    /**
     * Get assets by category (sorted by import_time_ms)
     */
    async getAssetsByCategory(logId, category) {
        await this.open();
        const queries = new AssetQueries(this.db);
        return await queries.getByCategory(category);
    }

    /**
     * Get assets by type (sorted by import_time_ms using compound index)
     */
    async getAssetsByType(logId, assetType, limit = null) {
        await this.open();
        const queries = new AssetQueries(this.db);
        return await queries.getByType(assetType, limit);
    }

    /**
     * Get assets by type progressively, yielding batches via callback
     */
    async getAssetsByTypeProgressive(logId, assetType, batchCallback, batchSize = 200) {
        await this.open();
        const queries = new AssetQueries(this.db);
        return await queries.getByTypeProgressive(assetType, batchCallback, batchSize);
    }

    /**
     * Get count of assets by type
     */
    async getAssetsByTypeCount(logId, assetType) {
        await this.open();
        const queries = new AssetQueries(this.db);
        return await queries.getCountByType(assetType);
    }

    /**
     * Get assets by importer (sorted by import_time_ms)
     */
    async getAssetsByImporter(logId, importerType) {
        await this.open();
        const queries = new AssetQueries(this.db);
        return await queries.getByImporter(importerType);
    }

    /**
     * Get top slowest assets
     */
    async getTopSlowest(logId, limit = 20) {
        await this.open();
        const queries = new AssetQueries(this.db);
        return await queries.getTopSlowest(limit);
    }

    /**
     * Get worker thread timeline data
     */
    async getWorkerThreadTimeline(logId) {
        return await this.safeOperation(async () => {
            const queries = new AssetQueries(this.db);
            return await queries.getWorkerThreadImports();
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FOLDER ANALYSIS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get folder analysis
     */
    async getFolderAnalysis(logId) {
        await this.open();
        const query = new FolderAnalysisQuery(this.db);
        return await query.analyze();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROCESS & PIPELINE QUERIES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get pipeline refreshes
     */
    async getPipelineRefreshes(logId) {
        await this.open();
        const queries = new ProcessQueries(this.db);
        return await queries.getPipelineRefreshes();
    }

    /**
     * Get processes breakdown by type
     */
    async getProcessesBreakdown(logId) {
        await this.open();
        const queries = new ProcessQueries(this.db);
        return await queries.getBreakdown();
    }

    /**
     * Get processes by type
     */
    async getProcessesByType(processType, logId) {
        await this.open();
        const queries = new ProcessQueries(this.db);
        return await queries.getByType(processType);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIMELINE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get timeline data
     */
    async getTimeline(logId) {
        return await this.safeOperation(async () => {
            const builder = new TimelineBuilder(this.db, logId);
            return await builder.build();
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LOG LINES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get log lines for viewer
     */
    async getLogLines(logId, options = {}) {
        await this.open();
        const query = new LogLinesQuery(this.db, logId);
        return await query.query(options);
    }

    /**
     * Get single log line
     */
    async getLogLine(logId, lineNumber) {
        await this.open();
        const query = new LogLinesQuery(this.db, logId);
        const result = await query.query({ center_line: lineNumber });

        if (result.lines && result.lines.length > 0) {
            return result.lines.find(line => line.line_number === lineNumber) || result.lines[0];
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DATABASE SIZE ESTIMATION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get the estimated size of the database in bytes
     */
    async getDatabaseSize() {
        try {
            await this.open();
            let totalSize = 0;

            const tables = [
                this.db.log_metadata,
                this.db.asset_imports,
                this.db.pipeline_refreshes,
                this.db.processes
            ];

            for (const table of tables) {
                const records = await table.toArray();
                for (const record of records) {
                    totalSize += this._estimateObjectSize(record);
                }
            }

            // Add IndexedDB overhead (~30%)
            return totalSize * 1.3;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get database size in MB
     */
    async getDatabaseSizeMB() {
        const sizeBytes = await this.getDatabaseSize();
        return sizeBytes / (1024 * 1024);
    }

    /**
     * Estimate the size of a JavaScript object in bytes
     */
    _estimateObjectSize(obj) {
        if (obj === null || obj === undefined) return 0;
        if (typeof obj === 'boolean') return 4;
        if (typeof obj === 'number') return 8;
        if (typeof obj === 'string') return obj.length * 2;
        if (typeof obj === 'function') return 0;
        if (obj instanceof Date) return 8;

        if (Array.isArray(obj)) {
            return obj.reduce((sum, item) => sum + this._estimateObjectSize(item), 0);
        }

        if (typeof obj === 'object') {
            let size = 0;
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    size += key.length * 2;
                    size += this._estimateObjectSize(obj[key]);
                }
            }
            return size;
        }

        return 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

// Register with AppContext if available
if (window.appContext) {
    window.appContext.register('UnityLogDatabase', UnityLogDatabase);
}

// Export for use in other modules
window.UnityLogDatabase = UnityLogDatabase;
