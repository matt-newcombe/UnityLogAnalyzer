import { LogPatterns } from '../log-patterns.js';
import { PIPELINE_REFRESH_MAX_LINES, calculateStartFromEnd } from '../time-utils.js';

/**
 * PipelineHandler - Handles Asset Pipeline Refresh block parsing
 * 
 * Processes:
 * - Pipeline refresh start lines with timing and trigger info
 * - Creates both pipeline_refresh records and process records for timeline
 */
export class PipelineHandler {
    handle(contentLine, line, lineNumber, timestamp, state, databaseOps) {
        if (contentLine.includes('Asset Pipeline Refresh')) {
            return this._handleRefreshStart(contentLine, lineNumber, timestamp, state, databaseOps);
        }

        if (state.pipelineRefreshState.inPipelineRefresh) {
            return this._handleRefreshLine(contentLine, state, databaseOps);
        }

        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REFRESH BLOCK HANDLING
    // ─────────────────────────────────────────────────────────────────────────

    _handleRefreshStart(contentLine, lineNumber, timestamp, state, databaseOps) {
        const { pipelineRefreshState } = state;

        if (pipelineRefreshState.inPipelineRefresh) {
            this._finalizeRefresh(state, databaseOps);
        }

        pipelineRefreshState.inPipelineRefresh = true;
        pipelineRefreshState.pipelineRefreshStart = lineNumber;
        pipelineRefreshState.pipelineRefreshLines = [contentLine];
        pipelineRefreshState.pipelineRefreshTimestamp = timestamp;
        return true;
    }

    _handleRefreshLine(contentLine, state, databaseOps) {
        const { pipelineRefreshState } = state;
        pipelineRefreshState.pipelineRefreshLines.push(contentLine);

        const shouldFinalize = pipelineRefreshState.pipelineRefreshLines.length >= PIPELINE_REFRESH_MAX_LINES ||
            (pipelineRefreshState.pipelineRefreshLines.length > 1 && contentLine.trim() === '');

        if (shouldFinalize) {
            this._finalizeRefresh(state, databaseOps);
        }

        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REFRESH FINALIZATION
    // ─────────────────────────────────────────────────────────────────────────

    _finalizeRefresh(state, databaseOps) {
        const { pipelineRefreshState } = state;
        const { pipelineRefreshLines, pipelineRefreshStart, pipelineRefreshTimestamp } = pipelineRefreshState;
        
        const refreshData = this._parseRefreshData(pipelineRefreshLines, pipelineRefreshStart);
        if (!refreshData) {
            this._resetState(pipelineRefreshState);
            return;
        }

        databaseOps.addPipelineRefresh(refreshData);

        const endTimestamp = pipelineRefreshTimestamp || state.logCurrentTime;
        const startTimestamp = calculateStartFromEnd(endTimestamp, refreshData.total_time_seconds);

        databaseOps.addProcess({
            line_number: pipelineRefreshStart,
            process_type: 'Asset Pipeline Refresh',
            process_name: refreshData.initiated_by,
            duration_seconds: refreshData.total_time_seconds,
            duration_ms: (refreshData.total_time_seconds || 0) * 1000,
            start_timestamp: startTimestamp,
            end_timestamp: endTimestamp
        });

        if (startTimestamp) state.trackTimestampRange(startTimestamp);
        if (endTimestamp) state.trackTimestampRange(endTimestamp);

        this._resetState(pipelineRefreshState);
    }

    _resetState(pipelineRefreshState) {
        pipelineRefreshState.inPipelineRefresh = false;
        pipelineRefreshState.pipelineRefreshLines = [];
        pipelineRefreshState.pipelineRefreshTimestamp = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REFRESH DATA PARSING
    // ─────────────────────────────────────────────────────────────────────────

    _parseRefreshData(lines, startLine) {
        const match = lines[0].match(LogPatterns.PipelineRefreshStart);
        if (!match) return null;

        const [, refreshId, totalTime, initiatedBy] = match;

        return {
            line_number: startLine,
            refresh_id: refreshId,
            total_time_seconds: parseFloat(totalTime),
            initiated_by: initiatedBy
        };
    }
}
