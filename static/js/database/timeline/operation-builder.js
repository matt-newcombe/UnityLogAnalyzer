/**
 * OperationBuilder
 * Builds timeline segments for operations (script compilation, etc.)
 */

class OperationBuilder {
    constructor(positioner) {
        this.positioner = positioner;
    }

    /**
     * Build operation segments from events
     * @param {Array} events - All timeline events
     * @returns {Array} Array of operation segments
     */
    build(events) {
        const segments = [];
        const seenOperations = new Set();

        events.forEach(event => {
            if (event.type !== 'operation') return;

            // Deduplicate by line_number and operation_type
            const key = `${event.line_number}_${event.operation_type}_${event.operation_name}`;
            if (seenOperations.has(key)) return;
            seenOperations.add(key);

            const segment = this._buildSegment(event);
            if (segment) {
                segments.push(segment);
            }
        });

        return segments;
    }

    /**
     * Build a single operation segment
     */
    _buildSegment(event) {
        const durationMs = this._calculateDuration(event);
        const startTime = this.positioner.getStartTime(
            event.start_timestamp,
            event.line_number,
            durationMs
        );

        // Determine phase based on operation type
        let phase = 'Operation';
        if (event.operation_type === 'Script Compilation') {
            phase = 'CompileScripts';
        }

        return {
            phase: phase,
            start_time: startTime,
            duration_ms: durationMs,
            color: event.operation_type === 'Script Compilation' ? '#9966FF' : '#FF5722',
            description: `${event.operation_type}: ${event.operation_name} (${this._formatTime(durationMs / 1000)})`,
            operation_type: event.operation_type,
            operation_name: event.operation_name,
            line_number: event.line_number
        };
    }

    /**
     * Calculate duration from timestamps if available
     */
    _calculateDuration(event) {
        if (event.start_timestamp && event.end_timestamp) {
            const startTime = new Date(event.start_timestamp).getTime();
            const endTime = new Date(event.end_timestamp).getTime();
            if (!isNaN(startTime) && !isNaN(endTime)) {
                return endTime - startTime;
            }
        }
        return event.time_ms || event.duration_ms || 0;
    }

    /**
     * Format time for display
     */
    _formatTime(seconds) {
        if (seconds >= 3600) {
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${mins}m`;
        } else if (seconds >= 60) {
            const minutes = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${minutes}m ${secs}s`;
        }
        return seconds.toFixed(2) + 's';
    }
}

// Export for use in other modules
window.OperationBuilder = OperationBuilder;


