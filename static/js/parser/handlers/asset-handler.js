import { LogPatterns } from '../log-patterns.js';
import { extractImporterType, shouldSkipAsset, calculateWallTime, createAssetImport } from '../utils.js';

export class AssetHandler {
    constructor() { }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps, stored) {
        // 1. Start Importing (Main Thread)
        if (contentLine.includes('Start importing') && !contentLine.includes('[Worker')) {
            return await this._handleImportStart(contentLine, lineNumber, logId, timestamp, state, databaseOps, stored);
        }

        // 2. Keyframe Reduction (Animation)
        if (contentLine.includes('Keyframe reduction:')) {
            return this._handleKeyframeReduction(state, stored);
        }

        // 3. Import Complete (Main Thread)
        if (line.includes('-> (artifact id:') && !line.includes('[Worker')) {
            return await this._handleImportComplete(line, lineNumber, logId, timestamp, state, databaseOps, stored);
        }

        return false;
    }

    async _handleImportStart(contentLine, lineNumber, logId, timestamp, state, databaseOps, stored) {
        // When main thread imports start, finalize any worker phases (active or paused)
        // This indicates workers have completed and main thread has resumed
        if (state.workerPhases && Object.keys(state.workerPhases).length > 0) {
            // Use the maximum worker thread local time to finalize
            // This ensures we use the actual time when workers last did work
            let maxWorkerTime = null;
            for (const workerId in state.workerPhases) {
                const phase = state.workerPhases[workerId];
                // Use pausedAt if available (when phase was paused), otherwise threadLocalTime
                const workerTime = phase.pausedAt || state.threadLocalTimes[workerId];
                if (workerTime) {
                    const workerTimeMs = new Date(workerTime).getTime();
                    if (!maxWorkerTime || workerTimeMs > new Date(maxWorkerTime).getTime()) {
                        maxWorkerTime = workerTime;
                    }
                }
            }
            
            // Use the max worker time, falling back to current timestamp only if no worker times available
            // Do NOT use logCurrentTime as it may have advanced beyond when workers actually finished
            const endTime = maxWorkerTime || timestamp;
            
            if (endTime) {
                // Import the workerHandler to finalize phases
                const { WorkerHandler } = await import('./worker-handler.js');
                const workerHandler = new WorkerHandler();
                await workerHandler.endPhase(endTime, state, databaseOps, logId);
            }
        }

        // Try single-line parse first
        const importData = this._parseAssetImport(contentLine, lineNumber, timestamp, state);

        if (importData) {
            // Single-line import

            // Check cache server
            if (state.cacheServerBlock && state.cacheServerBlock.requested_asset_map &&
                state.cacheServerBlock.requested_asset_map[importData.asset_path]) {

                if (!state.cacheServerBlock.downloaded_assets.includes(importData.asset_path) &&
                    !state.cacheServerBlock.not_downloaded_assets.includes(importData.asset_path)) {
                    state.cacheServerBlock.not_downloaded_assets.push(importData.asset_path);
                }
                importData.importer_type = 'Cache Download';
            } else if (state.cacheServerAssetMap[importData.asset_path]) {
                importData.importer_type = 'Cache Download';
            }

            await databaseOps.addAssetImport(importData);
            stored.assetImport = true;
            return true;
        } else {
            // Multi-line import - extract GUID and path
            const startMatch = contentLine.match(LogPatterns.AssetImportStartSimple);

            if (startMatch) {
                const assetPath = startMatch[1];
                const guid = startMatch[2];

                let isCacheServerRequest = false;
                if (state.cacheServerBlock && state.cacheServerBlock.requested_asset_map &&
                    state.cacheServerBlock.requested_asset_map[assetPath]) {
                    isCacheServerRequest = true;
                    if (!state.cacheServerBlock.downloaded_assets.includes(assetPath) &&
                        !state.cacheServerBlock.not_downloaded_assets.includes(assetPath)) {
                        state.cacheServerBlock.not_downloaded_assets.push(assetPath);
                    }
                } else if (state.cacheServerAssetMap[assetPath]) {
                    isCacheServerRequest = true;
                }

                const crunchMatch = contentLine.match(LogPatterns.AssetImportCrunched);
                if (crunchMatch) {
                    const importerType = crunchMatch[1];
                    const crunchTime = parseFloat(crunchMatch[2]);

                    state.pendingImports[guid] = {
                        asset_path: assetPath,
                        guid: guid,
                        line_number: lineNumber,
                        byte_offset: state.currentLineByteOffset || null,
                        importer_type: isCacheServerRequest ? 'Cache Download' : importerType,
                        start_timestamp: timestamp || state.logCurrentTime,
                        crunch_time: crunchTime,
                        is_animation: false,
                        is_cache_server_request: isCacheServerRequest
                    };
                } else {
                    const importerMatch = contentLine.match(LogPatterns.ImporterType);
                    let importerType = importerMatch ? extractImporterType(importerMatch[0]) : null;

                    if (isCacheServerRequest) {
                        importerType = 'Cache Download';
                    }

                    state.pendingImports[guid] = {
                        asset_path: assetPath,
                        guid: guid,
                        line_number: lineNumber,
                        byte_offset: state.currentLineByteOffset || null,
                        importer_type: importerType,
                        start_timestamp: timestamp || state.logCurrentTime,
                        is_animation: false,
                        is_cache_server_request: isCacheServerRequest
                    };
                }

                if (contentLine.includes('Keyframe reduction:')) {
                    state.pendingImports[guid].is_animation = true;
                }
            }
            return true; // Handled (as pending)
        }
    }

    _handleKeyframeReduction(state, stored) {
        const pendingImports = state.pendingImports;
        const animationsFolderImports = Object.keys(pendingImports).filter(guid => {
            const pending = pendingImports[guid];
            return pending && (pending.asset_path || '').toLowerCase().includes('/animations/') &&
                (pending.asset_path || '').toLowerCase().endsWith('.fbx');
        });

        if (animationsFolderImports.length > 0) {
            animationsFolderImports.forEach(guid => {
                if (pendingImports[guid]) {
                    pendingImports[guid].is_animation = true;
                }
            });
        } else {
            Object.keys(pendingImports).forEach(guid => {
                const pending = pendingImports[guid];
                if (pending && (pending.asset_path || '').toLowerCase().endsWith('.fbx')) {
                    pending.is_animation = true;
                }
            });
        }
        return true;
    }

    async _handleImportComplete(line, lineNumber, logId, timestamp, state, databaseOps, stored) {
        const artifactMatch = line.match(LogPatterns.AssetImportComplete);
        // Fallback if needed, but regex handles it

        if (!artifactMatch || Object.keys(state.pendingImports).length === 0) return false;

        const artifactId = artifactMatch[4]; // Group 4 in our pattern
        const explicitTimeSeconds = parseFloat(artifactMatch[5]);

        let bestMatch = null;
        let bestGuid = null;
        let bestTimeDiff = Infinity;

        const currentTimestamp = timestamp ? new Date(timestamp).getTime() : null;

        for (const guid of Object.keys(state.pendingImports)) {
            const pendingState = state.pendingImports[guid];
            if (pendingState.start_timestamp && currentTimestamp) {
                const startTime = new Date(pendingState.start_timestamp).getTime();
                const expectedEndTime = startTime + (explicitTimeSeconds * 1000);
                const timeDiff = Math.abs(currentTimestamp - expectedEndTime);

                if (timeDiff < bestTimeDiff && timeDiff < 5000) {
                    bestTimeDiff = timeDiff;
                    bestMatch = pendingState;
                    bestGuid = guid;
                }
            }
        }

        if (!bestMatch) {
            const guids = Object.keys(state.pendingImports);
            bestGuid = guids[guids.length - 1];
            bestMatch = state.pendingImports[bestGuid];
        }

        if (bestMatch && bestGuid) {
            let timeSeconds, timeMs;
            if (bestMatch.start_timestamp && timestamp) {
                const calculated = calculateWallTime(
                    bestMatch.start_timestamp,
                    timestamp,
                    explicitTimeSeconds
                );
                timeSeconds = calculated.timeSeconds;
                timeMs = calculated.timeMs;
            } else if (bestMatch.crunch_time !== undefined) {
                timeSeconds = bestMatch.crunch_time;
                timeMs = timeSeconds * 1000;
            } else {
                timeSeconds = explicitTimeSeconds;
                timeMs = timeSeconds * 1000;
            }

            if (!timestamp) {
                // Advance logCurrentTime by duration
                const currentMs = new Date(state.logCurrentTime).getTime();
                const newMs = currentMs + (timeSeconds * 1000);
                state.logCurrentTime = new Date(newMs).toISOString();
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
            stored.assetImport = true;

            if (bestMatch.is_cache_server_request && state.cacheServerBlock) {
                if (timestamp) {
                    state.cacheServerBlock.last_timestamp = timestamp;
                }
            }

            delete state.pendingImports[bestGuid];
        }
        return true;
    }

    _parseAssetImport(line, lineNumber, timestamp, state = null) {
        let match = line.match(LogPatterns.AssetImportComplete);

        // Special case: TextureImporter with "crunched in X" format
        if (!match) {
            match = line.match(LogPatterns.AssetImportCrunched);
            if (match) {
                // Multi-line import - handled elsewhere
                return null;
            }
        }

        // Fallback: Pattern without artifact id
        if (!match) {
            match = line.match(LogPatterns.AssetImportCompleteNoArtifact);
            if (match) {
                // Remap to match structure: [full, path, guid, importer, null, time]
                match = [match[0], match[1], match[2], match[3], null, match[4]];
            }
        }

        if (match) {
            const assetPath = match[1];
            const guid = match[2];
            const importerRaw = match[3];
            const artifactId = match[4] || null;
            const timeSeconds = parseFloat(match[5] || match[4]);
            const timeMs = timeSeconds * 1000;

            const importerType = extractImporterType(importerRaw);

            if (shouldSkipAsset(assetPath, importerType)) {
                return null;
            }

            let startTimestamp = timestamp;
            let endTimestamp = timestamp;

            if (!timestamp && state) {
                startTimestamp = state.logCurrentTime;

                // Advance logCurrentTime by duration
                const currentMs = new Date(state.logCurrentTime).getTime();
                const newMs = currentMs + (timeSeconds * 1000);
                state.logCurrentTime = new Date(newMs).toISOString();

                endTimestamp = state.logCurrentTime;
            }

            return createAssetImport({
                logId: null,
                lineNumber,
                byteOffset: state ? state.currentLineByteOffset : null,
                assetPath,
                guid,
                artifactId,
                importerType,
                timeSeconds,
                timeMs,
                startTimestamp: startTimestamp,
                endTimestamp: endTimestamp
            });
        }

        return null;
    }
}
