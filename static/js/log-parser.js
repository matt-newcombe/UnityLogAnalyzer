/**
 * Unity Editor Log Parser (JavaScript)
 * Ported from Python log_parser.py
 * Parses Unity Editor.log files and stores data directly in IndexedDB
 */

import { LogPatterns } from './parser/log-patterns.js';
import { ParserState } from './parser/parser-state.js';
import { LogStreamProcessor } from './parser/log-stream-processor.js';
import { TimelineNormalizer } from './timeline-normalizer.js';
import {
    WorkerThreadHandler,
    AssetHandler,
    PipelineHandler,
    ScriptCompilationHandler,
    AcceleratorHandler,
    SpriteAtlasHandler,
    MetadataHandler
} from './parser/handlers/index.js';
import {
    getExtension,
    getFilename,
    categorizeAsset,
    shouldSkipAsset,
    calculateWallTime
} from './parser/utils.js';

// Asset mappings are loaded globally via asset-mappings.js in index.html
const ASSET_EXT_DISPLAY_MAP = window.ASSET_EXT_DISPLAY_MAP || {};
const ASSET_CATEGORY_MAP = window.ASSET_CATEGORY_MAP || {};
const ASSET_IMPORTER_MAP = window.ASSET_IMPORTER_MAP || {};

// Code version patch number - increment when making changes to byte offset calculation or parsing logic
const PARSER_VERSION_PATCH = 6;

class UnityLogParser {
    /**
     * Initialize the parser
     * @param {UnityLogDatabase} db - IndexedDB database instance
     * @param {Function} progressCallback - Optional callback for progress updates
     */
    constructor(db, progressCallback = null) {
        this.db = db;
        this.progressCallback = progressCallback;

        // Initialize handlers
        this.metadataHandler = new MetadataHandler();
        this.workerThreadBarrierHandler = new WorkerThreadHandler();
        this.assetHandler = new AssetHandler();
        this.pipelineHandler = new PipelineHandler();
        this.scriptCompilationHandler = new ScriptCompilationHandler();
        this.acceleratorHandler = new AcceleratorHandler();

        // Initialize asset mappings (needed for SpriteAtlasHandler)
        this._initAssetMappings();
        this.spriteAtlasHandler = new SpriteAtlasHandler(this.extDisplayMap);
    }

    /**
     * Initialize asset type and category mappings
     */
    _initAssetMappings() {
        if (typeof ASSET_EXT_DISPLAY_MAP !== 'undefined') {
            this.extDisplayMap = ASSET_EXT_DISPLAY_MAP;
        } else {
            console.warn('[LogParser] ASSET_EXT_DISPLAY_MAP not found, using empty map');
            this.extDisplayMap = {};
        }

        if (typeof ASSET_CATEGORY_MAP !== 'undefined') {
            this.categoryMap = ASSET_CATEGORY_MAP;
        } else {
            console.warn('[LogParser] ASSET_CATEGORY_MAP not found, using empty map');
            this.categoryMap = {};
        }

        if (typeof ASSET_IMPORTER_MAP !== 'undefined') {
            this.importerMap = ASSET_IMPORTER_MAP;
        } else {
            console.warn('[LogParser] ASSET_IMPORTER_MAP not found, using empty map');
            this.importerMap = {};
        }
    }

    /**
     * Report progress
     */
    _reportProgress(message) {
        if (this.progressCallback) {
            this.progressCallback(message);
        }
    }

    /**
     * Strip timestamp prefix from a line and return both timestamp and stripped line
     */
    _stripTimestampPrefix(line) {
        const match = line.match(LogPatterns.TimestampPrefix);

        if (match) {
            return {
                timestamp: match[1],
                line: match[2] // Content after the timestamp prefix
            };
        }

        return {
            timestamp: null,
            line: line
        };
    }

    /**
     * Process file in streaming fashion to avoid memory issues
     */
    async _processFileStreaming(file, lineCallback, progressCallback = null, cancelSignal = null) {
        return new Promise((resolve, reject) => {
            const chunkSize = 1024 * 1024; // 1MB chunks
            const reader = new FileReader();
            let fileByteOffset = 0;
            let lineNumber = 0;
            const totalSize = file.size;
            let lastProgressUpdate = 0;

            // Use the shared LogStreamProcessor
            const processor = new LogStreamProcessor();

            const processChunk = async (chunkArrayBuffer) => {
                await processor.processChunk(chunkArrayBuffer, fileByteOffset, async (line, lineStartByteOffset) => {
                    lineNumber++;

                    if (cancelSignal && cancelSignal.cancelled) {
                        throw new Error('Parsing cancelled');
                    }

                    const result = lineCallback(line, lineNumber, lineStartByteOffset);
                    if (result && typeof result.then === 'function') {
                        await result;
                    }
                });
            };

            const readChunk = () => {
                if (cancelSignal && cancelSignal.cancelled) {
                    reject(new Error('Parsing cancelled'));
                    return;
                }

                const slice = file.slice(fileByteOffset, fileByteOffset + chunkSize);
                if (slice.size === 0) {
                    // End of file, flush any remaining content
                    processor.flush(async (line, lineStartByteOffset) => {
                        lineNumber++;
                        const result = lineCallback(line, lineNumber, lineStartByteOffset);
                        if (result && typeof result.then === 'function') {
                            await result;
                        }
                    }).then(() => {
                        if (progressCallback) progressCallback(100, lineNumber);
                        resolve(lineNumber);
                    }).catch(reject);
                    return;
                }

                reader.onload = async (e) => {
                    try {
                        await processChunk(e.target.result);
                        fileByteOffset += chunkSize;

                        const percentRead = (fileByteOffset / totalSize) * 100;
                        const percentReadFloor = Math.floor(percentRead);
                        if (progressCallback && (percentReadFloor >= lastProgressUpdate + 2 || percentRead >= 100)) {
                            progressCallback(percentRead, lineNumber);
                            lastProgressUpdate = percentReadFloor;
                        }

                        if (fileByteOffset % (chunkSize * 10) === 0) {
                            setTimeout(readChunk, 0);
                        } else {
                            readChunk();
                        }
                    } catch (error) {
                        reject(error);
                    }
                };

                reader.onerror = () => reject(new Error('Failed to read file chunk'));
                reader.readAsArrayBuffer(slice);
            };

            readChunk();
        });
    }

    /**
     * Unified line processor
     */
    async processLine(line, lineNumber, logId, parserState, options = {}) {
        const { timestampsEnabled = null, onProgress = null, updateMetadata = true, skipLogLineStorage = false } = options;

        // Detect timestampsEnabled if not provided (fallback)
        let finalTimestampsEnabled = timestampsEnabled;
        if (finalTimestampsEnabled === null || finalTimestampsEnabled === undefined) {
            if (parserState.timestampsEnabled !== undefined) {
                finalTimestampsEnabled = parserState.timestampsEnabled;
            }
        } else {
            parserState.timestampsEnabled = finalTimestampsEnabled;
        }

        // Create dbOps if not provided (for live monitoring or when dbOps not passed)
        // Use isLiveFileWatching=true to write immediately rather than batch
        let dbOps = options.dbOps;
        if (!dbOps && typeof ParsingDatabaseOperations !== 'undefined') {
            dbOps = new ParsingDatabaseOperations(this.db, true, onProgress || this.progressCallback);
        }

        await this.processAndStoreLine(line, lineNumber, logId, parserState, {
            timestampsEnabled: finalTimestampsEnabled,
            onProgress: onProgress,
            dbOps: dbOps,
            skipLogLineStorage: skipLogLineStorage,
            byteOffset: options.byteOffset
        });

        // Update metadata timestamps if changed (for both timestamped and non-timestamped logs)
        if (updateMetadata && parserState.firstTimestamp && parserState.lastTimestamp) {
            await this.db.open();
            const metadata = await this.db.getLogMetadata(logId);
            if (metadata) {
                const metadataUpdate = {};
                const existingStart = metadata.start_timestamp ? new Date(metadata.start_timestamp).getTime() : null;
                const existingEnd = metadata.end_timestamp ? new Date(metadata.end_timestamp).getTime() : null;
                const newStart = new Date(parserState.firstTimestamp).getTime();
                const newEnd = new Date(parserState.lastTimestamp).getTime();

                if (!existingStart || newStart < existingStart) {
                    metadataUpdate.start_timestamp = parserState.firstTimestamp;
                }
                if (!existingEnd || newEnd > existingEnd) {
                    metadataUpdate.end_timestamp = parserState.lastTimestamp;
                }

                if (Object.keys(metadataUpdate).length > 0) {
                    // Use dbOps if available, otherwise update directly
                    if (dbOps) {
                        await dbOps.updateLogMetadata(logId, metadataUpdate);
                    } else {
                        await this.db.db.log_metadata.update(logId, metadataUpdate);
                    }
                }
            }
        }
    }

    /**
     * Parse log file
     * @param {File} file - The log file to parse
     * @param {Object} cancelSignal - Optional cancellation signal
     * @param {Function} storageProgressCallback - Optional callback for storage progress (phaseId, phaseLabel, percent, timeRemaining)
     */
    async parseLogFile(file, cancelSignal = null, storageProgressCallback = null) {
        const fileSizeMB = file.size / (1024 * 1024);
        this._reportProgress(`Reading log file (${fileSizeMB.toFixed(1)} MB)...`);

        // STEP 1: Store file reference
        if (!window.logFileCache) {
            window.logFileCache = new Map();
        }

        // STEP 2: Insert initial metadata (will be updated by MetadataHandler)
        const metadata = {
            log_file: file.name,
            date_parsed: new Date().toISOString(),
            total_lines: null,
            total_parse_time_ms: null,
            timestampsEnabled: null // Will be set by MetadataHandler
        };

        const logId = await this.db.insertLogMetadata(metadata);
        window.logFileCache.set(logId, file);

        this._reportProgress(`Metadata placeholder stored (ID: ${logId})`);
        this._reportProgress(`Parsing log lines...`);

        // STEP 3: Initialize state
        const parserState = new ParserState();

        // STEP 4: Process lines
        let totalLines = 0;
        let lastProgressReport = 0;
        const progressReportInterval = 10000;

        const dbOps = new ParsingDatabaseOperations(this.db, false, this.progressCallback);

        let lastReadingProgressUpdate = 0;
        const readingProgressCallback = (percentRead, currentLineNumber) => {
            totalLines = currentLineNumber;
            const percentReadFloor = Math.floor(percentRead);
            if (percentReadFloor >= lastReadingProgressUpdate + 2 || percentRead >= 100) {
                this._reportProgress(`Reading: ${percentRead.toFixed(1)}% (${currentLineNumber.toLocaleString()} lines read)`);
                lastReadingProgressUpdate = percentReadFloor;
            }
        };

        const processLineCallback = async (line, lineNumber, byteOffset) => {
            totalLines = lineNumber;

            await this.processLine(line, lineNumber, logId, parserState, {
                timestampsEnabled: parserState.timestampsEnabled, // Will be updated by MetadataHandler
                byteOffset: byteOffset,
                dbOps: dbOps,
                onProgress: (message) => {
                    if (lineNumber % progressReportInterval === 0) {
                        this._reportProgress(message);
                    }
                },
                updateMetadata: false,
                skipLogLineStorage: true
            });

            if (lineNumber - lastProgressReport >= progressReportInterval) {
                this._reportProgress(`Processed ${lineNumber.toLocaleString()} lines...`);
                lastProgressReport = lineNumber;
            }

            if (cancelSignal && cancelSignal.cancelled) {
                throw new Error('Parsing cancelled');
            }
        };

        await this._processFileStreaming(file, processLineCallback, readingProgressCallback, cancelSignal);

        // Finalize cache server block
        if (parserState.acceleratorBlock) {
            await this.acceleratorHandler._finalizeBlock(parserState.acceleratorBlock, parserState.lastTimestamp, dbOps);
        }

        // Join any active worker thread barriers
        await this.workerThreadBarrierHandler.joinBarriers(parserState.lastTimestamp, parserState, dbOps, logId);

        // Execute batch operations with storage progress callback
        await dbOps.executeBatchOperations(cancelSignal, storageProgressCallback);

        // Update metadata
        await this.db.open();
        const metadataUpdate = { total_lines: totalLines };

        // Always save start/end timestamps if we have them
        // For non-timestamped logs, these are calculated from durations (not real wall-clock time)
        // The timestampsEnabled flag (set by MetadataHandler) indicates if they're real or calculated
        if (parserState.firstTimestamp && parserState.lastTimestamp) {
            metadataUpdate.start_timestamp = parserState.firstTimestamp;
            metadataUpdate.end_timestamp = parserState.lastTimestamp;
        }

        await dbOps.updateLogMetadata(logId, metadataUpdate);

        // Post-processing: Normalize timeline for non-timestamped logs
        // TODO: This is currently too slow for large logs (54k+ imports), need batch updates
        // Temporarily disabled for testing
        /*
        this._reportProgress(`Post-processing: Normalizing timeline...`);
        const normalizer = new TimelineNormalizer(this.db, logId);
        const normalizationResult = await normalizer.normalize();
        if (normalizationResult.normalized) {
            this._reportProgress(`✓ Timeline normalized: ${normalizationResult.stats.operations} operations, ${normalizationResult.stats.assetImports} imports updated`);
        }
        */

        this._reportProgress(`✓ Parsing complete: ${totalLines} lines processed`);

        return {
            logId,
            logLines: [],
            assetImports: [],
            pipelineRefreshes: [],
            operations: [],
            acceleratorBlocks: []
        };
    }

    /**
     * Parse log file incrementally
     */
    async parseLogFileIncremental(file, logId, startLineNumber, savedState = {}, cancelSignal = null) {
        try {
            const parseStart = performance.now();
            this._reportProgress(`Processing new lines from line ${startLineNumber}...`);

            // Detect timestamps if needed
            let timestampsEnabled = savedState.timestampsEnabled;
            if (timestampsEnabled === undefined) {
                // ... (Timestamp detection logic similar to parseLogFile)
                // Simplified for brevity, assuming savedState usually has it or we detect it
                const headerLines = []; // Would need to read header if not in state
                // For now, assume false if not in state and we can't easily read header here without duplicating logic
                timestampsEnabled = false;
            }

            const databaseOps = new ParsingDatabaseOperations(this.db, false, (message) => {
                this._reportProgress(message);
            });

            // Reconstruct ParserState from savedState
            const parserState = new ParserState();
            Object.assign(parserState, savedState);

            let totalLines = 0;
            let lastReadingProgressUpdate = 0;

            const readingProgressCallback = (percentRead, linesRead) => {
                const percentReadFloor = Math.floor(percentRead);
                if (percentReadFloor >= lastReadingProgressUpdate + 2 || percentRead >= 100) {
                    this._reportProgress(`Reading: ${percentRead.toFixed(1)}% (${linesRead.toLocaleString()} lines read)`);
                    lastReadingProgressUpdate = percentReadFloor;
                }
            };

            const processLine = async (line, lineNumber, byteOffset) => {
                totalLines = lineNumber;
                await this.processAndStoreLine(line, lineNumber, logId, parserState, {
                    timestampsEnabled: timestampsEnabled,
                    onProgress: (lineNumber % 100000 === 0) ?
                        (msg) => this._reportProgress(`Processed ${lineNumber.toLocaleString()} lines...`) : null,
                    dbOps: databaseOps,
                    skipLogLineStorage: true,
                    byteOffset: byteOffset
                });
            };

            await this._processFileStreaming(file, processLine, readingProgressCallback, cancelSignal);

            if (parserState.acceleratorBlock) {
                await this.acceleratorHandler._finalizeBlock(parserState.acceleratorBlock, parserState.lastTimestamp, databaseOps);
            }

            // Join any active worker thread barriers
            await this.workerThreadBarrierHandler.joinBarriers(parserState.lastTimestamp, parserState, databaseOps, logId);

            // Update metadata
            await this.db.open();
            let existingMetadata = await this.db.db.log_metadata.get(logId);
            const metadataUpdate = { total_lines: totalLines };

            // Always save start/end timestamps if we have them (for both timestamped and non-timestamped logs)
            // The timestampsEnabled flag indicates if they're real or calculated
            if (parserState.firstTimestamp && parserState.lastTimestamp) {
                if (existingMetadata && existingMetadata.start_timestamp && existingMetadata.end_timestamp) {
                    const existingStart = new Date(existingMetadata.start_timestamp).getTime();
                    const existingEnd = new Date(existingMetadata.end_timestamp).getTime();
                    const newStart = new Date(parserState.firstTimestamp).getTime();
                    const newEnd = new Date(parserState.lastTimestamp).getTime();

                    if (newStart < existingStart) metadataUpdate.start_timestamp = parserState.firstTimestamp;
                    else metadataUpdate.start_timestamp = existingMetadata.start_timestamp;

                    if (newEnd > existingEnd) metadataUpdate.end_timestamp = parserState.lastTimestamp;
                    else metadataUpdate.end_timestamp = existingMetadata.end_timestamp;
                } else {
                    metadataUpdate.start_timestamp = parserState.firstTimestamp;
                    metadataUpdate.end_timestamp = parserState.lastTimestamp;
                }
            }

            await this.db.db.log_metadata.update(logId, metadataUpdate);
            await databaseOps.executeBatchOperations(cancelSignal);

            await this.db.open();
            await this.db.db.log_metadata.update(logId, { total_parse_time_ms: null });

            const parseDuration = performance.now() - parseStart;
            this._reportProgress(`✓ Parsing complete in ${(parseDuration / 1000).toFixed(2)} seconds`);

            const collectArrays = databaseOps.collectArrays;
            return {
                logId,
                logLines: [],
                assetImports: collectArrays ? collectArrays.assetImports : [],
                pipelineRefreshes: collectArrays ? collectArrays.pipelineRefreshes : [],
                operations: collectArrays ? collectArrays.operations : [],
                acceleratorBlocks: collectArrays ? collectArrays.acceleratorBlocks : []
            };
        } catch (error) {
            console.error('[Parser] Error during parsing:', error);
            this._reportProgress(`✗ Error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process a single line and store results
     */
    async processAndStoreLine(line, lineNumber, logId, parserState, options = {}) {
        const { timestampsEnabled, onProgress, dbOps, skipLogLineStorage, byteOffset } = options;

        // Update state with current line info (needed for byte_offset in all logs, not just timestamped)
        parserState.currentLine = line;
        parserState.currentLineNumber = lineNumber;
        parserState.currentLineByteOffset = options.byteOffset;

        // Strip timestamp if present
        let timestamp = null;
        let contentLine = line;

        if (timestampsEnabled) {
            const stripped = this._stripTimestampPrefix(line);
            timestamp = stripped.timestamp;
            contentLine = stripped.line;

            if (timestamp) {
                parserState.updateTimestamps(timestamp);
            }
        }

        if (!parserState.metadataState.endTime) {
            if (await this.metadataHandler.handle(contentLine, line, lineNumber, logId, timestamp, parserState, dbOps)) {
                return;
            }
        }

        if (WorkerThreadHandler.shouldHandle(contentLine)) {
            if (await this.workerThreadBarrierHandler.handle(contentLine, line, lineNumber, logId, timestamp, parserState, dbOps)) {
                return;
            }
        }

        await this.workerThreadBarrierHandler.handlePendingThreads(timestamp, parserState, dbOps, logId);

        // Check if we should join active worker barriers (non-worker line encountered)
        const shouldSkipLine = await this.workerThreadBarrierHandler.handleNonWorkerLine(contentLine, timestamp, parserState, dbOps, logId);
        if (shouldSkipLine) {
            return; // Ignorable line - skip further processing
        }

        // Check if we should finalize active cache server block (non-cache line encountered)
        await this.acceleratorHandler.handleNonAcceleratorLine(contentLine, parserState, logId, dbOps);

        if (PipelineHandler.shouldHandle(contentLine, parserState)) {
            if (await this.pipelineHandler.handle(contentLine, line, lineNumber, logId, timestamp, parserState, dbOps)) {
                return;
            }
        }

        if (AcceleratorHandler.shouldHandle(contentLine, parserState)) {
            if (await this.acceleratorHandler.handle(contentLine, line, lineNumber, logId, timestamp, parserState, dbOps)) {
                return;
            }
        }

        if (SpriteAtlasHandler.shouldHandle(contentLine, parserState)) {
            if (await this.spriteAtlasHandler.handle(contentLine, line, lineNumber, logId, timestamp, parserState, dbOps)) {
                return;
            }
        }

        if (AssetHandler.shouldHandle(contentLine)) {
            if (await this.assetHandler.handle(contentLine, line, lineNumber, logId, timestamp, parserState, dbOps)) {
                return;
            }
        }

        if (ScriptCompilationHandler.shouldHandle(contentLine, parserState)) {
            if (await this.scriptCompilationHandler.handle(contentLine, line, lineNumber, logId, timestamp, parserState, dbOps)) {
                return;
            }
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnityLogParser;
} else {
    window.UnityLogParser = UnityLogParser;
}

export { UnityLogParser };
