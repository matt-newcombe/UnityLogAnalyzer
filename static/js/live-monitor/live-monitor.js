import { LiveMonitorUI } from './ui.js';
import { LogStreamProcessor } from '../parser/log-stream-processor.js';
import { ParserState } from '../parser/parser-state.js';

/**
 * LiveMonitor
 * Handles continuous monitoring of log files via network polling
 */
export class LiveMonitor {
    constructor() {
        this.activeMonitors = new Map(); // logId -> monitorState
        this.ui = new LiveMonitorUI();
        this.pollInterval = 1000; // Poll every second
        this.fileWatcherPort = 8767;
        this.fileWatcherBaseUrl = null;
    }

    /**
     * Check if file watcher service is available
     */
    async checkAvailability() {
        // Try integrated API first
        try {
            const response = await fetch('/api/file-watcher/info', { signal: AbortSignal.timeout(1000) });
            if (response.ok) {
                this.fileWatcherBaseUrl = ''; // Same origin
                return true;
            }
        } catch (e) { /* Ignore */ }

        // Try standalone service
        try {
            const response = await fetch(`http://localhost:${this.fileWatcherPort}/api/info`, { signal: AbortSignal.timeout(3000) });
            if (response.ok) {
                this.fileWatcherBaseUrl = `http://localhost:${this.fileWatcherPort}`;
                return true;
            }
        } catch (e) {
            console.warn('[LiveMonitor] Standalone service check failed:', e);
        }

        this.fileWatcherBaseUrl = null;
        return false;
    }

    _getUrl(path) {
        if (this.fileWatcherBaseUrl === '') return `/api/file-watcher${path}`;
        if (this.fileWatcherBaseUrl) return `${this.fileWatcherBaseUrl}/api${path}`;
        return null;
    }

    /**
     * Start monitoring a log file
     * @param {number} logId 
     * @param {string} filePath - Optional, if null will auto-detect
     * @param {UnityLogDatabase} db 
     */
    async start(logId, filePath, db) {
        await this.stop(logId);

        // Ensure service is available
        if (!this.fileWatcherBaseUrl) {
            const available = await this.checkAvailability();
            if (!available) throw new Error('File watcher service not available');
        }

        // Start watching via API
        const watchUrl = this._getUrl(filePath ? `/watch?file=${encodeURIComponent(filePath)}` : '/watch');
        const response = await fetch(watchUrl);
        const result = await response.json();

        if (result.error) throw new Error(result.error);

        const actualFilePath = result.file_path;

        // Initialize state
        await db.open();
        const metadata = await db.getLogMetadata(logId);
        const lastProcessedLine = metadata?.last_processed_line || 0;

        // We need to know the byte offset corresponding to the last processed line
        // Since we don't store byte offsets in DB, we might need to read from 0 if we want to be perfect,
        // or we can just assume we start from the end if it's a new session, or rely on the server's "last_position"
        // But the server's last_position is transient too.
        // Strategy: 
        // 1. If we have processed lines, we ideally want to continue from where we left off.
        //    But mapping line number to byte offset is hard without re-reading.
        // 2. For "Live" monitoring, it's often acceptable to start from the CURRENT end of file (tail),
        //    OR we can ask the server for the current size and start there.
        //    However, if we want to catch up on missed lines, we'd need to read from 0 and fast-forward.
        //    Given the constraints and the "Live" nature, let's start from the server's current position (tail) 
        //    unless we are explicitly told otherwise. 
        //    Actually, the user said "resume from the end... is usually acceptable".
        //    BUT, if we just refreshed the page, we might want to see what happened.
        //    Let's stick to: Start from current server position (tail) to avoid re-parsing huge files.

        // Get current file info from server to know where to start
        const infoUrl = this._getUrl('/info');
        const infoResponse = await fetch(infoUrl);
        const infoResult = await infoResponse.json();
        let currentByteOffset = infoResult.file_info?.size || 0;

        // If we have 0 processed lines, we might want to read from 0? 
        // If it's a new log, read from 0. If it's existing, maybe tail.
        // For simplicity and "Live" focus: Start from current size (tail).
        // If the user wants to re-parse, they can use "Reset" or "Import".
        if (lastProcessedLine === 0) {
            currentByteOffset = 0;
        }

        const monitorState = {
            logId,
            filePath: actualFilePath,
            db,
            parserState: new ParserState(),
            processor: new LogStreamProcessor(),
            lastProcessedLine,
            currentByteOffset,
            isProcessing: false,
            intervalId: null,
            timestampsEnabled: undefined
        };

        // Set live flag
        await db.setLiveMonitoring(logId, true);
        this.ui.updateStatus(logId, true, `Watching: ${result.auto_detected ? 'Auto-detected' : ''} ${actualFilePath}`);

        // Start polling
        monitorState.intervalId = setInterval(() => this._poll(monitorState), this.pollInterval);
        this.activeMonitors.set(logId, monitorState);

        // Trigger immediate poll to start processing right away (especially important for initial file read)
        this._poll(monitorState);

        return actualFilePath;
    }

    /**
     * Stop monitoring
     */
    async stop(logId) {
        const monitor = this.activeMonitors.get(logId);
        if (monitor) {
            clearInterval(monitor.intervalId);
            this.activeMonitors.delete(logId);
            await monitor.db.setLiveMonitoring(logId, false);
            this.ui.updateStatus(logId, false);

            // Stop server watcher too
            try {
                await fetch(this._getUrl('/stop'));
            } catch (e) { /* Ignore */ }
        }
    }

    /**
     * Polling loop
     */
    async _poll(monitorState) {
        if (monitorState.isProcessing) return;
        monitorState.isProcessing = true;

        try {
            const { logId, currentByteOffset, processor, parserState, db } = monitorState;

            // Fetch new content starting from last known byte offset
            const readUrl = this._getUrl(`/read?start=${currentByteOffset}`);
            const response = await fetch(readUrl);
            const result = await response.json();

            if (result.error) {
                console.error('[LiveMonitor] Poll error:', result.error);
                return;
            }

            if (result.file_reset) {
                // File was reset (e.g. Unity restarted)
                console.log('[LiveMonitor] File reset detected - resetting state and processing new content');
                // Reset state first
                monitorState.currentByteOffset = 0;
                monitorState.lastProcessedLine = 0;
                monitorState.parserState = new ParserState();
                monitorState.processor.reset();
                
                // The server has already read from position 0, so process that content now
                // Don't return early - continue to process the content below
            }

            const content = result.content;
            if (!content || content.length === 0) {
                monitorState.isProcessing = false;
                return;
            }

            // Convert to Uint8Array for processor (ensures byte consistency)
            const encoder = new TextEncoder();
            const chunk = encoder.encode(content);

            // Process chunk
            // Note: We use the *server's* start position as our base for this chunk
            // This ensures we stay in sync even if we missed something or logic differs slightly
            const chunkStartOffset = result.start_position;

            // Use UnityLogParser logic (we need an instance or just use the processor directly?)
            // We need UnityLogParser to handle the *semantics* (handlers), 
            // while LogStreamProcessor handles the *splitting*.
            // We can instantiate a transient UnityLogParser or keep one. 
            // Since UnityLogParser is stateful (handlers might be), we should probably keep one?
            // But the plan said "ParserState instance in memory".
            // UnityLogParser takes `db`.

            if (!monitorState.parser) {
                // Dynamically import or assume global? 
                // The plan assumes we are in the same context.
                // We'll assume UnityLogParser is available globally or imported.
                // Since we are in a module, we should import it.
                // But UnityLogParser is a default export or named? 
                // In log-parser.js it is `export default` or `module.exports`.
                // Let's assume we can import it.
            }

            // We need to import UnityLogParser. I'll add it to imports.

            let linesProcessed = 0;

            // Process lines
            await processor.processChunk(chunk, chunkStartOffset, async (line, lineStartByteOffset) => {
                monitorState.lastProcessedLine++;
                linesProcessed++;

                // Process with parser
                // We use a simplified processLine call
                // We need to ensure we have a parser instance
                if (!monitorState.unityParser) {
                    // Lazy init
                    const { UnityLogParser } = await import('../log-parser.js');
                    monitorState.unityParser = new UnityLogParser(db);
                }

                await monitorState.unityParser.processLine(
                    line,
                    monitorState.lastProcessedLine,
                    logId,
                    parserState,
                    {
                        timestampsEnabled: monitorState.timestampsEnabled,
                        updateMetadata: true,
                        skipLogLineStorage: true,
                        byteOffset: lineStartByteOffset,
                        // We use a transient dbOps for immediate writes
                        // UnityLogParser creates one if not provided
                    }
                );

                // Update UI for last message
                this.ui.updateLastMessage(logId, parserState.lastTimestamp, line);
            });

            // Update state
            monitorState.currentByteOffset = result.end_position;

            // Update UI status
            if (linesProcessed > 0) {
                this.ui.updateStatus(logId, true, `Processed ${linesProcessed} new lines`);
                this.ui.scheduleUpdate(async () => {
                    // Trigger dashboard refresh with incremental updates (disables animations)
                    if (window.loadOverview) window.loadOverview(true);
                });
            }

        } catch (e) {
            console.error('[LiveMonitor] Error processing:', e);
            this.ui.updateStatus(monitorState.logId, true, 'Error processing updates');
        } finally {
            monitorState.isProcessing = false;
        }
    }

    // Compatibility methods for index.html
    getActiveMonitors() {
        return Array.from(this.activeMonitors.keys());
    }

    async isFileWatcherAvailable() {
        return this.checkAvailability();
    }

    _getFileWatcherUrl(path) {
        return this._getUrl(path);
    }

    async startWatchingWithFileWatcher(logId, filePath, db) {
        return this.start(logId, filePath, db);
    }

    async stopMonitoring(logId) {
        return this.stop(logId);
    }
}
