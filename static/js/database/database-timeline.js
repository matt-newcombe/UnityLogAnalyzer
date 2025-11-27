/**
 * Timeline Builder
 * Orchestrates timeline construction using specialized builders
 */

class TimelineBuilder {
    constructor(db, logId) {
        this.db = db;
        this.logId = logId;
    }

    /**
     * Build timeline data for visualization
     */
    async build() {
        // Fetch all required data
        const { metadata, imports, operations, cacheServerBlocks, workerPhases } = await this._fetchData();

        // Determine timestamp bounds
        const { firstTimestamp, lastTimestamp } = this._getTimestampBounds(metadata, imports, operations, cacheServerBlocks);

        // Create positioner for consistent positioning logic
        const positioner = new TimelinePositioner(metadata, firstTimestamp, lastTimestamp);

        // Merge imports and operations into events
        const events = this._mergeEvents(imports, operations);

        // Build segments using specialized builders
        const importChunkBuilder = new ImportChunkBuilder(positioner);
        const operationBuilder = new OperationBuilder(positioner);
        const cacheBlockBuilder = new CacheBlockBuilder(positioner);
        const workerTimelineBuilder = new WorkerTimelineBuilder(positioner);

        // Reset positioner for sequential building
        positioner.resetCumulativeTime();

        const importSegments = importChunkBuilder.build(events);
        const operationSegments = operationBuilder.build(events);
        const cacheBlockSegments = cacheBlockBuilder.build(cacheServerBlocks);

        // Combine all segments
        let segments = [...importSegments, ...operationSegments, ...cacheBlockSegments];
        segments.sort((a, b) => a.start_time - b.start_time);

        // Calculate final total time
        const totalTimeMs = this._calculateTotalTime(positioner, segments, imports, operations);

        // Build worker thread timeline
        const workerThreadData = workerTimelineBuilder.build(imports, workerPhases);

        // Calculate actual asset import time
        const actualAssetImportTime = imports.reduce((sum, imp) => sum + (imp.import_time_ms || 0), 0);

        return {
            total_time_ms: totalTimeMs,
            segments: segments,
            summary: {
                asset_import_time_ms: actualAssetImportTime,
                total_imports: imports.length
            },
            first_timestamp: firstTimestamp,
            last_timestamp: lastTimestamp,
            worker_threads: workerThreadData
        };
    }

    /**
     * Fetch all required data from database
     */
    async _fetchData() {
        const metadata = await this.db.log_metadata.get(this.logId);
        const imports = await this.db.asset_imports.toCollection().sortBy('line_number');
        const operations = await this.db.processes.toCollection().sortBy('line_number');
        const cacheServerBlocks = await this.db.cache_server_download_blocks.toCollection().sortBy('start_timestamp');
        const workerPhases = await this.db.worker_thread_phases.toCollection().sortBy('start_timestamp');

        return { metadata, imports, operations, cacheServerBlocks, workerPhases };
    }

    /**
     * Determine first and last timestamps from data
     */
    _getTimestampBounds(metadata, imports, operations, cacheServerBlocks) {
        // Try to use stored timestamps from metadata first
        if (metadata?.start_timestamp && metadata?.end_timestamp) {
            return {
                firstTimestamp: metadata.start_timestamp,
                lastTimestamp: metadata.end_timestamp
            };
        }

        // Otherwise, scan all data for timestamps
        let firstTimestamp = null;
        let lastTimestamp = null;

        const updateBounds = (startTs, endTs) => {
            if (startTs && (!firstTimestamp || startTs < firstTimestamp)) {
                firstTimestamp = startTs;
            }
            if (endTs && (!lastTimestamp || endTs > lastTimestamp)) {
                lastTimestamp = endTs;
            }
        };

        // Check imports
        imports.forEach(imp => {
            if (imp.start_timestamp) {
                const endTs = imp.end_timestamp || this._getEndTimestamp(imp.start_timestamp, imp.import_time_ms);
                updateBounds(imp.start_timestamp, endTs);
            }
        });

        // Check operations
        operations.forEach(op => {
            const endTs = op.end_timestamp || this._getEndTimestamp(op.start_timestamp, op.duration_ms);
            updateBounds(op.start_timestamp, endTs);
        });

        // Check cache server blocks
        cacheServerBlocks.forEach(block => {
            updateBounds(block.start_timestamp, block.end_timestamp);
        });

        // Fallback to defaults if no timestamps found
        if (!firstTimestamp || !lastTimestamp) {
            const now = new Date();
            if (!firstTimestamp) {
                firstTimestamp = new Date(now.getTime() - 3600000).toISOString();
            }
            if (!lastTimestamp) {
                lastTimestamp = now.toISOString();
            }
        }

        return { firstTimestamp, lastTimestamp };
    }

    /**
     * Calculate end timestamp from start + duration
     */
    _getEndTimestamp(startTs, durationMs) {
        if (!startTs) return null;
        if (durationMs) {
            const startTime = new Date(startTs).getTime();
            return new Date(startTime + durationMs).toISOString();
        }
        return startTs;
    }

    /**
     * Merge imports and operations by line number
     */
    _mergeEvents(imports, operations) {
        const events = [];
        let importIndex = 0;
        let operationIndex = 0;

        while (importIndex < imports.length || operationIndex < operations.length) {
            const importLineNum = importIndex < imports.length ? (imports[importIndex].line_number || 0) : Infinity;
            const operationLineNum = operationIndex < operations.length ? (operations[operationIndex].line_number || 0) : Infinity;

            if (importLineNum <= operationLineNum) {
                const imp = imports[importIndex++];

                // Skip worker thread imports - they go in worker lanes
                if (imp.worker_thread_id !== null && imp.worker_thread_id !== undefined) {
                    continue;
                }

                let startTimestamp = imp.start_timestamp;
                let endTimestamp = imp.end_timestamp;

                if (startTimestamp && !endTimestamp && imp.import_time_ms) {
                    const startTime = new Date(startTimestamp).getTime();
                    endTimestamp = new Date(startTime + imp.import_time_ms).toISOString();
                }

                events.push({
                    line_number: imp.line_number || 0,
                    type: 'import',
                    time_ms: imp.duration_ms || 0,
                    name: imp.asset_name || '',
                    asset_type: imp.asset_type || '',
                    category: imp.asset_category || 'Other',
                    start_timestamp: startTimestamp,
                    end_timestamp: endTimestamp
                });
            } else {
                const op = operations[operationIndex++];

                let startTimestamp = op.start_timestamp;
                let endTimestamp = op.end_timestamp;

                if (startTimestamp && !endTimestamp && op.duration_ms) {
                    const startTime = new Date(startTimestamp).getTime();
                    endTimestamp = new Date(startTime + op.duration_ms).toISOString();
                }

                let timeMs = op.duration_ms || 0;
                if (startTimestamp && endTimestamp) {
                    const startTime = new Date(startTimestamp).getTime();
                    const endTime = new Date(endTimestamp).getTime();
                    timeMs = endTime - startTime;
                }

                events.push({
                    line_number: op.line_number || 0,
                    type: 'operation',
                    time_ms: timeMs,
                    duration_ms: op.duration_ms,
                    operation_type: op.process_type || '',
                    operation_name: op.process_name || '',
                    start_timestamp: startTimestamp,
                    end_timestamp: endTimestamp
                });
            }
        }

        return events;
    }

    /**
     * Calculate total timeline duration
     */
    _calculateTotalTime(positioner, segments, imports, operations) {
        let totalTimeMs = positioner.totalTimeMs;

        // Check if any segment extends beyond calculated total
        if (segments.length > 0) {
            const lastSegment = segments[segments.length - 1];
            const lastSegmentEnd = lastSegment.start_time + lastSegment.duration_ms;
            if (lastSegmentEnd > totalTimeMs) {
                totalTimeMs = lastSegmentEnd;
            }
        }

        if (totalTimeMs === 0) {
            // Calculate from sum of all durations
            const allDurations = [
                ...imports.map(imp => imp.import_time_ms || 0),
                ...operations.map(op => op.duration_ms || op.time_ms || 0)
            ];
            const sumDurations = allDurations.reduce((sum, d) => sum + d, 0);

            if (sumDurations > totalTimeMs) {
                totalTimeMs = sumDurations;
            }

            // Line number estimation fallback
            if (totalTimeMs === 0 && (imports.length > 0 || operations.length > 0)) {
                const maxLine = Math.max(
                    ...imports.map(i => i.line_number || 0),
                    ...operations.map(o => o.line_number || 0)
                );
                const minLine = Math.min(
                    ...imports.filter(i => i.line_number).map(i => i.line_number),
                    ...operations.filter(o => o.line_number).map(o => o.line_number)
                );
                totalTimeMs = Math.max(1000, (maxLine - minLine) * 1);
            }

            // Final fallback
            if (totalTimeMs === 0) {
                totalTimeMs = 1000;
            }
        }

        return totalTimeMs;
    }
}

// Export for use in other modules
window.TimelineBuilder = TimelineBuilder;
