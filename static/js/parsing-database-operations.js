/**
 * ParsingDatabaseOperations - Centralized database operations during parsing
 * Handles all database writes, either collecting for batch operations or writing immediately
 * 
 * @param {UnityLogDatabase} db - IndexedDB database instance
 * @param {boolean} isLiveFileWatching - If false, collect data in arrays for batch operations. If true, write immediately.
 * @param {Function} progressCallback - Optional callback for progress updates
 */
class ParsingDatabaseOperations {
    constructor(db, isLiveFileWatching = false, progressCallback = null) {
        this.db = db;
        this.isLiveFileWatching = isLiveFileWatching;
        this.progressCallback = progressCallback;

        // If not live watching, create arrays for batch collection
        if (!isLiveFileWatching) {
            this.collectArrays = {
                assetImports: [],
                pipelineRefreshes: [],
                processes: [],
                operations: [],
                cacheServerBlocks: [],
                logLines: [],
                workerPhases: []
            };
        } else {
            this.collectArrays = null;
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
     * Add an asset import (collect or write immediately)
     */
    async addAssetImport(assetImport) {
        if (!this.isLiveFileWatching && this.collectArrays) {
            this.collectArrays.assetImports.push(assetImport);
        } else {
            await this.db.open();
            await this.db.db.asset_imports.add(assetImport);
        }
    }

    /**
     * Add a process (collect or write immediately)
     */
    async addProcess(process) {
        if (!this.isLiveFileWatching && this.collectArrays) {
            this.collectArrays.processes.push(process);
        } else {
            await this.db.open();
            await this.db.db.processes.add(process);
        }
    }

    /**
     * Add a pipeline refresh (collect or write immediately)
     */
    async addPipelineRefresh(refreshData) {
        if (!this.isLiveFileWatching && this.collectArrays) {
            this.collectArrays.pipelineRefreshes.push(refreshData);
        } else {
            await this.db.open();
            await this.db.db.pipeline_refreshes.add(refreshData);
        }
    }



    /**
     * Add a cache server block (collect or write immediately)
     */
    async addCacheServerBlock(block) {
        if (!this.isLiveFileWatching && this.collectArrays) {
            this.collectArrays.cacheServerBlocks.push(block);
        } else {
            await this.db.open();
            await this.db.db.cache_server_download_blocks.add(block);
        }
    }

    /**
     * Add a worker phase (collect or write immediately)
     */
    async addWorkerPhase(phase) {
        if (!this.isLiveFileWatching && this.collectArrays) {
            if (!this.collectArrays.workerPhases) {
                this.collectArrays.workerPhases = [];
            }
            this.collectArrays.workerPhases.push(phase);
        } else {
            await this.db.open();
            await this.db.db.worker_thread_phases.add(phase);
        }
    }

    /**
     * Update a cache server block (only for immediate writes, not collected)
     */
    async updateCacheServerBlock(blockId, updates) {
        if (!this.isLiveFileWatching) {
            // For collected blocks, we'll update them in the array before batch insert
            // This method is only called for immediate writes
            throw new Error('updateCacheServerBlock should not be called in batch collection mode');
        } else {
            await this.db.open();
            await this.db.db.cache_server_download_blocks.update(blockId, updates);
        }
    }

    /**
     * Add a log line (no-op - log lines are no longer stored in database)
     * Log lines are now read directly from the file on demand
     */
    async addLogLine(logLineData) {
        // Log lines are no longer stored - they're read from file on demand
        // This method is kept for backward compatibility but does nothing
        if (!this.isLiveFileWatching && this.collectArrays) {
            // Still collect in arrays for compatibility, but they won't be used
            this.collectArrays.logLines.push(logLineData);
        }
        // No database operation - log lines are read from file
    }

    /**
     * Update log metadata (always writes immediately, not collected)
     */
    async updateLogMetadata(logId, updates) {
        await this.db.open();
        await this.db.db.log_metadata.update(logId, updates);
    }

    /**
     * Execute batch operations for all collected data
     * Called when parsing is complete for offline file parsing
     * Only works when isLiveFileWatching is false
     * @param {Object} cancelSignal - Optional cancellation signal
     * @param {Function} storageProgressCallback - Optional callback for storage progress (phaseId, phaseLabel, percent, timeRemaining)
     */
    async executeBatchOperations(cancelSignal = null, storageProgressCallback = null) {
        if (this.isLiveFileWatching || !this.collectArrays) {
            return; // Nothing to do if live watching or no arrays
        }

        const collectArrays = this.collectArrays;

        // Store asset imports
        if (collectArrays.assetImports && collectArrays.assetImports.length > 0) {
            this._reportProgress(`Storing ${collectArrays.assetImports.length} asset imports...`);

            const assetProgressCallback = storageProgressCallback ?
                (batchNum, totalBatches, processed, total, percent, estimatedTimeRemaining) => {
                    storageProgressCallback('storing_asset_imports', 'Storing asset imports', percent, estimatedTimeRemaining);
                } : null;

            await this.db.bulkInsertAssetImports(collectArrays.assetImports, assetProgressCallback, cancelSignal);

            if (storageProgressCallback) {
                storageProgressCallback('storing_asset_imports', 'Storing asset imports', 100, null);
            }
        }

        // Store processes
        if (collectArrays.processes && collectArrays.processes.length > 0) {
            this._reportProgress(`Storing ${collectArrays.processes.length} processes...`);
            await this.db.bulkInsertProcesses(collectArrays.processes);
        }

        // Store pipeline refreshes
        if (collectArrays.pipelineRefreshes && collectArrays.pipelineRefreshes.length > 0) {
            this._reportProgress(`Storing ${collectArrays.pipelineRefreshes.length} pipeline refreshes...`);
            await this.db.bulkInsertPipelineRefreshes(collectArrays.pipelineRefreshes);
        }



        // Store cache server blocks
        if (collectArrays.cacheServerBlocks && collectArrays.cacheServerBlocks.length > 0) {
            this._reportProgress(`Storing ${collectArrays.cacheServerBlocks.length} cache server blocks...`);
            await this.db.bulkInsertCacheServerBlocks(collectArrays.cacheServerBlocks);
        }

        // Store worker phases
        if (collectArrays.workerPhases && collectArrays.workerPhases.length > 0) {
            this._reportProgress(`Storing ${collectArrays.workerPhases.length} worker phases...`);
            await this.db.open();
            await this.db.db.worker_thread_phases.bulkAdd(collectArrays.workerPhases);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ParsingDatabaseOperations;
} else {
    window.ParsingDatabaseOperations = ParsingDatabaseOperations;
}

