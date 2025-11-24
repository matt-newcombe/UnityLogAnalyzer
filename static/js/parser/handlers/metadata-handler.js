import { LogPatterns } from '../log-patterns.js';
import { getFilename } from '../utils.js';

export class MetadataHandler {
    constructor() { }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps, stored) {
        // Check if we are in metadata section
        if (!state.metadataState.inMetadata) {
            // If we haven't started metadata yet, and this is the first line (or close to it)
            if (lineNumber === 1) {
                state.metadataState.inMetadata = true;
                state.metadataState.startLine = lineNumber;
                state.metadataState.startTime = timestamp;
                
                // Detect timestamps on the very first line
                if (state.timestampsEnabled === undefined) {
                    if (LogPatterns.TimestampPrefix.test(line)) {
                        console.log('[MetadataHandler] Detected timestamps on first line');
                        state.timestampsEnabled = true;
                    } else {
                        console.log('[MetadataHandler] No timestamp on first line, timestamps disabled');
                        state.timestampsEnabled = false;
                    }
                }
            }

            if (lineNumber > 1 && !state.metadataState.inMetadata) {
                // If we are not in metadata and not at start, we are done with metadata
                return false;
            }
        }

        // We are in metadata section
        if (state.metadataState.inMetadata) {
            // Accumulate metadata lines
            state.metadataState.lines.push(contentLine);

            // Extract metadata fields
            if (!state.metadataState.unityVersion) {
                const versionMatch = contentLine.match(LogPatterns.UnityVersion);
                if (versionMatch) state.metadataState.unityVersion = versionMatch[1];
            }

            if (!state.metadataState.platform) {
                if (LogPatterns.PlatformMacOS.test(contentLine)) state.metadataState.platform = 'macOS';
                else if (LogPatterns.PlatformWindows.test(contentLine)) state.metadataState.platform = 'Windows';
                else if (LogPatterns.PlatformLinux.test(contentLine)) state.metadataState.platform = 'Linux';
            }

            if (!state.metadataState.architecture) {
                const archMatch = contentLine.match(LogPatterns.Architecture);
                if (archMatch) state.metadataState.architecture = archMatch[1];
            }

            if (!state.metadataState.projectName) {
                const projectPathMatch = contentLine.match(LogPatterns.ProjectPath);
                if (projectPathMatch) {
                    state.metadataState.projectName = getFilename(projectPathMatch[1].replace(/\/$/, ''));
                } else {
                    const pathMatch = contentLine.match(LogPatterns.ProjectPathChange);
                    if (pathMatch) {
                        state.metadataState.projectName = getFilename(pathMatch[1].replace(/\/$/, ''));
                    }
                }
            }

            // Check for end of metadata section
            if (contentLine.includes('Player connection') ||
                contentLine.includes('Start importing') ||
                contentLine.includes('[Worker') ||
                contentLine.includes('Asset Pipeline Refresh')) {

                await this._finalizeMetadata(logId, lineNumber, timestamp, state, databaseOps, stored);

                // If we stopped because of Start importing, Worker, or Pipeline Refresh, we should return false so other handlers can process this line
                if (contentLine.includes('Start importing') ||
                    contentLine.includes('[Worker') ||
                    contentLine.includes('Asset Pipeline Refresh')) {
                    return false;
                }

                return true;
            }

            return true; // Handled as part of metadata
        }

        return false;
    }

    async _finalizeMetadata(logId, lineNumber, timestamp, state, databaseOps, stored) {
        state.metadataState.inMetadata = false;
        state.metadataState.endLine = lineNumber;
        state.metadataState.endTime = timestamp;

        // 1. Update Log Metadata in DB
        const metadataUpdate = {
            unity_version: state.metadataState.unityVersion,
            platform: state.metadataState.platform,
            architecture: state.metadataState.architecture,
            project_name: state.metadataState.projectName,
            timestampsEnabled: state.timestampsEnabled
        };

        await databaseOps.updateLogMetadata(logId, metadataUpdate);

        // 2. Create Operation for Metadata Block
        // Calculate duration if timestamps are available
        let durationSeconds = 0;
        let durationMs = 0;

        // If we have timestamps, use them
        if (state.metadataState.startTime && state.metadataState.endTime) {
            const start = new Date(state.metadataState.startTime).getTime();
            const end = new Date(state.metadataState.endTime).getTime();
            durationMs = end - start;
            durationSeconds = durationMs / 1000;
        }

        const operation = {
            line_number: state.metadataState.startLine,
            process_type: 'Metadata',
            process_name: 'Initialization',
            duration_seconds: durationSeconds,
            duration_ms: durationMs,
            memory_mb: null,
            start_timestamp: state.metadataState.startTime,
            end_timestamp: state.metadataState.endTime
        };

        // Track timestamp range for metadata (works for both timestamped and non-timestamped logs)
        if (state.metadataState.startTime) state.trackTimestampRange(state.metadataState.startTime);
        if (state.metadataState.endTime) state.trackTimestampRange(state.metadataState.endTime);

        await databaseOps.addProcess(operation);
        stored.operation = true;
    }
}
