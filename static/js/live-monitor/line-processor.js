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

            // Process this line
            await this.processLine(line, currentLineNumber, logId, db, parserState, parser);
            await db.updateLastProcessedLine(logId, currentLineNumber);
            processedCount++;

            currentLineNumber++;
        }

        return processedCount;
    }

    /**
     * Process a single line
     * @param {string} line - Line content
     * @param {number} lineNumber - Line number
     * @param {number} logId - Log ID
     * @param {UnityLogDatabase} db - Database instance
     * @param {Object} parserState - Parser state object
     * @param {UnityLogParser} parser - Parser instance (optional, will create if not provided)
     */
    async processLine(line, lineNumber, logId, db, parserState, parser = null) {
        if (!parser) {
            parser = new UnityLogParser(db);
        }

        await parser.processLine(line, lineNumber, logId, parserState, {
            timestampsEnabled: parserState.timestampsEnabled,
            onProgress: null,
            updateMetadata: true, // Metadata timestamp updates handled by log_parser
            skipLogLineStorage: true // Don't store log lines - use file-based reading
        });
    }
}

