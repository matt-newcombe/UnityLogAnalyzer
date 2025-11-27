/**
 * Unity Editor Log Parser
 * 
 * Parses Unity Editor.log files and stores data in IndexedDB.
 * This is the main orchestrator that coordinates:
 * - File streaming (via file-reader.js)
 * - Line parsing (via handlers/)
 * - Database operations (via ParsingDatabaseOperations)
 */

import { LogPatterns } from './log-patterns.js';
import { ParserState } from './parser-state.js';
import { readFileStreaming, formatFileSize } from './file-reader.js';
import { WorkerThreadHandler } from './handlers/worker-thread-handler.js';
import { AssetHandler } from './handlers/asset-handler.js';
import { PipelineHandler } from './handlers/pipeline-handler.js';
import { ScriptCompilationHandler } from './handlers/script-compilation-handler.js';
import { AcceleratorHandler } from './handlers/accelerator-handler.js';
import { SpriteAtlasHandler } from './handlers/sprite-atlas-handler.js';
import { MetadataHandler } from './handlers/metadata-handler.js';

/**
 * Main parser class - orchestrates log file parsing
 */
class UnityLogParser {
    constructor(db, progressCallback = null) {
        this.db = db;
        this.progressCallback = progressCallback;
        this._initHandlers();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Parse a complete log file
     * @param {File} file - The log file to parse
     * @param {Object} cancelSignal - Optional cancellation signal
     * @param {Function} storageProgressCallback - Optional callback for storage progress
     * @returns {Promise<{logId: number}>}
     */
    async parseLogFile(file, cancelSignal = null, storageProgressCallback = null) {
        this._report(`Reading log file (${formatFileSize(file.size)})...`);

        // Initialize file cache and create metadata entry
        this._cacheFile(file);
        const logId = await this._createLogMetadata(file);
        window.logFileCache.set(logId, file);

        this._report(`Parsing log lines...`);

        // Initialize parsing state and database operations
        const state = new ParserState();
        const dbOps = new ParsingDatabaseOperations(this.db, this.progressCallback);

        // Process all lines (synchronous handler calls, no DB writes)
        const totalLines = await this._processFile(file, state, dbOps, cancelSignal);

        // Finalize any pending state
        this._finalizeParsing(state, dbOps);

        // Flush pending metadata update if any
        if (state.pendingMetadataUpdate) {
            await dbOps.updateLogMetadata(state.pendingMetadataUpdate);
        }

        // Write all collected data to database
        await dbOps.executeBatchOperations(cancelSignal, storageProgressCallback);

        // Update final metadata
        await this._updateFinalMetadata(logId, totalLines, state);

        this._report(`✓ Parsing complete: ${totalLines.toLocaleString()} lines processed`);

        return { logId };
    }

    /**
     * Process a single line (for external callers like live monitoring)
     * Returns the dbOps so caller can flush if needed
     */
    processLine(line, lineNumber, parserState, options = {}) {
        const dbOps = options.dbOps || new ParsingDatabaseOperations(this.db, this.progressCallback);
        
        this._parseLine(line, lineNumber, parserState, {
            ...options,
            dbOps
        });

        return dbOps;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────────────────────────────────

    _initHandlers() {
        this.handlers = {
            metadata: new MetadataHandler(),
            workerThread: new WorkerThreadHandler(),
            asset: new AssetHandler(),
            pipeline: new PipelineHandler(),
            scriptCompilation: new ScriptCompilationHandler(),
            accelerator: new AcceleratorHandler(),
            spriteAtlas: new SpriteAtlasHandler()
        };
    }

    _cacheFile(file) {
        if (!window.logFileCache) {
            window.logFileCache = new Map();
        }
    }

    async _createLogMetadata(file) {
        return await this.db.insertLogMetadata({
            log_file: file.name,
            date_parsed: new Date().toISOString(),
            total_lines: null,
            total_parse_time_ms: null,
            timestampsEnabled: null
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FILE PROCESSING
    // ─────────────────────────────────────────────────────────────────────────

    async _processFile(file, state, dbOps, cancelSignal) {
        let lastProgressReport = 0;
        const PROGRESS_INTERVAL = 10000;

        const onProgress = (percentRead, lineNumber) => {
            this._report(`Reading: ${percentRead.toFixed(1)}% (${lineNumber.toLocaleString()} lines read)`);
        };

        const processLine = (line, lineNumber, byteOffset) => {
            this._parseLine(line, lineNumber, state, {
                timestampsEnabled: state.timestampsEnabled,
                byteOffset,
                dbOps,
                skipLogLineStorage: true
            });

            if (lineNumber - lastProgressReport >= PROGRESS_INTERVAL) {
                this._report(`Processed ${lineNumber.toLocaleString()} lines...`);
                lastProgressReport = lineNumber;
            }

            if (cancelSignal?.cancelled) {
                throw new Error('Parsing cancelled');
            }
        };

        return await readFileStreaming(file, processLine, { onProgress, cancelSignal });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LINE PARSING - Handler Dispatch
    // ─────────────────────────────────────────────────────────────────────────

    _parseLine(line, lineNumber, state, options) {
        const { timestampsEnabled, byteOffset, dbOps } = options;

        // Track current line info in state
        state.currentLine = line;
        state.currentLineNumber = lineNumber;
        state.currentLineByteOffset = byteOffset;

        // Extract timestamp if present
        const { timestamp, contentLine } = this._stripTimestamp(line, timestampsEnabled);
        if (timestamp) {
            state.updateTimestamps(timestamp);
        }

        // Dispatch to handlers in priority order
        const h = this.handlers;
        const args = [contentLine, line, lineNumber, timestamp, state, dbOps];

        // 1. Metadata (only during initial lines)
        if (!state.metadataState.endTime && h.metadata.handle(...args)) return;

        // 2. Worker thread lines
        if (h.workerThread.handle(...args)) return;

        // 3. Check if worker barriers should be joined (returns true if line should be ignored)
        if (h.workerThread.shouldJoinThreadBarriers(contentLine, timestamp, state, dbOps)) return;

        // 4. Check if active cache server block should be finalized
        h.accelerator.handleNonAcceleratorLine(contentLine, state, dbOps);

        // 5. Pipeline refresh
        if (h.pipeline.handle(...args)) return;

        // 6. Cache server / Accelerator
        if (h.accelerator.handle(...args)) return;

        // 7. Sprite atlas
        if (h.spriteAtlas.handle(...args)) return;

        // 8. Asset imports
        if (h.asset.handle(...args)) return;

        // 9. Script compilation
        if (h.scriptCompilation.handle(...args)) return;
    }

    _stripTimestamp(line, timestampsEnabled) {
        if (!timestampsEnabled) {
            return { timestamp: null, contentLine: line };
        }

        const match = line.match(LogPatterns.TimestampPrefix);
        if (match) {
            return { timestamp: match[1], contentLine: match[2] };
        }
        return { timestamp: null, contentLine: line };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FINALIZATION
    // ─────────────────────────────────────────────────────────────────────────

    _finalizeParsing(state, dbOps) {
        // Finalize any active cache server block
        if (state.acceleratorBlock) {
            this.handlers.accelerator._finalizeBlock(state.acceleratorBlock, dbOps);
        }

        // Join any active worker thread barriers
        this.handlers.workerThread.joinBarriers(state.lastTimestamp, state, dbOps);
    }

    async _updateFinalMetadata(logId, totalLines, state) {
        await this.db.open();
        
        const update = { total_lines: totalLines };
        if (state.firstTimestamp && state.lastTimestamp) {
            update.start_timestamp = state.firstTimestamp;
            update.end_timestamp = state.lastTimestamp;
        }

        await this.db.db.log_metadata.update(logId, update);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────────────────────

    _report(message) {
        if (this.progressCallback) {
            this.progressCallback(message);
        }
    }
}

// Export for module and global use
export { UnityLogParser };

if (typeof window !== 'undefined') {
    window.UnityLogParser = UnityLogParser;
}
