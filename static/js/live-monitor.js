/**
 * Live Monitoring Service
 * Handles continuous parsing of updating log files using File System Access API
 */

class LiveMonitor {
    constructor() {
        this.activeMonitors = new Map(); // logId -> {fileHandle, intervalId, lastProcessedLine, parserState, lastFileSize, useFileWatcher, filePath}
        this.pollInterval = 2000; // Check every 2 seconds
        this.supportsFileSystemAccess = 'showOpenFilePicker' in window;
        this.fileWatcherPort = 8767; // Port for standalone file_watcher.py (different from start.py's 8765)
        this.fileWatcherBaseUrl = null; // Will be detected automatically
        this.fileWatcherAvailable = false;
        this.checkFileWatcherAvailability();
    }

    /**
     * Check if file watcher service is available
     * Tries integrated API first (when running via start.py), then standalone service
     * Note: For static file hosting, the local server (start.py) must be running
     */
    async checkFileWatcherAvailability() {
        // Try integrated API (same origin as main server - available when start.py is running)
        try {
            const response = await fetch('/api/file-watcher/info', {
                method: 'GET',
                signal: AbortSignal.timeout(1000) // 1 second timeout
            });
            if (response.ok) {
                this.fileWatcherAvailable = true;
                this.fileWatcherBaseUrl = ''; // Same origin
                console.log('[LiveMonitor] File watcher available via integrated API (start.py)');
                return true;
            }
        } catch (error) {
            // Integrated API not available - might be static hosting or server not running
            // Don't log this as it's expected when not using start.py
        }

        // Try standalone file watcher service (for backwards compatibility)
        try {
            const response = await fetch(`http://localhost:${this.fileWatcherPort}/api/info`, {
                method: 'GET',
                signal: AbortSignal.timeout(1000) // 1 second timeout
            });
            if (response.ok) {
                this.fileWatcherAvailable = true;
                this.fileWatcherBaseUrl = `http://localhost:${this.fileWatcherPort}`;
                console.log('[LiveMonitor] File watcher available via standalone service (port 8767)');
                return true;
            }
        } catch (error) {
            this.fileWatcherAvailable = false;
            this.fileWatcherBaseUrl = null;
            // Don't log this as it's expected when file watcher isn't running
        }
        return this.fileWatcherAvailable;
    }

    /**
     * Get the base URL for file watcher API calls
     */
    _getFileWatcherUrl(path) {
        if (this.fileWatcherBaseUrl === '') {
            // Integrated API (same origin)
            return `/api/file-watcher${path}`;
        } else if (this.fileWatcherBaseUrl) {
            // Standalone service
            return `${this.fileWatcherBaseUrl}/api${path}`;
        }
        return null;
    }

    /**
     * Start watching a file using file watcher service (for system directories)
     * If filePath is not provided, will auto-detect Unity Editor.log
     */
    async startWatchingWithFileWatcher(logId, filePath, db) {
        // Build watch URL - if no filePath, let the service auto-detect
        let watchUrl;
        if (filePath) {
            watchUrl = this._getFileWatcherUrl(`/watch?file=${encodeURIComponent(filePath)}`);
            console.log(`[LiveMonitor] Starting file watcher with path: ${filePath}`);
        } else {
            watchUrl = this._getFileWatcherUrl('/watch'); // No file param = auto-detect
            console.log(`[LiveMonitor] Starting file watcher with auto-detection`);
        }
        
        if (!watchUrl) {
            throw new Error('File watcher service not available');
        }

        console.log(`[LiveMonitor] Calling file watcher: ${watchUrl}`);
        
        try {
            const response = await fetch(watchUrl);
            const result = await response.json();
            
            console.log(`[LiveMonitor] File watcher response:`, result);
            
            if (result.error) {
                // Show user-friendly error message
                let errorMsg = result.error;
                if (result.default_path) {
                    errorMsg += `\n\nDefault location: ${result.default_path}`;
                }
                throw new Error(errorMsg);
            }

            const message = result.auto_detected 
                ? `Auto-detected and watching: ${result.file_path}`
                : result.message;
            console.log(`[LiveMonitor] File watcher service started: ${message}`);
            
            // Use the actual file path from the result (may be auto-detected)
            const actualFilePath = result.file_path || filePath;
            
            // Get last processed line from database
            await db.open();
            let metadata = await db.getLogMetadata(logId);
            let actualLogId = logId; // Track the actual logId (may change if we create new metadata)
            
            // If metadata doesn't exist, we need to create it from the file header
            if (!metadata) {
                console.log(`[LiveMonitor] No metadata found for log ${logId}, creating from file header...`);
                
                // Read first part of file to extract metadata
                const readUrl = this._getFileWatcherUrl('/read?start=0');
                if (readUrl) {
                    try {
                        const headerResponse = await fetch(readUrl);
                        const headerData = await headerResponse.json();
                        
                        if (headerData.content) {
                            // Extract metadata from header (first 100 lines)
                            const lines = headerData.content.split('\n').slice(0, 100);
                            
                            let unityVersion = null;
                            let platform = null;
                            let architecture = null;
                            let projectName = null;
                            
                            // Helper to extract filename from path
                            const getFilename = (path) => {
                                const lastSlash = path.lastIndexOf('/');
                                return lastSlash === -1 ? path : path.substring(lastSlash + 1);
                            };
                            
                            for (const line of lines) {
                                // Extract Unity version
                                if (!unityVersion) {
                                    const match = line.match(/Unity Editor version:\s+(\S+)/);
                                    if (match) unityVersion = match[1];
                                }
                                
                                // Extract platform
                                if (!platform) {
                                    if (line.includes('macOS version:')) platform = 'macOS';
                                    else if (line.includes('Windows version:')) platform = 'Windows';
                                    else if (line.includes('Linux version:')) platform = 'Linux';
                                }
                                
                                // Extract architecture
                                if (!architecture) {
                                    const match = line.match(/Architecture:\s+(\S+)/);
                                    if (match) architecture = match[1];
                                }
                                
                                // Extract project name
                                if (!projectName) {
                                    const projectPathMatch = line.match(/-projectpath\s+([^\s]+)/);
                                    if (projectPathMatch) {
                                        const projectPath = projectPathMatch[1];
                                        projectName = getFilename(projectPath.replace(/\/$/, ''));
                                    } else if (line.includes('Successfully changed project path to:')) {
                                        const pathMatch = line.match(/Successfully changed project path to:\s+([^\s]+)/);
                                        if (pathMatch) {
                                            const projectPath = pathMatch[1];
                                            projectName = getFilename(projectPath.replace(/\/$/, ''));
                                        }
                                    }
                                }
                            }
                            
                            // Create metadata
                            const newMetadata = {
                                log_file: actualFilePath.split('/').pop() || 'Editor.log',
                                unity_version: unityVersion,
                                platform: platform,
                                architecture: architecture,
                                project_name: projectName,
                                date_parsed: new Date().toISOString(),
                                total_lines: null,
                                total_parse_time_ms: null,
                                last_processed_line: 0,
                                is_live_monitoring: true,
                                file_name: actualFilePath.split('/').pop() || 'Editor.log'
                            };
                            
                            // If logId is provided, use it; otherwise let DB auto-generate
                            if (logId && logId > 0) {
                                newMetadata.id = logId;
                                await db.db.log_metadata.put(newMetadata);
                                actualLogId = logId;
                            } else {
                                actualLogId = await db.insertLogMetadata(newMetadata);
                            }
                            
                            metadata = await db.getLogMetadata(actualLogId);
                            console.log(`[LiveMonitor] Created metadata for log ${actualLogId}`);
                        }
                    } catch (error) {
                        console.warn(`[LiveMonitor] Failed to create metadata from header:`, error);
                        // Continue with default metadata
                        metadata = {
                            log_file: actualFilePath.split('/').pop() || 'Editor.log',
                            last_processed_line: 0
                        };
                    }
                }
            }
            
            const lastProcessedLine = metadata?.last_processed_line || 0;

            // Load parser state (use actualLogId)
            const workerStates = await db.loadParserState(actualLogId, 'worker_states') || {};
            const pendingImports = await db.loadParserState(actualLogId, 'pending_imports') || {};
            const domainReloadState = await db.loadParserState(actualLogId, 'domain_reload') || {
                inDomainReload: false,
                domainReloadLines: [],
                domainReloadStart: 0
            };
            const pipelineRefreshState = await db.loadParserState(actualLogId, 'pipeline_refresh') || {
                inPipelineRefresh: false,
                pipelineRefreshLines: [],
                pipelineRefreshStart: 0
            };
            const atlasImportState = await db.loadParserState(actualLogId, 'atlas_import') || {
                inAtlasImport: false,
                atlasImportState: null
            };

            // Store monitor state (use actualLogId in case it was updated)
            const monitorState = {
                logId: actualLogId,
                fileHandle: null,
                db,
                lastProcessedLine,
                lastFileSize: 0,
                parserState: {
                    workerStates,
                    pendingImports,
                    domainReloadState,
                    pipelineRefreshState,
                    atlasImportState
                },
                intervalId: null,
                isProcessing: false,
                useFileWatcher: true,
                filePath: actualFilePath
            };

            // Set live monitoring flag (use actualLogId)
            await db.setLiveMonitoring(actualLogId, true);

            // Start polling file watcher service
            monitorState.intervalId = setInterval(() => {
                this.checkFileWatcherForUpdates(monitorState);
            }, this.pollInterval);

            // Monitor state already stored above with actualLogId

            console.log(`[LiveMonitor] Started monitoring log ${actualLogId} via file watcher service (File: ${actualFilePath})`);
            this.updateStatusIndicator(actualLogId, true);
            
            // If starting from the beginning (lastProcessedLine is 0), trigger initial check immediately
            // This ensures we process any existing content in the file right away
            if (lastProcessedLine === 0) {
                console.log(`[LiveMonitor] Starting from beginning - triggering initial file check...`);
                // Trigger initial check after a short delay to ensure file watcher is ready
                setTimeout(() => {
                    this.checkFileWatcherForUpdates(monitorState);
                }, 500);
            }
            
            // Store monitor with actualLogId
            this.activeMonitors.set(actualLogId, monitorState);
            
            // Return the actual file path that's being watched (useful if auto-detected)
            return actualFilePath;
        } catch (error) {
            throw new Error(`Failed to start file watcher service: ${error.message}`);
        }
    }

    /**
     * Start monitoring a log file using File System Access API
     * @param {number} logId - Log ID to monitor
     * @param {FileSystemFileHandle} fileHandle - File handle from File System Access API
     * @param {UnityLogDatabase} db - Database instance
     */
    async startMonitoring(logId, fileHandle, db) {
        // Stop any existing monitor for this log
        await this.stopMonitoring(logId);

        if (!this.supportsFileSystemAccess) {
            throw new Error('File System Access API not supported in this browser. Please use Chrome/Edge or manually refresh.');
        }

        // Get last processed line from database
        await db.open();
        const metadata = await db.getLogMetadata(logId);
        const lastProcessedLine = metadata?.last_processed_line || 0;

        // Load parser state
        const workerStates = await db.loadParserState(logId, 'worker_states') || {};
        const pendingImports = await db.loadParserState(logId, 'pending_imports') || {};
        const domainReloadState = await db.loadParserState(logId, 'domain_reload') || {
            inDomainReload: false,
            domainReloadLines: [],
            domainReloadStart: 0
        };
        const pipelineRefreshState = await db.loadParserState(logId, 'pipeline_refresh') || {
            inPipelineRefresh: false,
            pipelineRefreshLines: [],
            pipelineRefreshStart: 0
        };

        // Get initial file size
        const file = await fileHandle.getFile();
        const lastFileSize = file.size;

        // Store monitor state
        const monitorState = {
            logId,
            fileHandle,
            db,
            lastProcessedLine,
            lastFileSize,
            parserState: {
                workerStates,
                pendingImports,
                domainReloadState,
                pipelineRefreshState
            },
            intervalId: null,
            isProcessing: false
        };

        // Set live monitoring flag
        await db.setLiveMonitoring(logId, true);

        // Start polling
        monitorState.intervalId = setInterval(() => {
            this.checkForUpdates(monitorState);
        }, this.pollInterval);

        this.activeMonitors.set(logId, monitorState);

        console.log(`[LiveMonitor] Started monitoring log ${logId} (File: ${file.name})`);
        this.updateStatusIndicator(logId, true);
    }

    /**
     * Check file watcher service for updates
     */
    async checkFileWatcherForUpdates(monitorState) {
        const { logId, db, lastProcessedLine, parserState, isProcessing, filePath, lastFileSize } = monitorState;

        // Skip if already processing
        if (isProcessing) {
            return;
        }

        try {
            // Check file info first
            const infoUrl = this._getFileWatcherUrl('/info');
            if (!infoUrl) {
                throw new Error('File watcher service not available');
            }

            const infoResponse = await fetch(infoUrl);
            const infoData = await infoResponse.json();
            
            if (infoData.error) {
                console.error(`[LiveMonitor] File watcher error: ${infoData.error}`);
                return;
            }

            const fileInfo = infoData.file_info;
            const currentFileSize = fileInfo.size || 0;
            
            // Check if file was reset (Unity reopened)
            if (currentFileSize < lastFileSize) {
                console.log(`[LiveMonitor] ⚠️  File reset detected! File size decreased from ${lastFileSize} to ${currentFileSize} bytes (log ${logId})`);
                console.log(`[LiveMonitor] Unity Editor was reopened - clearing database and starting fresh...`);
                
                // Clear database and dashboard
                await this.handleFileReset(logId, filePath);
                return;
            }
            
            // Check if file has grown OR if we're starting from the beginning and there's content
            const shouldProcess = currentFileSize > lastFileSize || (lastProcessedLine === 0 && currentFileSize > 0);
            
            if (shouldProcess) {
                console.log(`[LiveMonitor] File size changed: ${lastFileSize} -> ${currentFileSize} bytes (log ${logId})`);
                
                monitorState.isProcessing = true;
                this.updateStatusIndicator(logId, true, 'Processing...');

                // Read the full file from the watcher (it can access system files)
                // We need the full file to process with correct line numbers
                const readUrl = this._getFileWatcherUrl('/read?start=0');
                if (!readUrl) {
                    throw new Error('File watcher service not available');
                }

                const fullReadResponse = await fetch(readUrl);
                const fullReadData = await fullReadResponse.json();
                
                if (fullReadData.error) {
                    throw new Error(fullReadData.error);
                }

                // Check if file was reset during read
                if (fullReadData.file_reset) {
                    console.log(`[LiveMonitor] ⚠️  File reset detected during read! Clearing database and starting fresh...`);
                    await this.handleFileReset(logId, filePath);
                    return;
                }

                // Create a File object from the full content
                const fullContent = fullReadData.content;
                const blob = new Blob([fullContent], { type: 'text/plain' });
                const file = new File([blob], filePath.split('/').pop() || 'log.log', { type: 'text/plain' });

                // Process new lines using incremental parser
                const parser = new UnityLogParser(db, (message) => {
                    console.log(`[LiveMonitor] ${message}`);
                });

                const result = await parser.parseLogFileIncremental(
                    file,
                    logId,
                    lastProcessedLine + 1,
                    parserState
                );

                if (result.newLines > 0) {
                    // Store new log lines
                    if (result.logLines.length > 0) {
                        await db.bulkInsertLogLines(result.logLines);
                    }

                    // Update monitor state
                    monitorState.lastProcessedLine = lastProcessedLine + result.newLines;
                    monitorState.lastFileSize = currentFileSize;
                    
                    // Update file watcher's position to the end of what we processed
                    try {
                        const updateUrl = this._getFileWatcherUrl(`/update_position?position=${fullReadData.end_position || currentFileSize}`);
                        if (updateUrl) {
                            await fetch(updateUrl);
                        }
                    } catch (e) {
                        console.warn('Failed to update file watcher position:', e);
                    }
                    
                    // Reload parser state (it was updated by the parser)
                    monitorState.parserState.workerStates = await db.loadParserState(logId, 'worker_states') || {};
                    monitorState.parserState.pendingImports = await db.loadParserState(logId, 'pending_imports') || {};
                    monitorState.parserState.domainReloadState = await db.loadParserState(logId, 'domain_reload') || {
                        inDomainReload: false,
                        domainReloadLines: [],
                        domainReloadStart: 0
                    };
                    monitorState.parserState.pipelineRefreshState = await db.loadParserState(logId, 'pipeline_refresh') || {
                        inPipelineRefresh: false,
                        pipelineRefreshLines: [],
                        pipelineRefreshStart: 0
                    };

                    // Refresh dashboard with incremental update (no chart reanimation)
                    if (typeof loadOverview === 'function') {
                        loadOverview(true); // Pass true for incremental update
                    } else if (typeof loadLogList === 'function') {
                        loadLogList();
                    } else if (window.loadLogList) {
                        window.loadLogList();
                    }

                    console.log(`[LiveMonitor] Processed ${result.newLines} new lines for log ${logId}`);
                    this.updateStatusIndicator(logId, true, `${result.newLines} new lines`);
                    
                    // Clear status message after 3 seconds
                    setTimeout(() => {
                        this.updateStatusIndicator(logId, true);
                    }, 3000);
                } else {
                    // File size changed but no new complete lines yet
                    monitorState.lastFileSize = currentFileSize;
                }

                monitorState.isProcessing = false;
            }
        } catch (error) {
            console.error(`[LiveMonitor] Error checking file watcher:`, error);
            monitorState.isProcessing = false;
            this.updateStatusIndicator(logId, true, 'Error');
        }
    }

    /**
     * Handle file reset (Unity Editor reopened)
     * Clears database and restarts monitoring from the beginning
     */
    async handleFileReset(logId, filePath) {
        console.log(`[LiveMonitor] Handling file reset for log ${logId}...`);
        
        // Stop current monitoring
        await this.stopMonitoring(logId);
        
        // Clear database and dashboard using the same logic as "Clear All"
        if (typeof performClear === 'function') {
            await performClear();
        } else if (window.performClear) {
            await window.performClear();
        } else {
            // Fallback: manually clear
            if (typeof getCurrentDatabase === 'function' && typeof createNewDatabase === 'function') {
                const currentDb = getCurrentDatabase();
                if (currentDb && currentDb.db) {
                    await currentDb.close();
                }
                
                const newDb = await createNewDatabase();
                await newDb.open();
                
                if (window.apiClient) {
                    if (window.apiClient.db) {
                        await window.apiClient.db.close().catch(() => {});
                    }
                    window.apiClient.db = newDb;
                }
            }
            
            // Clear dashboard views
            if (window.clearDashboard) {
                window.clearDashboard();
            }
        }
        
        // Show notification
        if (typeof showToast === 'function') {
            showToast('Unity Editor log reset detected. Database cleared and monitoring restarted.', 'info');
        } else if (window.showToast) {
            window.showToast('Unity Editor log reset detected. Database cleared and monitoring restarted.', 'info');
        }
        
        // Restart monitoring from the beginning
        console.log(`[LiveMonitor] Restarting monitoring from beginning of file...`);
        try {
            const newLogId = 1; // Start with log ID 1 for the fresh database
            const newDb = getCurrentDatabase();
            await newDb.open();
            
            // Start watching again (will auto-detect file path if filePath is null)
            await this.startWatchingWithFileWatcher(newLogId, filePath, newDb);
            
            console.log(`[LiveMonitor] ✓ Monitoring restarted successfully`);
        } catch (error) {
            console.error(`[LiveMonitor] Error restarting monitoring:`, error);
            if (typeof showToast === 'function') {
                showToast(`Error restarting monitoring: ${error.message}`, 'error');
            } else if (window.showToast) {
                window.showToast(`Error restarting monitoring: ${error.message}`, 'error');
            }
        }
    }

    /**
     * Check for file updates and process new lines
     */
    async checkForUpdates(monitorState) {
        const { logId, fileHandle, db, lastProcessedLine, lastFileSize, parserState, isProcessing } = monitorState;

        // Skip if already processing
        if (isProcessing) {
            return;
        }

        try {
            // Get current file
            const file = await fileHandle.getFile();
            const currentFileSize = file.size;

            // Check if file has grown
            if (currentFileSize > lastFileSize) {
                console.log(`[LiveMonitor] File size changed: ${lastFileSize} -> ${currentFileSize} bytes (log ${logId})`);
                
                monitorState.isProcessing = true;
                this.updateStatusIndicator(logId, true, 'Processing...');

                // Process new lines
                const parser = new UnityLogParser(db, (message) => {
                    console.log(`[LiveMonitor] ${message}`);
                });

                const result = await parser.parseLogFileIncremental(
                    file,
                    logId,
                    lastProcessedLine + 1,
                    parserState
                );

                if (result.newLines > 0) {
                    // Store new log lines
                    if (result.logLines.length > 0) {
                        await db.bulkInsertLogLines(result.logLines);
                    }

                    // Update monitor state
                    monitorState.lastProcessedLine = lastProcessedLine + result.newLines;
                    monitorState.lastFileSize = currentFileSize;
                    
                    // Reload parser state (it was updated by the parser)
                    monitorState.parserState.workerStates = await db.loadParserState(logId, 'worker_states') || {};
                    monitorState.parserState.pendingImports = await db.loadParserState(logId, 'pending_imports') || {};
                    monitorState.parserState.domainReloadState = await db.loadParserState(logId, 'domain_reload') || {
                        inDomainReload: false,
                        domainReloadLines: [],
                        domainReloadStart: 0
                    };
                    monitorState.parserState.pipelineRefreshState = await db.loadParserState(logId, 'pipeline_refresh') || {
                        inPipelineRefresh: false,
                        pipelineRefreshLines: [],
                        pipelineRefreshStart: 0
                    };

                    // Refresh dashboard with incremental update (no chart reanimation)
                    if (typeof loadOverview === 'function') {
                        loadOverview(true); // Pass true for incremental update
                    } else if (typeof loadLogList === 'function') {
                        loadLogList();
                    } else if (window.loadLogList) {
                        window.loadLogList();
                    }

                    console.log(`[LiveMonitor] Processed ${result.newLines} new lines for log ${logId}`);
                    this.updateStatusIndicator(logId, true, `${result.newLines} new lines`);
                    
                    // Clear status message after 3 seconds
                    setTimeout(() => {
                        this.updateStatusIndicator(logId, true);
                    }, 3000);
                } else {
                    // File size changed but no new complete lines yet
                    monitorState.lastFileSize = currentFileSize;
                }

                monitorState.isProcessing = false;
            }
        } catch (error) {
            console.error(`[LiveMonitor] Error checking for updates:`, error);
            monitorState.isProcessing = false;
            this.updateStatusIndicator(logId, true, 'Error');
        }
    }

    /**
     * Stop monitoring a log file
     */
    async stopMonitoring(logId) {
        const monitor = this.activeMonitors.get(logId);
        if (monitor) {
            if (monitor.intervalId) {
                clearInterval(monitor.intervalId);
            }
            
            // Stop file watcher service if it was being used
            if (monitor.useFileWatcher) {
                try {
                    const stopUrl = this._getFileWatcherUrl('/stop');
                    if (stopUrl) {
                        await fetch(stopUrl);
                    }
                } catch (error) {
                    console.error('Error stopping file watcher:', error);
                }
            }
            
            this.activeMonitors.delete(logId);
            
            // Update database
            if (monitor.db) {
                await monitor.db.setLiveMonitoring(logId, false);
            }
            
            this.updateStatusIndicator(logId, false);
            console.log(`[LiveMonitor] Stopped monitoring log ${logId}`);
        }
    }

    /**
     * Check if file watcher service is available
     */
    async isFileWatcherAvailable() {
        return await this.checkFileWatcherAvailability();
    }

    /**
     * Update status indicator in UI
     */
    updateStatusIndicator(logId, isMonitoring, message = null) {
        // Find or create status indicator
        let indicator = document.getElementById(`live-monitor-indicator-${logId}`);
        if (!indicator && isMonitoring) {
            // Create indicator in header
            const headerNav = document.querySelector('.header-nav');
            if (headerNav) {
                indicator = document.createElement('div');
                indicator.id = `live-monitor-indicator-${logId}`;
                indicator.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: #e8f5e9; border-radius: 4px; font-size: 0.85em; color: #2e7d32; margin-left: 10px;';
                indicator.innerHTML = '<span style="display: inline-block; width: 8px; height: 8px; background: #4CAF50; border-radius: 50%; animation: pulse 2s infinite;"></span><span class="monitor-text">Watching file...</span>';
                headerNav.appendChild(indicator);
                
                // Add pulse animation
                if (!document.getElementById('pulse-animation-style')) {
                    const style = document.createElement('style');
                    style.id = 'pulse-animation-style';
                    style.textContent = '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }';
                    document.head.appendChild(style);
                }
            }
        }
        
        if (indicator) {
            if (isMonitoring) {
                indicator.style.display = 'inline-flex';
                const textSpan = indicator.querySelector('.monitor-text');
                if (textSpan) {
                    textSpan.textContent = message || 'Watching file...';
                }
            } else {
                indicator.style.display = 'none';
            }
        }
    }

    /**
     * Get all active monitors
     */
    getActiveMonitors() {
        return Array.from(this.activeMonitors.keys());
    }

    /**
     * Stop all monitors
     */
    async stopAll() {
        const logIds = Array.from(this.activeMonitors.keys());
        for (const logId of logIds) {
            await this.stopMonitoring(logId);
        }
    }

    /**
     * Check if File System Access API is supported
     */
    isSupported() {
        return this.supportsFileSystemAccess;
    }
}

// Global instance
window.liveMonitor = new LiveMonitor();

