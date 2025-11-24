import { LogPatterns } from '../log-patterns.js';
import { getExtension, calculateWallTime } from '../utils.js';

export class SpriteAtlasHandler {
    constructor(extDisplayMap) {
        this.extDisplayMap = extDisplayMap || {};
    }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps, stored) {
        const spriteAtlasState = state.spriteAtlasState;

        // 1. Start Importing
        if (contentLine.includes('Start importing') && contentLine.includes('.spriteatlasv2')) {
            const startMatch = contentLine.match(LogPatterns.SpriteAtlasStart);
            if (startMatch) {
                const spriteAtlasPath = startMatch[1];
                const guid = startMatch[2];
                const pathParts = spriteAtlasPath.split('/');
                const fileName = pathParts[pathParts.length - 1];
                const atlasName = fileName.replace('.spriteatlasv2', '');

                state.spriteAtlasState = {
                    atlas_name: atlasName,
                    atlas_path: spriteAtlasPath,
                    start_line: lineNumber,
                    start_timestamp: timestamp,
                    guid: guid,
                    steps: []
                };
                return true;
            }
        }

        // 2. Processing Atlas
        if (contentLine.includes('Processing Atlas')) {
            const atlasMatch = contentLine.match(LogPatterns.SpriteAtlasProcessing);
            if (atlasMatch && spriteAtlasState) {
                spriteAtlasState.atlas_name = atlasMatch[1].trim();
            }
            return true;
        }

        // 3. Sprite Atlas Operation
        if (contentLine.includes('Sprite Atlas Operation')) {
            // We need to parse the operation here since it's specific to Sprite Atlas
            const opData = this._parseOperation(contentLine, lineNumber, logId);

            if (opData && opData.operation_type === 'Sprite Atlas Operation') {
                if (!spriteAtlasState) {
                    if (opData.operation_name.includes('Generating Atlas Masks')) {
                        state.spriteAtlasState = {
                            atlas_name: null,
                            atlas_path: null,
                            start_line: lineNumber,
                            start_timestamp: timestamp,
                            steps: [{
                                process_name: opData.operation_name,
                                duration_ms: opData.duration_ms,
                                timestamp: timestamp
                            }]
                        };
                    }
                } else {
                    spriteAtlasState.steps.push({
                        process_name: opData.operation_name,
                        duration_ms: opData.duration_ms,
                        timestamp: timestamp
                    });
                }
                return true;
            }
        }

        // 4. Completion
        if (contentLine.includes('-> (artifact id:') && !contentLine.includes('[Worker') && spriteAtlasState) {
            const artifactMatch = contentLine.match(LogPatterns.WorkerImportComplete); // Reusing worker pattern as it matches the format

            if (artifactMatch) {
                const artifactId = artifactMatch[1];
                const explicitTimeSeconds = parseFloat(artifactMatch[2]);
                const atlasName = spriteAtlasState.atlas_name || 'Unknown Atlas';

                const { timeSeconds, timeMs } = calculateWallTime(
                    spriteAtlasState.start_timestamp,
                    timestamp,
                    explicitTimeSeconds
                );

                const spriteAtlasPath = spriteAtlasState.atlas_path || `SpriteAtlas/${atlasName}`;
                const ext = getExtension(spriteAtlasPath);
                const assetType = this.extDisplayMap[ext] || ext || '.spriteatlasv2';

                const assetImport = {
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
                };

                await databaseOps.addAssetImport(assetImport);
                stored.assetImport = true;
                state.spriteAtlasState = null;
            }
            return true;
        }

        return false;
    }

    _parseOperation(line, lineNumber, logId) {
        // Strip timestamp prefix if present
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
