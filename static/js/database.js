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
    return version ? parseInt(version, 10) : 1;
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
        
        // Version 1: Initial schema
        this.db.version(1).stores({
            log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms',
            asset_imports: '++id, log_id, line_number, asset_path, asset_name, asset_type, asset_category, guid, artifact_id, importer_type, import_time_seconds, import_time_ms',
            pipeline_refreshes: '++id, log_id, line_number, refresh_id, total_time_seconds, initiated_by, imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms',
            domain_reload_steps: '++id, log_id, line_number, parent_id, step_name, time_ms, indent_level',
            script_compilation: '++id, log_id, line_number, assembly_path, defines_count, references_count',
            telemetry_data: '++id, log_id, line_number, telemetry_type, json_data',
            operations: '++id, log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb',
            log_lines: '++id, log_id, line_number, content, line_type, indent_level, is_error, is_warning, timestamp'
        });

        // Version 2: Add compound indexes for pre-sorted queries
        // These indexes allow efficient sorted queries by type/category/importer
        this.db.version(2).stores({
            log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms',
            asset_imports: '++id, log_id, line_number, asset_path, asset_name, asset_type, asset_category, guid, artifact_id, importer_type, import_time_seconds, import_time_ms, [log_id+asset_type+import_time_ms], [log_id+asset_category+import_time_ms], [log_id+importer_type+import_time_ms], [log_id+import_time_ms]',
            pipeline_refreshes: '++id, log_id, line_number, refresh_id, total_time_seconds, initiated_by, imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms',
            domain_reload_steps: '++id, log_id, line_number, parent_id, step_name, time_ms, indent_level',
            script_compilation: '++id, log_id, line_number, assembly_path, defines_count, references_count',
            telemetry_data: '++id, log_id, line_number, telemetry_type, json_data',
            operations: '++id, log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb',
            log_lines: '++id, log_id, line_number, content, line_type, indent_level, is_error, is_warning, timestamp, [log_id+line_number]'
        }).upgrade(async tx => {
            // Migration: No data transformation needed, just adding indexes
            // IndexedDB will automatically build the indexes from existing data
        });

        // Version 3: Add timestamps to operations table for wall-to-wall time calculation
        this.db.version(3).stores({
            log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms',
            asset_imports: '++id, log_id, line_number, asset_path, asset_name, asset_type, asset_category, guid, artifact_id, importer_type, import_time_seconds, import_time_ms, [log_id+asset_type+import_time_ms], [log_id+asset_category+import_time_ms], [log_id+importer_type+import_time_ms], [log_id+import_time_ms]',
            pipeline_refreshes: '++id, log_id, line_number, refresh_id, total_time_seconds, initiated_by, imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms',
            domain_reload_steps: '++id, log_id, line_number, parent_id, step_name, time_ms, indent_level',
            script_compilation: '++id, log_id, line_number, assembly_path, defines_count, references_count',
            telemetry_data: '++id, log_id, line_number, telemetry_type, json_data',
            operations: '++id, log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb, start_timestamp, end_timestamp',
            log_lines: '++id, log_id, line_number, content, line_type, indent_level, is_error, is_warning, timestamp, [log_id+line_number]'
        }).upgrade(async tx => {
            // Migration: No data transformation needed, just adding new fields
            // Existing operations will have null timestamps
        });

        // Version 4: Add start_timestamp and end_timestamp to log_metadata for timeline sizing
        this.db.version(4).stores({
            log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms, start_timestamp, end_timestamp',
            asset_imports: '++id, log_id, line_number, asset_path, asset_name, asset_type, asset_category, guid, artifact_id, importer_type, import_time_seconds, import_time_ms, [log_id+asset_type+import_time_ms], [log_id+asset_category+import_time_ms], [log_id+importer_type+import_time_ms], [log_id+import_time_ms]',
            pipeline_refreshes: '++id, log_id, line_number, refresh_id, total_time_seconds, initiated_by, imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms',
            domain_reload_steps: '++id, log_id, line_number, parent_id, step_name, time_ms, indent_level',
            script_compilation: '++id, log_id, line_number, assembly_path, defines_count, references_count',
            telemetry_data: '++id, log_id, line_number, telemetry_type, json_data',
            operations: '++id, log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb, start_timestamp, end_timestamp',
            log_lines: '++id, log_id, line_number, content, line_type, indent_level, is_error, is_warning, timestamp, [log_id+line_number]'
        }).upgrade(async tx => {
            // Migration: No data transformation needed, just adding new fields
            // Existing log_metadata will have null timestamps
        });

        // Version 5: Add start_timestamp and end_timestamp to asset_imports for direct storage during parsing
        this.db.version(5).stores({
            log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms, start_timestamp, end_timestamp',
            asset_imports: '++id, log_id, line_number, asset_path, asset_name, asset_type, asset_category, guid, artifact_id, importer_type, import_time_seconds, import_time_ms, start_timestamp, end_timestamp, [log_id+asset_type+import_time_ms], [log_id+asset_category+import_time_ms], [log_id+importer_type+import_time_ms], [log_id+import_time_ms]',
            pipeline_refreshes: '++id, log_id, line_number, refresh_id, total_time_seconds, initiated_by, imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms',
            domain_reload_steps: '++id, log_id, line_number, parent_id, step_name, time_ms, indent_level',
            script_compilation: '++id, log_id, line_number, assembly_path, defines_count, references_count',
            telemetry_data: '++id, log_id, line_number, telemetry_type, json_data',
            operations: '++id, log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb, start_timestamp, end_timestamp',
            log_lines: '++id, log_id, line_number, content, line_type, indent_level, is_error, is_warning, timestamp, [log_id+line_number]'
        }).upgrade(async tx => {
            // Migration: No data transformation needed, just adding new fields
            // Existing asset_imports will have null timestamps
        });

        // Version 6: Add error_count and warning_count to log_metadata for fast error/warning retrieval
        this.db.version(6).stores({
            log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms, start_timestamp, end_timestamp, error_count, warning_count',
            asset_imports: '++id, log_id, line_number, asset_path, asset_name, asset_type, asset_category, guid, artifact_id, importer_type, import_time_seconds, import_time_ms, start_timestamp, end_timestamp, [log_id+asset_type+import_time_ms], [log_id+asset_category+import_time_ms], [log_id+importer_type+import_time_ms], [log_id+import_time_ms]',
            pipeline_refreshes: '++id, log_id, line_number, refresh_id, total_time_seconds, initiated_by, imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms',
            domain_reload_steps: '++id, log_id, line_number, parent_id, step_name, time_ms, indent_level',
            script_compilation: '++id, log_id, line_number, assembly_path, defines_count, references_count',
            telemetry_data: '++id, log_id, line_number, telemetry_type, json_data',
            operations: '++id, log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb, start_timestamp, end_timestamp',
            log_lines: '++id, log_id, line_number, content, line_type, indent_level, is_error, is_warning, timestamp, [log_id+line_number]'
        }).upgrade(async tx => {
            // Migration: Calculate error/warning counts from existing log_lines
            // This ensures existing logs get their counts populated
            const metadataRecords = await tx.table('log_metadata').toArray();
            for (const meta of metadataRecords) {
                if (meta.error_count === undefined || meta.warning_count === undefined) {
                    const lines = await tx.table('log_lines')
                        .where('log_id').equals(meta.id)
                        .toArray();
                    const errorCount = lines.filter(l => l.is_error === true || l.is_error === 1).length;
                    const warningCount = lines.filter(l => l.is_warning === true || l.is_warning === 1).length;
                    await tx.table('log_metadata').update(meta.id, {
                        error_count: errorCount,
                        warning_count: warningCount
                    });
                }
            }
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
            console.error('Failed to open database:', error);
            throw error;
        }
    }

    /**
     * Close the database
     */
    async close() {
        if (this.db) {
            await this.db.close();
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
        if (metadata) {
            console.log(`[Database] Retrieved metadata for log ${logId}:`, {
                hasStartTimestamp: !!metadata.start_timestamp,
                hasEndTimestamp: !!metadata.end_timestamp,
                startTimestamp: metadata.start_timestamp,
                endTimestamp: metadata.end_timestamp,
                totalLines: metadata.total_lines
            });
        } else {
            console.warn(`[Database] No metadata found for log ${logId}`);
        }
        return metadata;
    }

    /**
     * Get summary statistics for a log
     */
    async getSummary(logId) {
        await this.open();
        
        const summary = {};

        // Asset imports summary
        const assetImports = await this.db.asset_imports
            .where('log_id').equals(logId)
            .toArray();
        
        if (assetImports.length > 0) {
            const totalTime = assetImports.reduce((sum, a) => sum + (a.import_time_ms || 0), 0);
            const avgTime = totalTime / assetImports.length;
            const maxTime = Math.max(...assetImports.map(a => a.import_time_ms || 0));
            
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
                byCategory[cat].total_time += asset.import_time_ms || 0;
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
                byType[type].total_time += asset.import_time_ms || 0;
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
                byImporter[importer].total_time += asset.import_time_ms || 0;
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
        const refreshes = await this.db.pipeline_refreshes
            .where('log_id').equals(logId)
            .toArray();
        
        if (refreshes.length > 0) {
            const totalTime = refreshes.reduce((sum, r) => sum + (r.total_time_seconds || 0), 0);
            summary.pipeline_refreshes = {
                count: refreshes.length,
                total_time_seconds: totalTime
            };
        } else {
            summary.pipeline_refreshes = {};
        }

        // Script compilation - now calculated from Tundra operations
        const tundraOps = await this.db.operations
            .where('log_id').equals(logId)
            .filter(op => op.operation_type === 'Tundra')
            .toArray();
        
        summary.script_compilation = {
            count: tundraOps.length,
            total_time_ms: tundraOps.reduce((sum, op) => sum + (op.duration_ms || 0), 0)
        };

        // Telemetry
        const telemetry = await this.db.telemetry_data
            .where('log_id').equals(logId)
            .toArray();
        
        summary.telemetry = telemetry.map(t => ({
            telemetry_type: t.telemetry_type,
            json_data: t.json_data
        }));

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
    }

    /**
     * Get all assets for a log (sorted by import_time_ms using compound index)
     */
    async getAssets(logId) {
        await this.open();
        // Use compound index [log_id+import_time_ms] for sorted results
        const assets = await this.db.asset_imports
            .where('[log_id+import_time_ms]')
            .between([logId, Dexie.minKey], [logId, Dexie.maxKey])
            .toArray();
        return assets;
    }

    /**
     * Get assets by category (sorted by import_time_ms using compound index)
     */
    async getAssetsByCategory(logId, category) {
        await this.open();
        // Use compound index [log_id+asset_category+import_time_ms] for sorted results
        const assets = await this.db.asset_imports
            .where('[log_id+asset_category+import_time_ms]')
            .between([logId, category, Dexie.minKey], [logId, category, Dexie.maxKey])
            .toArray();
        return assets;
    }

    /**
     * Get assets by type (sorted by import_time_ms using compound index)
     * Now supports efficient pagination with limit parameter
     */
    async getAssetsByType(logId, assetType, limit = null) {
        await this.open();
        // Use compound index [log_id+asset_type+import_time_ms] for sorted results
        // Query on first two fields, results are automatically sorted by third field
        let query = this.db.asset_imports
            .where('[log_id+asset_type+import_time_ms]')
            .between([logId, assetType, Dexie.minKey], [logId, assetType, Dexie.maxKey]);
        
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
            .where('[log_id+asset_type+import_time_ms]')
            .between([logId, assetType, Dexie.minKey], [logId, assetType, Dexie.maxKey])
            .each(() => { totalCount++; });
        
        // Load first batch immediately using limit (most efficient)
        let offset = 0;
        let allAssets = [];
        
        while (offset < totalCount) {
            // Load one batch at a time - compound index ensures sorted results
            const batch = await this.db.asset_imports
                .where('[log_id+asset_type+import_time_ms]')
                .between([logId, assetType, Dexie.minKey], [logId, assetType, Dexie.maxKey])
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
            .where('[log_id+asset_type+import_time_ms]')
            .between([logId, assetType, Dexie.minKey], [logId, assetType, Dexie.maxKey])
            .each(() => { count++; });
        return count;
    }

    /**
     * Get assets by importer (sorted by import_time_ms using compound index)
     */
    async getAssetsByImporter(logId, importerType) {
        await this.open();
        // Use compound index [log_id+importer_type+import_time_ms] for sorted results
        const assets = await this.db.asset_imports
            .where('[log_id+importer_type+import_time_ms]')
            .between([logId, importerType, Dexie.minKey], [logId, importerType, Dexie.maxKey])
            .toArray();
        return assets;
    }

    /**
     * Get top slowest assets (sorted descending by import_time_ms using compound index)
     */
    async getTopSlowest(logId, limit = 20) {
        await this.open();
        // Use compound index [log_id+import_time_ms] and reverse to get slowest first
        // Then take only the first N items for efficiency
        const assets = await this.db.asset_imports
            .where('[log_id+import_time_ms]')
            .between([logId, Dexie.minKey], [logId, Dexie.maxKey])
            .reverse()
            .limit(limit)
            .toArray();
        return assets;
    }

    /**
     * Get pipeline refreshes
     */
    async getPipelineRefreshes(logId) {
        await this.open();
        const refreshes = await this.db.pipeline_refreshes
            .where('log_id').equals(logId)
            .toArray();
        return refreshes.sort((a, b) => (a.total_time_seconds || 0) - (b.total_time_seconds || 0));
    }

    /**
     * Get pipeline breakdown
     */
    async getPipelineBreakdown(logId) {
        await this.open();
        const refreshes = await this.db.pipeline_refreshes
            .where('log_id').equals(logId)
            .toArray();
        
        // Get Script Compilation operations
        const scriptCompOps = await this.db.operations
            .where('log_id').equals(logId)
            .filter(op => op.operation_type === 'Script Compilation')
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
     * Get operations breakdown by type for the operations widget
     */
    async getOperationsBreakdown(logId) {
        await this.open();
        
        const operations = await this.db.operations
            .where('log_id').equals(logId)
            .toArray();
        
        // Group by operation_type and sum durations
        const breakdown = {};
        operations.forEach(op => {
            const type = op.operation_type || 'Unknown';
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
     * Get operations by type
     */
    async getOperationsByType(operationType, logId) {
        await this.open();
        const operations = await this.db.operations
            .where('log_id').equals(logId)
            .filter(op => op.operation_type === operationType)
            .toArray();
        
        // Sort by line_number
        return operations.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
    }

    /**
     * Get script compilation data (now returns Tundra operations)
     */
    async getScriptCompilation(logId) {
        await this.open();
        // Return Tundra operations as script compilation
        const tundraOps = await this.db.operations
            .where('log_id').equals(logId)
            .filter(op => op.operation_type === 'Tundra')
            .toArray();
        return tundraOps.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
    }

    /**
     * Get error and warning counts
     * Now reads from log_metadata for fast retrieval (counters are maintained during parsing)
     */
    async getErrorWarningCounts(logId) {
        await this.open();
        const metadata = await this.db.log_metadata.get(logId);
        
        // If metadata exists and has counts, use them (fast path)
        if (metadata && metadata.error_count !== undefined && metadata.warning_count !== undefined) {
            return {
                errors: metadata.error_count || 0,
                warnings: metadata.warning_count || 0
            };
        }
        
        // Fallback: if metadata doesn't exist or doesn't have counts (old logs), calculate from log_lines
        // This should rarely happen after migration, but ensures backward compatibility
        const lines = await this.db.log_lines
            .where('log_id').equals(logId)
            .toArray();
        
        const errorCount = lines.filter(l => l.is_error === true || l.is_error === 1).length;
        const warningCount = lines.filter(l => l.is_warning === true || l.is_warning === 1).length;

        // If metadata exists but counts were missing, update it for next time
        if (metadata && (metadata.error_count === undefined || metadata.warning_count === undefined)) {
            await this.db.log_metadata.update(logId, {
                error_count: errorCount,
                warning_count: warningCount
            });
        }

        return {
            errors: errorCount,
            warnings: warningCount
        };
    }

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
     */
    async getLogLine(logId, lineNumber) {
        await this.open();
        const lines = await this.db.log_lines
            .where('log_id').equals(logId)
            .filter(line => line.line_number === lineNumber)
            .toArray();
        
        return lines.length > 0 ? lines[0] : null;
    }

    /**
     * Get folder analysis
     */
    async getFolderAnalysis(logId) {
        await this.open();
        const assets = await this.db.asset_imports
            .where('log_id').equals(logId)
            .toArray();
        
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
        await this.open();
        const builder = new TimelineBuilder(this.db, logId);
        return await builder.build();
    }

    /**
     * Bulk insert methods for parsing
     */
    async insertLogMetadata(data) {
        await this.open();
        const id = await this.db.log_metadata.add(data);
        return id;
    }

    async bulkInsertAssetImports(imports) {
        await this.open();
        
        try {
            await this.db.asset_imports.bulkAdd(imports);
        } catch (error) {
            console.error(`[Database] bulkInsertAssetImports: Error inserting imports:`, error);
            // If bulkAdd fails due to duplicates, try individual inserts
            if (error.name === 'ConstraintError') {
                console.warn(`[Database] bulkInsertAssetImports: Constraint error, attempting individual inserts...`);
                let successCount = 0;
                let failCount = 0;
                for (const imp of imports) {
                    try {
                        await this.db.asset_imports.add(imp);
                        successCount++;
                    } catch (e) {
                        failCount++;
                        console.warn(`[Database] Failed to insert asset import:`, imp, e);
                    }
                }
                console.log(`[Database] bulkInsertAssetImports: Individual inserts - ${successCount} succeeded, ${failCount} failed`);
            } else {
                throw error;
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

    async bulkInsertTelemetryData(telemetry) {
        await this.open();
        await this.db.telemetry_data.bulkAdd(telemetry);
    }

    async bulkInsertOperations(operations) {
        await this.open();
        await this.db.operations.bulkAdd(operations);
    }

    async bulkInsertLogLines(lines, progressCallback = null, cancelSignal = null) {
        await this.open();
        // Insert in batches to avoid memory issues
        const batchSize = 1000;
        const totalBatches = Math.ceil(lines.length / batchSize);
        
        // Timing for first 3 batches to estimate remaining time
        const batchTimes = [];
        const startTime = performance.now();
        
        for (let i = 0; i < lines.length; i += batchSize) {
            // Check for cancellation
            if (cancelSignal && cancelSignal.cancelled) {
                throw new Error('Batch storage cancelled by user');
            }
            
            const batchStartTime = performance.now();
            const batch = lines.slice(i, i + batchSize);
            await this.db.log_lines.bulkAdd(batch);
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
                const percent = (processed / lines.length) * 100;
                
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
                
                progressCallback(batchNum, totalBatches, processed, lines.length, percent, estimatedTimeRemaining);
            }
        }
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
            
            const telemetry = await this.db.telemetry_data.toArray();
            telemetry.forEach(record => {
                totalSize += this._calculateObjectSize(record);
            });
            
            const operations = await this.db.operations.toArray();
            operations.forEach(record => {
                totalSize += this._calculateObjectSize(record);
            });
            
            const logLines = await this.db.log_lines.toArray();
            logLines.forEach(record => {
                totalSize += this._calculateObjectSize(record);
            });
            
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
}

/**
 * Delete old databases (all versions except the current one)
 * Uses indexedDB.databases() to check for existing databases first, then deletes them.
 * Falls back to trying known version numbers if databases() is not available.
 * @param {number} currentVersion - The current database version to keep
 */
async function cleanupOldDatabases(currentVersion) {
    console.log(`[Database] Cleaning up old databases (keeping version ${currentVersion})...`);
    
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
                                    console.log(`[Database] Deleted old database: ${dbName} (version ${dbVersion})`);
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
        console.log(`[Database] Using fallback method: trying versions 1 to ${currentVersion - 1}`);
        for (let oldVersion = 1; oldVersion < currentVersion; oldVersion++) {
            const oldDbName = getDbName(oldVersion);
            deletePromises.push(
                Dexie.delete(oldDbName)
                    .then(() => {
                        console.log(`[Database] Deleted old database: ${oldDbName}`);
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
        console.log(`[Database] Cleanup complete`);
    } else {
        console.log(`[Database] No old databases found to clean up`);
    }
}

/**
 * Create a new database for a new parse
 * Cleans up old databases before creating the new one
 * @returns {Promise<UnityLogDatabase>} New database instance
 */
async function createNewDatabase() {
    const oldVersion = getCurrentDbVersion();
    const version = getNextDbVersion();
    
    // Clean up old databases before creating the new one
    // This keeps only the most recent database
    await cleanupOldDatabases(version);
    
    return new UnityLogDatabase(version);
}

/**
 * Get the current active database
 * @returns {UnityLogDatabase} Current database instance
 */
function getCurrentDatabase() {
    return new UnityLogDatabase();
}

// Export for use in other modules
window.UnityLogDatabase = UnityLogDatabase;
window.createNewDatabase = createNewDatabase;
window.getCurrentDatabase = getCurrentDatabase;
window.getCurrentDbVersion = getCurrentDbVersion;

