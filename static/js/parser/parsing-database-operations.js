/**
 * ParsingDatabaseOperations - Centralized database operations during parsing
 * 
 * All add* methods are synchronous and just collect data into arrays.
 * For offline parsing: call executeBatchOperations() at the end to write everything.
 * For live parsing: call flush() after each line to write immediately.
 * 
 * @param {UnityLogDatabase} db - IndexedDB database instance
 * @param {Function} progressCallback - Optional callback for progress updates
 */
class ParsingDatabaseOperations {
    constructor(db, progressCallback = null) {
        this.db = db;
        this.progressCallback = progressCallback;

        // Always collect into arrays
        this.collectArrays = {
            assetImports: [],
            pipelineRefreshes: [],
            processes: [],
            acceleratorBlocks: [],
            workerPhases: []
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SYNCHRONOUS COLLECTION METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Add an asset import to the collection
     */
    addAssetImport(assetImport) {
        this.collectArrays.assetImports.push(assetImport);
    }

    /**
     * Add a process to the collection
     */
    addProcess(process) {
        this.collectArrays.processes.push(process);
    }

    /**
     * Add a pipeline refresh to the collection
     */
    addPipelineRefresh(refreshData) {
        this.collectArrays.pipelineRefreshes.push(refreshData);
    }

    /**
     * Add an accelerator block to the collection
     */
    addAcceleratorBlock(block) {
        this.collectArrays.acceleratorBlocks.push(block);
    }

    /**
     * Add a worker phase to the collection
     */
    addWorkerPhase(phase) {
        this.collectArrays.workerPhases.push(phase);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ASYNC DATABASE OPERATIONS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Update log metadata (always writes immediately)
     * Updates the single log entry (we only ever parse one log at a time)
     */
    async updateLogMetadata(updates) {
        await this.db.open();
        const log = await this.db.db.log_metadata.toCollection().first();
        if (log) {
            await this.db.db.log_metadata.update(log.id, updates);
        }
    }

    /**
     * Flush all collected data to the database immediately
     * Used for live monitoring where we want to write after each line
     */
    async flush() {
        const arrays = this.collectArrays;

        if (arrays.assetImports.length > 0) {
            await this.db.open();
            await this.db.db.asset_imports.bulkAdd(arrays.assetImports);
            arrays.assetImports = [];
        }

        if (arrays.processes.length > 0) {
            await this.db.open();
            await this.db.db.processes.bulkAdd(arrays.processes);
            arrays.processes = [];
        }

        if (arrays.pipelineRefreshes.length > 0) {
            await this.db.open();
            await this.db.db.pipeline_refreshes.bulkAdd(arrays.pipelineRefreshes);
            arrays.pipelineRefreshes = [];
        }

        if (arrays.acceleratorBlocks.length > 0) {
            await this.db.open();
            await this.db.db.cache_server_download_blocks.bulkAdd(arrays.acceleratorBlocks);
            arrays.acceleratorBlocks = [];
        }

        if (arrays.workerPhases.length > 0) {
            await this.db.open();
            await this.db.db.worker_thread_phases.bulkAdd(arrays.workerPhases);
            arrays.workerPhases = [];
        }
    }

    /**
     * Report progress message
     */
    _reportProgress(message) {
        if (this.progressCallback) {
            this.progressCallback(message);
        }
    }

    /**
     * Execute batch operations for all collected data
     * Called when parsing is complete for offline file parsing
     * @param {Object} cancelSignal - Optional cancellation signal
     * @param {Function} storageProgressCallback - Optional callback for storage progress
     */
    async executeBatchOperations(cancelSignal = null, storageProgressCallback = null) {
        const arrays = this.collectArrays;

        // Store asset imports
        if (arrays.assetImports.length > 0) {
            this._reportProgress(`Storing ${arrays.assetImports.length} asset imports...`);

            const assetProgressCallback = storageProgressCallback ?
                (batchNum, totalBatches, processed, total, percent, estimatedTimeRemaining) => {
                    storageProgressCallback('storing_asset_imports', 'Storing asset imports', percent, estimatedTimeRemaining);
                } : null;

            await this.db.bulkInsertAssetImports(arrays.assetImports, assetProgressCallback, cancelSignal);

            if (storageProgressCallback) {
                storageProgressCallback('storing_asset_imports', 'Storing asset imports', 100, null);
            }
        }

        // Store processes
        if (arrays.processes.length > 0) {
            this._reportProgress(`Storing ${arrays.processes.length} processes...`);
            await this.db.bulkInsertProcesses(arrays.processes);
        }

        // Store pipeline refreshes
        if (arrays.pipelineRefreshes.length > 0) {
            this._reportProgress(`Storing ${arrays.pipelineRefreshes.length} pipeline refreshes...`);
            await this.db.bulkInsertPipelineRefreshes(arrays.pipelineRefreshes);
        }

        // Store accelerator blocks
        if (arrays.acceleratorBlocks.length > 0) {
            this._reportProgress(`Storing ${arrays.acceleratorBlocks.length} accelerator blocks...`);
            await this.db.bulkInsertCacheServerBlocks(arrays.acceleratorBlocks);
        }

        // Store worker phases
        if (arrays.workerPhases.length > 0) {
            this._reportProgress(`Storing ${arrays.workerPhases.length} worker phases...`);
            await this.db.open();
            await this.db.db.worker_thread_phases.bulkAdd(arrays.workerPhases);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ParsingDatabaseOperations;
} else {
    window.ParsingDatabaseOperations = ParsingDatabaseOperations;
}
