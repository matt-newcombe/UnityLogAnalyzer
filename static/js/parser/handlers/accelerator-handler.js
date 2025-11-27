import { LogPatterns } from '../log-patterns.js';
import { calculateWallTime } from '../utils.js';

/**
 * AcceleratorHandler - Handles Unity Accelerator (Cache Server) block parsing
 * 
 * Processes:
 * - Cache server query blocks ("Querying for cacheable assets")
 * - Requested asset tracking (tab-indented asset lines)
 * - Downloaded asset tracking ("Artifact X downloaded for")
 * - Block finalization with download statistics
 */
export class AcceleratorHandler {
    handle(contentLine, line, lineNumber, timestamp, state, databaseOps) {
        if (contentLine.includes('Querying for cacheable assets in Cache Server:')) {
            return this._handleBlockStart(lineNumber, state, databaseOps);
        }

        // Only process cache content if we're in an active block
        if (state.acceleratorBlock && this._isCacheContent(contentLine)) {
            return this._handleBlockContent(contentLine, state);
        }

        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NON-ACCELERATOR LINE HANDLING
    // ─────────────────────────────────────────────────────────────────────────

    handleNonAcceleratorLine(contentLine, state, databaseOps) {
        const { acceleratorBlock } = state;
        if (!acceleratorBlock) return;

        // Don't update last_timestamp if this line is starting a new block
        if (!contentLine.includes('Querying for cacheable assets in Cache Server:')) {
            acceleratorBlock.last_timestamp = state.logCurrentTime;
        }
        
        if (!this._isCacheContent(contentLine)) {
            this._finalizeBlock(acceleratorBlock, databaseOps);
            state.acceleratorBlock = null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CACHE CONTENT DETECTION
    // ─────────────────────────────────────────────────────────────────────────

    _isCacheContent(contentLine) {
        return contentLine.startsWith('\t') || 
               (contentLine.includes('Artifact') && 
                (contentLine.includes('downloaded for') || contentLine.includes('uploaded to cacheserver')));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BLOCK START AND CONTENT HANDLING
    // ─────────────────────────────────────────────────────────────────────────

    _handleBlockStart(lineNumber, state, databaseOps) {
        if (state.acceleratorBlock) {
            this._finalizeBlock(state.acceleratorBlock, databaseOps);
        }

        state.acceleratorBlock = {
            start_line: lineNumber,
            start_byte_offset: state.currentLineByteOffset,
            start_timestamp: state.logCurrentTime,
            requested_assets: [],
            downloaded_assets: [],
            last_timestamp: state.logCurrentTime
        };
        return true;
    }

    _handleBlockContent(contentLine, state) {
        const { acceleratorBlock } = state;
        if (!acceleratorBlock) return false;

        acceleratorBlock.last_timestamp = state.logCurrentTime;

        if (contentLine.startsWith('\t')) {
            return this._handleRequestedAsset(contentLine, acceleratorBlock);
        }

        if (contentLine.includes('Artifact') && contentLine.includes('downloaded for')) {
            return this._handleDownloadedAsset(contentLine, acceleratorBlock);
        }

        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ASSET TRACKING
    // ─────────────────────────────────────────────────────────────────────────

    _handleRequestedAsset(contentLine, acceleratorBlock) {
        const parts = contentLine.trim().split(':');
        if (parts.length < 2) return true;

        const path = parts.slice(1).join(':');
        acceleratorBlock.requested_assets.push(path);
        
        return true;
    }

    _handleDownloadedAsset(contentLine, acceleratorBlock) {
        const match = contentLine.match(LogPatterns.AcceleratorDownloaded);
        if (!match) return true;

        const path = match[2];
        if (!acceleratorBlock.downloaded_assets.includes(path)) {
            acceleratorBlock.downloaded_assets.push(path);
        }
        
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BLOCK FINALIZATION
    // ─────────────────────────────────────────────────────────────────────────

    _finalizeBlock(acceleratorBlock, databaseOps) {
        if (!acceleratorBlock) return;

        const endTimestamp = acceleratorBlock.last_timestamp || acceleratorBlock.start_timestamp;
        const { timeSeconds, timeMs } = calculateWallTime(
            acceleratorBlock.start_timestamp, 
            endTimestamp, 
            0
        );

        databaseOps.addAcceleratorBlock({
            line_number: acceleratorBlock.start_line,
            byte_offset: acceleratorBlock.start_byte_offset,
            start_timestamp: acceleratorBlock.start_timestamp,
            end_timestamp: endTimestamp,
            duration_seconds: timeSeconds,
            duration_ms: timeMs,
            num_assets_requested: acceleratorBlock.requested_assets.length,
            num_assets_downloaded: acceleratorBlock.downloaded_assets.length,
            downloaded_assets: acceleratorBlock.downloaded_assets
        });
    }
}
