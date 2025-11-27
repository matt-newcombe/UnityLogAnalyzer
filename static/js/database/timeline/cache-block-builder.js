/**
 * CacheBlockBuilder
 * Builds timeline segments for cache server download blocks
 */

class CacheBlockBuilder {
    constructor(positioner) {
        this.positioner = positioner;
    }

    /**
     * Build cache server block segments
     * @param {Array} cacheServerBlocks - Cache server download blocks from database
     * @returns {Array} Array of cache block segments
     */
    build(cacheServerBlocks) {
        const segments = [];

        cacheServerBlocks.forEach(block => {
            const segment = this._buildSegment(block);
            if (segment) {
                segments.push(segment);
            }
        });

        return segments;
    }

    /**
     * Build a single cache block segment
     */
    _buildSegment(block) {
        const durationMs = block.duration_ms || 0;
        const startTime = this.positioner.getStartTime(
            block.start_timestamp,
            block.line_number,
            durationMs
        );

        return {
            phase: 'CacheServerDownload',
            start_time: startTime,
            duration_ms: durationMs,
            color: '#9C27B0', // Purple color for cache server downloads
            description: `Cache Server Download: ${block.num_assets_downloaded}/${block.num_assets_requested} assets (${this._formatTime(durationMs / 1000)})`,
            line_number: block.line_number
        };
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
window.CacheBlockBuilder = CacheBlockBuilder;


