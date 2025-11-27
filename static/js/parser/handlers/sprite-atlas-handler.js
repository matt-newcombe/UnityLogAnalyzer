import { LogPatterns } from '../log-patterns.js';
import { calculateWallTime, createAssetImport } from '../utils.js';

/**
 * SpriteAtlasHandler - Handles sprite atlas import parsing
 * 
 * Processes:
 * - Sprite atlas import start (.spriteatlasv2 files)
 * - Atlas processing steps and operations
 * - Import completion with timing
 */
export class SpriteAtlasHandler {
    handle(contentLine, line, lineNumber, timestamp, state, databaseOps) {
        if (contentLine.includes('Start importing') && contentLine.includes('.spriteatlasv2')) {
            return this._handleStartImport(contentLine, lineNumber, timestamp, state);
        }

        if (contentLine.includes('Processing Atlas')) {
            return this._handleProcessingAtlas(contentLine, state);
        }

        if (contentLine.includes('Sprite Atlas Operation')) {
            return this._handleOperation(contentLine, lineNumber, timestamp, state);
        }

        if (contentLine.includes('-> (artifact id:') && !contentLine.includes('[Worker') && state.spriteAtlasState) {
            return this._handleCompletion(contentLine, timestamp, state, databaseOps);
        }

        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IMPORT START HANDLING
    // ─────────────────────────────────────────────────────────────────────────

    _handleStartImport(contentLine, lineNumber, timestamp, state) {
        const match = contentLine.match(LogPatterns.SpriteAtlasStart);
        if (!match) return false;

        const [, spriteAtlasPath, guid] = match;
        const fileName = spriteAtlasPath.split('/').pop();
        const atlasName = fileName.replace('.spriteatlasv2', '');

        state.spriteAtlasState = {
            atlas_name: atlasName,
            atlas_path: spriteAtlasPath,
            start_line: lineNumber,
            start_timestamp: timestamp,
            byte_offset: state.currentLineByteOffset || null,
            guid,
            steps: []
        };
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROCESSING AND OPERATIONS
    // ─────────────────────────────────────────────────────────────────────────

    _handleProcessingAtlas(contentLine, state) {
        const match = contentLine.match(LogPatterns.SpriteAtlasProcessing);
        if (match && state.spriteAtlasState) {
            state.spriteAtlasState.atlas_name = match[1].trim();
        }
        return true;
    }

    _handleOperation(contentLine, lineNumber, timestamp, state) {
        const opData = this._parseOperation(contentLine, lineNumber);

        if (!opData || opData.process_type !== 'Sprite Atlas Operation') return false;

        if (!state.spriteAtlasState) {
            if (opData.process_name.includes('Generating Atlas Masks')) {
                state.spriteAtlasState = {
                    atlas_name: null,
                    atlas_path: null,
                    start_line: lineNumber,
                    start_timestamp: timestamp,
                    byte_offset: state.currentLineByteOffset || null,
                    steps: []
                };
            } else {
                return true;
            }
        }

        state.spriteAtlasState.steps.push({
            process_name: opData.process_name,
            duration_ms: opData.duration_ms,
            timestamp
        });

        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // IMPORT COMPLETION
    // ─────────────────────────────────────────────────────────────────────────

    _handleCompletion(contentLine, timestamp, state, databaseOps) {
        const match = contentLine.match(LogPatterns.WorkerImportComplete);
        if (!match) return false;

        const [, artifactId, explicitTimeSeconds] = match;
        const { spriteAtlasState } = state;

        const { timeMs } = calculateWallTime(
            spriteAtlasState.start_timestamp,
            timestamp,
            parseFloat(explicitTimeSeconds)
        );

        const assetPath = spriteAtlasState.atlas_path || `SpriteAtlas/${spriteAtlasState.atlas_name || 'Unknown'}`;

        const assetImport = createAssetImport({
            lineNumber: spriteAtlasState.start_line,
            byteOffset: spriteAtlasState.byte_offset,
            assetPath,
            guid: spriteAtlasState.guid || null,
            artifactId,
            importerType: 'SpriteAtlasImporter',
            timeMs,
            startTimestamp: spriteAtlasState.start_timestamp,
            endTimestamp: timestamp
        });

        // Override category for sprite atlases
        assetImport.asset_category = 'Sprite Pack';

        databaseOps.addAssetImport(assetImport);

        state.spriteAtlasState = null;
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OPERATION PARSING
    // ─────────────────────────────────────────────────────────────────────────

    _parseOperation(line, lineNumber) {
        const lineToParse = line.replace(LogPatterns.TimestampPrefix, '');
        const match = lineToParse.match(LogPatterns.Operation);

        if (!match) return null;

        return {
            line_number: lineNumber,
            process_type: match[1].trim(),
            process_name: match[2].trim(),
            duration_ms: parseFloat(match[3]) * 1000
        };
    }
}
