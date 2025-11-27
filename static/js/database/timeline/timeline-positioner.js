/**
 * TimelinePositioner
 * Handles timestamp vs sequential positioning logic for timeline events
 */

class TimelinePositioner {
    constructor(metadata, firstTimestamp, lastTimestamp) {
        this.metadata = metadata;
        this.firstTimestamp = firstTimestamp;
        this.lastTimestamp = lastTimestamp;
        
        // Determine if we have valid timestamps for positioning
        this.hasTimestamps = !!(firstTimestamp && lastTimestamp);
        
        // Calculate start offset for timestamp-based positioning
        this.startTimeOffset = this.hasTimestamps ? new Date(firstTimestamp).getTime() : 0;
        
        // Calculate total time in milliseconds
        this.totalTimeMs = 0;
        if (this.hasTimestamps) {
            const startTime = new Date(firstTimestamp).getTime();
            const endTime = new Date(lastTimestamp).getTime();
            this.totalTimeMs = endTime - startTime;
        }
        
        // Track cumulative time for sequential positioning (non-timestamped logs)
        this.cumulativeTime = 0;
    }

    /**
     * Get start time for an event based on its timestamp or sequential position
     * @param {string|null} timestamp - Event timestamp (if available)
     * @param {number} lineNumber - Line number in log
     * @param {number} durationMs - Duration of the event in ms
     * @returns {number} Start time in milliseconds relative to timeline start
     */
    getStartTime(timestamp, lineNumber, durationMs = 0) {
        if (this.hasTimestamps && timestamp) {
            // Use actual timestamp
            const eventTime = new Date(timestamp).getTime();
            if (!isNaN(eventTime)) {
                return eventTime - this.startTimeOffset;
            }
        }
        
        if (this.hasTimestamps && this.totalTimeMs > 0 && lineNumber && this.metadata?.total_lines) {
            // Estimate from line number proportion
            const totalLines = this.metadata.total_lines;
            if (totalLines > 0) {
                return this.totalTimeMs * (lineNumber / totalLines);
            }
        }
        
        // Sequential positioning fallback
        const startTime = this.cumulativeTime;
        this.cumulativeTime += durationMs;
        return startTime;
    }

    /**
     * Get start time without advancing cumulative time (for peeking)
     */
    peekStartTime(timestamp, lineNumber) {
        if (this.hasTimestamps && timestamp) {
            const eventTime = new Date(timestamp).getTime();
            if (!isNaN(eventTime)) {
                return eventTime - this.startTimeOffset;
            }
        }
        
        if (this.hasTimestamps && this.totalTimeMs > 0 && lineNumber && this.metadata?.total_lines) {
            const totalLines = this.metadata.total_lines;
            if (totalLines > 0) {
                return this.totalTimeMs * (lineNumber / totalLines);
            }
        }
        
        return this.cumulativeTime;
    }

    /**
     * Advance cumulative time manually (for sequential positioning)
     */
    advanceTime(durationMs) {
        this.cumulativeTime += durationMs;
    }

    /**
     * Reset cumulative time (for starting a new sequence)
     */
    resetCumulativeTime() {
        this.cumulativeTime = 0;
    }
}

// Export for use in other modules
window.TimelinePositioner = TimelinePositioner;


