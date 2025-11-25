import { LogPatterns } from '../log-patterns.js';
import { getExtension, calculateWallTime } from '../utils.js';

export class SpriteAtlasHandler {
    constructor(extDisplayMap = {}) {
        this.extDisplayMap = extDisplayMap;
    }

    static shouldHandle(contentLine, state) {
        return state.spriteAtlasState ||
            (contentLine.includes('Start importing') && contentLine.includes('.spriteatlasv2')) ||
            contentLine.includes('Processing Atlas') ||
            contentLine.includes('Sprite Atlas Operation');
    }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps) {
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
            return this._handleCompletion(contentLine, lineNumber, timestamp, state, databaseOps);
        }

        return false;
    }

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
            guid,
            steps: []
        };
        return true;
    }

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

    async _handleCompletion(contentLine, lineNumber, timestamp, state, databaseOps) {
        const match = contentLine.match(LogPatterns.WorkerImportComplete);
        if (!match) return false;

        const [, artifactId, explicitTimeSeconds] = match;
        const { spriteAtlasState } = state;
        const atlasName = spriteAtlasState.atlas_name || 'Unknown Atlas';

        const { timeMs } = calculateWallTime(
            spriteAtlasState.start_timestamp,
            timestamp,
            parseFloat(explicitTimeSeconds)
        );

        const spriteAtlasPath = spriteAtlasState.atlas_path || `SpriteAtlas/${atlasName}`;
        const ext = getExtension(spriteAtlasPath);
        const assetType = this.extDisplayMap[ext] || ext || '.spriteatlasv2';

        await databaseOps.addAssetImport({
            line_number: spriteAtlasState.start_line,
            asset_path: spriteAtlasPath,
            asset_name: atlasName,
            asset_type: assetType,
            asset_category: 'Sprite Pack',
            guid: spriteAtlasState.guid || null,
            importer_type: 'SpriteAtlasImporter',
            import_time_ms: timeMs,
            start_timestamp: spriteAtlasState.start_timestamp || null,
            end_timestamp: timestamp || null
        });

        state.spriteAtlasState = null;
        return true;
    }

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
