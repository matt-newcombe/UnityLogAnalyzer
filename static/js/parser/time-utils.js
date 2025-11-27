/**
 * Time Utilities
 * Shared time/date operations for log parsing handlers.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Default timestamp when none is available */
export const DEFAULT_TIMESTAMP = '2000-01-01T00:00:00.000Z';

/** Maximum lines to collect for pipeline refresh blocks */
export const PIPELINE_REFRESH_MAX_LINES = 11;

// ─────────────────────────────────────────────────────────────────────────────
// TIMESTAMP PARSING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse timestamp string to milliseconds
 * @param {string} timestamp - ISO timestamp string
 * @returns {number|null} Milliseconds since epoch, or null if invalid
 */
export function parseTimestampMs(timestamp) {
    if (!timestamp) return null;
    const ms = new Date(timestamp).getTime();
    return isNaN(ms) ? null : ms;
}

/**
 * Convert milliseconds to ISO timestamp string
 * @param {number} ms - Milliseconds since epoch
 * @returns {string|null} ISO timestamp string, or null if invalid
 */
export function msToTimestamp(ms) {
    if (ms == null || isNaN(ms)) return null;
    return new Date(ms).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME ADVANCEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Advance a timestamp by a duration
 * @param {string} timestamp - Starting timestamp
 * @param {number} durationSeconds - Duration to add in seconds
 * @returns {string|null} New timestamp, or null if invalid
 */
export function advanceTimestamp(timestamp, durationSeconds) {
    const startMs = parseTimestampMs(timestamp);
    if (startMs === null || durationSeconds == null || isNaN(durationSeconds)) {
        return null;
    }
    return msToTimestamp(startMs + (durationSeconds * 1000));
}

/**
 * Advance state.logCurrentTime by duration
 * Mutates state in place, returns the new timestamp
 * @param {Object} state - Parser state with logCurrentTime
 * @param {number} durationSeconds - Duration to add
 * @returns {string|null} New timestamp, or null if unchanged
 */
export function advanceLogTime(state, durationSeconds) {
    if (!state?.logCurrentTime || durationSeconds == null || isNaN(durationSeconds)) {
        return null;
    }
    const newTimestamp = advanceTimestamp(state.logCurrentTime, durationSeconds);
    if (newTimestamp) {
        state.logCurrentTime = newTimestamp;
    }
    return newTimestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
// DURATION CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate duration between two timestamps in milliseconds
 * @param {string} startTimestamp - Start timestamp
 * @param {string} endTimestamp - End timestamp
 * @returns {number} Duration in ms, or 0 if invalid
 */
export function calculateDurationMs(startTimestamp, endTimestamp) {
    const startMs = parseTimestampMs(startTimestamp);
    const endMs = parseTimestampMs(endTimestamp);
    if (startMs === null || endMs === null) return 0;
    return Math.max(0, endMs - startMs);
}

/**
 * Calculate start timestamp from end timestamp and duration
 * @param {string} endTimestamp - End timestamp
 * @param {number} durationSeconds - Duration in seconds
 * @returns {string|null} Start timestamp
 */
export function calculateStartFromEnd(endTimestamp, durationSeconds) {
    const endMs = parseTimestampMs(endTimestamp);
    if (endMs === null || durationSeconds == null) return null;
    return msToTimestamp(endMs - (durationSeconds * 1000));
}

/**
 * Find the maximum timestamp from an object of timestamps
 * @param {Object} timestampMap - Object with timestamp values
 * @returns {string|null} Maximum timestamp, or null if none found
 */
export function findMaxTimestamp(timestampMap) {
    let maxMs = null;
    let maxTimestamp = null;
    
    for (const key in timestampMap) {
        const timestamp = timestampMap[key];
        const ms = parseTimestampMs(timestamp);
        if (ms !== null && (maxMs === null || ms > maxMs)) {
            maxMs = ms;
            maxTimestamp = timestamp;
        }
    }
    
    return maxTimestamp;
}

/**
 * Update state.logCurrentTime to the later of current or provided timestamp
 * @param {Object} state - Parser state
 * @param {string} timestamp - Timestamp to compare
 */
export function updateLogTimeIfLater(state, timestamp) {
    if (!state || !timestamp) return;
    
    const currentMs = parseTimestampMs(state.logCurrentTime);
    const newMs = parseTimestampMs(timestamp);
    
    if (newMs !== null && (currentMs === null || newMs > currentMs)) {
        state.logCurrentTime = timestamp;
    }
}

