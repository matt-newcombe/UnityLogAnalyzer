/**
 * ImportChunkBuilder
 * Builds timeline segments for asset import chunks
 */

class ImportChunkBuilder {
    constructor(positioner) {
        this.positioner = positioner;
    }

    /**
     * Build import chunk segments from events
     * @param {Array} events - All timeline events (imports and operations mixed)
     * @returns {Array} Array of import chunk segments
     */
    build(events) {
        const importChunks = this._groupImportsIntoChunks(events);
        return this._buildSegments(importChunks);
    }

    /**
     * Group consecutive imports by category into chunks
     */
    _groupImportsIntoChunks(events) {
        const chunks = [];
        let currentChunk = [];

        events.forEach(event => {
            if (event.type !== 'import') return;

            if (currentChunk.length === 0) {
                currentChunk.push(event);
            } else {
                const prevLine = currentChunk[currentChunk.length - 1].line_number;
                const prevCategory = currentChunk[currentChunk.length - 1].category || 'Other';
                const currentCategory = event.category || 'Other';
                const gap = event.line_number - prevLine;

                // Category changed = always start new chunk
                if (currentCategory !== prevCategory) {
                    this._finishChunk(currentChunk, chunks);
                    currentChunk = [event];
                } else if (gap <= 50) {
                    // Same category and reasonable gap - continue chunk
                    currentChunk.push(event);
                } else {
                    // Same category but very large gap - start new chunk
                    this._finishChunk(currentChunk, chunks);
                    currentChunk = [event];
                }
            }
        });

        // Finish last chunk
        if (currentChunk.length > 0) {
            this._finishChunk(currentChunk, chunks);
        }

        return chunks;
    }

    /**
     * Finish a chunk and add it to the chunks array
     */
    _finishChunk(currentChunk, chunks) {
        if (currentChunk.length === 0) return;

        const chunkTime = this._calculateChunkTime(currentChunk);
        const actualImportTime = this._calculateActualImportTime(currentChunk);

        chunks.push({
            start_line: currentChunk[0].line_number,
            end_line: currentChunk[currentChunk.length - 1].line_number,
            time_ms: chunkTime,
            actual_import_time_ms: actualImportTime,
            count: currentChunk.length,
            category: currentChunk[0].category || 'Other',
            start_timestamp: currentChunk[0].start_timestamp,
            end_timestamp: currentChunk[currentChunk.length - 1].end_timestamp
        });
    }

    /**
     * Calculate chunk time for timeline visualization (wall time)
     */
    _calculateChunkTime(chunk) {
        if (chunk.length === 0) return 0;

        const firstEvent = chunk[0];
        const lastEvent = chunk[chunk.length - 1];

        // Use timestamps for timeline visualization
        if (firstEvent.start_timestamp && lastEvent.end_timestamp) {
            const startTime = new Date(firstEvent.start_timestamp).getTime();
            const endTime = new Date(lastEvent.end_timestamp).getTime();
            const wallTime = endTime - startTime;
            const sumDurations = chunk.reduce((sum, e) => sum + (e.time_ms || 0), 0);
            return Math.max(wallTime, sumDurations);
        }

        // Fallback to sum of durations
        return chunk.reduce((sum, e) => sum + (e.time_ms || 0), 0);
    }

    /**
     * Calculate actual import time (sum of durations, excluding gaps)
     */
    _calculateActualImportTime(chunk) {
        if (chunk.length === 0) return 0;
        return chunk.reduce((sum, e) => sum + (e.time_ms || 0), 0);
    }

    /**
     * Build segments from chunks
     */
    _buildSegments(chunks) {
        const segments = [];

        chunks.forEach(chunk => {
            if (chunk.time_ms <= 0) return;

            const startTime = this.positioner.getStartTime(
                chunk.start_timestamp,
                chunk.start_line,
                chunk.time_ms
            );

            const timeSeconds = chunk.time_ms / 1000;
            segments.push({
                phase: 'AssetImports',
                start_time: startTime,
                duration_ms: chunk.time_ms,
                actual_import_time_ms: chunk.actual_import_time_ms || 0,
                color: '#4CAF50',
                category: chunk.category,
                description: `Asset imports - ${chunk.count} assets (${this._formatTime(timeSeconds)})`,
                asset_count: chunk.count,
                line_number: chunk.start_line
            });
        });

        return segments;
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
window.ImportChunkBuilder = ImportChunkBuilder;


