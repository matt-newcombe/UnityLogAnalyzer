/**
 * WorkerTimelineBuilder
 * Builds timeline data for worker thread imports
 */

// Category colors (subset of charts/colors.js for timeline use)
const WORKER_CATEGORY_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
    '#EC7063', '#5DADE2', '#F1948A', '#82E0AA', '#F4D03F'
];

class WorkerTimelineBuilder {
    constructor(positioner) {
        this.positioner = positioner;
    }

    /**
     * Build worker thread timeline data
     * @param {Array} allImports - All asset imports
     * @param {Array} workerPhases - Worker thread phases from database
     * @returns {Object} Worker thread timeline data keyed by worker ID
     */
    build(allImports, workerPhases) {
        // Filter worker thread imports
        const workerImports = allImports.filter(imp =>
            imp.worker_thread_id !== null && imp.worker_thread_id !== undefined
        );

        if (workerImports.length === 0) {
            return {};
        }

        // Build category color map
        const categoryColorMap = this._buildCategoryColorMap(allImports);

        // Group by worker_thread_id
        const workerThreads = {};
        workerImports.forEach(imp => {
            const workerId = imp.worker_thread_id;
            if (!workerThreads[workerId]) {
                workerThreads[workerId] = [];
            }
            workerThreads[workerId].push(imp);
        });

        // Build segments for each worker thread
        const workerTimelines = {};

        Object.keys(workerThreads).forEach(workerId => {
            const imports = workerThreads[workerId];
            const segments = this._buildWorkerSegments(imports, workerId, categoryColorMap);
            const groupedSegments = this._groupConsecutiveSegments(segments, workerId);
            const phaseBlocks = this._buildPhaseBlocks(workerPhases, workerId);

            workerTimelines[workerId] = {
                worker_id: workerId,
                segments: groupedSegments,
                phase_blocks: phaseBlocks,
                total_operations: segments.length
            };
        });

        return workerTimelines;
    }

    /**
     * Build segments for a single worker thread
     */
    _buildWorkerSegments(imports, workerId, categoryColorMap) {
        // Sort by line_number
        imports.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));

        const segments = [];
        let logicalEndTime = 0;

        imports.forEach(imp => {
            const durationMs = imp.duration_ms || imp.import_time_ms || 0;
            let startTime = 0;

            if (imp.start_timestamp && this.positioner.hasTimestamps) {
                // Use actual timestamp
                const impStartTime = new Date(imp.start_timestamp).getTime();
                startTime = impStartTime - this.positioner.startTimeOffset;

                // Update logical end time
                if (imp.end_timestamp) {
                    const impEndTime = new Date(imp.end_timestamp).getTime();
                    logicalEndTime = Math.max(logicalEndTime, impEndTime - this.positioner.startTimeOffset);
                } else {
                    logicalEndTime = Math.max(logicalEndTime, startTime + durationMs);
                }
            } else {
                // Sequential positioning
                startTime = logicalEndTime;
                logicalEndTime = startTime + durationMs;
            }

            const category = imp.asset_category || 'Other';
            const color = categoryColorMap[category] || '#999999';

            segments.push({
                phase: 'WorkerImport',
                start_time: startTime,
                duration_ms: durationMs,
                color: color,
                category: category,
                description: `${imp.asset_name || imp.asset_path}`,
                asset_name: imp.asset_name,
                asset_path: imp.asset_path,
                line_number: imp.line_number,
                worker_thread_id: workerId
            });
        });

        // Sort by start_time
        segments.sort((a, b) => {
            if (a.start_time !== b.start_time) {
                return a.start_time - b.start_time;
            }
            return (a.line_number || 0) - (b.line_number || 0);
        });

        return segments;
    }

    /**
     * Group consecutive segments with no gap between them
     */
    _groupConsecutiveSegments(segments, workerId) {
        const groupedSegments = [];
        let currentGroup = null;
        const GAP_TOLERANCE_MS = 10;

        segments.forEach((segment, index) => {
            if (currentGroup === null) {
                currentGroup = this._createGroup(segment, workerId);
            } else {
                const groupEndTime = currentGroup.start_time + currentGroup.duration_ms;
                const timeDiff = segment.start_time - groupEndTime;

                if (timeDiff >= 0 && timeDiff <= GAP_TOLERANCE_MS) {
                    // No gap - add to current group
                    currentGroup.duration_ms += segment.duration_ms;
                    currentGroup.operation_count++;
                    currentGroup.operations.push(segment);

                    const firstDesc = currentGroup.operations[0].description || currentGroup.operations[0].asset_name || 'Operation';
                    currentGroup.description = `${firstDesc} (+${currentGroup.operation_count - 1} more)`;
                } else {
                    // Gap exists - finish current group and start new one
                    groupedSegments.push(currentGroup);
                    currentGroup = this._createGroup(segment, workerId);
                }
            }

            if (index === segments.length - 1 && currentGroup) {
                groupedSegments.push(currentGroup);
            }
        });

        return groupedSegments;
    }

    /**
     * Create a new segment group
     */
    _createGroup(segment, workerId) {
        return {
            phase: 'WorkerImport',
            start_time: segment.start_time,
            duration_ms: segment.duration_ms,
            color: segment.color,
            category: segment.category,
            description: segment.description,
            asset_name: segment.asset_name,
            asset_path: segment.asset_path,
            line_number: segment.line_number,
            worker_thread_id: workerId,
            operation_count: 1,
            operations: [segment]
        };
    }

    /**
     * Build category color map from imports
     */
    _buildCategoryColorMap(items) {
        const categoryTimes = {};
        items.forEach(item => {
            const category = item.asset_category || item.category || 'Other';
            if (!categoryTimes[category]) {
                categoryTimes[category] = 0;
            }
            categoryTimes[category] += (item.duration_ms || item.import_time_ms || 0);
        });

        const sortedCategories = Object.keys(categoryTimes).sort((a, b) => {
            return categoryTimes[b] - categoryTimes[a];
        });

        const categoryColorMap = {};
        sortedCategories.forEach((category, index) => {
            categoryColorMap[category] = WORKER_CATEGORY_COLORS[index % WORKER_CATEGORY_COLORS.length];
        });

        return categoryColorMap;
    }

    /**
     * Build phase blocks for a worker thread
     */
    _buildPhaseBlocks(workerPhases, workerId) {
        const phaseBlocks = [];
        const workerPhasesForThread = workerPhases.filter(p => p.worker_thread_id === parseInt(workerId));

        workerPhasesForThread.forEach(phase => {
            let startTime = 0;
            const durationMs = phase.duration_ms || 0;

            if (phase.start_timestamp && this.positioner.hasTimestamps) {
                const phaseStartTime = new Date(phase.start_timestamp).getTime();
                startTime = phaseStartTime - this.positioner.startTimeOffset;
            }

            phaseBlocks.push({
                phase: 'WorkerPhase',
                start_time: startTime,
                duration_ms: durationMs,
                color: 'rgba(255, 152, 0, 0.3)',
                description: `Worker Phase: ${phase.import_count} imports`,
                import_count: phase.import_count,
                line_number: phase.start_line_number,
                worker_thread_id: workerId,
                is_phase_block: true
            });
        });

        return phaseBlocks;
    }
}

// Export for use in other modules
window.WorkerTimelineBuilder = WorkerTimelineBuilder;

