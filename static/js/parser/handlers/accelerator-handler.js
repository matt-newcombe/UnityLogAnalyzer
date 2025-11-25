import { LogPatterns } from '../log-patterns.js';
import { calculateWallTime } from '../utils.js';

export class AcceleratorHandler {
    static shouldHandle(contentLine, state) {
        return state.acceleratorBlock || 
               contentLine.includes('Querying for cacheable assets') || 
               (contentLine.includes('Artifact') && (contentLine.includes('downloaded for') || contentLine.includes('uploaded to')));
    }

    async handleNonAcceleratorLine(contentLine, state, logId, databaseOps) {
        if (!state.acceleratorBlock) return;

        // Don't update last_timestamp if this line is starting a new block
        if (!contentLine.includes('Querying for cacheable assets in Cache Server:')) {
            state.acceleratorBlock.last_timestamp = state.logCurrentTime;
        }
        
        if (!this._isCacheContent(contentLine)) {
            await this._finalizeBlock(state.acceleratorBlock, state.acceleratorBlock.last_timestamp, databaseOps);
            state.acceleratorBlock = null;
        }
    }

    async handle(contentLine, line, lineNumber, logId, timestamp, state, databaseOps) {
        if (contentLine.includes('Querying for cacheable assets in Cache Server:')) {
            return await this._handleBlockStart(lineNumber, state, databaseOps);
        }

        if (this._isCacheContent(contentLine)) {
            return this._handleBlockContent(contentLine, state);
        }

        return false;
    }

    _isCacheContent(contentLine) {
        return contentLine.startsWith('\t') || 
               (contentLine.includes('Artifact') && 
                (contentLine.includes('downloaded for') || contentLine.includes('uploaded to cacheserver')));
    }

    async _handleBlockStart(lineNumber, state, databaseOps) {
        if (state.acceleratorBlock) {
            await this._finalizeBlock(state.acceleratorBlock, state.acceleratorBlock.last_timestamp, databaseOps);
        }

        state.acceleratorBlock = {
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

    _handleBlockContent(contentLine, state) {
        if (!state.acceleratorBlock) return false;

        state.acceleratorBlock.last_timestamp = state.logCurrentTime;

        if (contentLine.startsWith('\t')) {
            return this._handleRequestedAsset(contentLine, state);
        }

        if (contentLine.includes('Artifact') && contentLine.includes('downloaded for')) {
            return this._handleDownloadedAsset(contentLine, state.acceleratorBlock);
        }

        return false;
    }

    _handleRequestedAsset(contentLine, state) {
        const parts = contentLine.trim().split(':');
        if (parts.length < 2) return true;

        const hash = parts[0];
        const path = parts.slice(1).join(':');
        
        state.acceleratorBlock.requested_assets.push(path);
        state.acceleratorBlock.requested_asset_map[path] = hash;
        state.acceleratorAssetMap[path] = hash;
        
        return true;
    }

    _handleDownloadedAsset(contentLine, acceleratorBlock) {
        const match = contentLine.match(/Artifact ([a-f0-9]+) downloaded for '(.+)'/);
        if (!match) return true;

        const path = match[2];
        if (!acceleratorBlock.downloaded_assets.includes(path)) {
            acceleratorBlock.downloaded_assets.push(path);
        }
        
        return true;
    }

    async _finalizeBlock(acceleratorBlock, lastTimestamp, databaseOps) {
        if (!acceleratorBlock) return;

        const endTimestamp = lastTimestamp || acceleratorBlock.start_timestamp;
        const { timeSeconds, timeMs } = calculateWallTime(
            acceleratorBlock.start_timestamp, 
            endTimestamp, 
            0
        );

        await databaseOps.addAcceleratorBlock({
            line_number: acceleratorBlock.start_line,
            byte_offset: acceleratorBlock.start_byte_offset,
            start_timestamp: acceleratorBlock.start_timestamp,
            end_timestamp: endTimestamp,
            duration_seconds: timeSeconds,
            duration_ms: timeMs,
            num_assets_requested: acceleratorBlock.requested_assets?.length || 0,
            num_assets_downloaded: acceleratorBlock.downloaded_assets?.length || 0,
            downloaded_assets: acceleratorBlock.downloaded_assets || []
        });
    }
}
