/**
 * IndexedDB Database Wrapper using Dexie.js
 * Handles database versioning and provides API-compatible methods
 */

// Database version counter - stored in localStorage
const DB_VERSION_KEY = 'unity_log_db_version';
const DB_NAME_PREFIX = 'UnityLogAnalyzer';

/**
 * Get the current database version
 * @returns {number} Current database version
 */
function getCurrentDbVersion() {
    const version = localStorage.getItem(DB_VERSION_KEY);
    return version ? parseInt(version, 10) : 2; // Default to version 2 for worker_thread_id support
}

/**
 * Increment and get the next database version
 * @returns {number} Next database version
 */
function getNextDbVersion() {
    const currentVersion = getCurrentDbVersion();
    const nextVersion = currentVersion + 1;
    localStorage.setItem(DB_VERSION_KEY, nextVersion.toString());
    return nextVersion;
}

/**
 * Get the database name for a specific version
 * @param {number} version - Database version
 * @returns {string} Database name
 */
function getDbName(version) {
    return `${DB_NAME_PREFIX}_v${version}`;
}

/**
 * Get the current active database name
 * @returns {string} Current database name
 */
function getCurrentDbName() {
    const version = getCurrentDbVersion();
    return getDbName(version);
}

/**
 * Detect the highest existing database version and sync localStorage
 * This handles cases where localStorage is out of sync with actual IndexedDB databases
 * @returns {Promise<number>} The highest database version found
 */
async function syncDatabaseVersion() {
    const storedVersion = getCurrentDbVersion();
    let highestVersion = storedVersion;

    // Try to use indexedDB.databases() to list all databases (modern browsers)
    if (indexedDB.databases) {
        try {
            const databases = await indexedDB.databases();
            const dbNamePattern = new RegExp(`^${DB_NAME_PREFIX}_v(\\d+)$`);

            // Find all databases matching our pattern
            for (const dbInfo of databases) {
                const match = dbInfo.name.match(dbNamePattern);
                if (match) {
                    const dbVersion = parseInt(match[1], 10);
                    if (dbVersion > highestVersion) {
                        highestVersion = dbVersion;
                    }
                }
            }
        } catch (error) {
            console.warn(`[Database] Could not list databases to sync version:`, error);
        }
    }

    // Update localStorage if we found a higher version
    if (highestVersion > storedVersion) {
        console.log(`[Database] Syncing database version: localStorage had ${storedVersion}, found ${highestVersion} in IndexedDB. Updating localStorage.`);
        localStorage.setItem(DB_VERSION_KEY, highestVersion.toString());
    }

    return highestVersion;
}

/**
 * Database class wrapper
 */
class UnityLogDatabase {
    constructor(version) {
        this.version = version || getCurrentDbVersion();
        this.dbName = getDbName(this.version);
        this.db = null;
        this._initDatabase();
    }

    _initDatabase() {
        // Create Dexie database instance
        this.db = new Dexie(this.dbName);

        // Single version with final schema (no migrations needed - databases are regenerated)
        this.db.version(1).stores({
            log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms, start_timestamp, end_timestamp, last_processed_line, is_live_monitoring',
            asset_imports: '++id, line_number, byte_offset, asset_path, asset_name, asset_type, asset_category, guid, importer_type, import_time_ms, duration_ms, start_timestamp, end_timestamp, worker_thread_id, [asset_type+import_time_ms], [asset_category+import_time_ms], [importer_type+import_time_ms], [worker_thread_id+start_timestamp]',
            pipeline_refreshes: '++id, line_number, byte_offset, refresh_id, total_time_seconds, initiated_by, imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms',
            script_compilation: '++id, line_number, assembly_path, defines_count, references_count',
            processes: '++id, line_number, byte_offset, process_type, process_name, duration_seconds, duration_ms, memory_mb, start_timestamp, end_timestamp',
            parser_state: '++id, state_type, state_data',
            cache_server_download_blocks: '++id, line_number, start_timestamp, end_timestamp, duration_seconds, duration_ms, num_assets_requested, num_assets_downloaded, downloaded_assets',
            worker_thread_phases: '++id, worker_thread_id, start_timestamp, end_timestamp, duration_ms, import_count, start_line_number, [worker_thread_id+start_timestamp]'
        });
    }

    /**
     * Open the database
     */
    async open() {
        try {
            await this.db.open();
            return this.db;
        } catch (error) {
            // If database is being deleted/upgraded, wait a bit and retry
            if (error.name === 'DatabaseClosedError' || error.message?.includes('Database has been closed')) {
                // Wait a short time for database operations to complete
                await new Promise(resolve => setTimeout(resolve, 100));
                // Try to get a fresh database instance
                const freshDb = await getCurrentDatabase();
                this.db = freshDb.db;
                await this.db.open();
                return this.db;
            }
            throw error;
        }
    }

    /**
     * Close the database
     */
    async close() {
        if (this.db) {
            try {
                await this.db.close();
            } catch (error) {
                // Ignore errors when closing (database might already be closed)
            }
        }
    }

    /**
     * Safely execute a database operation with error handling
     * @private
     */
    async _safeDbOperation(operation) {
        try {
            await this.open();
            return await operation();
        } catch (error) {
            // Handle database closed errors by retrying with a fresh connection
            if (error.name === 'DatabaseClosedError' || error.message?.includes('Database has been closed')) {
                try {
                    // Get a fresh database instance
                    const freshDb = await getCurrentDatabase();
                    this.db = freshDb.db;
                    await this.db.open();
                    // Retry the operation
                    return await operation();
                } catch (retryError) {
                    // If retry also fails, throw the original error
                    throw error;
                }
            }
            throw error;
        }
    }

    /**
     * Get all logs (log_metadata)
     */
    async getLogs() {
        await this.open();
        const logs = await this.db.log_metadata.orderBy('date_parsed').reverse().toArray();
        // Convert to match API format (date_parsed as string)
        return logs.map(log => ({
            ...log,
            date_parsed: log.date_parsed || new Date().toISOString()
        }));
    }

    /**
     * Get log metadata by ID
     */
    async getLogMetadata(logId) {
        await this.open();
        const metadata = await this.db.log_metadata.get(logId);
        if (!metadata) {
            console.warn(`[Database] No metadata found for log ${logId}`);
        }
        return metadata;
    }

    /**
     * Get summary statistics for a log
     */
    async getSummary(logId) {
        return await this._safeDbOperation(async () => {
            const summary = {};
            const assetImports = await this.db.asset_imports.toArray();

            // Debug: Log asset import data to diagnose chart issues
            if (assetImports.length > 0) {
                const sampleAsset = assetImports[0];
                const missingCategory = assetImports.filter(a => !a.asset_category || a.asset_category === 'Other').length;
                const missingType = assetImports.filter(a => !a.asset_type || a.asset_type === 'Unknown').length;
                console.log(`[getSummary] Found ${assetImports.length} asset imports. Sample:`, {
                    asset_category: sampleAsset.asset_category,
                    asset_type: sampleAsset.asset_type,
                    asset_path: sampleAsset.asset_path
                });
                if (missingCategory > 0 || missingType > 0) {
                    console.warn(`[getSummary] ${missingCategory} assets missing category, ${missingType} missing type`);
                }
            }

            if (assetImports.length > 0) {
                // Use duration_ms field (calculated during parsing: wall time if available, else import_time_ms)
                const totalTime = assetImports.reduce((sum, a) => sum + (a.duration_ms || 0), 0);
                const avgTime = totalTime / assetImports.length;
                const maxTime = Math.max(...assetImports.map(a => a.duration_ms || 0));

                summary.asset_imports = {
                    count: assetImports.length,
                    total_time: totalTime,
                    avg_time: avgTime,
                    max_time: maxTime
                };

                // By category
                const byCategory = {};
                assetImports.forEach(asset => {
                    const cat = asset.asset_category || 'Other';
                    if (!byCategory[cat]) {
                        byCategory[cat] = { count: 0, total_time: 0 };
                    }
                    byCategory[cat].count++;
                    byCategory[cat].total_time += asset.duration_ms || 0;
                });

                summary.by_category = Object.entries(byCategory).map(([category, data]) => ({
                    asset_category: category,
                    count: data.count,
                    total_time: data.total_time,
                    avg_time: data.total_time / data.count
                })).sort((a, b) => b.total_time - a.total_time);

                // By type
                const byType = {};
                assetImports.forEach(asset => {
                    const type = asset.asset_type || 'Unknown';
                    if (!byType[type]) {
                        byType[type] = { count: 0, total_time: 0 };
                    }
                    byType[type].count++;
                    byType[type].total_time += asset.duration_ms || 0;
                });
                summary.by_type = Object.entries(byType).map(([type, data]) => ({
                    asset_type: type,
                    count: data.count,
                    total_time: data.total_time,
                    avg_time: data.total_time / data.count
                })).sort((a, b) => b.total_time - a.total_time);

                // By importer
                const byImporter = {};
                assetImports.forEach(asset => {
                    const importer = asset.importer_type || 'Unknown';
                    if (!byImporter[importer]) {
                        byImporter[importer] = { count: 0, total_time: 0 };
                    }
                    byImporter[importer].count++;
                    byImporter[importer].total_time += asset.duration_ms || 0;
                });
                summary.by_importer = Object.entries(byImporter).map(([importer, data]) => ({
                    importer_type: importer,
                    count: data.count,
                    total_time: data.total_time,
                    avg_time: data.total_time / data.count
                })).sort((a, b) => b.total_time - a.total_time);
            } else {
                summary.asset_imports = {};
                summary.by_category = [];
                summary.by_type = [];
                summary.by_importer = [];
            }

            // Pipeline refreshes
            const refreshes = await this.db.pipeline_refreshes.toArray();

            if (refreshes.length > 0) {
                const totalTime = refreshes.reduce((sum, r) => sum + (r.total_time_seconds || 0), 0);
                summary.pipeline_refreshes = {
                    count: refreshes.length,
                    total_time_seconds: totalTime
                };
            } else {
                summary.pipeline_refreshes = {};
            }

            // Script compilation
            const scriptCompOps = await this.db.processes
                .filter(op => op.process_type === 'Script Compilation')
                .toArray();

            summary.script_compilation = {
                count: scriptCompOps.length,
                total_time_ms: scriptCompOps.reduce((sum, op) => sum + (op.duration_ms || 0), 0)
            };


            // Get Unity version from metadata
            const metadata = await this.getLogMetadata(logId);
            summary.unity_version = metadata ? metadata.unity_version : null;

            // Project load time - will be calculated from log file or pipeline refresh
            // For now, use the largest pipeline refresh total_time_seconds
            if (refreshes.length > 0) {
                const maxRefresh = refreshes.reduce((max, r) =>
                    (r.total_time_seconds || 0) > (max.total_time_seconds || 0) ? r : max
                );
                summary.project_load_time_seconds = maxRefresh.total_time_seconds;
            } else {
                summary.project_load_time_seconds = null;
            }

            return summary;
        });
    }

    /**
     * Get all assets for a log (sorted by import_time_ms)
     */
    async getAssets(logId) {
        await this.open();
        const assets = await this.db.asset_imports.toArray();
        // Sort by import_time_ms
        return assets.sort((a, b) => (a.import_time_ms || 0) - (b.import_time_ms || 0));
    }

    /**
     * Get assets by category (sorted by import_time_ms)
     */
    async getAssetsByCategory(logId, category) {
        await this.open();
        const assets = await this.db.asset_imports
            .where('[asset_category+import_time_ms]')
            .between([category, Dexie.minKey], [category, Dexie.maxKey])
            .toArray();
        return assets;
    }

    /**
     * Get assets by type (sorted by import_time_ms using compound index)
     * Now supports efficient pagination with limit parameter
     */
    async getAssetsByType(logId, assetType, limit = null) {
        await this.open();
        // Use compound index [asset_type+import_time_ms] for sorted results
        let query = this.db.asset_imports
            .where('[asset_type+import_time_ms]')
            .between([assetType, Dexie.minKey], [assetType, Dexie.maxKey]);

        if (limit !== null && limit > 0) {
            // Use limit() for efficient pagination - only loads what we need!
            return await query.limit(limit).toArray();
        }

        return await query.toArray();
    }

    /**
     * Get assets by type progressively, yielding batches via callback
     * Now uses compound index for efficient sorted queries with true pagination
     */
    async getAssetsByTypeProgressive(logId, assetType, batchCallback, batchSize = 200) {
        await this.open();

        // Use compound index for sorted iteration
        // Count total first for progress tracking
        let totalCount = 0;
        await this.db.asset_imports
            .where('[asset_type+import_time_ms]')
            .between([assetType, Dexie.minKey], [assetType, Dexie.maxKey])
            .each(() => { totalCount++; });

        // Load first batch immediately using limit (most efficient)
        let offset = 0;
        let allAssets = [];

        while (offset < totalCount) {
            // Load one batch at a time - compound index ensures sorted results
            const batch = await this.db.asset_imports
                .where('[asset_type+import_time_ms]')
                .between([assetType, Dexie.minKey], [assetType, Dexie.maxKey])
                .offset(offset)
                .limit(batchSize)
                .toArray();

            if (batch.length === 0) break;

            allAssets.push(...batch);
            const isLast = (offset + batch.length) >= totalCount;

            // Yield batch immediately (async callback)
            await batchCallback(batch, offset, totalCount, isLast);

            offset += batch.length;

            // Yield to event loop between batches for UI responsiveness
            if (!isLast) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return allAssets;
    }

    /**
     * Get count of assets by type (optimized using compound index)
     */
    async getAssetsByTypeCount(logId, assetType) {
        await this.open();
        let count = 0;
        // Use compound index for efficient counting
        await this.db.asset_imports
            .where('[asset_type+import_time_ms]')
            .between([assetType, Dexie.minKey], [assetType, Dexie.maxKey])
            .each(() => { count++; });
        return count;
    }

    /**
     * Get assets by importer (sorted by import_time_ms using compound index)
     */
    async getAssetsByImporter(logId, importerType) {
        await this.open();
        const assets = await this.db.asset_imports
            .where('[importer_type+import_time_ms]')
            .between([importerType, Dexie.minKey], [importerType, Dexie.maxKey])
            .toArray();
        return assets;
    }

    /**
     * Get top slowest assets (sorted descending by import_time_ms)
     */
    async getTopSlowest(logId, limit = 20) {
        await this.open();
        const assets = await this.db.asset_imports.toArray();
        // Sort by import_time_ms descending and take top N
        return assets
            .sort((a, b) => (b.import_time_ms || 0) - (a.import_time_ms || 0))
            .slice(0, limit);
    }

    /**
     * Get pipeline refreshes
     */
    async getPipelineRefreshes(logId) {
        await this.open();
        const refreshes = await this.db.pipeline_refreshes.toArray();
        return refreshes.sort((a, b) => (a.total_time_seconds || 0) - (b.total_time_seconds || 0));
    }

    /**
     * Get pipeline breakdown
     */
    async getPipelineBreakdown(logId) {
        await this.open();
        const refreshes = await this.db.pipeline_refreshes.toArray();

        // Get Script Compilation processes
        const scriptCompOps = await this.db.processes
            .filter(op => op.process_type === 'Script Compilation')
            .toArray();

        // Sum Script Compilation operation times
        const totalCompile = scriptCompOps.reduce((sum, op) => sum + (op.duration_ms || 0), 0);

        const breakdown = refreshes.reduce((acc, r) => ({
            total_asset_db_process: (acc.total_asset_db_process || 0) + (r.asset_db_process_time_ms || 0),
            total_asset_db_callback: (acc.total_asset_db_callback || 0) + (r.asset_db_callback_time_ms || 0),
            total_domain_reload: (acc.total_domain_reload || 0) + (r.domain_reload_time_ms || 0),
            total_compile: totalCompile, // Use Script Compilation operations sum
            total_scripting_other: (acc.total_scripting_other || 0) + (r.scripting_other_ms || 0)
        }), {});

        return breakdown;
    }

    /**
     * Get processes breakdown by type for the processes widget
     */
    async getProcessesBreakdown(logId) {
        await this.open();

        const processes = await this.db.processes.toArray();

        // Group by process_type and sum durations
        const breakdown = {};
        processes.forEach(op => {
            const type = op.process_type || 'Unknown';
            if (!breakdown[type]) {
                breakdown[type] = {
                    type: type,
                    count: 0,
                    total_time_ms: 0
                };
            }
            breakdown[type].count++;
            breakdown[type].total_time_ms += (op.duration_ms || 0);
        });

        // Convert to array and sort by total time
        return Object.values(breakdown).sort((a, b) => b.total_time_ms - a.total_time_ms);
    }

    /**
     * Get processes by type
     */
    async getProcessesByType(processType, logId) {
        await this.open();
        const processes = await this.db.processes
            .filter(op => op.process_type === processType)
            .toArray();

        // Sort by line_number
        return processes.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
    }

    /**
     * Get script compilation data
     */
    async getScriptCompilation(logId) {
        await this.open();
        const scriptCompOps = await this.db.processes
            .filter(op => op.process_type === 'Script Compilation')
            .toArray();
        return scriptCompOps.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
    }

    /**
     * Get error and warning counts
     * Now reads from log_metadata for fast retrieval (counters are maintained during parsing)
     */

    /**
     * Get log lines for viewer
     * Delegates to LogLinesQuery for complex query logic
     */
    async getLogLines(logId, options = {}) {
        await this.open();
        const query = new LogLinesQuery(this.db, logId);
        return await query.query(options);
    }

    /**
     * Get single log line
     * Now reads from file using line index
     */
    async getLogLine(logId, lineNumber) {
        await this.open();
        const query = new LogLinesQuery(this.db, logId);
        const result = await query.query({ center_line: lineNumber });

        if (result.lines && result.lines.length > 0) {
            // Find the exact line number (should be the center line)
            return result.lines.find(line => line.line_number === lineNumber) || result.lines[0];
        }

        return null;
    }

    /**
     * Get folder analysis
     */
    async getFolderAnalysis(logId) {
        await this.open();
        const assets = await this.db.asset_imports.toArray();

        const folderTimes = {};
        const folderCounts = {};
        const folderAssets = {};

        assets.forEach(asset => {
            const path = asset.asset_path || '';
            const timeMs = asset.import_time_ms || 0;
            const parts = path.split('/');

            let folder;
            if (parts.length >= 4) {
                folder = parts.slice(0, 4).join('/');
            } else if (parts.length >= 3) {
                folder = parts.slice(0, 3).join('/');
            } else if (parts.length >= 2) {
                folder = parts.slice(0, 2).join('/');
            } else {
                folder = parts[0] || 'Root';
            }

            if (!folderTimes[folder]) {
                folderTimes[folder] = 0;
                folderCounts[folder] = 0;
                folderAssets[folder] = [];
            }

            folderTimes[folder] += timeMs;
            folderCounts[folder] += 1;
            folderAssets[folder].push({
                path: path,
                time_ms: timeMs
            });
        });

        const folders = Object.entries(folderTimes).map(([folder, totalTime]) => ({
            folder: folder,
            total_time_ms: totalTime,
            asset_count: folderCounts[folder],
            avg_time_ms: totalTime / folderCounts[folder],
            assets: folderAssets[folder]
                .sort((a, b) => b.time_ms - a.time_ms)
                .slice(0, 5)
        })).sort((a, b) => b.total_time_ms - a.total_time_ms);

        return folders;
    }

    /**
     * Get timeline data
     * Delegates to TimelineBuilder for complex timeline construction
     */
    async getTimeline(logId) {
        return await this._safeDbOperation(async () => {
            const builder = new TimelineBuilder(this.db, logId);
            return await builder.build();
        });
    }

    /**
     * Get worker thread timeline data
     * Returns operations grouped by worker thread ID
     */
    async getWorkerThreadTimeline(logId) {
        return await this._safeDbOperation(async () => {
            // Query all worker thread imports (where worker_thread_id is not null)
            const workerImports = await this.db.asset_imports
                .filter(asset => asset.worker_thread_id !== null && asset.worker_thread_id !== undefined)
                .toArray();

            // Group by worker_thread_id
            const workerThreads = {};
            workerImports.forEach(asset => {
                const workerId = asset.worker_thread_id;
                if (!workerThreads[workerId]) {
                    workerThreads[workerId] = [];
                }
                workerThreads[workerId].push(asset);
            });

            // Sort each worker's operations by start_timestamp
            Object.keys(workerThreads).forEach(workerId => {
                workerThreads[workerId].sort((a, b) => {
                    const aTime = a.start_timestamp ? new Date(a.start_timestamp).getTime() : 0;
                    const bTime = b.start_timestamp ? new Date(b.start_timestamp).getTime() : 0;
                    return aTime - bTime;
                });
            });

            return { workerThreads };
        });
    }


    /**
     * Bulk insert methods for parsing
     */
    async insertLogMetadata(data) {
        await this.open();
        const id = await this.db.log_metadata.add(data);
        return id;
    }

    async bulkInsertAssetImports(imports, progressCallback = null, cancelSignal = null) {
        await this.open();
        // Insert in batches to avoid memory issues and provide progress updates
        const batchSize = 1000;
        const totalBatches = Math.ceil(imports.length / batchSize);

        // Timing for first 3 batches to estimate remaining time
        const batchTimes = [];
        const startTime = performance.now();

        for (let i = 0; i < imports.length; i += batchSize) {
            // Check for cancellation
            if (cancelSignal && cancelSignal.cancelled) {
                throw new Error('Batch storage cancelled by user');
            }

            const batchStartTime = performance.now();
            const batch = imports.slice(i, i + batchSize);

            try {
                await this.db.asset_imports.bulkAdd(batch);
            } catch (error) {
                console.error(`[Database] bulkInsertAssetImports: Error inserting batch:`, error);
                // If bulkAdd fails due to duplicates, try individual inserts
                if (error.name === 'ConstraintError') {
                    console.warn(`[Database] bulkInsertAssetImports: Constraint error, attempting individual inserts...`);
                    let successCount = 0;
                    let failCount = 0;
                    for (const imp of batch) {
                        try {
                            await this.db.asset_imports.add(imp);
                            successCount++;
                        } catch (e) {
                            failCount++;
                            console.warn(`[Database] Failed to insert asset import:`, imp, e);
                        }
                    }
                } else {
                    throw error;
                }
            }

            const batchEndTime = performance.now();
            const batchTime = batchEndTime - batchStartTime;

            const batchNum = Math.floor(i / batchSize) + 1;

            // Track timing for first 3 batches
            if (batchNum <= 3) {
                batchTimes.push(batchTime);
            }

            // Call progress callback if provided
            if (progressCallback) {
                const processed = i + batch.length;
                const percent = (processed / imports.length) * 100;

                // Calculate estimated time remaining after first 3 batches
                let estimatedTimeRemaining = null;
                if (batchNum >= 3 && batchTimes.length === 3) {
                    const avgBatchTime = batchTimes.reduce((sum, t) => sum + t, 0) / batchTimes.length;
                    const remainingBatches = totalBatches - batchNum;
                    estimatedTimeRemaining = (remainingBatches * avgBatchTime) / 1000; // Convert to seconds
                } else if (batchNum < 3) {
                    // Still calculating
                    estimatedTimeRemaining = -1;
                }

                progressCallback(batchNum, totalBatches, processed, imports.length, percent, estimatedTimeRemaining);
            }
        }
    }

    async bulkInsertPipelineRefreshes(refreshes) {
        await this.open();
        await this.db.pipeline_refreshes.bulkAdd(refreshes);
    }

    async bulkInsertDomainReloadSteps(steps) {
        await this.open();
        await this.db.domain_reload_steps.bulkAdd(steps);
    }

    async bulkInsertScriptCompilation(compilations) {
        await this.open();
        await this.db.script_compilation.bulkAdd(compilations);
    }


    async bulkInsertProcesses(processes) {
        await this.open();
        await this.db.processes.bulkAdd(processes);
    }

    async bulkInsertLineIndex(indexEntries) {
        await this.open();
        // Insert in batches to avoid memory issues
        const batchSize = 10000;
        const totalBatches = Math.ceil(indexEntries.length / batchSize);

        for (let i = 0; i < totalBatches; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, indexEntries.length);
            const batch = indexEntries.slice(start, end);
            await this.db.line_index.bulkAdd(batch);
        }
    }

    async bulkInsertCacheServerBlocks(blocks) {
        await this.open();
        // Delete existing blocks to avoid duplicates when re-parsing
        await this.db.cache_server_download_blocks.clear();
        await this.db.cache_server_download_blocks.bulkAdd(blocks);
    }

    async bulkInsertLogLines(lines, progressCallback = null, cancelSignal = null) {
        // Log lines are no longer stored in database - they're read from file on demand
        // This method is kept for backward compatibility but does nothing
        if (progressCallback) {
            progressCallback(0, 1, 0, lines.length, 100, 0);
        }
        // No database operation - log lines are read from file
        return;
    }

    /**
     * Calculate the size of a JavaScript object in bytes (rough estimate)
     */
    _calculateObjectSize(obj) {
        let size = 0;
        const visited = new WeakSet();

        function calculate(obj) {
            if (obj === null || obj === undefined) return 0;
            if (typeof obj === 'boolean') return 4;
            if (typeof obj === 'number') return 8;
            if (typeof obj === 'string') return obj.length * 2; // UTF-16 encoding
            if (typeof obj === 'function') return 0; // Functions don't count
            if (visited.has(obj)) return 0; // Avoid circular references
            if (obj instanceof Date) return 8;

            if (Array.isArray(obj)) {
                visited.add(obj);
                size = 0;
                for (let item of obj) {
                    size += calculate(item);
                }
                return size;
            }

            if (typeof obj === 'object') {
                visited.add(obj);
                size = 0;
                for (let key in obj) {
                    if (obj.hasOwnProperty(key)) {
                        size += key.length * 2; // Key size
                        size += calculate(obj[key]);
                    }
                }
                return size;
            }

            return 0;
        }

        return calculate(obj);
    }

    /**
     * Get the estimated size of the database in bytes
     * Calculates based on actual stored data
     */
    async getDatabaseSize() {
        try {
            await this.open();
            let totalSize = 0;

            // Calculate actual size of stored data
            const metadata = await this.db.log_metadata.toArray();
            metadata.forEach(record => {
                totalSize += this._calculateObjectSize(record);
            });

            const assets = await this.db.asset_imports.toArray();
            assets.forEach(record => {
                totalSize += this._calculateObjectSize(record);
            });

            const refreshes = await this.db.pipeline_refreshes.toArray();
            refreshes.forEach(record => {
                totalSize += this._calculateObjectSize(record);
            });

            const steps = await this.db.domain_reload_steps.toArray();
            steps.forEach(record => {
                totalSize += this._calculateObjectSize(record);
            });

            const compilations = await this.db.script_compilation.toArray();
            compilations.forEach(record => {
                totalSize += this._calculateObjectSize(record);
            });


            const processes = await this.db.processes.toArray();
            processes.forEach(record => {
                totalSize += this._calculateObjectSize(record);
            });

            // Log lines are no longer stored in database - they're read from file on demand

            // Add IndexedDB overhead (indexes, structure, etc.) - roughly 30% overhead
            totalSize = totalSize * 1.3;

            return totalSize;
        } catch (error) {
            console.warn('Could not calculate database size:', error);
            return 0;
        }
    }

    /**
     * Get database size in a human-readable format
     */
    async getDatabaseSizeMB() {
        const sizeBytes = await this.getDatabaseSize();
        return sizeBytes / (1024 * 1024); // Convert to MB
    }

    /**
     * Save parser state for multi-line message handling
     */
    async saveParserState(logId, stateType, stateData) {
        await this.open();
        // Remove existing state of this type
        await this.db.parser_state
            .filter(state => state.state_type === stateType)
            .delete();
        // Insert new state
        await this.db.parser_state.add({
            state_type: stateType,
            state_data: JSON.stringify(stateData)
        });
    }

    /**
     * Load parser state for multi-line message handling
     */
    async loadParserState(logId, stateType) {
        await this.open();
        const state = await this.db.parser_state
            .filter(s => s.state_type === stateType)
            .first();
        if (state) {
            return JSON.parse(state.state_data);
        }
        return null;
    }

    /**
     * Clear all parser state for a log
     */
    async clearParserState(logId) {
        await this.open();
        await this.db.parser_state.clear();
    }

    /**
     * Set live monitoring flag for a log
     */
    async setLiveMonitoring(logId, isMonitoring) {
        await this.open();
        await this.db.log_metadata.update(logId, {
            is_live_monitoring: isMonitoring
        });
    }

    /**
     * Update last processed line for a log
     */
    async updateLastProcessedLine(logId, lineNumber) {
        await this.open();
        await this.db.log_metadata.update(logId, {
            last_processed_line: lineNumber
        });
    }
}

/**
 * Delete old databases (all versions except the current one)
 * Uses indexedDB.databases() to check for existing databases first, then deletes them.
 * Falls back to trying known version numbers if databases() is not available.
 * @param {number} currentVersion - The current database version to keep
 */
async function cleanupOldDatabases(currentVersion) {

    const currentDbName = getDbName(currentVersion);
    const deletePromises = [];

    // Try to use indexedDB.databases() to list all databases (modern browsers)
    if (indexedDB.databases) {
        try {
            const databases = await indexedDB.databases();
            const dbNamePattern = new RegExp(`^${DB_NAME_PREFIX}_v(\\d+)$`);

            // Find all databases matching our pattern
            for (const dbInfo of databases) {
                const match = dbInfo.name.match(dbNamePattern);
                if (match) {
                    const dbVersion = parseInt(match[1], 10);
                    const dbName = dbInfo.name;

                    // Delete if it's not the current version
                    if (dbVersion !== currentVersion) {
                        deletePromises.push(
                            Dexie.delete(dbName)
                                .then(() => {
                                })
                                .catch(error => {
                                    // Database might be in use - that's okay
                                    if (error.name !== 'DatabaseClosedError' && error.name !== 'NotFoundError') {
                                        console.warn(`[Database] Could not delete ${dbName}:`, error.message);
                                    }
                                })
                        );
                    }
                }
            }
        } catch (error) {
            console.warn(`[Database] Could not list databases, falling back to version-based deletion:`, error);
            // Fall through to fallback method
        }
    }

    // Fallback: If databases() is not available or failed, try known version numbers
    // This ensures compatibility with older browsers
    if (deletePromises.length === 0) {
        for (let oldVersion = 1; oldVersion < currentVersion; oldVersion++) {
            const oldDbName = getDbName(oldVersion);
            deletePromises.push(
                Dexie.delete(oldDbName)
                    .then(() => {
                    })
                    .catch(error => {
                        // Database might not exist or might be in use - that's okay
                        if (error.name !== 'DatabaseClosedError' && error.name !== 'NotFoundError') {
                            console.warn(`[Database] Could not delete ${oldDbName}:`, error.message);
                        }
                    })
            );
        }
    }

    // Wait for all deletions to complete (or fail gracefully)
    if (deletePromises.length > 0) {
        await Promise.allSettled(deletePromises);
    }
}

/**
 * Create a new database for a new parse
 * Cleans up old databases before creating the new one
 * @returns {Promise<UnityLogDatabase>} New database instance
 */
async function createNewDatabase() {
    // Sync version first to ensure we're working with the correct base version
    await syncDatabaseVersion();

    const oldVersion = getCurrentDbVersion();
    const version = getNextDbVersion();

    // Clean up old databases before creating the new one
    // This keeps only the most recent database
    await cleanupOldDatabases(version);

    return new UnityLogDatabase(version);
}

/**
 * Get the current active database
 * Syncs the database version with IndexedDB before returning
 * @returns {Promise<UnityLogDatabase>} Current database instance
 */
async function getCurrentDatabase() {
    // Sync version with existing databases to handle version mismatches
    await syncDatabaseVersion();
    return new UnityLogDatabase();
}

// Export for use in other modules
window.UnityLogDatabase = UnityLogDatabase;
window.createNewDatabase = createNewDatabase;
window.getCurrentDatabase = getCurrentDatabase;
window.getCurrentDbVersion = getCurrentDbVersion;
window.syncDatabaseVersion = syncDatabaseVersion;

