/**
 * Dashboard Module
 * Handles dashboard state, initialization, and core UI operations
 */

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clear all dashboard content to prevent showing stale data
 */
function clearDashboard() {
    // Clear stats
    const statsDiv = document.getElementById('stats');
    if (statsDiv) {
        statsDiv.innerHTML = '';
        statsDiv.style.display = 'none';
    }
    
    // Clear charts and destroy Chart.js instances
    const chartsDiv = document.getElementById('charts');
    if (chartsDiv) {
        // Destroy all Chart.js instances to prevent memory leaks
        Chart.getChart('categoryChart')?.destroy();
        Chart.getChart('typeTimeChart')?.destroy();
        Chart.getChart('foldersChart')?.destroy();
        Chart.getChart('importerChart')?.destroy();
        
        // Destroy stdDevChartInstance if it exists (from histogram view)
        if (window.stdDevChartInstance) {
            try {
                window.stdDevChartInstance.destroy();
                window.stdDevChartInstance = null;
            } catch (e) {
                console.warn('Error destroying stdDevChartInstance:', e);
            }
        }
        
        chartsDiv.innerHTML = '';
        chartsDiv.style.display = 'none';
    }
    
    // Clear tables (this includes detail views)
    const tablesDiv = document.getElementById('tables');
    if (tablesDiv) {
        tablesDiv.innerHTML = '';
    }
    
    // Clear timeline container
    const timelineContainer = document.getElementById('timeline-container');
    if (timelineContainer) {
        timelineContainer.innerHTML = '';
    }
    
    // Reset dashboard state
    if (typeof resetState === 'function') {
        resetState();
    }
    
    // Reset project name and unity version
    updateProjectName('');
    updateUnityVersion('');
    
    // Hide Slack button
    const slackButtonContainer = document.getElementById('slack-button-container');
    if (slackButtonContainer) {
        slackButtonContainer.style.display = 'none';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER UPDATES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update project name display in header
 */
function updateProjectName(projectName) {
    const projectNameEl = document.getElementById('project-name');
    if (projectNameEl && projectName) {
        projectNameEl.textContent = `- ${projectName}`;
    } else if (projectNameEl) {
        projectNameEl.textContent = '';
    }
}

/**
 * Update Unity version display in header
 */
function updateUnityVersion(unityVersion) {
    const unityVersionEl = document.getElementById('unity-version');
    if (unityVersionEl && unityVersion && unityVersion !== 'Unknown') {
        unityVersionEl.textContent = `(${unityVersion})`;
    } else if (unityVersionEl) {
        unityVersionEl.textContent = '';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clear dashboard and database - creates fresh database
 */
async function clearDashboardAndDatabase() {
    try {
        // Stop any active monitoring
        if (window.liveMonitor) {
            const activeMonitors = window.liveMonitor.getActiveMonitors();
            for (const logId of activeMonitors) {
                await window.liveMonitor.stopMonitoring(logId);
            }
        }

        // Close current database
        const currentDb = await getCurrentDatabase();
        if (currentDb && currentDb.db) {
            await currentDb.close();
        }

        // Create new database
        const newDb = await createNewDatabase();
        await newDb.open();

        // Update API client
        if (window.apiClient) {
            if (window.apiClient.db) {
                await window.apiClient.db.close().catch(() => {});
            }
            window.apiClient.db = newDb;
        }

        // Clear dashboard
        clearDashboard();

        // Refresh
        if (typeof loadLogList === 'function') {
            loadLogList();
        }

        showToast('Database cleared successfully', 'success');
    } catch (error) {
        console.error('Error clearing database:', error);
        showToast('Error clearing database: ' + error.message, 'error');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE MONITORING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update watch button state based on monitoring status
 */
function updateWatchButtonState() {
    const watchBtn = document.getElementById('watch-editor-log-btn');
    const monitoringStatus = document.getElementById('monitoring-status');
    const monitoringPathText = document.getElementById('monitoring-path-text');

    if (!watchBtn) return;

    if (window.liveMonitor) {
        const activeMonitors = window.liveMonitor.getActiveMonitors();
        if (activeMonitors.length > 0) {
            // Active monitoring - change button to "Stop Watching"
            watchBtn.classList.remove('action-btn-secondary');
            watchBtn.classList.add('action-btn-danger');
            watchBtn.innerHTML = '⏹️ Stop Watching';
            watchBtn.onclick = toggleWatchEditorLog;

            // Show monitoring status with file path
            if (monitoringStatus) {
                const firstLogId = activeMonitors[0];
                const monitor = window.liveMonitor.activeMonitors.get(firstLogId);
                if (monitor && monitor.filePath) {
                    monitoringPathText.textContent = monitor.filePath;
                    monitoringStatus.style.display = 'flex';
                } else {
                    monitoringStatus.style.display = 'none';
                }
            }
        } else {
            // No active monitoring - change button to "Watch Editor Log"
            watchBtn.classList.remove('action-btn-danger');
            watchBtn.classList.add('action-btn-secondary');
            watchBtn.innerHTML = '👁️ Watch Editor Log';
            watchBtn.onclick = toggleWatchEditorLog;

            // Hide monitoring status
            if (monitoringStatus) {
                monitoringStatus.style.display = 'none';
            }
        }
    }
}

/**
 * Toggle Watch Editor Log - start or stop live monitoring
 */
async function toggleWatchEditorLog() {
    if (!window.liveMonitor) {
        showToast('Live monitor not available', 'error');
        return;
    }

    const activeMonitors = window.liveMonitor.getActiveMonitors();

    // If already watching, stop it
    if (activeMonitors.length > 0) {
        for (const logId of activeMonitors) {
            await window.liveMonitor.stopMonitoring(logId);
        }
        updateWatchButtonState();
        showToast('Monitoring stopped.', 'success');
        return;
    }

    // Otherwise, start watching
    const isAvailable = await window.liveMonitor.isFileWatcherAvailable();

    if (isAvailable) {
        try {
            const db = await getCurrentDatabase();
            await db.open();

            const watchUrl = window.liveMonitor._getFileWatcherUrl('/watch');
            if (!watchUrl) {
                throw new Error('File watcher service not available');
            }

            const watchResponse = await fetch(watchUrl);
            const watchData = await watchResponse.json();

            if (watchData.error) {
                throw new Error(watchData.error);
            }

            const detectedFilePath = watchData.file_path;
            console.log(`[Watch] File watcher started watching: ${detectedFilePath}`);

            // Create a minimal log entry that will be populated by polling
            const fileName = detectedFilePath.split('/').pop() || detectedFilePath.split('\\').pop() || 'Editor.log';
            const metadata = {
                log_file: fileName,
                date_parsed: new Date().toISOString(),
                total_lines: null,
                total_parse_time_ms: null,
                timestampsEnabled: null
            };

            const logId = await db.insertLogMetadata(metadata);
            console.log(`[Watch] Created log entry (log_id: ${logId}), starting polling from beginning`);

            // Start live monitoring
            await window.liveMonitor.startWatchingWithFileWatcher(logId, detectedFilePath, db);
            updateWatchButtonState();
            loadLogList();
        } catch (error) {
            console.error('[Watch] Error:', error);
            showToast(`Failed to start watching: ${error.message}`, 'error');
        }
    } else {
        if (window.fileWatcherSetup) {
            window.fileWatcherSetup.showSetupInstructions();
        } else {
            showToast('File watcher service not available. Please run editor_log_watcher.py', 'error');
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTING UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Example log configurations
 */
const EXAMPLE_LOGS = {
    'fantasy-kingdom': {
        path: 'logs/dashboard-examples/fantasy-kingdom-open-ts.txt',
        displayName: 'Fantasy Kingdom.log'
    },
    'time-ghost': {
        path: 'logs/dashboard-examples/time-ghost-open-ts.txt',
        displayName: 'Time Ghosts.log'
    }
};

/**
 * Load an example log file for testing
 * @param {string} logId - The example log identifier
 */
async function loadExampleLog(logId) {
    const config = EXAMPLE_LOGS[logId];
    if (!config) {
        showToast(`Unknown example log: ${logId}`, 'error');
        return;
    }

    try {
        // Fetch the example log file from logs folder
        // Using .txt extension for GitHub Pages compatibility (.log files may be blocked)
        const response = await fetch(config.path);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${config.path}: ${response.statusText}`);
        }

        const content = await response.text();
        const blob = new Blob([content], { type: 'text/plain' });
        const file = new File([blob], config.displayName, { type: 'text/plain' });

        // Open the log parser modal
        if (typeof openLogParser === 'function') {
            openLogParser();
        } else if (window.openLogParser) {
            window.openLogParser();
        } else {
            throw new Error('Log parser not available');
        }

        // Wait for modal to open and initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Programmatically trigger file selection
        const fileInput = document.getElementById('parser-file-input');
        if (!fileInput) {
            throw new Error('File input not found');
        }

        // Create a DataTransfer to set the file
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        // Trigger the change event
        const event = new Event('change', { bubbles: true });
        fileInput.dispatchEvent(event);

    } catch (error) {
        console.error('Error loading example log:', error);
        showToast(`Failed to load ${config.displayName}: ${error.message}`, 'error');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG LIST MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and display the log list from the database
 */
async function loadLogList() {
    try {
        // Clear dashboard first to prevent showing stale data
        clearDashboard();
        
        const logs = await window.apiClient.getLogs();
        
        if (logs.length === 0) {
            // Show empty state - user can upload a file
            showEmptyState();
            return;
        }
        
        setCurrentLogId(logs[0].id);
        window.apiClient.setCurrentLogId(logs[0].id);
        updateProjectName(logs[0].project_name);
        loadOverview();
        
    } catch (error) {
        // Database might not exist yet - show empty state
        console.error('Error loading log list:', error);
        showEmptyState();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize dashboard after modules are loaded
 */
function initDashboard() {
    console.log('[Dashboard] Modules loaded, initializing...');
    if (typeof loadLogList === 'function') {
        loadLogList();
    } else {
        console.error('[Dashboard] loadLogList not available');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show error message
 */
function showError(message) {
    const errorDiv = document.getElementById('error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

/**
 * Hide error message
 */
function hideError() {
    const errorDiv = document.getElementById('error');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
}

/**
 * Navigate to a specific log line
 */
function navigateToLogLine(lineNumber) {
    if (lineNumber && lineNumber > 0) {
        openLogViewer(lineNumber);
    } else {
        console.warn('No line number available for this timeline segment');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

// Export to window for global access
window.clearDashboard = clearDashboard;
window.updateProjectName = updateProjectName;
window.updateUnityVersion = updateUnityVersion;
window.clearDashboardAndDatabase = clearDashboardAndDatabase;
window.performClear = clearDashboardAndDatabase; // Alias for live-monitor.js
window.updateWatchButtonState = updateWatchButtonState;
window.toggleWatchEditorLog = toggleWatchEditorLog;
window.watchEditorLog = toggleWatchEditorLog; // Backward compatibility
window.loadExampleLog = loadExampleLog;
window.loadLogList = loadLogList;
window.initDashboard = initDashboard;
window.showError = showError;
window.hideError = hideError;
window.navigateToLogLine = navigateToLogLine;
