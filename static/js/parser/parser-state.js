/**
 * Parser State
 * Encapsulates the state of the log parsing process.
 */
export class ParserState {
    constructor() {
        this.reset();
    }

    reset() {
        this.metadataState = {
            inMetadata: false,
            startLine: null,
            endLine: null,
            startTime: null,
            endTime: null,
            lines: [],
            unityVersion: null,
            platform: null,
            architecture: null,
            projectName: null
        };

        // Worker thread process state: map of threadId -> { assetPath, guid, startTime, ... }
        this.workerThreadStates = {};

        // Active worker threads: map of threadId -> { start_timestamp, import_count, start_line_number }
        // Each entry represents a worker thread barrier period where main thread is blocked
        this.workerThreads = {};

        // Pending worker threads (waiting for end timestamp)
        this.pendingWorkerThreads = {};

        // Pending import (main thread): single pending multi-line import
        // Main thread imports are always sequential - only one can be pending at a time
        this.pendingImport = null;



        // Pipeline Refresh state
        this.pipelineRefreshState = {
            inPipelineRefresh: false,
            pipelineRefreshLines: [],
            pipelineRefreshStart: 0
        };

        // Sprite Atlas state
        this.spriteAtlasState = null;

        // Script Compilation state
        this.scriptCompilationState = null;

        // Accelerator block state
        this.acceleratorBlock = null;

        // Pending metadata update (set by MetadataHandler, flushed after parsing)
        this.pendingMetadataUpdate = null;

        // Timestamp tracking
        this.firstTimestamp = null;
        this.lastTimestamp = null;
        this.lastSeenTimestamp = null;
        this.hasTimestamps = false;
        this.timestampsEnabled = undefined; // Will be detected

        // Current line info
        this.currentLineByteOffset = null;

        // Unified Time Tracking
        // logCurrentTime: The current cursor of the log timeline (ISO string)
        // For Main Thread: Represents the global timeline cursor
        // For Worker Threads: See threadLocalTimes
        this.logCurrentTime = '2000-01-01T00:00:00.000Z';

        // Thread Local Times: map of threadId -> ISO timestamp string
        // Tracks the local time cursor for each worker thread
        this.threadLocalTimes = {};
    }

    updateTimestamps(timestamp) {
        if (!timestamp) return;

        this.hasTimestamps = true;
        this.lastSeenTimestamp = timestamp;

        // Update the global log cursor to the explicit timestamp
        this.logCurrentTime = timestamp;

        // When the global log time is updated from an explicit timestamp on the main thread,
        // sync worker thread local cursors to this time so worker starts that lack an
        // explicit per-line timestamp will be anchored to the current known wall-clock.
        try {
            // Update any existing threadLocalTimes entries
            Object.keys(this.threadLocalTimes || {}).forEach(k => {
                this.threadLocalTimes[k] = timestamp;
            });

            // Also ensure any active worker threads get their local cursor advanced
            Object.keys(this.workerThreads || {}).forEach(k => {
                this.threadLocalTimes[k] = timestamp;
            });

            // And pending worker threads
            Object.keys(this.pendingWorkerThreads || {}).forEach(k => {
                this.threadLocalTimes[k] = timestamp;
            });
        } catch (e) {
            // Defensive: do not let timestamp sync failures break parsing
            // (silent fail is acceptable here)
        }

        if (!this.firstTimestamp || timestamp < this.firstTimestamp) {
            this.firstTimestamp = timestamp;
        }
        if (!this.lastTimestamp || timestamp > this.lastTimestamp) {
            this.lastTimestamp = timestamp;
        }
    }

    /**
     * Track timestamp range for metadata without requiring hasTimestamps
     * This allows non-timestamped logs to track calculated timestamps
     * @param {string} timestamp - ISO timestamp string
     */
    trackTimestampRange(timestamp) {
        if (!timestamp) return;

        if (!this.firstTimestamp || timestamp < this.firstTimestamp) {
            this.firstTimestamp = timestamp;
        }
        if (!this.lastTimestamp || timestamp > this.lastTimestamp) {
            this.lastTimestamp = timestamp;
        }
    }
}
