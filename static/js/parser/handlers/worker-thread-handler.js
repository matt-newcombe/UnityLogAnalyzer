import { LogPatterns } from '../log-patterns.js';
import { shouldSkipAsset, calculateWallTime, createAssetImport, fillMissingTimestamps } from '../utils.js';

export class WorkerThreadHandler {
    constructor() { }

    static shouldHandle(contentLine) {
        return contentLine.startsWith('[Worker');
    }

    /**
     * Handle non-worker lines when we have active worker threads
     * This is called to check if we should join worker barriers
     */
    async handleNonWorkerLine(contentLine, timestamp, state, databaseOps, logId) {
        // Check if we have any active worker threads to join
        const hasActiveThreads = Object.keys(state.workerThreads).length > 0;
        
        if (!hasActiveThreads) {
            return false; // No active threads, nothing to do
        }

        // Ignore certain non-worker lines that are irrelevant main thread noise
        // These should not trigger joining of worker threads
        const isIgnorableLine = contentLine.includes('TcpProtobufClient') || 
                                contentLine.includes('AcceleratorClientConnectionCallback');

        if (isIgnorableLine) {
            return true; // Skip this line entirely
        }

        // We have active threads and this is a significant main thread line - join barriers
        if (timestamp) {
            // We have a timestamp, join all barriers immediately
            await this.joinBarriers(timestamp, state, databaseOps, logId);
        } else {
            // No timestamp on this line
            if (!state.timestampsEnabled) {
                // For non-timestamped logs, use thread local times or logCurrentTime
                let maxWorkerTime = null;
                for (const threadId in state.workerThreads) {
                    const workerTime = state.threadLocalTimes[threadId];
                    if (workerTime && (!maxWorkerTime || new Date(workerTime).getTime() > new Date(maxWorkerTime).getTime())) {
                        maxWorkerTime = workerTime;
                    }
                }
                const endTime = maxWorkerTime || state.logCurrentTime;
                await this.joinBarriers(endTime, state, databaseOps, logId);
            } else {
                // For timestamped logs, defer completion until we see the next timestamp
                for (const threadId in state.workerThreads) {
                    state.pendingWorkerThreads[threadId] = state.workerThreads[threadId];
                }
                state.workerThreads = {};
            }
        }

        return false; // Continue processing this line with other handlers
    }

    /**
     * Handle pending worker threads when we encounter a timestamp
     */
    async handlePendingThreads(timestamp, state, databaseOps, logId) {
        // If we have pending worker threads, and this line has a timestamp, join them.
        // Optimization: Check if object has keys without creating array
        let hasPendingThreads = false;
        for (const _ in state.pendingWorkerThreads) { hasPendingThreads = true; break; }

        if (timestamp && hasPendingThreads) {
            for (const threadId in state.pendingWorkerThreads) {
                const pendingBarrier = state.pendingWorkerThreads[threadId];
                await this.joinBarrier(parseInt(threadId), pendingBarrier, timestamp, databaseOps, logId, state);
            }
            state.pendingWorkerThreads = {};
        }
    }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps) {
        // Fast-path: Worker lines always start with "[Worker"
        // This cheap string check avoids expensive regex on non-worker lines
        if (!contentLine.startsWith('[Worker')) {
            return false;
        }

        const workerMatch = contentLine.match(LogPatterns.WorkerThread);
        if (!workerMatch) {
            return false;
        }

        const matchLine = contentLine;

        const workerNum = parseInt(workerMatch[1]);
        const lastSeenTimestamp = state.lastSeenTimestamp;
        const workerThreadStates = state.workerThreadStates;

        // Start worker thread barrier for this thread if not active
        if (!state.workerThreads[workerNum]) {
            // Check if we have a pending barrier to resume for this thread
            if (state.pendingWorkerThreads[workerNum]) {
                state.workerThreads[workerNum] = state.pendingWorkerThreads[workerNum];
                delete state.pendingWorkerThreads[workerNum];
            } else {
                // Calculate start timestamp using logCurrentTime if explicit timestamp is missing
                let barrierStartTimestamp = timestamp || state.logCurrentTime;

                // If we are starting a new barrier without a timestamp, ensure we have a valid time
                if (!barrierStartTimestamp) {
                    barrierStartTimestamp = '2000-01-01T00:00:00.000Z';
                }

                state.workerThreads[workerNum] = {
                    start_timestamp: barrierStartTimestamp,
                    import_count: 0,
                    start_line_number: lineNumber
                };
            }
        }
        const workerLine = workerMatch[2];

        // 1. Start Importing
        if (LogPatterns.WorkerImportStart.test(workerLine)) {
            // Continue to the full handler for complete processing
            return await this._handleImportStart(workerLine, workerNum, lineNumber, timestamp, state, workerThreadStates, lastSeenTimestamp);
        }
        else if (LogPatterns.WorkerImportComplete.test(workerLine)) {
            const match = workerLine.match(LogPatterns.WorkerImportComplete);
            const artifactId = match[1];
            const timeSeconds = parseFloat(match[2]);
            const timeMs = timeSeconds * 1000;

            const workerState = state.workerThreadStates[workerNum];
            // Continue to the full handler for complete processing
            return await this._handleImportComplete(workerLine, workerNum, lineNumber, logId, timestamp, state, workerThreadStates, databaseOps);
        }

        // 2. Importer Type (on next line)
        if (workerThreadStates[workerNum] && workerThreadStates[workerNum].importer_type === null) {
            const importerMatch = workerLine.match(LogPatterns.WorkerImporterType);
            if (importerMatch) {
                let importerType = importerMatch[1];
                if (importerType === '-1' || !importerType.endsWith('Importer')) {
                    importerType = null;
                }
                workerThreadStates[workerNum].importer_type = importerType;
                return true; // Handled
            }
        }

        // 3. Import Complete
        if (workerLine.includes('-> (artifact id:')) {
            return await this._handleImportComplete(workerLine, workerNum, lineNumber, logId, timestamp, state, workerThreadStates, databaseOps);
        }

        return true; // It was a worker line, even if we didn't do specific processing
    }

    async _handleImportStart(workerLine, workerNum, lineNumber, timestamp, state, workerThreadStates, lastSeenTimestamp) {
        const startMatch = workerLine.match(LogPatterns.WorkerImportStart);
        if (!startMatch) return false;

        const assetPath = startMatch[1];
        const guid = startMatch[2];

        // Check cache server request
        let isCacheServerRequest = false;
        const acceleratorBlock = state.acceleratorBlock;
        if (acceleratorBlock && acceleratorBlock.requested_asset_map && acceleratorBlock.requested_asset_map[assetPath]) {
            isCacheServerRequest = true;
            if (!acceleratorBlock.downloaded_assets.includes(assetPath) &&
                !acceleratorBlock.not_downloaded_assets.includes(assetPath)) {
                acceleratorBlock.not_downloaded_assets.push(assetPath);
            }
        } else if (state.acceleratorAssetMap[assetPath]) {
            isCacheServerRequest = true;
        }

        // Calculate start timestamp for this worker thread
        // Priority: 1) Use actual timestamp if available (from log line)
        //           2) Use worker's local time cursor
        let workerStartTimestamp = null;

        if (timestamp) {
            // Use actual timestamp from log line if available (highest priority)
            workerStartTimestamp = timestamp;

            // Sync thread local time to this timestamp if we have one
            state.threadLocalTimes[workerNum] = timestamp;
        } else {
            // Use thread local time logic

            // Initialize worker local time if not set
            if (!state.threadLocalTimes[workerNum]) {
                // Start from current main thread time
                state.threadLocalTimes[workerNum] = state.logCurrentTime;
            }

            workerStartTimestamp = state.threadLocalTimes[workerNum];
        }

        workerThreadStates[workerNum] = {
            asset_path: assetPath,
            guid: guid,
            line_number: lineNumber,
            byte_offset: state.currentLineByteOffset || null,
            importer_type: null,
            start_timestamp: workerStartTimestamp,
            is_cache_server_request: isCacheServerRequest
        };

        return true; // Handled
    }

    async _handleImportComplete(workerLine, workerNum, lineNumber, logId, timestamp, state, workerThreadStates, databaseOps) {
        const artifactMatch = workerLine.match(LogPatterns.WorkerImportComplete);
        if (!artifactMatch || !workerThreadStates[workerNum]) return false;

        const artifactId = artifactMatch[1];
        const explicitTimeSeconds = parseFloat(artifactMatch[2]);
        const workerState = workerThreadStates[workerNum];
        const lastSeenTimestamp = state.lastSeenTimestamp;

        if (shouldSkipAsset(workerState.asset_path, workerState.importer_type)) {
            delete workerThreadStates[workerNum];
            return true;
        }

        // Calculate end timestamp from start + duration when timestamp is missing
        // Pass timestamp (null for worker lines) to force calculation, not lastSeenTimestamp
        const completionTimestamp = timestamp || lastSeenTimestamp;
        const { startTimestamp, endTimestamp } = fillMissingTimestamps(
            workerState.start_timestamp,
            timestamp, // Pass actual timestamp (null for worker lines), not completionTimestamp
            explicitTimeSeconds
        );

        const { timeSeconds, timeMs } = calculateWallTime(
            startTimestamp,
            endTimestamp,
            explicitTimeSeconds
        );

        let importerType = workerState.importer_type;
        if (workerState.is_cache_server_request) {
            importerType = 'Cache Download';
        }

        const assetImport = createAssetImport({
            logId,
            lineNumber: workerState.line_number,
            byteOffset: workerState.byte_offset || null,
            assetPath: workerState.asset_path,
            guid: workerState.guid,
            artifactId,
            importerType,
            timeSeconds,
            timeMs,
            startTimestamp,
            endTimestamp,
            workerThreadId: workerNum
        });

        await databaseOps.addAssetImport(assetImport);

        if (state.workerThreads[workerNum]) {
            state.workerThreads[workerNum].import_count++;
        }

        // Update cache server block
        if (workerState.is_cache_server_request && state.acceleratorBlock) {
            if (completionTimestamp) {
                if (!state.acceleratorBlock.last_timestamp ||
                    new Date(completionTimestamp) > new Date(state.acceleratorBlock.last_timestamp)) {
                    state.acceleratorBlock.last_timestamp = completionTimestamp;
                }
            }
        }

        // Update worker local time cursor
        if (state.threadLocalTimes[workerNum]) {
            // Advance time by duration
            const currentMs = new Date(state.threadLocalTimes[workerNum]).getTime();
            const newMs = currentMs + (explicitTimeSeconds * 1000);
            state.threadLocalTimes[workerNum] = new Date(newMs).toISOString();
        } else if (completionTimestamp) {
            state.threadLocalTimes[workerNum] = completionTimestamp;
        }

        delete workerThreadStates[workerNum];
        return true;
    }

    /**
     * Join all active worker thread barriers
     * This is called when the main thread resumes (worker threads have completed)
     */
    async joinBarriers(timestamp, state, databaseOps, logId) {
        const workerThreadIds = Object.keys(state.workerThreads);

        for (const threadId of workerThreadIds) {
            const barrier = state.workerThreads[threadId];
            if (barrier) {
                // Join all barriers
                await this.joinBarrier(parseInt(threadId), barrier, timestamp || state.lastSeenTimestamp, databaseOps, logId, state);
            }
        }

        // Clear all barriers
        state.workerThreads = {};

        // Also join any pending barriers
        const pendingThreadIds = Object.keys(state.pendingWorkerThreads);

        for (const threadId of pendingThreadIds) {
            const barrier = state.pendingWorkerThreads[threadId];
            if (barrier) {
                // Use worker's local time if available, otherwise use provided timestamp or lastSeenTimestamp
                const barrierEndTime = timestamp || state.threadLocalTimes[threadId] || state.lastSeenTimestamp;
                await this.joinBarrier(parseInt(threadId), barrier, barrierEndTime, databaseOps, logId, state);
            }
        }
        state.pendingWorkerThreads = {};

        // Sync main thread time to the max of all worker local times
        // This "fast-forwards" the main thread to when the last worker finished
        if (!timestamp) {
            let maxWorkerTimeMs = new Date(state.logCurrentTime).getTime();

            for (const threadId in state.threadLocalTimes) {
                const workerTime = state.threadLocalTimes[threadId];
                if (workerTime) {
                    const workerTimeMs = new Date(workerTime).getTime();
                    if (workerTimeMs > maxWorkerTimeMs) {
                        maxWorkerTimeMs = workerTimeMs;
                    }
                }
            }
            state.logCurrentTime = new Date(maxWorkerTimeMs).toISOString();
        }

        // Reset worker local times as we are back to main thread
        state.threadLocalTimes = {};
    }

    /**
     * Join a worker thread barrier with an end timestamp and write to DB
     * This represents the point where the main thread resumes after waiting for this worker
     */
    async joinBarrier(workerThreadId, barrier, endTimestamp, databaseOps, logId, state = null) {
        const startTime = barrier.start_timestamp;
        let finalEndTimestamp = endTimestamp;

        // If no end timestamp provided, try to use start timestamp + duration or just start timestamp
        if (!finalEndTimestamp) {
            if (startTime) {
                // If we have import count, assume some duration passed
                // For now, just use start time as end time if we really have nothing else
                finalEndTimestamp = startTime;
            }
        }

        // Calculate duration
        let durationMs = 0;
        if (startTime && finalEndTimestamp) {
            durationMs = new Date(finalEndTimestamp).getTime() - new Date(startTime).getTime();
        }

        await databaseOps.addWorkerPhase({
            worker_thread_id: workerThreadId,
            start_timestamp: startTime,
            end_timestamp: finalEndTimestamp,
            duration_ms: durationMs,
            import_count: barrier.import_count,
            start_line_number: barrier.start_line_number
        });

        // Update logCurrentTime to barrier end time if state provided and no explicit timestamps
        // This ensures main thread operations get correct start times after worker threads finish
        if (state && !state.timestampsEnabled && finalEndTimestamp) {
            const currentTimeMs = new Date(state.logCurrentTime).getTime();
            const barrierEndMs = new Date(finalEndTimestamp).getTime();

            // Only update if barrier ended later than current time
            if (barrierEndMs > currentTimeMs) {
                state.logCurrentTime = finalEndTimestamp;
            }
        }
    }
}
