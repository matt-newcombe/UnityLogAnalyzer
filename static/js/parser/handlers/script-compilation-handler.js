import { LogPatterns } from '../log-patterns.js';
import { calculateWallTime } from '../utils.js';

export class ScriptCompilationHandler {
    constructor() { }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps, stored) {
        // Script Compilation
        if (contentLine.includes('Requested script compilation') || state.scriptCompilationState ||
            contentLine.includes('script compilation time:') || contentLine.includes('[ScriptCompilation]') ||
            (contentLine.includes('NetCoreRuntime/dotnet') && contentLine.includes('exec'))) {
            return await this._handleScriptCompilation(contentLine, lineNumber, logId, timestamp, state, databaseOps, stored);
        }

        return false;
    }

    async _handleScriptCompilation(contentLine, lineNumber, logId, timestamp, state, databaseOps, stored) {
        if (!state.scriptCompilationState) state.scriptCompilationState = null;
        let scriptCompilationState = state.scriptCompilationState;

        // Start: Requested script compilation
        if (!scriptCompilationState && contentLine.includes('[ScriptCompilation]') && contentLine.includes('Requested script compilation')) {
            let assemblyName = 'Unknown Assembly';
            const assemblyMatch = contentLine.match(LogPatterns.ScriptCompilationRequested);
            if (assemblyMatch) {
                assemblyName = assemblyMatch[1];
            } else {
                const becauseMatch = contentLine.match(LogPatterns.ScriptCompilationReason);
                if (becauseMatch) {
                    assemblyName = becauseMatch[1].trim();
                }
            }
            state.scriptCompilationState = {
                start_line: lineNumber,
                start_timestamp: timestamp,
                assembly_name: assemblyName
            };
            return true;
        }

        // Start: Bee build (dotnet exec)
        if (!scriptCompilationState && contentLine.includes('NetCoreRuntime/dotnet') && contentLine.includes('exec') && !contentLine.includes('## CmdLine:')) {
            let assemblyName = 'Unknown Assembly';
            const rspMatch = contentLine.match(LogPatterns.ScriptCompilationBee);
            if (rspMatch) {
                assemblyName = rspMatch[1];
            }
            state.scriptCompilationState = {
                start_line: lineNumber,
                start_timestamp: timestamp,
                assembly_name: assemblyName
            };
            return true;
        }

        // End: Compilation time
        if (scriptCompilationState && contentLine.includes('script compilation time:')) {
            const timeMatch = contentLine.match(LogPatterns.ScriptCompilationTime);
            if (timeMatch) {
                const explicitTimeSeconds = parseFloat(timeMatch[1]);
                let startTimestamp = scriptCompilationState.start_timestamp;

                if (!startTimestamp && timestamp) {
                    const endTime = new Date(timestamp).getTime();
                    const calculatedStartTime = endTime - (explicitTimeSeconds * 1000);
                    startTimestamp = new Date(calculatedStartTime).toISOString();
                }

                const { timeSeconds, timeMs } = calculateWallTime(
                    startTimestamp,
                    timestamp,
                    explicitTimeSeconds
                );

                let endTimestamp = timestamp;
                if (!endTimestamp && startTimestamp) {
                    const startTime = new Date(startTimestamp).getTime();
                    const endTime = startTime + timeMs;
                    endTimestamp = new Date(endTime).toISOString();
                }

                const operation = {
                    line_number: scriptCompilationState.start_line,
                    process_type: 'Script Compilation',
                    process_name: scriptCompilationState.assembly_name,
                    duration_seconds: timeSeconds,
                    duration_ms: timeMs,
                    memory_mb: null,
                    start_timestamp: startTimestamp,
                    end_timestamp: endTimestamp
                };

                // Track timestamp range for metadata (works for both timestamped and non-timestamped logs)
                if (startTimestamp) state.trackTimestampRange(startTimestamp);
                if (endTimestamp) state.trackTimestampRange(endTimestamp);

                await databaseOps.addProcess(operation);
                stored.operation = true;
                state.scriptCompilationState = null;
            }
            return true;
        }

        return false;
    }
}

