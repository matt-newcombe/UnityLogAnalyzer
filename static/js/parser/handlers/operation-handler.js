import { LogPatterns } from '../log-patterns.js';
import { calculateWallTime } from '../utils.js';

export class OperationHandler {
    constructor() { }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps, stored) {
        // 1. Generic Operations
        if (contentLine.includes('Operation') && contentLine.includes('took') && contentLine.includes('sec') &&
            !contentLine.includes('Sprite Atlas Operation')) {
            return await this._handleGenericOperation(contentLine, lineNumber, logId, timestamp, state, databaseOps, stored);
        }

        // 2. Script Compilation
        if (contentLine.includes('Requested script compilation') || state.scriptCompilationState) {
            return await this._handleScriptCompilation(contentLine, lineNumber, logId, timestamp, state, databaseOps, stored);
        }

        return false;
    }

    async _handleGenericOperation(contentLine, lineNumber, logId, timestamp, state, databaseOps, stored) {
        const opData = this._parseOperation(contentLine, lineNumber, logId);
        if (opData) {
            opData.start_timestamp = timestamp;
            opData.end_timestamp = timestamp;
            
            // Track timestamp range for metadata
            if (timestamp) state.trackTimestampRange(timestamp);
            
            await databaseOps.addProcess(opData);
            stored.operation = true;
            return true;
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

    _parseOperation(line, lineNumber, logId) {
        // Strip timestamp prefix if present (already handled by caller, but just in case)
        let lineToParse = line;
        if (LogPatterns.TimestampPrefix.test(line)) {
            lineToParse = line.replace(LogPatterns.TimestampPrefix, '');
        }

        const match = lineToParse.match(LogPatterns.Operation);

        if (match) {
            return {
                line_number: lineNumber,
                process_type: match[1].trim(),
                process_name: match[2].trim(),
                duration_seconds: parseFloat(match[3]),
                duration_ms: parseFloat(match[3]) * 1000,
                memory_mb: match[4] ? parseInt(match[4]) : null
            };
        }
        return null;
    }
}
