import { LogPatterns } from '../log-patterns.js';
import { calculateWallTime } from '../utils.js';

export class CacheServerHandler {
    constructor() { }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps, stored) {
        // 1. Cache Server Query Start
        if (contentLine.includes('Querying for cacheable assets in Cache Server:')) {
            // Finalize previous block if exists
            if (state.cacheServerBlock) {
                // Use the block's last_timestamp, not the current line's timestamp
                // This ensures the end timestamp is from the last line of the block, not the first line of the next block
                await this._finalizeCacheServerBlock(state.cacheServerBlock, logId, state.cacheServerBlock.last_timestamp, databaseOps);
                stored.cacheServerBlock = true;
            }

            // Start new block - use logCurrentTime for start (which is this line's timestamp)
            state.cacheServerBlock = {
                start_line: lineNumber,
                start_byte_offset: state.currentLineByteOffset,
                start_timestamp: state.logCurrentTime,
                requested_assets: [],
                downloaded_assets: [],
                not_downloaded_assets: [],
                requested_asset_map: {},
                last_timestamp: state.logCurrentTime
            };
            return true;
        }

        // 2. Cache Server Block Content (indented or artifact messages)
        if (contentLine.startsWith('\t') ||
            (contentLine.includes('Artifact') && (contentLine.includes('downloaded for') || contentLine.includes('uploaded to cacheserver')))) {
            return await this._handleCacheServerUpload(contentLine, lineNumber, logId, timestamp, state, databaseOps, stored);
        }

        return false;
    }

    async _finalizeCacheServerBlock(cacheServerBlock, logId, lastTimestamp, databaseOps) {
        if (!cacheServerBlock) return null;

        const endTimestamp = lastTimestamp || cacheServerBlock.last_timestamp || cacheServerBlock.start_timestamp;
        let durationSeconds = 0;
        let durationMs = 0;
        if (cacheServerBlock.start_timestamp && endTimestamp) {
            const calculated = calculateWallTime(cacheServerBlock.start_timestamp, endTimestamp, 0);
            durationSeconds = calculated.timeSeconds;
            durationMs = calculated.timeMs;
        }

        const finalizedBlock = {
            line_number: cacheServerBlock.start_line,
            byte_offset: cacheServerBlock.start_byte_offset,
            start_timestamp: cacheServerBlock.start_timestamp,
            end_timestamp: endTimestamp,
            duration_seconds: durationSeconds,
            duration_ms: durationMs,
            num_assets_requested: cacheServerBlock.requested_assets?.length || 0,
            num_assets_downloaded: cacheServerBlock.downloaded_assets?.length || 0,
            downloaded_assets: cacheServerBlock.downloaded_assets || []
        };

        await databaseOps.addCacheServerBlock(finalizedBlock);
        return finalizedBlock;
    }

    async _handleCacheServerUpload(contentLine, lineNumber, logId, timestamp, state, databaseOps, stored) {
        // Note: The original code had a simplified version here and delegated logic elsewhere.
        // For now, we'll keep the structure but since the original _handleCacheServerUpload returned null,
        // we assume the detailed parsing logic was intended to be here or in the main loop.
        // Looking at the original code, it seems `_handleCacheServerBlock` calls `_handleCacheServerUpload` 
        // but `_handleCacheServerUpload` just returns null.
        // However, the parsing of "hash:path" lines happens implicitly? 
        // Wait, the original code for `_handleCacheServerUpload` is:
        // return null;
        // This suggests the logic for parsing the indented lines was MISSING or handled by side-effects?
        // Ah, I see in `_handleCacheServerBlock` it calls `_handleCacheServerUpload`.
        // But `_handleCacheServerUpload` is empty in the provided file content!
        // This might be a bug in the original code or incomplete implementation.
        // I will implement basic parsing here to make it useful.

        const cacheServerBlock = state.cacheServerBlock;
        if (!cacheServerBlock) return false;

        // Parse requested assets (tab indented)
        if (contentLine.startsWith('\t')) {
            const parts = contentLine.trim().split(':');
            if (parts.length >= 2) {
                const hash = parts[0];
                const path = parts.slice(1).join(':'); // Handle paths with colons
                cacheServerBlock.requested_assets.push(path);
                cacheServerBlock.requested_asset_map[path] = hash;
                state.cacheServerAssetMap[path] = hash; // Global map
            }
            // Update last_timestamp to track the end of this block
            cacheServerBlock.last_timestamp = state.logCurrentTime;
            return true;
        }

        // Parse downloaded/uploaded messages
        if (contentLine.includes('Artifact') && contentLine.includes('downloaded for')) {
            const match = contentLine.match(/Artifact ([a-f0-9]+) downloaded for '(.+)'/);
            if (match) {
                const path = match[2];
                if (!cacheServerBlock.downloaded_assets.includes(path)) {
                    cacheServerBlock.downloaded_assets.push(path);
                }
                // Always track the current time for this block
                cacheServerBlock.last_timestamp = state.logCurrentTime;
            }
            return true;
        }

        return false;
    }
}
