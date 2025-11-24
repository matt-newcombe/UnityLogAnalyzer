import { LogPatterns } from '../log-patterns.js';

export class PipelineHandler {
    constructor() { }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps, stored) {
        const inPipelineRefresh = state.pipelineRefreshState.inPipelineRefresh;

        if (contentLine.includes('Asset Pipeline Refresh')) {
            // Start of new refresh
            if (inPipelineRefresh) {
                // Finalize previous if exists (edge case)
                await this._finalizeRefresh(logId, state, databaseOps, stored);
            }

            state.pipelineRefreshState.inPipelineRefresh = true;
            state.pipelineRefreshState.pipelineRefreshStart = lineNumber;
            state.pipelineRefreshState.pipelineRefreshLines = [contentLine];
            // Capture start timestamp if available
            state.pipelineRefreshState.pipelineRefreshTimestamp = timestamp;
            return true;
        } else if (inPipelineRefresh) {
            // Accumulate lines
            state.pipelineRefreshState.pipelineRefreshLines.push(contentLine);

            // Check for end conditions
            if (state.pipelineRefreshState.pipelineRefreshLines.length >= 11 ||
                (state.pipelineRefreshState.pipelineRefreshLines.length > 1 && contentLine.trim() === '')) {
                await this._finalizeRefresh(logId, state, databaseOps, stored);
            }
            return true;
        }

        return false;
    }

    async _finalizeRefresh(logId, state, databaseOps, stored) {
        const lines = state.pipelineRefreshState.pipelineRefreshLines;
        const startLine = state.pipelineRefreshState.pipelineRefreshStart;
        const startTimestamp = state.pipelineRefreshState.pipelineRefreshTimestamp;

        const refreshData = this._parsePipelineRefresh(lines, startLine, logId);
        if (refreshData) {
            await databaseOps.addPipelineRefresh(refreshData);

            // Also add as an operation for the timeline view
            const durationMs = (refreshData.total_time_seconds || 0) * 1000;

            // The log line appears at the END of the operation
            // So: end_timestamp = current time, start_timestamp = end_timestamp - duration
            let endTimestamp = startTimestamp || state.logCurrentTime;
            let startTime = null;

            if (endTimestamp) {
                const endMs = new Date(endTimestamp).getTime();
                const startMs = endMs - durationMs;
                startTime = new Date(startMs).toISOString();
            }

            const operation = {
                line_number: startLine,
                process_type: 'Asset Pipeline Refresh',
                process_name: refreshData.initiated_by,
                duration_seconds: refreshData.total_time_seconds,
                duration_ms: durationMs,
                start_timestamp: startTime,
                end_timestamp: endTimestamp
            };

            // Track timestamp range for metadata (works for both timestamped and non-timestamped logs)
            if (startTime) state.trackTimestampRange(startTime);
            if (endTimestamp) state.trackTimestampRange(endTimestamp);

            await databaseOps.addProcess(operation);
            stored.pipelineRefresh = true;

            // DO NOT advance logCurrentTime for pipeline refresh
            // These operations are non-blocking and overlap with other operations
            // They act as containers showing what happened during a time period

            state.pipelineRefreshState.inPipelineRefresh = false;
            state.pipelineRefreshState.pipelineRefreshLines = [];
            state.pipelineRefreshState.pipelineRefreshTimestamp = null;
        }
    }

    _parsePipelineRefresh(lines, startLine, logId) {
        const firstLine = lines[0];
        const match = firstLine.match(LogPatterns.PipelineRefreshStart);

        if (!match) return null;

        const refreshId = match[1];
        const totalTime = parseFloat(match[2]);
        const initiatedBy = match[3];

        let importsTotal = null;
        let importsActual = null;
        let assetDbProcessMs = null;
        let assetDbCallbackMs = null;
        let domainReloads = null;
        let domainReloadMs = null;
        let compileMs = null;
        let scriptingOtherMs = null;

        for (let i = 1; i < Math.min(lines.length, 11); i++) {
            const line = lines[i];

            if (line.includes('Imports: total=')) {
                const importsMatch = line.match(LogPatterns.PipelineImports);
                if (importsMatch) {
                    importsTotal = parseInt(importsMatch[1]);
                    importsActual = parseInt(importsMatch[2]);
                }
            } else if (line.includes('Asset DB Process Time:')) {
                const timeMatch = line.match(LogPatterns.PipelineAssetDbProcess);
                if (timeMatch) {
                    assetDbProcessMs = parseInt(timeMatch[1]) + parseInt(timeMatch[2]);
                }
            } else if (line.includes('Asset DB Callback time:')) {
                const timeMatch = line.match(LogPatterns.PipelineAssetDbCallback);
                if (timeMatch) {
                    assetDbCallbackMs = parseInt(timeMatch[1]) + parseInt(timeMatch[2]);
                }
            } else if (line.includes('Scripting:') && line.includes('domain reload')) {
                const scriptingMatch = line.match(LogPatterns.PipelineDomainReload);
                if (scriptingMatch) {
                    domainReloads = parseInt(scriptingMatch[1]);
                    domainReloadMs = parseInt(scriptingMatch[2]);
                    compileMs = parseInt(scriptingMatch[3]);
                    scriptingOtherMs = parseInt(scriptingMatch[4]);
                }
            }
        }

        return {
            line_number: startLine,
            refresh_id: refreshId,
            total_time_seconds: totalTime,
            initiated_by: initiatedBy,
            imports_total: importsTotal,
            imports_actual: importsActual,
            asset_db_process_time_ms: assetDbProcessMs,
            asset_db_callback_time_ms: assetDbCallbackMs,
            domain_reloads: domainReloads,
            domain_reload_time_ms: domainReloadMs,
            compile_time_ms: compileMs,
            scripting_other_ms: scriptingOtherMs
        };
    }
}
