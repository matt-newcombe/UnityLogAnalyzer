/**
 * Line Processor
 * Unified line processing for live monitoring
 * Uses UnityLogParser for actual parsing
 */

export class LineProcessor {
    /**
     * Process a batch of new lines
     * @param {string[]} newLines - Array of lines to process
     * @param {number} startLineNumber - Starting line number
     * @param {number} logId - Log ID
     * @param {UnityLogDatabase} db - Database instance
     * @param {Object} parserState - Parser state object
     * @returns {Promise<number>} Number of lines processed
     */
    async processNewLines(newLines, startLineNumber, logId, db, parserState) {
        const parser = new UnityLogParser(db);

        // Detect timestamps if not already set
        if (parserState.timestampsEnabled === undefined) {
            await db.open();
            const metadata = await db.getLogMetadata(logId);
            parserState.timestampsEnabled = !!(metadata && metadata.start_timestamp);
        }

        let currentLineNumber = startLineNumber + 1;
        let processedCount = 0;

        for (const line of newLines) {
            // Skip empty lines but still increment line number
            if (!line.trim() && line !== '') {
                currentLineNumber++;
                continue;
            }

            // Process this line and flush immediately for live monitoring
            await this.processLine(line, currentLineNumber, db, parserState, parser);
            await db.updateLastProcessedLine(logId, currentLineNumber);
            processedCount++;

            currentLineNumber++;
        }

        return processedCount;
    }

    /**
     * Process a single line and flush to database immediately
     * @param {string} line - Line content
     * @param {number} lineNumber - Line number
     * @param {UnityLogDatabase} db - Database instance
     * @param {Object} parserState - Parser state object
     * @param {UnityLogParser} parser - Parser instance (optional, will create if not provided)
     */
    async processLine(line, lineNumber, db, parserState, parser = null) {
        if (!parser) {
            parser = new UnityLogParser(db);
        }

        // Process line - returns dbOps with collected data
        const dbOps = parser.processLine(line, lineNumber, parserState, {
            timestampsEnabled: parserState.timestampsEnabled,
            onProgress: null,
            skipLogLineStorage: true
        });

        // Flush pending metadata update if any
        if (parserState.pendingMetadataUpdate) {
            await dbOps.updateLogMetadata(parserState.pendingMetadataUpdate);
            parserState.pendingMetadataUpdate = null;
        }

        // Flush collected data to database immediately for live monitoring
        await dbOps.flush();
    }
}
