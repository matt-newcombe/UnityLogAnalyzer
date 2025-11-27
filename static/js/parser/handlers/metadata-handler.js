import { LogPatterns } from '../log-patterns.js';
import { getFilename } from '../utils.js';
import { calculateDurationMs } from '../time-utils.js';

/**
 * MetadataHandler - Handles log file metadata extraction
 * 
 * Processes:
 * - Unity version detection
 * - Platform and architecture identification
 * - Project name extraction from path
 * - Timestamp format detection (first line check)
 * 
 * Note: This handler stores a pending metadata update in state.pendingMetadataUpdate
 * which should be flushed to the database after parsing completes.
 */
export class MetadataHandler {
    handle(contentLine, line, lineNumber, timestamp, state, databaseOps) {
        const { metadataState } = state;

        // Start metadata collection on first line
        if (lineNumber === 1) {
            this._initializeMetadata(metadataState, lineNumber, timestamp);
            this._detectTimestampFormat(line, state);
        }

        // Skip if not in metadata section
        if (!metadataState.inMetadata) {
            return false;
        }

        // Collect and extract metadata
        metadataState.lines.push(contentLine);
        this._extractMetadataFields(contentLine, metadataState);

        // Check for end of metadata section
        if (this._isMetadataEnd(contentLine)) {
            this._finalizeMetadata(lineNumber, timestamp, state, databaseOps);
            
            // Return false for lines that other handlers should process
            return contentLine.includes('Player connection');
        }

        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────────────────────────────────

    _initializeMetadata(metadataState, lineNumber, timestamp) {
        metadataState.inMetadata = true;
        metadataState.startLine = lineNumber;
        metadataState.startTime = timestamp;
    }

    _detectTimestampFormat(line, state) {
        if (state.timestampsEnabled !== undefined) return;

        state.timestampsEnabled = LogPatterns.TimestampPrefix.test(line);
        console.log(`[MetadataHandler] ${state.timestampsEnabled ? 'Detected timestamps on first line' : 'No timestamp on first line, timestamps disabled'}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FIELD EXTRACTION
    // ─────────────────────────────────────────────────────────────────────────

    _extractMetadataFields(contentLine, metadataState) {
        this._extractUnityVersion(contentLine, metadataState);
        this._extractPlatform(contentLine, metadataState);
        this._extractArchitecture(contentLine, metadataState);
        this._extractProjectName(contentLine, metadataState);
    }

    _extractUnityVersion(contentLine, metadataState) {
        if (metadataState.unityVersion) return;
        
        const match = contentLine.match(LogPatterns.UnityVersion);
        if (match) metadataState.unityVersion = match[1];
    }

    _extractPlatform(contentLine, metadataState) {
        if (metadataState.platform) return;

        if (LogPatterns.PlatformMacOS.test(contentLine)) {
            metadataState.platform = 'macOS';
        } else if (LogPatterns.PlatformWindows.test(contentLine)) {
            metadataState.platform = 'Windows';
        } else if (LogPatterns.PlatformLinux.test(contentLine)) {
            metadataState.platform = 'Linux';
        }
    }

    _extractArchitecture(contentLine, metadataState) {
        if (metadataState.architecture) return;
        
        const match = contentLine.match(LogPatterns.Architecture);
        if (match) metadataState.architecture = match[1];
    }

    _extractProjectName(contentLine, metadataState) {
        if (metadataState.projectName) return;

        const projectPathMatch = contentLine.match(LogPatterns.ProjectPath);
        const pathMatch = projectPathMatch || contentLine.match(LogPatterns.ProjectPathChange);
        
        if (pathMatch) {
            metadataState.projectName = getFilename(pathMatch[1].replace(/\/$/, ''));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION END DETECTION
    // ─────────────────────────────────────────────────────────────────────────

    _isMetadataEnd(contentLine) {
        return contentLine.includes('Player connection') ||
               contentLine.includes('Start importing') ||
               contentLine.includes('[Worker') ||
               contentLine.includes('Asset Pipeline Refresh');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FINALIZATION
    // ─────────────────────────────────────────────────────────────────────────

    _finalizeMetadata(lineNumber, timestamp, state, databaseOps) {
        const { metadataState } = state;
        
        metadataState.inMetadata = false;
        metadataState.endLine = lineNumber;
        metadataState.endTime = timestamp;

        // Store pending metadata update for later flush
        state.pendingMetadataUpdate = {
            unity_version: metadataState.unityVersion,
            platform: metadataState.platform,
            architecture: metadataState.architecture,
            project_name: metadataState.projectName,
            timestampsEnabled: state.timestampsEnabled
        };

        this._createMetadataProcess(metadataState, state, databaseOps);
    }

    _createMetadataProcess(metadataState, state, databaseOps) {
        const { startTime, endTime, startLine } = metadataState;
        const durationMs = calculateDurationMs(startTime, endTime);

        const operation = {
            line_number: startLine,
            process_type: 'Metadata',
            process_name: 'Initialization',
            duration_seconds: durationMs / 1000,
            duration_ms: durationMs,
            memory_mb: null,
            start_timestamp: startTime,
            end_timestamp: endTime
        };

        if (startTime) state.trackTimestampRange(startTime);
        if (endTime) state.trackTimestampRange(endTime);

        databaseOps.addProcess(operation);
    }
}
