import { LogPatterns } from '../log-patterns.js';
import { extractImporterType, shouldSkipAsset, calculateWallTime, createAssetImport } from '../utils.js';

export class AssetHandler {
    static shouldHandle(contentLine) {
        return contentLine.includes('Start importing') || 
               contentLine.includes('-> (artifact id:') || 
               contentLine.includes('Keyframe reduction:');
    }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps) {
        if (contentLine.includes('Start importing') && !contentLine.includes('[Worker')) {
            return await this._handleImportStart(contentLine, lineNumber, logId, timestamp, state, databaseOps);
        }

        if (contentLine.includes('Keyframe reduction:')) {
            return this._handleKeyframeReduction(state);
        }

        if (line.includes('-> (artifact id:') && !line.includes('[Worker')) {
            return await this._handleImportComplete(line, lineNumber, logId, timestamp, state, databaseOps);
        }

        return false;
    }

    async _handleImportStart(contentLine, lineNumber, logId, timestamp, state, databaseOps) {
        const importData = this._parseAssetImport(contentLine, lineNumber, timestamp, state);

        if (importData) {
            if (this._isCacheServerRequest(importData.asset_path, state)) {
                if (state.acceleratorBlock) {
                    this._trackNotDownloaded(importData.asset_path, state.acceleratorBlock);
                }
                importData.importer_type = 'Cache Download';
            }
            await databaseOps.addAssetImport(importData);
            return true;
        }

        return this._handleMultiLineImportStart(contentLine, lineNumber, timestamp, state);
    }

    _isCacheServerRequest(assetPath, state) {
        return (state.acceleratorBlock?.requested_asset_map?.[assetPath]) ||
               state.acceleratorAssetMap[assetPath];
    }

    _trackNotDownloaded(assetPath, acceleratorBlock) {
        const { downloaded_assets, not_downloaded_assets } = acceleratorBlock;
        
        if (!downloaded_assets.includes(assetPath) && !not_downloaded_assets.includes(assetPath)) {
            not_downloaded_assets.push(assetPath);
        }
    }

    _handleMultiLineImportStart(contentLine, lineNumber, timestamp, state) {
        const startMatch = contentLine.match(LogPatterns.AssetImportStartSimple);
        if (!startMatch) return true;

        const [, assetPath, guid] = startMatch;
        const isCacheServerRequest = this._isCacheServerRequest(assetPath, state);

        if (isCacheServerRequest && state.acceleratorBlock) {
            this._trackNotDownloaded(assetPath, state.acceleratorBlock);
        }

        const pendingImport = this._createPendingImport(contentLine, assetPath, guid, lineNumber, timestamp, state, isCacheServerRequest);
        state.pendingImports[guid] = pendingImport;

        return true;
    }

    _createPendingImport(contentLine, assetPath, guid, lineNumber, timestamp, state, isCacheServerRequest) {
        const crunchMatch = contentLine.match(LogPatterns.AssetImportCrunched);
        const importerMatch = contentLine.match(LogPatterns.ImporterType);
        
        const importerType = crunchMatch?.[1] || (importerMatch ? extractImporterType(importerMatch[0]) : null);
        const crunchTime = crunchMatch ? parseFloat(crunchMatch[2]) : undefined;

        return {
            asset_path: assetPath,
            guid,
            line_number: lineNumber,
            byte_offset: state.currentLineByteOffset || null,
            importer_type: isCacheServerRequest ? 'Cache Download' : importerType,
            start_timestamp: timestamp || state.logCurrentTime,
            crunch_time: !isNaN(crunchTime) ? crunchTime : undefined,
            is_animation: contentLine.includes('Keyframe reduction:'),
            is_cache_server_request: isCacheServerRequest
        };
    }

    _handleKeyframeReduction(state) {
        const pendingImports = state.pendingImports;
        const animationsFolderImports = Object.keys(pendingImports).filter(guid => {
            const pending = pendingImports[guid];
            const path = (pending?.asset_path || '').toLowerCase();
            return path.includes('/animations/') && path.endsWith('.fbx');
        });

        const targetsToMark = animationsFolderImports.length > 0 
            ? animationsFolderImports
            : Object.keys(pendingImports).filter(guid => {
                const pending = pendingImports[guid];
                return (pending?.asset_path || '').toLowerCase().endsWith('.fbx');
            });

        targetsToMark.forEach(guid => {
            if (pendingImports[guid]) {
                pendingImports[guid].is_animation = true;
            }
        });

        return true;
    }

    async _handleImportComplete(line, lineNumber, logId, timestamp, state, databaseOps) {
        const { artifactId, explicitTimeSeconds } = this._parseCompletionLine(line, lineNumber);
        if (!artifactId || Object.keys(state.pendingImports).length === 0) return false;

        const { bestMatch, bestGuid } = this._findBestPendingImport(state.pendingImports, timestamp, explicitTimeSeconds);
        if (!bestMatch || !bestGuid) return false;

        const { timeSeconds, timeMs } = this._calculateImportTime(bestMatch, timestamp, explicitTimeSeconds);

        if (!timestamp) {
            this._advanceLogCurrentTime(state, timeSeconds);
        }

        const assetImport = createAssetImport({
            logId,
            lineNumber: bestMatch.line_number,
            byteOffset: bestMatch.byte_offset || null,
            assetPath: bestMatch.asset_path,
            guid: bestMatch.guid,
            artifactId,
            importerType: bestMatch.importer_type,
            timeSeconds,
            timeMs,
            startTimestamp: bestMatch.start_timestamp,
            endTimestamp: timestamp,
            isAnimation: bestMatch.is_animation
        });

        await databaseOps.addAssetImport(assetImport);

        if (bestMatch.is_cache_server_request && state.acceleratorBlock && timestamp) {
            state.acceleratorBlock.last_timestamp = timestamp;
        }

        delete state.pendingImports[bestGuid];
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

    _findBestPendingImport(pendingImports, timestamp, explicitTimeSeconds) {
        const currentTimestamp = timestamp ? new Date(timestamp).getTime() : null;
        let bestMatch = null;
        let bestGuid = null;
        let bestTimeDiff = Infinity;

        if (currentTimestamp) {
            for (const [guid, pendingState] of Object.entries(pendingImports)) {
                if (!pendingState.start_timestamp) continue;

                const startTime = new Date(pendingState.start_timestamp).getTime();
                const timeDiff = Math.abs(currentTimestamp - (startTime + explicitTimeSeconds * 1000));

                if (timeDiff < Math.min(bestTimeDiff, 5000)) {
                    bestTimeDiff = timeDiff;
                    bestMatch = pendingState;
                    bestGuid = guid;
                }
            }
        }

        if (!bestMatch) {
            const guids = Object.keys(pendingImports);
            bestGuid = guids[guids.length - 1];
            bestMatch = pendingImports[bestGuid];
        }

        return { bestMatch, bestGuid };
    }

    _calculateImportTime(bestMatch, timestamp, explicitTimeSeconds) {
        if (bestMatch.start_timestamp && timestamp) {
            return calculateWallTime(bestMatch.start_timestamp, timestamp, explicitTimeSeconds);
        }

        if (bestMatch.crunch_time !== undefined && !isNaN(bestMatch.crunch_time)) {
            return { timeSeconds: bestMatch.crunch_time, timeMs: bestMatch.crunch_time * 1000 };
        }

        return { timeSeconds: explicitTimeSeconds, timeMs: explicitTimeSeconds * 1000 };
    }

    _advanceLogCurrentTime(state, timeSeconds) {
        if (!state.logCurrentTime || !timeSeconds || isNaN(timeSeconds)) return;

        const currentMs = new Date(state.logCurrentTime).getTime();
        if (isNaN(currentMs)) return;

        const newMs = currentMs + (timeSeconds * 1000);
        if (!isNaN(newMs)) {
            state.logCurrentTime = new Date(newMs).toISOString();
        }
    }

    _parseAssetImport(line, lineNumber, timestamp, state = null) {
        let match = line.match(LogPatterns.AssetImportComplete);

        if (!match) {
            match = line.match(LogPatterns.AssetImportCrunched);
            if (match) return null;
        }

        if (!match) {
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
            logId: null,
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

        if (!state) {
            return { startTimestamp: null, endTimestamp: null };
        }

        const startTimestamp = state.logCurrentTime;
        const currentMs = new Date(state.logCurrentTime).getTime();
        const newMs = currentMs + (timeSeconds * 1000);
        state.logCurrentTime = new Date(newMs).toISOString();

        return { startTimestamp, endTimestamp: state.logCurrentTime };
    }
}
