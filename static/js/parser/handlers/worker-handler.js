import { LogPatterns } from '../log-patterns.js';
import { shouldSkipAsset, calculateWallTime, createAssetImport } from '../utils.js';

export class WorkerHandler {
    constructor() { }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps, stored) {
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

        // If we have active phases AND significant activity since last worker line, finalize them first
        // This creates distinct phases separated by main thread activity
        if (state.hasActivitySinceWorker && Object.keys(state.workerPhases).length > 0) {
            // Finalize all current worker phases before starting/resuming
            // Use the pausedAt time if available (captured when phase was paused)
            // Otherwise fall back to threadLocalTimes, then logCurrentTime
            let maxWorkerTime = null;
            for (const workerId in state.workerPhases) {
                const phase = state.workerPhases[workerId];
                const workerTime = phase.pausedAt || state.threadLocalTimes[workerId];
                if (workerTime) {
                    if (!maxWorkerTime || new Date(workerTime).getTime() > new Date(maxWorkerTime).getTime()) {
                        maxWorkerTime = workerTime;
                    }
                }
            }
            // Fallback to logCurrentTime if no worker times available
            const endTime = maxWorkerTime || state.logCurrentTime;
            await this.endPhase(endTime, state, databaseOps, logId);
        }

        // Worker line detected - resume any paused phases and clear activity flag
        for (const threadId in state.workerPhases) {
            if (!state.workerPhases[threadId].active) {
                state.workerPhases[threadId].active = true;
            }
        }
        state.hasActivitySinceWorker = false;
        const lastSeenTimestamp = state.lastSeenTimestamp;
        const workerStates = state.workerStates;

        // Start worker phase for this thread if not active
        if (!state.workerPhases[workerNum]) {
            // Check if we have a pending phase to resume for this thread
            if (state.pendingWorkerPhases[workerNum]) {
                state.workerPhases[workerNum] = state.pendingWorkerPhases[workerNum];
                state.workerPhases[workerNum].active = true;
                delete state.pendingWorkerPhases[workerNum];
            } else {
                // Calculate start timestamp using logCurrentTime if explicit timestamp is missing
                let phaseStartTimestamp = timestamp || state.logCurrentTime;

                // If we are starting a new phase without a timestamp, ensure we have a valid time
                if (!phaseStartTimestamp) {
                    phaseStartTimestamp = '2000-01-01T00:00:00.000Z';
                }

                state.workerPhases[workerNum] = {
                    start_timestamp: phaseStartTimestamp,
                    import_count: 0,
                    active: true,
                    start_line_number: lineNumber
                };
            }
        }
        const workerLine = workerMatch[2];

        // 1. Start Importing
        if (LogPatterns.WorkerImportStart.test(workerLine)) {
            // Continue to the full handler for complete processing
            return await this._handleImportStart(workerLine, workerNum, lineNumber, timestamp, state, workerStates, lastSeenTimestamp, stored);
        }
        else if (LogPatterns.WorkerImportComplete.test(workerLine)) {
            const match = workerLine.match(LogPatterns.WorkerImportComplete);
            const artifactId = match[1];
            const timeSeconds = parseFloat(match[2]);
            const timeMs = timeSeconds * 1000;

            const workerState = state.workerStates[workerNum];
            // Continue to the full handler for complete processing
            return await this._handleImportComplete(workerLine, workerNum, lineNumber, logId, timestamp, state, workerStates, databaseOps, stored);
        }

        // 2. Importer Type (on next line)
        if (workerStates[workerNum] && workerStates[workerNum].importer_type === null) {
            const importerMatch = workerLine.match(LogPatterns.WorkerImporterType);
            if (importerMatch) {
                let importerType = importerMatch[1];
                if (importerType === '-1' || !importerType.endsWith('Importer')) {
                    importerType = null;
                }
                workerStates[workerNum].importer_type = importerType;
                return true; // Handled
            }
        }

        // 3. Import Complete
        if (workerLine.includes('-> (artifact id:')) {
            return await this._handleImportComplete(workerLine, workerNum, lineNumber, logId, timestamp, state, workerStates, databaseOps, stored);
        }

        return true; // It was a worker line, even if we didn't do specific processing
    }

    async _handleImportStart(workerLine, workerNum, lineNumber, timestamp, state, workerStates, lastSeenTimestamp, stored) {
        const startMatch = workerLine.match(LogPatterns.WorkerImportStart);
        if (!startMatch) return false;

        const assetPath = startMatch[1];
        const guid = startMatch[2];

        // Check cache server request
        let isCacheServerRequest = false;
        const cacheServerBlock = state.cacheServerBlock;
        if (cacheServerBlock && cacheServerBlock.requested_asset_map && cacheServerBlock.requested_asset_map[assetPath]) {
            isCacheServerRequest = true;
            if (!cacheServerBlock.downloaded_assets.includes(assetPath) &&
                !cacheServerBlock.not_downloaded_assets.includes(assetPath)) {
                cacheServerBlock.not_downloaded_assets.push(assetPath);
            }
        } else if (state.cacheServerAssetMap[assetPath]) {
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

        workerStates[workerNum] = {
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

    async _handleImportComplete(workerLine, workerNum, lineNumber, logId, timestamp, state, workerStates, databaseOps, stored) {
        const artifactMatch = workerLine.match(LogPatterns.WorkerImportComplete);
        if (!artifactMatch || !workerStates[workerNum]) return false;

        const artifactId = artifactMatch[1];
        const explicitTimeSeconds = parseFloat(artifactMatch[2]);
        const workerState = workerStates[workerNum];
        const lastSeenTimestamp = state.lastSeenTimestamp;

        if (shouldSkipAsset(workerState.asset_path, workerState.importer_type)) {
            delete workerStates[workerNum];
            return true;
        }

        // Calculate completion timestamp
        let completionTimestamp = timestamp;
        if (!completionTimestamp) {
            if (workerState.start_timestamp) {
                // Always prefer start_timestamp + explicit duration for worker imports
                // This gives us the accurate import time from the log line
                const startTime = new Date(workerState.start_timestamp).getTime();
                const completionTime = startTime + (explicitTimeSeconds * 1000);
                completionTimestamp = new Date(completionTime).toISOString();
            } else if (lastSeenTimestamp) {
                // Fallback if no start timestamp available
                completionTimestamp = lastSeenTimestamp;
            }
        }

        const { timeSeconds, timeMs } = calculateWallTime(
            workerState.start_timestamp,
            completionTimestamp,
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
            startTimestamp: workerState.start_timestamp,
            endTimestamp: completionTimestamp,
            workerThreadId: workerNum
        });

        await databaseOps.addAssetImport(assetImport);
        stored.assetImport = true;

        if (state.workerPhases[workerNum]) {
            state.workerPhases[workerNum].import_count++;
        }

        // Update cache server block
        if (workerState.is_cache_server_request && state.cacheServerBlock) {
            if (completionTimestamp) {
                if (!state.cacheServerBlock.last_timestamp ||
                    new Date(completionTimestamp) > new Date(state.cacheServerBlock.last_timestamp)) {
                    state.cacheServerBlock.last_timestamp = completionTimestamp;
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

        delete workerStates[workerNum];
        return true;
    }

    /**
     * End all active worker phases
     */
    async endPhase(timestamp, state, databaseOps, logId) {
        const workerThreadIds = Object.keys(state.workerPhases);

        for (const threadId of workerThreadIds) {
            const phase = state.workerPhases[threadId];
            if (phase) {
                // Finalize all phases, whether active or paused
                phase.active = false;
                await this.finalizePhase(parseInt(threadId), phase, timestamp || state.lastSeenTimestamp, databaseOps, logId, state);
            }
        }

        // Clear all phases
        state.workerPhases = {};

        // Also finalize any pending phases
        const pendingThreadIds = Object.keys(state.pendingWorkerPhases);

        for (const threadId of pendingThreadIds) {
            const phase = state.pendingWorkerPhases[threadId];
            if (phase) {
                // Use worker's local time if available, otherwise use provided timestamp or lastSeenTimestamp
                const phaseEndTime = timestamp || state.threadLocalTimes[threadId] || state.lastSeenTimestamp;
                await this.finalizePhase(parseInt(threadId), phase, phaseEndTime, databaseOps, logId, state);
            }
        }
        state.pendingWorkerPhases = {};

        // Sync main thread time to the max of all worker local times
        // This "fast-forwards" the main thread to when the last worker finished
        if (!timestamp) {
            let maxWorkerTimeMs = new Date(state.logCurrentTime).getTime();

            for (const workerId in state.threadLocalTimes) {
                const workerTime = state.threadLocalTimes[workerId];
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
     * Finalize a worker phase with an end timestamp and write to DB
     */
    async finalizePhase(workerThreadId, phase, endTimestamp, databaseOps, logId, state = null) {
        const startTime = phase.start_timestamp;
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
            import_count: phase.import_count,
            start_line_number: phase.start_line_number
        });

        // Update logCurrentTime to worker phase end time if state provided and no explicit timestamps
        // This ensures main thread operations get correct start times after worker threads finish
        if (state && !state.timestampsEnabled && finalEndTimestamp) {
            const currentTimeMs = new Date(state.logCurrentTime).getTime();
            const phaseEndMs = new Date(finalEndTimestamp).getTime();

            // Only update if worker phase ended later than current time
            if (phaseEndMs > currentTimeMs) {
                state.logCurrentTime = finalEndTimestamp;
            }
        }
    }
}
