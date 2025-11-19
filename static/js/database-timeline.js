/**
 * Timeline Builder
 * Handles complex timeline construction logic for log visualization
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
        const buildStartTime = performance.now();
        console.log('[Timeline Builder] Starting build...');
        
        // Get metadata - direct indexed lookup (should be very fast)
        // For already-parsed logs, metadata should exist immediately
        const metadataStart = performance.now();
        
        // Direct query - IndexedDB may need to initialize on first access after opening
        // This can be slow (1+ seconds) but subsequent queries are fast
        const queryStart = performance.now();
        let metadata = await this.db.log_metadata.get(this.logId);
        const queryTime = performance.now() - queryStart;

        metadata = await this.db.log_metadata.get(this.logId);

        const metadataTime = performance.now() - metadataStart;
        console.log(`[Timeline Builder] Metadata fetch: ${metadataTime.toFixed(2)}ms`);
        
        let firstTimestamp = null;
        let lastTimestamp = null;
        let useStoredTimestamps = false;
        
        if (metadata && metadata.start_timestamp && metadata.end_timestamp) {
            // Use stored timestamps from parsing - these are the actual first and last timestamps in the log
            firstTimestamp = metadata.start_timestamp;
            lastTimestamp = metadata.end_timestamp;
            useStoredTimestamps = true;
        }
        
        // Get imports - use index for sorted query (much faster than loading all and sorting in JS)
        const importsStart = performance.now();
        const imports = await this.db.asset_imports
            .where('log_id').equals(this.logId)
            .sortBy('line_number');
        const importsTime = performance.now() - importsStart;
        console.log(`[Timeline Builder] Loaded ${imports.length} imports in ${importsTime.toFixed(2)}ms`);
        
        // Get operations - use index for sorted query
        const operationsStart = performance.now();
        const operations = await this.db.operations
            .where('log_id').equals(this.logId)
            .sortBy('line_number');
        const operationsTime = performance.now() - operationsStart;
        console.log(`[Timeline Builder] Loaded ${operations.length} operations in ${operationsTime.toFixed(2)}ms`);
        
        // If we don't have stored timestamps in metadata, try to extract from imports and operations
        // Fallback to arbitrary defaults if no timestamps found
        if (!useStoredTimestamps) {
            // Helper to get end timestamp from start + duration
            const getEndTimestamp = (startTs, durationMs) => {
                if (!startTs) return null;
                if (durationMs) {
                    const startTime = new Date(startTs).getTime();
                    return new Date(startTime + durationMs).toISOString();
                }
                return startTs;
            };
            
            // Check imports for timestamps
            imports.forEach(imp => {
                if (imp.start_timestamp) {
                    if (!firstTimestamp || imp.start_timestamp < firstTimestamp) {
                        firstTimestamp = imp.start_timestamp;
                    }
                    const endTs = imp.end_timestamp || getEndTimestamp(imp.start_timestamp, imp.import_time_ms);
                    if (endTs && (!lastTimestamp || endTs > lastTimestamp)) {
                        lastTimestamp = endTs;
                    }
                }
            });
            
            // Check operations for timestamps
            operations.forEach(op => {
                if (op.start_timestamp) {
                    if (!firstTimestamp || op.start_timestamp < firstTimestamp) {
                        firstTimestamp = op.start_timestamp;
                    }
                }
                const endTs = op.end_timestamp || getEndTimestamp(op.start_timestamp, op.duration_ms);
                if (endTs && (!lastTimestamp || endTs > lastTimestamp)) {
                    lastTimestamp = endTs;
                }
            });
            
            // Fallback to arbitrary defaults if no timestamps found
            if (!firstTimestamp || !lastTimestamp) {
                const now = new Date();
                if (!firstTimestamp) {
                    firstTimestamp = new Date(now.getTime() - 3600000).toISOString();
                }
                if (!lastTimestamp) {
                    lastTimestamp = now.toISOString();
                }
                console.log(`[Timeline Builder] Using arbitrary default timestamps (no stored timestamps available)`);
            }
        }
        
        // Build timeline segments - group by category properly
        const segments = [];

        // Merge imports and operations by line number to get actual sequence
        // Since both arrays are already sorted by line_number, we can merge them efficiently
        const mergeStart = performance.now();
        const allEvents = [];
        
        let importIndex = 0;
        let operationIndex = 0;
        
        // Merge two sorted arrays (imports and operations) by line_number
        while (importIndex < imports.length || operationIndex < operations.length) {
            const importLineNum = importIndex < imports.length ? (imports[importIndex].line_number || 0) : Infinity;
            const operationLineNum = operationIndex < operations.length ? (operations[operationIndex].line_number || 0) : Infinity;
            
            if (importLineNum <= operationLineNum) {
                // Process import
                const imp = imports[importIndex++];
                // Use stored timestamps if available (from parsing)
                let startTimestamp = imp.start_timestamp;
                let endTimestamp = imp.end_timestamp;
                
                // If we have start_timestamp but no end_timestamp, calculate from duration
                if (startTimestamp && !endTimestamp && imp.import_time_ms) {
                    const startTime = new Date(startTimestamp).getTime();
                    endTimestamp = new Date(startTime + imp.import_time_ms).toISOString();
                }
                
                allEvents.push({
                    line_number: imp.line_number || 0,
                    type: 'import',
                    time_ms: imp.import_time_ms || 0,
                    name: imp.asset_name || '',
                    asset_type: imp.asset_type || '',
                    category: imp.asset_category || 'Other',
                    start_timestamp: startTimestamp,
                    end_timestamp: endTimestamp
                });
            } else {
                // Process operation
                const op = operations[operationIndex++];
                // Use stored timestamps from database
                let startTimestamp = op.start_timestamp;
                let endTimestamp = op.end_timestamp;
                
                // If we have start_timestamp but no end_timestamp, calculate from duration
                if (startTimestamp && !endTimestamp && op.duration_ms) {
                    const startTime = new Date(startTimestamp).getTime();
                    endTimestamp = new Date(startTime + op.duration_ms).toISOString();
                }
                
                // Calculate duration from timestamps if available, otherwise use duration_ms
                let timeMs = op.duration_ms || 0;
                if (startTimestamp && endTimestamp) {
                    const startTime = new Date(startTimestamp).getTime();
                    const endTime = new Date(endTimestamp).getTime();
                    timeMs = endTime - startTime;
                }
                
                allEvents.push({
                    line_number: op.line_number || 0,
                    type: 'operation',
                    time_ms: timeMs,
                    operation_type: op.operation_type || '',
                    operation_name: op.operation_name || '',
                    start_timestamp: startTimestamp,
                    end_timestamp: endTimestamp
                });
            }
        }
        const mergeTime = performance.now() - mergeStart;
        console.log(`[Timeline Builder] Merged ${allEvents.length} events (${imports.length} imports + ${operations.length} operations) in ${mergeTime.toFixed(2)}ms`);
        
        // Determine if we have timestamps available
        // Check if ACTUAL EVENTS have timestamps, not just if metadata has timestamps
        const eventsWithTimestamps = allEvents.filter(e => e.start_timestamp || e.end_timestamp).length;
        const eventsTimestampRatio = allEvents.length > 0 ? eventsWithTimestamps / allEvents.length : 0;
        
        // Use timestamp-based positioning only if most events (>= 50%) have timestamps
        // Otherwise, use sequential positioning
        const hasTimestamps = useStoredTimestamps && (firstTimestamp && lastTimestamp) && eventsTimestampRatio >= 0.5;
        
        // Calculate total log duration in milliseconds
        // For timestamped logs: use wall time from first to last timestamp
        // For non-timestamped logs: will be calculated after segments are built (from cumulative time)
        let totalTimeMs = 0;
        if (hasTimestamps && firstTimestamp && lastTimestamp) {
            // Use timestamp-based duration (wall time)
            const startTime = new Date(firstTimestamp).getTime();
            const endTime = new Date(lastTimestamp).getTime();
            totalTimeMs = endTime - startTime;
        }
        // For non-timestamped logs, totalTimeMs will be calculated from final cumulative time

        // Group consecutive imports into chunks by category
        // Key: Category changes always start a new chunk, even if gap is small
        // Also group logical operations like initial compiles, sprite packs, etc.
        const chunkingStart = performance.now();
        const importChunks = [];
        let currentChunk = [];
        const operationsInSequence = [];
        
        // Helper to calculate chunk time for timeline visualization
        // Use timestamp-based duration to show wall time (includes file I/O and gaps)
        // This matches the user requirement: "timeline chunks should always be the width 
        // of their recorded time, this should now be the time started and ended in the 
        // time stamps, rather than the explicit completion time in the log itself"
        const calculateChunkTime = (chunk) => {
            if (chunk.length === 0) return 0;
            
            const firstEvent = chunk[0];
            const lastEvent = chunk[chunk.length - 1];
            
            // Use timestamps for timeline visualization (shows wall time including gaps/file I/O)
            if (firstEvent.start_timestamp && lastEvent.end_timestamp) {
                const startTime = new Date(firstEvent.start_timestamp).getTime();
                const endTime = new Date(lastEvent.end_timestamp).getTime();
                const wallTime = endTime - startTime;
                // Use wall time if it's reasonable (at least as long as the sum of durations)
                const sumDurations = chunk.reduce((sum, e) => sum + (e.time_ms || 0), 0);
                return Math.max(wallTime, sumDurations);
            }
            
            // Fallback to sum of durations if timestamps unavailable
            // This is the actual work time for the chunk
            return chunk.reduce((sum, e) => sum + (e.time_ms || 0), 0);
        };
        
        // Helper to calculate actual import time (sum of durations, excluding gaps)
        // This is used for summary statistics to match the category widget
        const calculateActualImportTime = (chunk) => {
            if (chunk.length === 0) return 0;
            return chunk.reduce((sum, e) => sum + (e.time_ms || 0), 0);
        };
        
        allEvents.forEach((event, idx) => {
            if (event.type === 'import') {
                if (currentChunk.length === 0) {
                    // Start new chunk
                    currentChunk.push(event);
                } else {
                    // Check gap and category
                    const prevLine = currentChunk[currentChunk.length - 1].line_number;
                    const prevCategory = currentChunk[currentChunk.length - 1].category || 'Other';
                    const currentCategory = event.category || 'Other';
                    const gap = event.line_number - prevLine;
                    
                    // Category changed = always start new chunk (even if gap is small)
                    // Same category = allow larger gaps (up to 50 lines for worker thread imports)
                    if (currentCategory !== prevCategory) {
                        // Category changed - finish current chunk, start new one
                        this._finishChunk(currentChunk, importChunks, calculateChunkTime, calculateActualImportTime);
                        currentChunk = [event];
                    } else if (gap <= 50) {
                        // Same category and reasonable gap - continue chunk
                        currentChunk.push(event);
                    } else {
                        // Same category but very large gap - start new chunk
                        this._finishChunk(currentChunk, importChunks, calculateChunkTime, calculateActualImportTime);
                        currentChunk = [event];
                    }
                }
            } else if (event.type === 'operation') {
                // If there's a current chunk, finish it before the operation
                if (currentChunk.length > 0) {
                    this._finishChunk(currentChunk, importChunks, calculateChunkTime, calculateActualImportTime);
                    currentChunk = [];
                }
                // Store operations to insert at correct positions
                operationsInSequence.push(event);
            }
        });
        
        // Finish last chunk
        if (currentChunk.length > 0) {
            this._finishChunk(currentChunk, importChunks, calculateChunkTime, calculateActualImportTime);
        }
        
        // Merge import chunks and operations by line number for correct sequence
        const timelineEvents = [];
        
        // Add import chunks
        importChunks.forEach(chunk => {
            timelineEvents.push({
                line_number: chunk.start_line,
                type: 'import_chunk',
                data: chunk
            });
        });
        
        // Add operations (deduplicate by line_number and operation_type to avoid duplicates)
        const seenOperations = new Set();
        operationsInSequence.forEach(op => {
            const key = `${op.line_number}_${op.operation_type}_${op.operation_name}`;
            if (!seenOperations.has(key)) {
                seenOperations.add(key);
                timelineEvents.push({
                    line_number: op.line_number,
                    type: 'operation',
                    data: op
                });
            }
        });
        
        // Sort by line number
        timelineEvents.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));

        // Helper function to format time (matches formatTime from dashboard)
        const formatTime = (seconds) => {
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
        };

        // Build timeline segments
        // Use different positioning strategies based on whether we have timestamps:
        // - With timestamps: Use actual wall time from timestamps (shows real-time gaps, I/O, etc.)
        // - Without timestamps: Use sequential positioning based on cumulative durations (shows work time)
        const startTimeOffset = hasTimestamps && firstTimestamp ? new Date(firstTimestamp).getTime() : 0;
        
        // For non-timestamped logs, track cumulative time for sequential positioning
        // Events are already sorted by line_number, so this creates a sequential timeline
        let cumulativeTime = 0;
        
        // Debug: log timeline mode and key values
        console.log('[Timeline] Mode:', {
            hasTimestamps,
            useStoredTimestamps,
            eventsWithTimestamps: eventsWithTimestamps + '/' + allEvents.length + ' (' + (eventsTimestampRatio * 100).toFixed(1) + '%)',
            firstTimestamp: firstTimestamp || 'null',
            lastTimestamp: lastTimestamp || 'null',
            totalTimeMs: totalTimeMs + 'ms (' + (totalTimeMs / 1000).toFixed(2) + 's)',
            importsCount: imports.length,
            operationsCount: operations.length,
            timelineEventsCount: timelineEvents.length
        });
        
        timelineEvents.forEach(event => {
            if (event.type === 'import_chunk') {
                const chunk = event.data;
                const timeSeconds = chunk.time_ms / 1000;
                
                // Calculate start_time based on available data
                let startTime = 0;
                if (hasTimestamps && chunk.start_timestamp) {
                    // Use actual timestamp (timestamped log)
                    startTime = new Date(chunk.start_timestamp).getTime() - startTimeOffset;
                } else if (hasTimestamps && totalTimeMs > 0 && firstTimestamp && chunk.start_line && metadata && metadata.total_lines) {
                    // Estimate from line number proportion (timestamped log but chunk missing timestamp)
                    // Only do this if we have a valid totalTimeMs
                    const totalLines = metadata.total_lines;
                    if (totalLines > 0) {
                        const lineProportion = chunk.start_line / totalLines;
                        startTime = totalTimeMs * lineProportion;
                    } else {
                        // Can't estimate - position at 0 (will be sorted later)
                        startTime = 0;
                    }
                } else {
                    // No timestamps or can't use timestamp-based positioning: use sequential positioning
                    startTime = cumulativeTime;
                    cumulativeTime += chunk.time_ms || 0;
                }
                
                // Only add segment if it has a valid duration (greater than 0)
                // This prevents empty segments from appearing, but we should still log them for debugging
                if (chunk.time_ms > 0) {
                    segments.push({
                        phase: 'AssetImports',
                        start_time: startTime,
                        duration_ms: chunk.time_ms,
                        color: '#4CAF50',
                        category: chunk.category,
                        description: `Asset imports - ${chunk.count} assets (${formatTime(timeSeconds)})`,
                        asset_count: chunk.count,
                        line_number: chunk.start_line
                    });
                } else {
                    console.warn('[Timeline] Skipping chunk with zero duration:', {
                        category: chunk.category,
                        count: chunk.count,
                        start_line: chunk.start_line,
                        end_line: chunk.end_line,
                        actual_import_time_ms: chunk.actual_import_time_ms
                    });
                }
            } else if (event.type === 'operation') {
                const op = event.data;
                const timeSeconds = (op.time_ms || 0) / 1000;
                
                // Calculate start_time based on available data
                let startTime = 0;
                if (hasTimestamps && op.start_timestamp) {
                    // Use actual timestamp (timestamped log)
                    startTime = new Date(op.start_timestamp).getTime() - startTimeOffset;
                } else if (hasTimestamps && totalTimeMs > 0 && firstTimestamp && op.line_number && metadata && metadata.total_lines) {
                    // Estimate from line number proportion (timestamped log but operation missing timestamp)
                    // Only do this if we have a valid totalTimeMs
                    const totalLines = metadata.total_lines;
                    if (totalLines > 0) {
                        const lineProportion = op.line_number / totalLines;
                        startTime = totalTimeMs * lineProportion;
                    } else {
                        // Can't estimate - position at 0 (will be sorted later)
                        startTime = 0;
                    }
                } else {
                    // No timestamps or can't use timestamp-based positioning: use sequential positioning
                    startTime = cumulativeTime;
                    cumulativeTime += op.time_ms || op.duration_ms || 0;
                }
                
                // Determine phase based on operation type
                let phase = 'Operation';
                if (op.operation_type === 'Script Compilation' || op.operation_type === 'Tundra') {
                    phase = 'CompileScripts';
                }
                
                // Calculate duration from timestamps if available
                let durationMs = op.time_ms || 0;
                if (op.start_timestamp && op.end_timestamp) {
                    const startTime = new Date(op.start_timestamp).getTime();
                    const endTime = new Date(op.end_timestamp).getTime();
                    durationMs = endTime - startTime;
                }
                
                segments.push({
                    phase: phase,
                    start_time: startTime,
                    duration_ms: durationMs,
                    color: (op.operation_type === 'Script Compilation' || op.operation_type === 'Tundra') ? '#9966FF' : '#FF5722',
                    description: `${op.operation_type}: ${op.operation_name} (${formatTime(durationMs / 1000)})`,
                    operation_type: op.operation_type,
                    operation_name: op.operation_name,
                    line_number: op.line_number
                });
            }
        });

        // Sort segments by start_time to ensure correct order
        segments.sort((a, b) => a.start_time - b.start_time);
        const chunkingTime = performance.now() - chunkingStart;
        console.log(`[Timeline Builder] Chunking and segment creation: ${chunkingTime.toFixed(2)}ms (${importChunks.length} import chunks, ${operationsInSequence.length} operations, ${segments.length} total segments)`);

        // Calculate actual asset import time from database (not from timeline segments)
        // This ensures consistency with the category widget which uses import_time_ms
        const processingStart = performance.now();
        const actualAssetImportTime = imports.reduce((sum, imp) => sum + (imp.import_time_ms || 0), 0);
        
        // Ensure totalTimeMs is valid
        let finalTotalTimeMs = totalTimeMs;
        if (finalTotalTimeMs === 0) {
            // No timestamps: calculate from final cumulative time (end of last segment)
            if (segments.length > 0) {
                const lastSegment = segments[segments.length - 1];
                finalTotalTimeMs = lastSegment.start_time + lastSegment.duration_ms;
                console.log('[Timeline] Calculated totalTimeMs from last segment:', {
                    lastSegmentStart: lastSegment.start_time,
                    lastSegmentDuration: lastSegment.duration_ms,
                    finalTotal: finalTotalTimeMs
                });
            }
            
            // Also calculate from sum of all import/operation durations as a sanity check
            const allDurations = [
                ...imports.map(imp => imp.import_time_ms || 0),
                ...operations.map(op => op.duration_ms || op.time_ms || 0)
            ];
            const sumDurations = allDurations.reduce((sum, d) => sum + d, 0);
            
            // Use the larger of: last segment end time, or sum of all durations
            // This ensures we capture the full timeline even if segments are positioned incorrectly
            if (sumDurations > finalTotalTimeMs) {
                console.log('[Timeline] Sum of durations (' + sumDurations + 'ms) is larger than last segment end time, using sum');
                finalTotalTimeMs = sumDurations;
            }
            
            // If still zero, use line number estimation
            if (finalTotalTimeMs === 0 && (imports.length > 0 || operations.length > 0)) {
                const maxLine = Math.max(
                    ...imports.map(i => i.line_number || 0),
                    ...operations.map(o => o.line_number || 0)
                );
                const minLine = Math.min(
                    ...imports.filter(i => i.line_number).map(i => i.line_number),
                    ...operations.filter(o => o.line_number).map(o => o.line_number)
                );
                finalTotalTimeMs = Math.max(1000, (maxLine - minLine) * 1);
                console.log('[Timeline] Calculated totalTimeMs from line numbers:', finalTotalTimeMs);
            }
        }
        
        // Debug: Check category distribution in segments
        const categoryCounts = {};
        segments.forEach(s => {
            const cat = s.category || 'N/A';
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });
        
        // Debug: Check category distribution in imports
        const importCategoryCounts = {};
        imports.forEach(imp => {
            const cat = imp.asset_category || 'Other';
            importCategoryCounts[cat] = (importCategoryCounts[cat] || 0) + 1;
        });
        
        console.log('[Timeline] Final values:', {
            finalTotalTimeMs: finalTotalTimeMs + 'ms (' + (finalTotalTimeMs / 1000).toFixed(2) + 's)',
            segmentsCount: segments.length,
            importChunksCount: importChunks.length,
            segmentsByCategory: categoryCounts,
            importsByCategory: importCategoryCounts,
            firstSegment: segments[0] ? { 
                start_time: segments[0].start_time + 'ms', 
                duration_ms: segments[0].duration_ms + 'ms',
                category: segments[0].category || 'N/A'
            } : null,
            lastSegment: segments[segments.length - 1] ? { 
                start_time: segments[segments.length - 1].start_time + 'ms', 
                duration_ms: segments[segments.length - 1].duration_ms + 'ms',
                category: segments[segments.length - 1].category || 'N/A'
            } : null,
            sampleSegments: segments.slice(0, 5).map(s => ({
                start_time: s.start_time + 'ms',
                duration_ms: s.duration_ms + 'ms',
                category: s.category || 'N/A'
            }))
        });
        
        const processingTime = performance.now() - processingStart;
        const totalBuildTime = performance.now() - buildStartTime;
        console.log(`[Timeline Builder] Final processing: ${processingTime.toFixed(2)}ms`);
        
        // Build detailed timing breakdown
        const timingBreakdown = [
            `Metadata: ${metadataTime.toFixed(2)}ms`,
            `Imports: ${importsTime.toFixed(2)}ms (${imports.length} items)`,
            `Operations: ${operationsTime.toFixed(2)}ms (${operations.length} items)`,
            `Merge: ${mergeTime.toFixed(2)}ms`,
            `Chunking: ${chunkingTime.toFixed(2)}ms`,
            `Processing: ${processingTime.toFixed(2)}ms`
        ].join(', ');
        
        console.log(`[Timeline Builder] Total build time: ${totalBuildTime.toFixed(2)}ms`);
        console.log(`[Timeline Builder] Breakdown: ${timingBreakdown}`);
        
        return {
            total_time_ms: finalTotalTimeMs,
            segments: segments,
            summary: {
                asset_import_time_ms: actualAssetImportTime, // Use actual import times from database
                total_imports: imports.length
            }
        };
    }

    /**
     * Helper to finish a chunk and add it to importChunks
     */
    _finishChunk(currentChunk, importChunks, calculateChunkTime, calculateActualImportTime) {
        const chunkStartTimestamp = currentChunk[0].start_timestamp;
        const chunkEndTimestamp = currentChunk[currentChunk.length - 1].end_timestamp;
        const chunkTime = calculateChunkTime(currentChunk); // For timeline visualization
        const actualImportTime = calculateActualImportTime(currentChunk); // For statistics
        const chunkCategory = currentChunk[0].category || 'Other';
        
        // Debug: Log texture chunks specifically
        if (chunkCategory === 'Textures' && chunkTime === 0) {
            console.warn('[Timeline] Texture chunk with zero time:', {
                count: currentChunk.length,
                start_line: currentChunk[0].line_number,
                end_line: currentChunk[currentChunk.length - 1].line_number,
                actual_import_time_ms: actualImportTime,
                events: currentChunk.slice(0, 3).map(e => ({
                    time_ms: e.time_ms,
                    has_timestamp: !!(e.start_timestamp || e.end_timestamp)
                }))
            });
        }
        
        importChunks.push({
            start_line: currentChunk[0].line_number,
            end_line: currentChunk[currentChunk.length - 1].line_number,
            time_ms: chunkTime, // Wall time for timeline visualization
            actual_import_time_ms: actualImportTime, // Actual work time for statistics
            count: currentChunk.length,
            category: chunkCategory,
            start_timestamp: chunkStartTimestamp,
            end_timestamp: chunkEndTimestamp
        });
    }
}

// Export for use in other modules
window.TimelineBuilder = TimelineBuilder;

