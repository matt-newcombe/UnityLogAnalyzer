import { LogPatterns } from '../log-patterns.js';

export class PipelineHandler {
    static shouldHandle(contentLine, state) {
        return state.pipelineRefreshState.inPipelineRefresh || 
            contentLine.includes('Asset Pipeline Refresh');
    }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps) {
        if (contentLine.includes('Asset Pipeline Refresh')) {
            return await this._handleRefreshStart(contentLine, lineNumber, timestamp, state, databaseOps);
        }

        if (state.pipelineRefreshState.inPipelineRefresh) {
            return await this._handleRefreshLine(contentLine, state, databaseOps);
        }

        return false;
    }

    async _handleRefreshStart(contentLine, lineNumber, timestamp, state, databaseOps) {
        if (state.pipelineRefreshState.inPipelineRefresh) {
            await this._finalizeRefresh(state, databaseOps);
        }

        state.pipelineRefreshState.inPipelineRefresh = true;
        state.pipelineRefreshState.pipelineRefreshStart = lineNumber;
        state.pipelineRefreshState.pipelineRefreshLines = [contentLine];
        state.pipelineRefreshState.pipelineRefreshTimestamp = timestamp;
        return true;
    }

    async _handleRefreshLine(contentLine, state, databaseOps) {
        state.pipelineRefreshState.pipelineRefreshLines.push(contentLine);

        const shouldFinalize = state.pipelineRefreshState.pipelineRefreshLines.length >= 11 ||
            (state.pipelineRefreshState.pipelineRefreshLines.length > 1 && contentLine.trim() === '');

        if (shouldFinalize) {
            await this._finalizeRefresh(state, databaseOps);
        }

        return true;
    }

    async _finalizeRefresh(state, databaseOps) {
        const { pipelineRefreshLines, pipelineRefreshStart, pipelineRefreshTimestamp } = state.pipelineRefreshState;
        
        const refreshData = this._parseRefreshData(pipelineRefreshLines, pipelineRefreshStart);
        if (!refreshData) return;

        await databaseOps.addPipelineRefresh(refreshData);

        const { startTimestamp, endTimestamp } = this._calculateRefreshTimestamps(
            pipelineRefreshTimestamp || state.logCurrentTime,
            refreshData.total_time_seconds
        );

        await databaseOps.addProcess({
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

        state.pipelineRefreshState.inPipelineRefresh = false;
        state.pipelineRefreshState.pipelineRefreshLines = [];
        state.pipelineRefreshState.pipelineRefreshTimestamp = null;
    }

    _calculateRefreshTimestamps(endTimestamp, totalTimeSeconds) {
        if (!endTimestamp) return { startTimestamp: null, endTimestamp: null };

        const durationMs = (totalTimeSeconds || 0) * 1000;
        const endMs = new Date(endTimestamp).getTime();
        const startMs = endMs - durationMs;

        return {
            startTimestamp: new Date(startMs).toISOString(),
            endTimestamp
        };
    }

    _parseRefreshData(lines, startLine) {
        const match = lines[0].match(LogPatterns.PipelineRefreshStart);
        if (!match) return null;

        const [, refreshId, totalTime, initiatedBy] = match;
        const metrics = this._extractMetrics(lines);

        return {
            line_number: startLine,
            refresh_id: refreshId,
            total_time_seconds: parseFloat(totalTime),
            initiated_by: initiatedBy,
            ...metrics
        };
    }

    _extractMetrics(lines) {
        const metrics = {
            imports_total: null,
            imports_actual: null,
            asset_db_process_time_ms: null,
            asset_db_callback_time_ms: null,
            domain_reloads: null,
            domain_reload_time_ms: null,
            compile_time_ms: null,
            scripting_other_ms: null
        };

        for (let i = 1; i < Math.min(lines.length, 11); i++) {
            const line = lines[i];

            if (line.includes('Imports: total=')) {
                const match = line.match(LogPatterns.PipelineImports);
                if (match) {
                    metrics.imports_total = parseInt(match[1]);
                    metrics.imports_actual = parseInt(match[2]);
                }
            } else if (line.includes('Asset DB Process Time:')) {
                const match = line.match(LogPatterns.PipelineAssetDbProcess);
                if (match) {
                    metrics.asset_db_process_time_ms = parseInt(match[1]) + parseInt(match[2]);
                }
            } else if (line.includes('Asset DB Callback time:')) {
                const match = line.match(LogPatterns.PipelineAssetDbCallback);
                if (match) {
                    metrics.asset_db_callback_time_ms = parseInt(match[1]) + parseInt(match[2]);
                }
            } else if (line.includes('Scripting:') && line.includes('domain reload')) {
                const match = line.match(LogPatterns.PipelineDomainReload);
                if (match) {
                    metrics.domain_reloads = parseInt(match[1]);
                    metrics.domain_reload_time_ms = parseInt(match[2]);
                    metrics.compile_time_ms = parseInt(match[3]);
                    metrics.scripting_other_ms = parseInt(match[4]);
                }
            }
        }

        return metrics;
    }
}
