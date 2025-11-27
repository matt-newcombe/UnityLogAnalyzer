/**
 * Log Lines Query
 * Handles reading log lines directly from file using line index
 */

// Code version patch number - increment when making changes to byte offset calculation or log viewing logic
const LOG_VIEWER_VERSION_PATCH = 3;

class LogLinesQuery {
    constructor(db, logId) {
        this.db = db;
        this.logId = logId;
    }

    /**
     * Query log lines with various options
     * Now reads directly from file blob using line index
     */
    async query(options = {}) {
        const {
            center_line,
            offset = 0,
            limit = 100,
            search_query,
            filter_type
        } = options;

        // Get metadata to get total lines
        await this.db.open();
        const metadata = await this.db.log_metadata.get(this.logId);
        if (!metadata) {
            throw new Error(`Log metadata not found for ID: ${this.logId}`);
        }

        const totalLines = metadata.total_lines || 0;
        const isLiveMonitoring = metadata.is_live_monitoring || false;
        
        // For live monitoring, read from file watcher service instead of memory cache
        if (isLiveMonitoring && window.liveMonitor) {
            return await this._queryFromFileWatcher(options, totalLines);
        }
        
        // Get file from memory cache
        if (!window.logFileCache) {
            window.logFileCache = new Map();
        }
        const file = window.logFileCache.get(this.logId);
        
        if (!file) {
            throw new Error(`File not found in memory cache for ID: ${this.logId}. Please re-upload the log file.`);
        }
        
        // Verify file object is a File (not a Blob) to ensure byte positions are preserved
        if (!(file instanceof File)) {
            console.warn(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] WARNING: Retrieved file is not a File instance, byte offsets may be incorrect! Type: ${file.constructor.name}`);
        }

        // For center_line queries, read 50 lines before and after
        if (center_line !== null && center_line !== undefined) {
            try {
                return await this._queryByCenterLine(center_line, totalLines, file);
            } catch (error) {
                console.error('[LogLinesQuery] Error in _queryByCenterLine:', error);
                throw error;
            }
        }

        // For paginated view, read lines from offset
        if (!search_query && !filter_type) {
            try {
                return await this._queryPaginated(offset, limit, totalLines, file);
            } catch (error) {
                console.error('[LogLinesQuery] Error in _queryPaginated:', error);
                throw error;
            }
        }

        // Search and filter not implemented for file-based reading
        console.warn('[LogLinesQuery] Search and filter not implemented for file-based reading');
        return {
            lines: [],
            total_lines: totalLines,
            offset: offset,
            limit: limit,
            has_more: false,
            message: 'Search and filter not yet implemented for file-based reading'
        };
    }

    /**
     * Query by center line (for log viewer navigation)
     * Reads 50 lines before and after the center line from the file
     * Now uses byte_offset from asset_imports/operations instead of line_index
     */
    async _queryByCenterLine(center_line, totalLines, file) {
        console.log(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] _queryByCenterLine called with center_line=${center_line}, totalLines=${totalLines}`);
        
        const contextSize = 50; // Load 50 lines before and after
        
        // Clamp center_line to valid range
        let clampedCenterLine = Math.max(1, Math.min(center_line, totalLines));
        
        // If the requested line is beyond total, adjust to show the end
        if (center_line > totalLines && totalLines > 0) {
            console.warn(`[Database] Requested line ${center_line} exceeds total lines ${totalLines}, clamping to ${totalLines}`);
            clampedCenterLine = totalLines;
        }
        
        const start = Math.max(1, clampedCenterLine - contextSize);
        const end = Math.min(totalLines, clampedCenterLine + contextSize);
        
        // Try to find byte_offset from asset_imports or operations for the center line
        await this.db.open();
        let centerByteOffset = null;
        let sourceType = null; // Track where the byte_offset came from for debugging
        
        // Check asset_imports first
        const assetImport = await this.db.asset_imports
            .filter(ai => ai.line_number === center_line)
            .first();
        
        if (assetImport && assetImport.byte_offset !== null && assetImport.byte_offset !== undefined) {
            centerByteOffset = assetImport.byte_offset;
            sourceType = 'asset_import';
            console.log(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] Found byte_offset ${centerByteOffset} from asset_import for line ${center_line}`);
        } else {
            // Check processes
            const operation = await this.db.processes
                .filter(op => op.line_number === center_line)
                .first();
            
            if (operation && operation.byte_offset !== null && operation.byte_offset !== undefined) {
                centerByteOffset = operation.byte_offset;
                sourceType = 'process';
                console.log(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] Found byte_offset ${centerByteOffset} from process for line ${center_line}`);
            } else {
                // Check cache_server_download_blocks
                const cacheBlock = await this.db.cache_server_download_blocks
                    .filter(block => block.line_number === center_line)
                    .first();
                
                if (cacheBlock && cacheBlock.byte_offset !== null && cacheBlock.byte_offset !== undefined) {
                    centerByteOffset = cacheBlock.byte_offset;
                    sourceType = 'cache_server_block';
                    console.log(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] Found byte_offset ${centerByteOffset} from cache_server_block for line ${center_line}`);
                }
            }
        }
        
        if (centerByteOffset === null) {
            // Fallback: estimate byte offset based on line number (rough approximation)
            // For ASCII files, average ~80 bytes per line
            centerByteOffset = center_line * 80;
            sourceType = 'estimated';
            console.log(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] No byte_offset found in database, using estimated ${centerByteOffset} for line ${center_line}`);
        }
        
        // Count newlines from start of file to centerByteOffset to find exact line number
        const bytesPerLine = 200; // Conservative estimate for reading chunk size
        const readBeforeBytes = Math.max(0, centerByteOffset - (contextSize * bytesPerLine * 3)); // Read plenty before
        const readAfterBytes = centerByteOffset + (contextSize * bytesPerLine * 3) + 20480; // 20KB buffer after
        
        // Read from start of file to centerByteOffset to count newlines accurately
        // This tells us the exact line number at centerByteOffset
        const beforeSlice = file.slice(0, centerByteOffset);
        const beforeArrayBuffer = await beforeSlice.arrayBuffer();
        const decoder = new TextDecoder('utf-8');
        const beforeText = decoder.decode(beforeArrayBuffer);
        
        // Count newlines from start of file to centerByteOffset
        // This gives us the line number (1-based) that starts at centerByteOffset
        const newlinesCount = (beforeText.match(/\r?\n/g) || []).length;
        const actualLineNumber = newlinesCount + 1; // +1 because line numbers are 1-based
        
        // Verify: actualLineNumber should equal center_line (from asset_import)
        if (actualLineNumber !== center_line) {
            console.error(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] CRITICAL: Byte offset ${centerByteOffset} points to line ${actualLineNumber}, but ${sourceType} says ${center_line}. This indicates the byte offset was stored incorrectly during parsing.`);
            console.error(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] The byte offset calculation during parsing may be wrong. Using actual line number ${actualLineNumber} instead of ${center_line}.`);
            console.error(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] Source: ${sourceType}, centerByteOffset: ${centerByteOffset}`);
            // Use the actual line number from byte offset - it's more accurate
            // Update center_line to match what the byte offset actually points to
            const correctedCenterLine = actualLineNumber;
            // Use actualLineNumber for targetLineIndex calculation since byte offset is authoritative
        }
        
        // Now read the chunk for display (around centerByteOffset)
        const displaySlice = file.slice(readBeforeBytes, readAfterBytes);
        const displayArrayBuffer = await displaySlice.arrayBuffer();
        const displayText = decoder.decode(displayArrayBuffer);
        const allLines = displayText.split(/\r?\n/);
        
        // Count newlines from start of file to readBeforeBytes to find what line number the chunk starts at
        const beforeDisplaySlice = file.slice(0, readBeforeBytes);
        const beforeDisplayArrayBuffer = await beforeDisplaySlice.arrayBuffer();
        const beforeDisplayText = decoder.decode(beforeDisplayArrayBuffer);
        const newlinesBeforeDisplay = (beforeDisplayText.match(/\r?\n/g) || []).length;
        const chunkStartLineNumber = newlinesBeforeDisplay + 1; // +1 because line numbers are 1-based
        
        // The line at centerByteOffset should be at index in allLines
        // Use actualLineNumber (from byte offset) as it's more accurate than center_line (from database)
        let targetLineIndex = actualLineNumber - chunkStartLineNumber;
        
        // If there's a mismatch, log it but use the actual line number
        if (actualLineNumber !== center_line) {
            console.warn(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] Using line ${actualLineNumber} (from byte offset) instead of ${center_line} (from database)`);
        }
        
        // Clamp targetLineIndex to valid range
        if (targetLineIndex < 0) {
            console.warn(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] targetLineIndex ${targetLineIndex} < 0, adjusting to 0`);
            targetLineIndex = 0;
        }
        if (targetLineIndex >= allLines.length) {
            console.warn(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] targetLineIndex ${targetLineIndex} >= allLines.length ${allLines.length}, adjusting`);
            targetLineIndex = Math.min(targetLineIndex, allLines.length - 1);
        }
        
        // Extract contextSize lines before and after targetLineIndex
        const lines = [];
        const startIndex = Math.max(0, targetLineIndex - contextSize);
        const endIndex = Math.min(allLines.length, targetLineIndex + contextSize + 1);
        
        // Calculate the starting line number for display
        // targetLineIndex in allLines corresponds to actualLineNumber (from byte offset)
        // So: displayStartingLineNumber = actualLineNumber - (targetLineIndex - startIndex)
        const displayStartingLineNumber = actualLineNumber - (targetLineIndex - startIndex);
        
        // Verify: line at targetLineIndex should be actualLineNumber
        const verifyLineNumber = displayStartingLineNumber + (targetLineIndex - startIndex);
        if (verifyLineNumber !== actualLineNumber) {
            console.warn(`[LogViewer v${LOG_VIEWER_VERSION_PATCH}] Line number mismatch: expected ${actualLineNumber}, calculated ${verifyLineNumber}`);
        }
        
        // Update center_line to actualLineNumber for display consistency
        const displayCenterLine = actualLineNumber;
        
        let currentLineNumber = displayStartingLineNumber;
        
        for (let i = startIndex; i < endIndex; i++) {
            if (i < allLines.length) {
                const lineContent = allLines[i];
                const parsedLine = this._parseLine(lineContent, currentLineNumber);
                
                lines.push({
                    line_number: currentLineNumber,
                    content: lineContent,
                    line_type: parsedLine.lineType,
                    timestamp: parsedLine.timestamp
                });
                currentLineNumber++;
            }
        }
        
        return {
            lines: lines,
            total_lines: totalLines,
            center_line: displayCenterLine, // Use actual line number from byte offset
            requested_line: center_line, // Keep original request for reference
            range_start: Math.max(1, displayStartingLineNumber),
            range_end: Math.min(totalLines, currentLineNumber - 1)
        };
    }

    /**
     * Query with pagination
     * Reads lines directly from file by estimating byte positions
     */
    async _queryPaginated(offset, limit, totalLines, file) {
        const startLine = offset + 1; // Line numbers are 1-based
        const endLine = Math.min(offset + limit, totalLines);
        
        // Estimate byte positions based on average line length
        // For most log files, average line is around 100-200 bytes
        const avgBytesPerLine = 150;
        const estimatedStartByte = (startLine - 1) * avgBytesPerLine;
        const estimatedEndByte = endLine * avgBytesPerLine + 10240; // Add buffer
        
        // Read a chunk from the file
        const fileSlice = file.slice(Math.max(0, estimatedStartByte), Math.min(file.size, estimatedEndByte));
        const arrayBuffer = await fileSlice.arrayBuffer();
        const decoder = new TextDecoder('utf-8');
        const fileText = decoder.decode(arrayBuffer);
        
        // Count newlines from start of file to estimatedStartByte to find actual starting line
        const beforeSlice = file.slice(0, Math.max(0, estimatedStartByte));
        const beforeArrayBuffer = await beforeSlice.arrayBuffer();
        const beforeText = decoder.decode(beforeArrayBuffer);
        const newlinesBeforeStart = (beforeText.match(/\r?\n/g) || []).length;
        const actualStartLine = newlinesBeforeStart + 1;
        
        // Split into lines
        const allLines = fileText.split(/\r?\n/);
        
        // Calculate which lines in allLines correspond to our requested range
        const lines = [];
        const startIndex = Math.max(0, startLine - actualStartLine);
        const endIndex = Math.min(allLines.length, endLine - actualStartLine + 1);
        
        let currentLineNumber = actualStartLine + startIndex;
        
        for (let i = startIndex; i < endIndex && currentLineNumber <= endLine; i++) {
            if (i < allLines.length) {
                const lineContent = allLines[i];
                const parsedLine = this._parseLine(lineContent, currentLineNumber);
                
                lines.push({
                    line_number: currentLineNumber,
                    content: lineContent,
                    line_type: parsedLine.lineType,
                    timestamp: parsedLine.timestamp
                });
                currentLineNumber++;
            }
        }
        
        return {
            lines: lines,
            total_lines: totalLines,
            offset: offset,
            limit: limit,
            has_more: offset + limit < totalLines
        };
    }

    /**
     * Parse a line to extract timestamp and classify line type
     */
    _parseLine(line, lineNumber) {
        // Detect timestamp prefix (ISO format: 2025-11-19T16:29:40.500Z|...)
        let timestamp = null;
        let contentLine = line;
        
        const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|/);
        if (timestampMatch) {
            timestamp = timestampMatch[1];
            contentLine = line.substring(timestampMatch[0].length);
        }
        
        // Classify line type
        let lineType = 'normal';
        
        if (contentLine.includes('Start importing') || contentLine.includes('importing') && contentLine.includes('seconds')) {
            lineType = 'import';
        } else if (contentLine.includes('Refresh:') || contentLine.includes('AssetDatabase.Refresh')) {
            lineType = 'pipeline';
        }
        
        return {
            timestamp,
            lineType
        };
    }

    /**
     * Query log lines from file watcher service (for live monitoring)
     */
    async _queryFromFileWatcher(options, totalLines) {
        const {
            center_line,
            offset = 0,
            limit = 100
        } = options;

        if (!window.liveMonitor) {
            throw new Error('Live monitor not available');
        }

        const readUrl = window.liveMonitor._getFileWatcherUrl('/read?start=0');
        if (!readUrl) {
            throw new Error('File watcher service not available');
        }

        try {
            const response = await fetch(readUrl);
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }

            if (!data.content) {
                throw new Error('No file content received from file watcher');
            }

            // Parse the file content
            const allLines = data.content.split(/\r?\n/);
            const actualTotalLines = allLines.length;

            // For center_line queries, return context around the line
            if (center_line !== null && center_line !== undefined) {
                const contextSize = 50;
                const start = Math.max(0, center_line - contextSize - 1);
                const end = Math.min(allLines.length, center_line + contextSize);
                
                const lines = [];
                for (let i = start; i < end; i++) {
                    const lineContent = allLines[i];
                    const parsedLine = this._parseLine(lineContent, i + 1);
                    lines.push({
                        line_number: i + 1,
                        content: lineContent,
                        line_type: parsedLine.lineType,
                        timestamp: parsedLine.timestamp
                    });
                }

                return {
                    lines: lines,
                    total_lines: actualTotalLines,
                    center_line: center_line,
                    range_start: start + 1,
                    range_end: end
                };
            }

            // For paginated view
            const start = offset;
            const end = Math.min(offset + limit, allLines.length);
            const lines = [];
            
            for (let i = start; i < end; i++) {
                const lineContent = allLines[i];
                const parsedLine = this._parseLine(lineContent, i + 1);
                lines.push({
                    line_number: i + 1,
                    content: lineContent,
                    line_type: parsedLine.lineType,
                    timestamp: parsedLine.timestamp
                });
            }

            return {
                lines: lines,
                total_lines: actualTotalLines,
                offset: offset,
                limit: limit,
                has_more: end < allLines.length
            };
        } catch (error) {
            console.error('[LogLinesQuery] Error reading from file watcher:', error);
            throw new Error(`Failed to read log file from file watcher: ${error.message}`);
        }
    }
}

// Export for use in other modules
window.LogLinesQuery = LogLinesQuery;
