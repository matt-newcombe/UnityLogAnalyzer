import { LogPatterns } from '../log-patterns.js';
import { calculateWallTime, fillMissingTimestamps } from '../utils.js';

export class ScriptCompilationHandler {
    static shouldHandle(contentLine, state) {
        return state.scriptCompilationState ||
            contentLine.includes('script compilation') ||
            contentLine.includes('[ScriptCompilation]') ||
            (contentLine.includes('NetCoreRuntime/dotnet') && contentLine.includes('exec'));
    }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps) {
        if (contentLine.includes('[ScriptCompilation]') && contentLine.includes('Requested script compilation')) {
            return this._handleRequestedCompilation(contentLine, lineNumber, timestamp, state);
        }

        if (contentLine.includes('NetCoreRuntime/dotnet') && contentLine.includes('exec') && !contentLine.includes('## CmdLine:')) {
            return this._handleBeeCompilation(contentLine, lineNumber, timestamp, state);
        }

        if (contentLine.includes('script compilation time:') && state.scriptCompilationState) {
            return await this._handleCompilationComplete(contentLine, timestamp, state, databaseOps);
        }

        return false;
    }

    _handleRequestedCompilation(contentLine, lineNumber, timestamp, state) {
        if (state.scriptCompilationState) return false;

        const assemblyMatch = contentLine.match(LogPatterns.ScriptCompilationRequested);
        const becauseMatch = !assemblyMatch && contentLine.match(LogPatterns.ScriptCompilationReason);
        const assemblyName = assemblyMatch?.[1] || becauseMatch?.[1]?.trim() || 'Unknown Assembly';

        state.scriptCompilationState = {
            start_line: lineNumber,
            start_timestamp: timestamp,
            assembly_name: assemblyName
        };
        return true;
    }

    _handleBeeCompilation(contentLine, lineNumber, timestamp, state) {
        if (state.scriptCompilationState) return false;

        const rspMatch = contentLine.match(LogPatterns.ScriptCompilationBee);
        const assemblyName = rspMatch?.[1] || 'Unknown Assembly';

        state.scriptCompilationState = {
            start_line: lineNumber,
            start_timestamp: timestamp,
            assembly_name: assemblyName
        };
        return true;
    }

    async _handleCompilationComplete(contentLine, timestamp, state, databaseOps) {
        const timeMatch = contentLine.match(LogPatterns.ScriptCompilationTime);
        if (!timeMatch) return false;

        const explicitTimeSeconds = parseFloat(timeMatch[1]);
        const { scriptCompilationState } = state;
        
        const { startTimestamp, endTimestamp } = fillMissingTimestamps(
            scriptCompilationState.start_timestamp,
            timestamp,
            explicitTimeSeconds
        );

        const { timeSeconds, timeMs } = calculateWallTime(
            startTimestamp,
            endTimestamp,
            explicitTimeSeconds
        );

        await databaseOps.addProcess({
            line_number: scriptCompilationState.start_line,
            process_type: 'Script Compilation',
            process_name: scriptCompilationState.assembly_name,
            duration_seconds: timeSeconds,
            duration_ms: timeMs,
            memory_mb: null,
            start_timestamp: startTimestamp,
            end_timestamp: endTimestamp
        });

        if (startTimestamp) state.trackTimestampRange(startTimestamp);
        if (endTimestamp) state.trackTimestampRange(endTimestamp);

        state.scriptCompilationState = null;
        return true;
    }
}

