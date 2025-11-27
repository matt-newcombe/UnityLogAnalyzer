import { LogPatterns } from '../log-patterns.js';
import { extractImporterType, shouldSkipAsset, calculateWallTime, createAssetImport } from '../utils.js';
import { advanceLogTime } from '../time-utils.js';

/**
 * AssetHandler - Handles main thread asset import parsing
 * 
 * Processes:
 * - Single-line imports: "Start importing X ... -> (artifact id: Y) in Z seconds"
 * - Multi-line imports: "Start importing X" followed later by "-> (artifact id: Y)"
 * - Keyframe reduction detection for animation assets
 * 
 * Note: Main thread imports are always sequential - only one pending import exists at a time.
 */
export class AssetHandler {
    handle(contentLine, line, lineNumber, timestamp, state, databaseOps) {
        // Handle "Start importing" lines (but not worker thread lines)
        if (contentLine.includes('Start importing') && !contentLine.includes('[Worker')) {
            return this._handleImportStart(contentLine, lineNumber, timestamp, state, databaseOps);
        }

        // Handle keyframe reduction markers (indicates animation import)
        if (contentLine.includes('Keyframe reduction:')) {
            return this._handleKeyframeReduction(state);
        }

        // Handle import completion lines (but not worker thread lines)
        if (contentLine.includes('-> (artifact id:') && !contentLine.includes('[Worker')) {
            return this._handleImportComplete(contentLine, lineNumber, timestamp, state, databaseOps);
        }

        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IMPORT START HANDLING
    // ─────────────────────────────────────────────────────────────────────────

    _handleImportStart(contentLine, lineNumber, timestamp, state, databaseOps) {
        // Try to parse as single-line import (contains full import info)
        const importData = this._parseSingleLineImport(contentLine, lineNumber, timestamp, state);

        if (importData) {
            databaseOps.addAssetImport(importData);
            return true;
        }

        // Otherwise, handle as multi-line import start
        return this._handleMultiLineImportStart(contentLine, lineNumber, timestamp, state);
    }

    _handleMultiLineImportStart(contentLine, lineNumber, timestamp, state) {
        const startMatch = contentLine.match(LogPatterns.AssetImportStartSimple);
        if (!startMatch) return true;

        const [, assetPath, guid] = startMatch;
        state.pendingImport = this._createPendingImport(contentLine, assetPath, guid, lineNumber, timestamp, state);

        return true;
    }

    _createPendingImport(contentLine, assetPath, guid, lineNumber, timestamp, state) {
        const crunchMatch = contentLine.match(LogPatterns.AssetImportCrunched);
        const importerMatch = contentLine.match(LogPatterns.ImporterType);
        
        const importerType = crunchMatch?.[1] || (importerMatch ? extractImporterType(importerMatch[0]) : null);
        const crunchTime = crunchMatch ? parseFloat(crunchMatch[2]) : undefined;

        return {
            asset_path: assetPath,
            guid,
            line_number: lineNumber,
            byte_offset: state.currentLineByteOffset || null,
            importer_type: importerType,
            start_timestamp: timestamp || state.logCurrentTime,
            crunch_time: !isNaN(crunchTime) ? crunchTime : undefined,
            is_animation: false
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // KEYFRAME REDUCTION (ANIMATION DETECTION)
    // ─────────────────────────────────────────────────────────────────────────

    _handleKeyframeReduction(state) {
        // Mark the current pending import as an animation if it's an FBX file
        if (state.pendingImport) {
            const path = (state.pendingImport.asset_path || '').toLowerCase();
            if (path.endsWith('.fbx')) {
                state.pendingImport.is_animation = true;
            }
        }
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IMPORT COMPLETION HANDLING
    // ─────────────────────────────────────────────────────────────────────────

    _handleImportComplete(contentLine, lineNumber, timestamp, state, databaseOps) {
        const { artifactId, explicitTimeSeconds } = this._parseCompletionLine(contentLine, lineNumber);
        if (!artifactId || !state.pendingImport) return false;

        const pending = state.pendingImport;
        const { timeSeconds, timeMs } = this._calculateImportTime(pending, timestamp, explicitTimeSeconds);

        // Advance log time for non-timestamped logs
        if (!timestamp) {
            advanceLogTime(state, timeSeconds);
        }

        const assetImport = createAssetImport({
            lineNumber: pending.line_number,
            byteOffset: pending.byte_offset,
            assetPath: pending.asset_path,
            guid: pending.guid,
            artifactId,
            importerType: pending.importer_type,
            timeSeconds,
            timeMs,
            startTimestamp: pending.start_timestamp,
            endTimestamp: timestamp,
            isAnimation: pending.is_animation
        });

        databaseOps.addAssetImport(assetImport);

        state.pendingImport = null;
        return true;
    }

    _parseCompletionLine(line, lineNumber) {
        const match = line.match(LogPatterns.AssetImportComplete) || line.match(LogPatterns.WorkerImportComplete);
        if (!match) return { artifactId: null, explicitTimeSeconds: null };

        const artifactId = match[4] || match[1];
        const explicitTimeSeconds = parseFloat(match[5] || match[2]);

        if (isNaN(explicitTimeSeconds)) {
            console.warn(`[AssetHandler] Failed to parse time from completion line ${lineNumber}: "${line.substring(0, 100)}"`);
            return { artifactId: null, explicitTimeSeconds: null };
        }

        return { artifactId, explicitTimeSeconds };
    }

    _calculateImportTime(pending, timestamp, explicitTimeSeconds) {
        // Prefer wall-clock time if both timestamps available
        if (pending.start_timestamp && timestamp) {
            return calculateWallTime(pending.start_timestamp, timestamp, explicitTimeSeconds);
        }

        // Use crunch time if available (from texture compression)
        if (pending.crunch_time !== undefined && !isNaN(pending.crunch_time)) {
            return { timeSeconds: pending.crunch_time, timeMs: pending.crunch_time * 1000 };
        }

        // Fall back to explicit time from log
        return { timeSeconds: explicitTimeSeconds, timeMs: explicitTimeSeconds * 1000 };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SINGLE-LINE IMPORT PARSING
    // ─────────────────────────────────────────────────────────────────────────

    _parseSingleLineImport(line, lineNumber, timestamp, state) {
        let match = line.match(LogPatterns.AssetImportComplete);

        if (!match) {
            // Check for crunched texture format (multi-line, return null to handle separately)
            if (line.match(LogPatterns.AssetImportCrunched)) return null;
        }

        if (!match) {
            // Try format without artifact ID
            match = line.match(LogPatterns.AssetImportCompleteNoArtifact);
            if (match) {
                match = [match[0], match[1], match[2], match[3], null, match[4]];
            }
        }

        if (!match) return null;

        const [, assetPath, guid, importerRaw, artifactId, timeStr] = match;
        const timeSeconds = parseFloat(timeStr || artifactId);
        const timeMs = timeSeconds * 1000;
        const importerType = extractImporterType(importerRaw);

        if (shouldSkipAsset(assetPath, importerType)) return null;

        const { startTimestamp, endTimestamp } = this._calculateSingleLineTimestamps(timestamp, timeSeconds, state);

        return createAssetImport({
            lineNumber,
            byteOffset: state?.currentLineByteOffset || null,
            assetPath,
            guid,
            artifactId: artifactId || null,
            importerType,
            timeSeconds,
            timeMs,
            startTimestamp,
            endTimestamp
        });
    }

    _calculateSingleLineTimestamps(timestamp, timeSeconds, state) {
        if (timestamp) {
            return { startTimestamp: timestamp, endTimestamp: timestamp };
        }

        if (!state?.logCurrentTime) {
            return { startTimestamp: null, endTimestamp: null };
        }

        const startTimestamp = state.logCurrentTime;
        advanceLogTime(state, timeSeconds);

        return { startTimestamp, endTimestamp: state.logCurrentTime };
    }
}
