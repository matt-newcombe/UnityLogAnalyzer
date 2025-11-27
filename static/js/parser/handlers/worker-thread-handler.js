import { LogPatterns } from '../log-patterns.js';
import { shouldSkipAsset, calculateWallTime, createAssetImport, fillMissingTimestamps } from '../utils.js';
import { DEFAULT_TIMESTAMP, parseTimestampMs, advanceTimestamp, findMaxTimestamp, updateLogTimeIfLater } from '../time-utils.js';

/**
 * WorkerThreadHandler - Handles worker thread asset import parsing
 * 
 * Worker threads in Unity import assets in parallel. This handler:
 * - Tracks worker thread barriers (periods when workers are active)
 * - Parses worker thread import start/complete lines
 * - Manages per-thread time tracking for non-timestamped logs
 */
export class WorkerThreadHandler {
    handle(contentLine, line, lineNumber, timestamp, state, databaseOps) {
        if (!contentLine.startsWith('[Worker')) return false;

        const workerMatch = contentLine.match(LogPatterns.WorkerThread);
        if (!workerMatch) return false;

        const workerNum = parseInt(workerMatch[1]);
        const workerLine = workerMatch[2];

        this._ensureBarrierExists(workerNum, lineNumber, timestamp, state);

        if (LogPatterns.WorkerImportStart.test(workerLine)) {
            return this._handleImportStart(workerLine, workerNum, lineNumber, timestamp, state);
        }

        if (state.workerThreadStates[workerNum]?.importer_type === null) {
            return this._handleImporterType(workerLine, workerNum, state);
        }

        if (workerLine.includes('-> (artifact id:')) {
            return this._handleImportComplete(workerLine, workerNum, timestamp, state, databaseOps);
        }

        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BARRIER MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Join all active worker thread barriers at end of parsing
     * Called from UnityLogParser._finalizeParsing
     */
    joinBarriers(timestamp, state, databaseOps) {
        this._joinAllBarriers(timestamp, state, databaseOps);
    }

    /**
     * Check if we should join (finalize) worker thread barriers
     * Called when a non-worker line is encountered
     */
    shouldJoinThreadBarriers(contentLine, timestamp, state, databaseOps) {
        // Join any pending worker threads first if we have a timestamp
        if (timestamp && Object.keys(state.pendingWorkerThreads).length) {
            this._joinPendingThreads(timestamp, state, databaseOps);
        }

        // Check if we have active worker threads to join
        if (!Object.keys(state.workerThreads).length) return false;

        // Ignore certain lines that appear during worker activity
        if (this._isIgnorableLine(contentLine)) return true;

        // Join barriers based on timestamp availability
        if (timestamp) {
            this._joinAllBarriers(timestamp, state, databaseOps);
        } else if (!state.timestampsEnabled) {
            const endTime = findMaxTimestamp(state.threadLocalTimes) || state.logCurrentTime;
            this._joinAllBarriers(endTime, state, databaseOps);
        } else {
            // Move to pending (will be joined when we get a timestamp)
            Object.assign(state.pendingWorkerThreads, state.workerThreads);
            state.workerThreads = {};
        }

        return false;
    }

    _isIgnorableLine(contentLine) {
        return contentLine.includes('TcpProtobufClient') || 
               contentLine.includes('AcceleratorClientConnectionCallback');
    }

    _joinPendingThreads(timestamp, state, databaseOps) {
        for (const threadId in state.pendingWorkerThreads) {
            this._joinBarrier(parseInt(threadId), state.pendingWorkerThreads[threadId], timestamp, databaseOps, state);
        }
        state.pendingWorkerThreads = {};
    }

    _ensureBarrierExists(workerNum, lineNumber, timestamp, state) {
        if (state.workerThreads[workerNum]) return;

        if (state.pendingWorkerThreads[workerNum]) {
            state.workerThreads[workerNum] = state.pendingWorkerThreads[workerNum];
            delete state.pendingWorkerThreads[workerNum];
        } else {
            state.workerThreads[workerNum] = {
                start_timestamp: timestamp || state.logCurrentTime || DEFAULT_TIMESTAMP,
                import_count: 0,
                start_line_number: lineNumber
            };
        }
    }

    _joinAllBarriers(timestamp, state, databaseOps) {
        const endTimestamp = timestamp || state.lastSeenTimestamp;
        
        for (const threadId in state.workerThreads) {
            this._joinBarrier(parseInt(threadId), state.workerThreads[threadId], endTimestamp, databaseOps, state);
        }
        state.workerThreads = {};

        // Update global time to max worker time for non-timestamped logs
        if (!timestamp) {
            const maxTime = this._calculateMaxWorkerEndTime(state);
            if (maxTime) state.logCurrentTime = maxTime;
        }

        state.threadLocalTimes = {};
    }

    _joinBarrier(workerThreadId, barrier, endTimestamp, databaseOps, state) {
        const finalEndTimestamp = endTimestamp || barrier.start_timestamp;
        const startMs = parseTimestampMs(barrier.start_timestamp);
        const endMs = parseTimestampMs(finalEndTimestamp);
        const durationMs = (startMs !== null && endMs !== null) ? endMs - startMs : 0;

        databaseOps.addWorkerPhase({
            worker_thread_id: workerThreadId,
            start_timestamp: barrier.start_timestamp,
            end_timestamp: finalEndTimestamp,
            duration_ms: durationMs,
            import_count: barrier.import_count,
            start_line_number: barrier.start_line_number
        });

        // Advance global time if barrier end is later (for non-timestamped logs)
        if (state && !state.timestampsEnabled) {
            updateLogTimeIfLater(state, finalEndTimestamp);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IMPORT HANDLING
    // ─────────────────────────────────────────────────────────────────────────

    _handleImportStart(workerLine, workerNum, lineNumber, timestamp, state) {
        const match = workerLine.match(LogPatterns.WorkerImportStart);
        if (!match) return false;

        const [, assetPath, guid] = match;
        const workerStartTimestamp = this._getWorkerStartTimestamp(workerNum, timestamp, state);

        state.workerThreadStates[workerNum] = {
            asset_path: assetPath,
            guid,
            line_number: lineNumber,
            byte_offset: state.currentLineByteOffset || null,
            importer_type: null,
            start_timestamp: workerStartTimestamp
        };

        return true;
    }

    _handleImporterType(workerLine, workerNum, state) {
        const match = workerLine.match(LogPatterns.WorkerImporterType);
        if (!match) return false;

        let importerType = match[1];
        if (importerType === '-1' || !importerType.endsWith('Importer')) {
            importerType = null;
        }
        state.workerThreadStates[workerNum].importer_type = importerType;
        return true;
    }

    _handleImportComplete(workerLine, workerNum, timestamp, state, databaseOps) {
        const match = workerLine.match(LogPatterns.WorkerImportComplete);
        const workerState = state.workerThreadStates[workerNum];
        if (!match || !workerState) return false;

        const [, artifactId, explicitTimeSeconds] = match;

        if (shouldSkipAsset(workerState.asset_path, workerState.importer_type)) {
            delete state.workerThreadStates[workerNum];
            return true;
        }

        const timeSeconds = parseFloat(explicitTimeSeconds);
        const { startTimestamp, endTimestamp } = fillMissingTimestamps(
            workerState.start_timestamp,
            timestamp,
            timeSeconds
        );

        const { timeMs } = calculateWallTime(startTimestamp, endTimestamp, timeSeconds);

        const assetImport = createAssetImport({
            lineNumber: workerState.line_number,
            byteOffset: workerState.byte_offset,
            assetPath: workerState.asset_path,
            guid: workerState.guid,
            artifactId,
            importerType: workerState.importer_type,
            timeMs,
            startTimestamp,
            endTimestamp,
            workerThreadId: workerNum
        });

        databaseOps.addAssetImport(assetImport);

        // Update barrier import count
        if (state.workerThreads[workerNum]) {
            state.workerThreads[workerNum].import_count++;
        }

        // Update per-worker time tracking
        this._updateWorkerLocalTime(workerNum, timestamp, timeSeconds, state);

        delete state.workerThreadStates[workerNum];
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TIME TRACKING
    // ─────────────────────────────────────────────────────────────────────────

    _getWorkerStartTimestamp(workerNum, timestamp, state) {
        if (timestamp) {
            state.threadLocalTimes[workerNum] = timestamp;
            return timestamp;
        }

        if (!state.threadLocalTimes[workerNum]) {
            state.threadLocalTimes[workerNum] = state.logCurrentTime;
        }

        return state.threadLocalTimes[workerNum];
    }

    _updateWorkerLocalTime(workerNum, completionTimestamp, explicitTimeSeconds, state) {
        if (state.threadLocalTimes[workerNum]) {
            const newTime = advanceTimestamp(state.threadLocalTimes[workerNum], explicitTimeSeconds);
            if (newTime) state.threadLocalTimes[workerNum] = newTime;
        } else if (completionTimestamp) {
            state.threadLocalTimes[workerNum] = completionTimestamp;
        }
    }

    _calculateMaxWorkerEndTime(state) {
        let maxMs = parseTimestampMs(state.logCurrentTime);
        let maxTimestamp = state.logCurrentTime;

        for (const threadId in state.threadLocalTimes) {
            const workerTime = state.threadLocalTimes[threadId];
            const workerMs = parseTimestampMs(workerTime);
            if (workerMs !== null && (maxMs === null || workerMs > maxMs)) {
                maxMs = workerMs;
                maxTimestamp = workerTime;
            }
        }

        return maxTimestamp;
    }
}
