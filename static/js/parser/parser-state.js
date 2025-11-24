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

        // Worker threads state: map of workerId -> { assetPath, guid, startTime, ... }
        this.workerStates = {};

        // Worker phase state: map of workerId -> { start_timestamp, import_count, active, start_line_number }
        this.workerPhases = {};

        // Pending worker phases (waiting for end timestamp)
        this.pendingWorkerPhases = {};

        // Pending imports (main thread): map of guid -> { assetPath, startTime, ... }
        this.pendingImports = {};



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

        // Cache Server block state
        this.cacheServerBlock = null;
        this.cacheServerAssetMap = {};

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

        // Thread Local Times: map of workerId -> ISO timestamp string
        // Tracks the local time cursor for each worker thread
        this.threadLocalTimes = {};

        // Track if we've seen significant activity (database entries) since last worker line
        // Used to determine if worker phases should be finalized or resumed
        this.hasActivitySinceWorker = false;
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

            // Also ensure any active worker phases get their local cursor advanced
            Object.keys(this.workerPhases || {}).forEach(k => {
                this.threadLocalTimes[k] = timestamp;
            });

            // And pending worker phases
            Object.keys(this.pendingWorkerPhases || {}).forEach(k => {
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
