/**
 * Database Core
 * Schema, versioning, connection management, and base CRUD operations.
 */

// Database version counter - stored in localStorage
const DB_VERSION_KEY = 'unity_log_db_version';
const DB_NAME_PREFIX = 'UnityLogAnalyzer';

// ─────────────────────────────────────────────────────────────────────────────
// VERSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current database version
 * @returns {number} Current database version
 */
function getCurrentDbVersion() {
    const version = localStorage.getItem(DB_VERSION_KEY);
    return version ? parseInt(version, 10) : 2;
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
 * Detect the highest existing database version and sync localStorage
 * @returns {Promise<number>} The highest database version found
 */
async function syncDatabaseVersion() {
    const storedVersion = getCurrentDbVersion();
    let highestVersion = storedVersion;

    if (indexedDB.databases) {
        try {
            const databases = await indexedDB.databases();
            const dbNamePattern = new RegExp(`^${DB_NAME_PREFIX}_v(\\d+)$`);

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
            // Silent fail - not all browsers support indexedDB.databases()
        }
    }

    if (highestVersion > storedVersion) {
        localStorage.setItem(DB_VERSION_KEY, highestVersion.toString());
    }

    return highestVersion;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Database schema definition
 * Single version - databases are regenerated on schema changes
 */
const DATABASE_SCHEMA = {
    log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms, start_timestamp, end_timestamp, last_processed_line, is_live_monitoring',
    asset_imports: '++id, line_number, byte_offset, asset_path, asset_name, asset_type, asset_category, guid, importer_type, import_time_ms, duration_ms, start_timestamp, end_timestamp, worker_thread_id, [asset_type+import_time_ms], [asset_category+import_time_ms], [importer_type+import_time_ms], [worker_thread_id+start_timestamp]',
    pipeline_refreshes: '++id, line_number, byte_offset, refresh_id, total_time_seconds, initiated_by',
    processes: '++id, line_number, byte_offset, process_type, process_name, duration_seconds, duration_ms, memory_mb, start_timestamp, end_timestamp',
    parser_state: '++id, state_type, state_data',
    cache_server_download_blocks: '++id, line_number, start_timestamp, end_timestamp, duration_seconds, duration_ms, num_assets_requested, num_assets_downloaded, downloaded_assets',
    worker_thread_phases: '++id, worker_thread_id, start_timestamp, end_timestamp, duration_ms, import_count, start_line_number, [worker_thread_id+start_timestamp]'
};

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core database wrapper class
 * Handles connection management and provides base operations
 */
class UnityLogDatabaseCore {
    constructor(version) {
        this.version = version || getCurrentDbVersion();
        this.dbName = getDbName(this.version);
        this.db = null;
        this._initDatabase();
    }

    _initDatabase() {
        this.db = new Dexie(this.dbName);
        this.db.version(1).stores(DATABASE_SCHEMA);
    }

    /**
     * Open the database connection
     */
    async open() {
        try {
            await this.db.open();
            return this.db;
        } catch (error) {
            if (error.name === 'DatabaseClosedError' || error.message?.includes('Database has been closed')) {
                await new Promise(resolve => setTimeout(resolve, 100));
                const freshDb = await getCurrentDatabase();
                this.db = freshDb.db;
                await this.db.open();
                return this.db;
            }
            throw error;
        }
    }

    /**
     * Close the database connection
     */
    async close() {
        if (this.db) {
            try {
                await this.db.close();
            } catch (error) {
                // Ignore - database might already be closed
            }
        }
    }

    /**
     * Execute a database operation with automatic retry on connection errors
     * @param {Function} operation - Async function to execute
     * @returns {Promise<*>} Operation result
     */
    async safeOperation(operation) {
        try {
            await this.open();
            return await operation();
        } catch (error) {
            if (error.name === 'DatabaseClosedError' || error.message?.includes('Database has been closed')) {
                try {
                    const freshDb = await getCurrentDatabase();
                    this.db = freshDb.db;
                    await this.db.open();
                    return await operation();
                } catch (retryError) {
                    throw error;
                }
            }
            throw error;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // METADATA OPERATIONS
    // ─────────────────────────────────────────────────────────────────────────

    async getLogs() {
        await this.open();
        const logs = await this.db.log_metadata.orderBy('date_parsed').reverse().toArray();
        return logs.map(log => ({
            ...log,
            date_parsed: log.date_parsed || new Date().toISOString()
        }));
    }

    async getLogMetadata(logId) {
        await this.open();
        return await this.db.log_metadata.get(logId);
    }

    async insertLogMetadata(data) {
        await this.open();
        return await this.db.log_metadata.add(data);
    }

    async setLiveMonitoring(logId, isMonitoring) {
        await this.open();
        await this.db.log_metadata.update(logId, { is_live_monitoring: isMonitoring });
    }

    async updateLastProcessedLine(logId, lineNumber) {
        await this.open();
        await this.db.log_metadata.update(logId, { last_processed_line: lineNumber });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PARSER STATE OPERATIONS
    // ─────────────────────────────────────────────────────────────────────────

    async saveParserState(logId, stateType, stateData) {
        await this.open();
        await this.db.parser_state
            .filter(state => state.state_type === stateType)
            .delete();
        await this.db.parser_state.add({
            state_type: stateType,
            state_data: JSON.stringify(stateData)
        });
    }

    async loadParserState(logId, stateType) {
        await this.open();
        const state = await this.db.parser_state
            .filter(s => s.state_type === stateType)
            .first();
        return state ? JSON.parse(state.state_data) : null;
    }

    async clearParserState(logId) {
        await this.open();
        await this.db.parser_state.clear();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BULK INSERT OPERATIONS
    // ─────────────────────────────────────────────────────────────────────────

    async bulkInsertAssetImports(imports, progressCallback = null, cancelSignal = null) {
        await this.open();
        const batchSize = 1000;
        const totalBatches = Math.ceil(imports.length / batchSize);
        const batchTimes = [];

        for (let i = 0; i < imports.length; i += batchSize) {
            if (cancelSignal?.cancelled) {
                throw new Error('Batch storage cancelled by user');
            }

            const batchStartTime = performance.now();
            const batch = imports.slice(i, i + batchSize);

            try {
                await this.db.asset_imports.bulkAdd(batch);
            } catch (error) {
                if (error.name === 'ConstraintError') {
                    // Fallback to individual inserts on constraint errors
                    for (const imp of batch) {
                        try {
                            await this.db.asset_imports.add(imp);
                        } catch (e) {
                            // Skip duplicates silently
                        }
                    }
                } else {
                    throw error;
                }
            }

            const batchNum = Math.floor(i / batchSize) + 1;
            if (batchNum <= 3) {
                batchTimes.push(performance.now() - batchStartTime);
            }

            if (progressCallback) {
                const processed = i + batch.length;
                const percent = (processed / imports.length) * 100;
                let estimatedTimeRemaining = null;
                
                if (batchNum >= 3 && batchTimes.length === 3) {
                    const avgBatchTime = batchTimes.reduce((sum, t) => sum + t, 0) / batchTimes.length;
                    estimatedTimeRemaining = ((totalBatches - batchNum) * avgBatchTime) / 1000;
                } else if (batchNum < 3) {
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

    async bulkInsertProcesses(processes) {
        await this.open();
        await this.db.processes.bulkAdd(processes);
    }

    async bulkInsertCacheServerBlocks(blocks) {
        await this.open();
        await this.db.cache_server_download_blocks.clear();
        await this.db.cache_server_download_blocks.bulkAdd(blocks);
    }

    async bulkInsertLogLines(lines, progressCallback = null, cancelSignal = null) {
        // Log lines are read from file on demand - this is a no-op for backward compatibility
        if (progressCallback) {
            progressCallback(0, 1, 0, lines.length, 100, 0);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete old databases (all versions except the current one)
 */
async function cleanupOldDatabases(currentVersion) {
    const deletePromises = [];

    if (indexedDB.databases) {
        try {
            const databases = await indexedDB.databases();
            const dbNamePattern = new RegExp(`^${DB_NAME_PREFIX}_v(\\d+)$`);

            for (const dbInfo of databases) {
                const match = dbInfo.name.match(dbNamePattern);
                if (match) {
                    const dbVersion = parseInt(match[1], 10);
                    if (dbVersion !== currentVersion) {
                        deletePromises.push(
                            Dexie.delete(dbInfo.name).catch(() => {})
                        );
                    }
                }
            }
        } catch (error) {
            // Fall through to version-based deletion
        }
    }

    if (deletePromises.length === 0) {
        for (let oldVersion = 1; oldVersion < currentVersion; oldVersion++) {
            deletePromises.push(
                Dexie.delete(getDbName(oldVersion)).catch(() => {})
            );
        }
    }

    if (deletePromises.length > 0) {
        await Promise.allSettled(deletePromises);
    }
}

/**
 * Create a new database for a new parse
 * @returns {Promise<UnityLogDatabase>} New database instance
 */
async function createNewDatabase() {
    await syncDatabaseVersion();
    const version = getNextDbVersion();
    await cleanupOldDatabases(version);
    // Use UnityLogDatabase if available (loaded after this file), otherwise fall back to Core
    const DbClass = window.UnityLogDatabase || UnityLogDatabaseCore;
    return new DbClass(version);
}

/**
 * Get the current active database
 * @returns {Promise<UnityLogDatabase>} Current database instance
 */
async function getCurrentDatabase() {
    await syncDatabaseVersion();
    // Use UnityLogDatabase if available (loaded after this file), otherwise fall back to Core
    const DbClass = window.UnityLogDatabase || UnityLogDatabaseCore;
    return new DbClass();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

window.UnityLogDatabaseCore = UnityLogDatabaseCore;
window.getCurrentDbVersion = getCurrentDbVersion;
window.syncDatabaseVersion = syncDatabaseVersion;
window.createNewDatabase = createNewDatabase;
window.getCurrentDatabase = getCurrentDatabase;

