/**
 * Log Parser Overlay Module
 * Handles log file upload and parsing in an overlay modal
 */

// Cancel signal for batch storage
let batchCancelSignal = { cancelled: false };

/**
 * Open the log parser overlay
 */
window.openLogParser = function() {
    const overlay = document.getElementById('log-parser-overlay');
    const panel = document.getElementById('log-parser-panel');
    
    if (!overlay || !panel) {
        console.error('Log parser overlay elements not found');
        return;
    }
    
    // Show overlay using flex display (overrides CSS default)
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.opacity = '1';
    panel.classList.add('active');
    
    // Prevent body scroll when overlay is open
    document.body.style.overflow = 'hidden';
    
    // Reset parser state
    resetParser();
};

/**
 * Cancel all operations and close the parser overlay
 * This is called when the user explicitly clicks the X button
 */
window.cancelLogParser = function() {
    console.log('[Parser] User cancelled - terminating all operations...');
    
    // Cancel batch storage operations
    batchCancelSignal.cancelled = true;
    
    // Terminate Web Worker if it exists
    if (window.logLinesWorker) {
        console.log('[Parser] Terminating Web Worker...');
        window.logLinesWorker.terminate();
        window.logLinesWorker = null;
    }
    
    // Clear worker progress state
    localStorage.removeItem('log_lines_worker_progress');
    
    // Close the overlay
    const overlay = document.getElementById('log-parser-overlay');
    const panel = document.getElementById('log-parser-panel');
    
    if (overlay) {
        overlay.style.display = 'none';
        overlay.style.opacity = '0';
    }
    if (panel) {
        panel.classList.remove('active');
    }
    
    // Restore body scroll
    document.body.style.overflow = '';
    
    // Reset cancel signal for next time
    batchCancelSignal.cancelled = false;
};

/**
 * Close the log parser overlay without cancelling operations
 * This is called when parsing succeeds and we want to return to dashboard
 * The worker continues processing in the background
 */
window.closeLogParser = function() {
    console.log('[Parser] Closing overlay - keeping worker alive if active...');
    
    // Don't cancel operations - just close the overlay
    // Worker will continue processing in the background
    
    const overlay = document.getElementById('log-parser-overlay');
    const panel = document.getElementById('log-parser-panel');
    
    if (overlay) {
        overlay.style.display = 'none';
        overlay.style.opacity = '0';
    }
    if (panel) {
        panel.classList.remove('active');
    }
    
    // Restore body scroll
    document.body.style.overflow = '';
};

/**
 * Cancel batch storage operation
 */
window.cancelBatchStorage = function() {
    batchCancelSignal.cancelled = true;
    const cancelBtn = document.getElementById('parser-batch-cancel-btn');
    if (cancelBtn) {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling...';
    }
};

/**
 * Format time remaining in a readable format
 */
function formatTimeRemaining(seconds) {
    if (seconds === null || seconds < 0) {
        return 'Calculating...';
    }
    if (seconds < 60) {
        return `${Math.ceil(seconds)} seconds`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.ceil(seconds % 60);
        return `${minutes}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
}

/**
 * Progress bar management - one per phase
 */
const progressBars = new Map();

// Define the order in which progress bars should appear
const PROGRESS_BAR_ORDER = [
    'reading',
    'receiving_asset_imports',
    'receiving_log_lines',
    'storing_log_lines_indexeddb'
];

/**
 * Get or create a progress bar for a specific phase
 */
function getProgressBar(phaseId, phaseLabel) {
    if (progressBars.has(phaseId)) {
        return progressBars.get(phaseId);
    }
    
    const container = document.getElementById('parser-progress-bars-container');
    if (!container) return null;
    
    // Create progress bar HTML - compact layout with name on left, bar on right
    const barContainer = document.createElement('div');
    barContainer.id = `progress-bar-${phaseId}`;
    barContainer.style.cssText = 'margin-bottom: 8px; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e0e0e0; display: flex; align-items: center; gap: 12px;';
    
    // Left side: label
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = 'font-weight: 500; color: #333; min-width: 200px; font-size: 0.9em;';
    labelDiv.textContent = phaseLabel;
    
    // Right side: progress bar and info
    const rightSide = document.createElement('div');
    rightSide.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 4px;';
    
    const timeDiv = document.createElement('div');
    timeDiv.id = `progress-time-${phaseId}`;
    timeDiv.style.cssText = 'font-size: 0.8em; color: #666; text-align: right;';
    timeDiv.textContent = 'Calculating...';
    
    const barWrapper = document.createElement('div');
    barWrapper.style.cssText = 'width: 100%; height: 20px; background-color: #e0e0e0; border-radius: 10px; overflow: hidden; position: relative;';
    
    const progressBar = document.createElement('div');
    progressBar.id = `progress-bar-fill-${phaseId}`;
    progressBar.style.cssText = 'height: 100%; background-color: #4CAF50; width: 0%; transition: width 0.3s ease; border-radius: 10px;';
    
    const progressText = document.createElement('div');
    progressText.id = `progress-text-${phaseId}`;
    progressText.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 0.75em; font-weight: bold; color: #333; text-shadow: 0 0 2px white;';
    progressText.textContent = '0%';
    
    barWrapper.appendChild(progressBar);
    barWrapper.appendChild(progressText);
    
    rightSide.appendChild(timeDiv);
    rightSide.appendChild(barWrapper);
    
    barContainer.appendChild(labelDiv);
    barContainer.appendChild(rightSide);
    
    // Insert in the correct order based on PROGRESS_BAR_ORDER
    const orderIndex = PROGRESS_BAR_ORDER.indexOf(phaseId);
    if (orderIndex === -1) {
        // If not in order list, append to end
        container.appendChild(barContainer);
    } else {
        // Find the correct position to insert
        let insertBefore = null;
        for (let i = orderIndex + 1; i < PROGRESS_BAR_ORDER.length; i++) {
            const nextPhaseId = PROGRESS_BAR_ORDER[i];
            const nextBar = progressBars.get(nextPhaseId);
            if (nextBar && nextBar.container.parentNode === container) {
                insertBefore = nextBar.container;
                break;
            }
        }
        if (insertBefore) {
            container.insertBefore(barContainer, insertBefore);
        } else {
            container.appendChild(barContainer);
        }
    }
    
    const barData = {
        container: barContainer,
        label: labelDiv,
        time: timeDiv,
        bar: progressBar,
        text: progressText,
        phaseId: phaseId,
        phaseLabel: phaseLabel,
        rightSide: rightSide
    };
    
    progressBars.set(phaseId, barData);
    return barData;
}

/**
 * Update progress bar for a specific phase
 */
function updateProgressBar(phaseId, phaseLabel, percent, estimatedTimeRemaining) {
    const barData = getProgressBar(phaseId, phaseLabel);
    if (!barData) return;
    
    // Update progress bar
    barData.bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    barData.text.textContent = `${percent.toFixed(1)}%`;
    
    // Update time remaining
    barData.time.textContent = estimatedTimeRemaining !== null ? formatTimeRemaining(estimatedTimeRemaining) : 'Calculating...';
}

/**
 * Mark a progress bar as complete
 */
function completeProgressBar(phaseId) {
    const barData = progressBars.get(phaseId);
    if (!barData) return;
    
    barData.bar.style.width = '100%';
    barData.text.textContent = '100%';
    barData.time.textContent = 'Complete';
    barData.bar.style.backgroundColor = '#4CAF50';
}

/**
 * Clear all progress bars
 */
function clearProgressBars() {
    const container = document.getElementById('parser-progress-bars-container');
    if (container) {
        container.innerHTML = '';
    }
    progressBars.clear();
}

/**
 * Show cancel button
 */
function showCancelButton() {
    const cancelBtn = document.getElementById('parser-batch-cancel-btn');
    if (cancelBtn) {
        cancelBtn.style.display = 'inline-block';
    }
}

/**
 * Hide cancel button
 */
function hideCancelButton() {
    const cancelBtn = document.getElementById('parser-batch-cancel-btn');
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
    }
}

/**
 * Reset parser to initial state
 */
window.resetParser = function() {
    console.log('[Parser] Resetting parser - terminating any background workers...');
    
    // Terminate any background workers when starting a new parse
    if (window.logLinesWorker) {
        console.log('[Parser] Terminating existing Web Worker...');
        window.logLinesWorker.terminate();
        window.logLinesWorker = null;
    }
    
    // Clear worker progress state
    localStorage.removeItem('log_lines_worker_progress');
    
    // Hide completion container
    const completionContainer = document.getElementById('parser-completion-container');
    if (completionContainer) {
        completionContainer.style.display = 'none';
    }
    
    // Hide progress container
    const progressContainer = document.getElementById('parser-progress-container');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    
    // Show upload area
    const uploadArea = document.getElementById('parser-upload-area');
    if (uploadArea) {
        uploadArea.style.display = 'block';
    }
    
    // Clear progress bars
    clearProgressBars();
    
    // Clear file input
    const fileInput = document.getElementById('parser-file-input');
    if (fileInput) {
        fileInput.value = '';
    }
    
    // Reset cancel signal
    batchCancelSignal.cancelled = false;
    
    // Hide cancel button
    hideCancelButton();
    
    // Hide error
    hideError();
};

/**
 * Show completion button
 */
function showCompletionButton(showBackgroundMessage = false) {
    const completionContainer = document.getElementById('parser-completion-container');
    const backgroundMessage = document.getElementById('parser-background-message');
    if (completionContainer) {
        completionContainer.style.display = 'block';
        if (backgroundMessage) {
            backgroundMessage.style.display = showBackgroundMessage ? 'block' : 'none';
        }
        // Scroll to completion button
        setTimeout(() => {
            completionContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
}

/**
 * Update progress display with message
 */
function updateStorageProgress(message) {
    const progressDiv = document.getElementById('parser-loading-progress');
    if (!progressDiv) return;
    
    // Append to progress (add new line)
    const currentText = progressDiv.textContent;
    if (currentText) {
        progressDiv.textContent = currentText + '\n' + message;
    } else {
        progressDiv.textContent = message;
    }
    
    // Scroll to bottom
    progressDiv.scrollTop = progressDiv.scrollHeight;
    
    // Don't log to console - messages should only appear in parser logs
}

/**
 * Show error message
 */
function showError(message) {
    const errorContainer = document.getElementById('parser-error-container');
    if (errorContainer) {
        errorContainer.textContent = message;
        errorContainer.style.display = 'block';
    }
    console.error(message);
}

/**
 * Hide error message
 */
function hideError() {
    const errorContainer = document.getElementById('parser-error-container');
    if (errorContainer) {
        errorContainer.style.display = 'none';
    }
}

/**
 * Store parsed data from server into IndexedDB
 * Handles streaming response for large files
 */
async function storeParsedDataInIndexedDB(logId) {
    try {
        // Reset cancel signal at start
        batchCancelSignal.cancelled = false;
        
        // Show progress container
        const progressContainer = document.getElementById('parser-progress-container');
        const uploadArea = document.getElementById('parser-upload-area');
        if (progressContainer) progressContainer.style.display = 'block';
        if (uploadArea) uploadArea.style.display = 'none';
        
        updateStorageProgress('Fetching parsed data from server...');
        
        // Track receiving progress
        let totalReceived = {
            asset_imports: 0,
            log_lines: 0
        };
        
        // Track receiving progress for each phase
        const receivingStates = {
            receiving_asset_imports: {
                totalItems: null,
                receivedItems: 0,
                batchTimes: [],
                lastBatchTime: null,
                avgBatchTime: null, // Calculated once after 3 batches
                phaseId: 'receiving_asset_imports',
                phaseLabel: 'Receiving asset imports'
            },
            receiving_log_lines: {
                totalItems: null,
                receivedItems: 0,
                batchTimes: [],
                lastBatchTime: null,
                avgBatchTime: null, // Calculated once after 3 batches
                phaseId: 'receiving_log_lines',
                phaseLabel: 'Receiving log lines'
            }
        };
        
        // Helper to update receiving progress
        function updateReceivingProgress(phaseKey, received, total, currentTime) {
            const state = receivingStates[phaseKey];
            if (!state) return;
            
            // Update total if provided (especially for log_lines from metadata)
            if (total !== null && total > 0) {
                state.totalItems = total;
            }
            
            state.receivedItems = received;
            
            // For receiving log lines, batches are 5000 lines each
            const LINES_PER_BATCH = 5000;
            
            // Add avgBatchTime to state if not present
            if (!state.hasOwnProperty('avgBatchTime')) {
                state.avgBatchTime = null;
            }
            
            if (state.lastBatchTime === null) {
                state.lastBatchTime = currentTime;
                const percent = state.totalItems > 0 ? (received / state.totalItems) * 100 : 0;
                updateProgressBar(state.phaseId, state.phaseLabel, percent, null);
            } else {
                // Calculate time for this batch (5000 lines)
                const batchTime = currentTime - state.lastBatchTime;
                state.batchTimes.push(batchTime);
                
                // Keep only the last 3 batch times (15K lines total)
                if (state.batchTimes.length > 3) {
                    state.batchTimes.shift();
                }
                
                state.lastBatchTime = currentTime;
                
                // Calculate avgBatchTime once after we have 3 batches AND received at least 15000 lines
                // This ensures we have meaningful timing data
                if (state.avgBatchTime === null && state.batchTimes.length >= 3 && received >= 15000) {
                    // avg batchTime = average of last 3 batches (15K lines)
                    const avg = state.batchTimes.reduce((a, b) => a + b, 0) / state.batchTimes.length;
                    // Only set if average is meaningful (at least 1ms)
                    if (avg >= 1) {
                        state.avgBatchTime = avg;
                    }
                }
                
                // Calculate estimated time remaining
                let estimatedTimeRemaining = null;
                if (state.avgBatchTime !== null && state.avgBatchTime > 0 && state.totalItems > 0) {
                    // total batches needed = total line count / lines per batch (5K)
                    const totalBatches = Math.ceil(state.totalItems / LINES_PER_BATCH);
                    
                    // batches received = received lines / lines per batch
                    const batchesReceived = Math.floor(received / LINES_PER_BATCH);
                    
                    // batches remaining = total batches - batches received
                    const batchesRemaining = totalBatches - batchesReceived;
                    
                    // time remaining = batches remaining * avgBatchTime
                    estimatedTimeRemaining = (batchesRemaining * state.avgBatchTime) / 1000; // Convert to seconds
                }
                
                const percent = state.totalItems > 0 ? (received / state.totalItems) * 100 : 0;
                updateProgressBar(state.phaseId, state.phaseLabel, percent, estimatedTimeRemaining);
            }
        }
        
        // Fetch exported data from server (streaming for large files)
        const response = await fetch(`/api/log/${logId}/export`);
        if (!response.ok) {
            throw new Error(`Failed to export data: ${response.statusText}`);
        }
        
        // Parse streaming JSON response (newline-delimited JSON)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        // Accumulate data by type
        const data = {
            metadata: null,
            asset_imports: [],
            pipeline_refreshes: [],
            domain_reload_steps: [],
            script_compilation: [],
            telemetry_data: [],
            operations: [],
            log_lines: []
        };
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const chunk = JSON.parse(line);
                    
                    if (chunk.type === 'metadata') {
                        data.metadata = chunk.data;
                        updateStorageProgress('Received metadata...');
                        
                        // Set total log lines from metadata if available
                        if (chunk.data && chunk.data.total_lines) {
                            const totalLogLines = chunk.data.total_lines;
                            receivingStates.receiving_log_lines.totalItems = totalLogLines;
                            // Initialize progress bar with correct total
                            updateProgressBar(receivingStates.receiving_log_lines.phaseId, 
                                            receivingStates.receiving_log_lines.phaseLabel, 
                                            0, null);
                        }
                    } else if (chunk.type === 'asset_imports') {
                        const currentTime = performance.now();
                        data.asset_imports.push(...chunk.data);
                        totalReceived.asset_imports = data.asset_imports.length;
                        
                        // Update receiving progress (we don't know total yet, so estimate)
                        const state = receivingStates.receiving_asset_imports;
                        if (state.totalItems === null) {
                            // Estimate total based on typical batch size (5000) and current progress
                            state.totalItems = Math.max(totalReceived.asset_imports * 2, 10000);
                        }
                        updateReceivingProgress('receiving_asset_imports', totalReceived.asset_imports, state.totalItems, currentTime);
                        
                        updateStorageProgress(`Received ${totalReceived.asset_imports.toLocaleString()} asset imports...`);
                    } else if (chunk.type === 'pipeline_refreshes') {
                        data.pipeline_refreshes = chunk.data;
                        updateStorageProgress(`Received ${data.pipeline_refreshes.length} pipeline refreshes...`);
                    } else if (chunk.type === 'domain_reload_steps') {
                        data.domain_reload_steps = chunk.data;
                        updateStorageProgress(`Received ${data.domain_reload_steps.length} domain reload steps...`);
                    } else if (chunk.type === 'script_compilation') {
                        data.script_compilation = chunk.data;
                        updateStorageProgress(`Received ${data.script_compilation.length} script compilation records...`);
                    } else if (chunk.type === 'telemetry_data') {
                        data.telemetry_data = chunk.data;
                        updateStorageProgress(`Received ${data.telemetry_data.length} telemetry records...`);
                    } else if (chunk.type === 'operations') {
                        data.operations = chunk.data;
                        updateStorageProgress(`Received ${data.operations.length} operations...`);
                    } else if (chunk.type === 'log_lines') {
                        const currentTime = performance.now();
                        data.log_lines.push(...chunk.data);
                        totalReceived.log_lines = data.log_lines.length;
                        
                        // Update receiving progress - use total from metadata if available
                        const state = receivingStates.receiving_log_lines;
                        if (state.totalItems === null) {
                            // If we don't have metadata yet, estimate based on typical batch size
                            state.totalItems = Math.max(totalReceived.log_lines * 2, 10000);
                        }
                        updateReceivingProgress('receiving_log_lines', totalReceived.log_lines, state.totalItems, currentTime);
                        
                        updateStorageProgress(`Received ${totalReceived.log_lines.toLocaleString()} log lines...`);
                    } else if (chunk.type === 'complete') {
                        updateStorageProgress('All data received from server');
                        // Mark receiving phases as complete
                        completeProgressBar('receiving_asset_imports');
                        completeProgressBar('receiving_log_lines');
                    }
                } catch (parseError) {
                    console.error('Error parsing JSON chunk:', parseError, 'Line:', line);
                    throw new Error(`Failed to parse data chunk: ${parseError.message}`);
                }
            }
        }
        
        // Parse any remaining buffer
        if (buffer.trim()) {
            try {
                const chunk = JSON.parse(buffer);
                if (chunk.type === 'metadata') {
                    data.metadata = chunk.data;
                } else if (chunk.type === 'asset_imports') {
                    data.asset_imports.push(...chunk.data);
                } else if (chunk.type === 'log_lines') {
                    data.log_lines.push(...chunk.data);
                }
            } catch (parseError) {
                console.error('Error parsing final buffer:', parseError);
            }
        }
        
        updateStorageProgress('Creating new IndexedDB database...');
        
        // Create new database for this parse
        const db = await createNewDatabase();
        await db.open();
        
        // Store metadata (remove id to let IndexedDB auto-generate)
        const metadata = { ...data.metadata };
        delete metadata.id;
        metadata.date_parsed = metadata.date_parsed || new Date().toISOString();
        const newLogId = await db.insertLogMetadata(metadata);
        
        updateStorageProgress('Storing metadata...');
        let dbSizeMB = await db.getDatabaseSizeMB();
        updateStorageProgress(`Metadata stored (${data.asset_imports.length} assets, ${data.log_lines.length} log lines) (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        
        // Store all data with the new log ID
        const assetImports = data.asset_imports.map(ai => {
            const item = { ...ai };
            delete item.id;
            item.log_id = newLogId;
            return item;
        });
        if (assetImports.length > 0) {
            updateStorageProgress(`Storing ${assetImports.length} asset imports...`);
            await db.bulkInsertAssetImports(assetImports);
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`Asset imports stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }
        
        const pipelineRefreshes = data.pipeline_refreshes.map(pr => {
            const item = { ...pr };
            delete item.id;
            item.log_id = newLogId;
            return item;
        });
        if (pipelineRefreshes.length > 0) {
            updateStorageProgress(`Storing ${pipelineRefreshes.length} pipeline refreshes...`);
            await db.bulkInsertPipelineRefreshes(pipelineRefreshes);
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`Pipeline refreshes stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }
        
        const domainReloadSteps = data.domain_reload_steps.map(dr => {
            const item = { ...dr };
            delete item.id;
            item.log_id = newLogId;
            return item;
        });
        if (domainReloadSteps.length > 0) {
            updateStorageProgress(`Storing ${domainReloadSteps.length} domain reload steps...`);
            await db.bulkInsertDomainReloadSteps(domainReloadSteps);
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`Domain reload steps stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }
        
        const scriptCompilation = data.script_compilation.map(sc => {
            const item = { ...sc };
            delete item.id;
            item.log_id = newLogId;
            return item;
        });
        if (scriptCompilation.length > 0) {
            updateStorageProgress(`Storing ${scriptCompilation.length} script compilation records...`);
            await db.bulkInsertScriptCompilation(scriptCompilation);
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`Script compilation stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }
        
        const telemetryData = data.telemetry_data.map(td => {
            const item = { ...td };
            delete item.id;
            item.log_id = newLogId;
            return item;
        });
        if (telemetryData.length > 0) {
            updateStorageProgress(`Storing ${telemetryData.length} telemetry records...`);
            await db.bulkInsertTelemetryData(telemetryData);
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`Telemetry data stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }
        
        const operations = data.operations.map(op => {
            const item = { ...op };
            delete item.id;
            item.log_id = newLogId;
            return item;
        });
        if (operations.length > 0) {
            updateStorageProgress(`Storing ${operations.length} operations...`);
            await db.bulkInsertOperations(operations);
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`Operations stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }
        
        // Prepare log lines for background worker (but don't store them yet)
        const logLines = data.log_lines.map(ll => {
            const item = { ...ll };
            delete item.id;
            item.log_id = newLogId;
            // Convert boolean fields
            item.is_error = item.is_error ? 1 : 0;
            item.is_warning = item.is_warning ? 1 : 0;
            return item;
        });
        
        // Get database size before closing
        dbSizeMB = await db.getDatabaseSizeMB();
        await db.close();
        
        // Update current log ID to the new one
        setCurrentLogId(newLogId);
        window.apiClient.setCurrentLogId(newLogId);
        
        // Force API client to refresh its database connection to use the new database
        // Clear the cached database instance so it will get the new one
        if (window.apiClient && window.apiClient.db) {
            try {
                await window.apiClient.db.close();
            } catch (e) {
                // Ignore errors
            }
            window.apiClient.db = null; // Clear cache to force refresh
        }
        
        // If we have log lines, start background worker to store them
        if (logLines.length > 0) {
            updateStorageProgress(`Starting background storage of ${logLines.length} log lines...`);
            
            // Store progress state in localStorage for dashboard access
            const progressState = {
                logId: newLogId,
                totalLines: logLines.length,
                processedLines: 0,
                percent: 0,
                estimatedTimeRemaining: null,
                status: 'in_progress',
                startTime: Date.now()
            };
            localStorage.setItem('log_lines_worker_progress', JSON.stringify(progressState));
            
            // Start Web Worker for background insertion
            console.log('[Parser] Creating Web Worker...');
            const worker = new Worker('static/js/log-lines-worker.js');
            
            // Handle worker errors
            worker.onerror = (error) => {
                console.error('[Parser] Worker error:', error);
                updateStorageProgress(`✗ Worker error: ${error.message}`);
            };
            
            // Initialize worker with database version
            console.log('[Parser] Initializing worker with version:', db.version);
            worker.postMessage({
                type: 'init',
                data: {
                    version: db.version
                }
            });
            
            // Wait for worker to be ready (this is the only await - necessary for initialization)
            console.log('[Parser] Waiting for worker to initialize...');
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.error('[Parser] Worker initialization timeout - continuing anyway');
                    resolve(); // Continue even if timeout - worker might still work
                }, 5000); // Reduced to 5 second timeout
                
                worker.addEventListener('message', function readyHandler(e) {
                    if (e.data.type === 'ready') {
                        clearTimeout(timeout);
                        worker.removeEventListener('message', readyHandler);
                        console.log('[Parser] Worker ready!');
                        resolve();
                    }
                });
            });
            
            // Send log lines to worker (this is non-blocking - worker processes in background)
            console.log('[Parser] Sending log lines to worker:', logLines.length, 'lines');
            console.log('[Parser] Worker will process in background - continuing immediately (NOT waiting for completion)...');
            worker.postMessage({
                type: 'insert',
                data: {
                    logLines: logLines,
                    logId: newLogId
                }
            });
            
            // IMPORTANT: We do NOT await the worker completion - it processes in the background
            // Execution continues immediately to the next line
            console.log('[Parser] Worker message sent - execution continues immediately');
            
            // Handle worker messages (asynchronous - doesn't block)
            worker.addEventListener('message', (e) => {
                const { type, batchNum, totalBatches, processed, total, percent, estimatedTimeRemaining, totalTime, totalLines, verifiedCount, error } = e.data;
                
                console.log('[Parser] Worker message:', type, { batchNum, processed, total, percent });
                
                if (type === 'progress') {
                    // Update progress state
                    const progressState = {
                        logId: newLogId,
                        totalLines: total,
                        processedLines: processed,
                        percent: percent,
                        estimatedTimeRemaining: estimatedTimeRemaining,
                        status: 'in_progress',
                        startTime: JSON.parse(localStorage.getItem('log_lines_worker_progress') || '{}').startTime || Date.now()
                    };
                    localStorage.setItem('log_lines_worker_progress', JSON.stringify(progressState));
                } else if (type === 'complete') {
                    console.log('[Parser] Worker completed!', { totalTime, totalLines, verifiedCount });
                    // Mark as complete
                    const progressState = {
                        logId: newLogId,
                        totalLines: totalLines,
                        processedLines: totalLines,
                        percent: 100,
                        estimatedTimeRemaining: 0,
                        status: 'complete',
                        startTime: JSON.parse(localStorage.getItem('log_lines_worker_progress') || '{}').startTime || Date.now(),
                        totalTime: totalTime,
                        verifiedCount: verifiedCount
                    };
                    localStorage.setItem('log_lines_worker_progress', JSON.stringify(progressState));
                    
                    // Clean up worker
                    worker.terminate();
                    console.log('[Parser] Worker terminated');
                } else if (type === 'error') {
                    console.error('[Parser] Worker error:', error);
                    // Handle error
                    const progressState = {
                        logId: newLogId,
                        status: 'error',
                        error: error
                    };
                    localStorage.setItem('log_lines_worker_progress', JSON.stringify(progressState));
                    
                    updateStorageProgress(`✗ Error storing log lines: ${error}`);
                    worker.terminate();
                }
            });
            
            // Store worker reference for cancellation (if needed)
            window.logLinesWorker = worker;
        } else {
            // No log lines, mark as complete
            localStorage.setItem('log_lines_worker_progress', JSON.stringify({
                logId: newLogId,
                status: 'complete'
            }));
        }
        
        // Final completion message
        updateStorageProgress(`✓ Storage complete! Database: ${db.dbName} (Size: ${dbSizeMB.toFixed(2)} MB)`);
        if (logLines.length > 0) {
            updateStorageProgress(`✓ Log lines (${logLines.length}) are being stored in the background by Web Worker.`);
            updateStorageProgress(`✓ Closing overlay and returning to dashboard...`);
        } else {
            updateStorageProgress('✓ Parsing complete!');
        }
        
        // Output final size to console
        console.log(`========================================`);
        console.log(`IndexedDB Storage Complete`);
        console.log(`Database: ${db.dbName}`);
        console.log(`Log ID: ${newLogId}`);
        console.log(`Database Size: ${dbSizeMB.toFixed(2)} MB`);
        if (logLines.length > 0) {
            console.log(`Log lines (${logLines.length}) are being stored in background by Web Worker`);
            console.log(`[Parser] NOT waiting for worker - returning to dashboard immediately`);
        }
        console.log(`========================================`);
        
        // Automatically close overlay and return to dashboard after a short delay
        // The worker will continue processing log lines in the background
        setTimeout(() => {
            console.log('[Parser] Closing overlay and refreshing dashboard...');
            closeLogParser(); // This keeps the worker alive
            
            // Force API client to refresh database connection to ensure it uses the new database
            if (window.apiClient) {
                if (window.apiClient.db) {
                    window.apiClient.db.close().catch(() => {}); // Close old connection
                }
                window.apiClient.db = null; // Clear cache to force fresh connection
                // Also clear any cached version info
                if (window.getCurrentDbVersion) {
                    // Force refresh by clearing any cached version
                    console.log('[Parser] Forcing database connection refresh');
                }
            }
            
            // Clear dashboard content first to prevent showing stale data
            if (window.clearDashboard) {
                window.clearDashboard();
            }
            
            // Refresh the dashboard to show the new log
            if (typeof loadLogList === 'function') {
                loadLogList();
            } else if (window.loadLogList) {
                window.loadLogList();
            }
        }, 2000);
    } catch (error) {
        console.error('Error storing data in IndexedDB:', error);
        updateStorageProgress(`✗ Error: ${error.message}`);
        showError(`Failed to store data: ${error.message}`);
        throw error;
    }
}

/**
 * Handle file selection - now uses client-side parser
 */
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Show progress container
    const progressContainer = document.getElementById('parser-progress-container');
    const uploadArea = document.getElementById('parser-upload-area');
    if (progressContainer) progressContainer.style.display = 'block';
    if (uploadArea) uploadArea.style.display = 'none';
    hideError();
    hideCancelButton();
    
    // Clear previous progress
    clearProgressBars();
    const progressDiv = document.getElementById('parser-loading-progress');
    if (progressDiv) progressDiv.textContent = '';
    
    // Reset cancel signal
    batchCancelSignal.cancelled = false;
    
    try {
        // Create new database
        updateStorageProgress('Creating new IndexedDB database...');
        const db = await createNewDatabase();
        await db.open();
        
        // Initialize reading progress bar at the start
        updateProgressBar('reading', 'Reading log file', 0, null);
        
        // Create parser instance
        const progressCallback = (message) => {
            // Check if this is a reading progress message (don't add to log, just update progress bar)
            const readingMatch = message.match(/Reading:\s*([\d.]+)%\s*\(([\d,]+)\s+lines read\)/i);
            if (readingMatch) {
                const percent = parseFloat(readingMatch[1]);
                const linesRead = parseInt(readingMatch[2].replace(/,/g, ''), 10);
                
                // Calculate estimated time remaining
                // We'll use a simple approach: track start time and estimate based on progress
                if (!window.readingStartTime) {
                    window.readingStartTime = Date.now();
                }
                
                let estimatedTimeRemaining = null;
                if (percent > 0) {
                    const elapsed = (Date.now() - window.readingStartTime) / 1000; // seconds
                    const totalTime = (elapsed / percent) * 100;
                    estimatedTimeRemaining = Math.max(0, totalTime - elapsed);
                }
                
                updateProgressBar('reading', 'Reading log file', percent, estimatedTimeRemaining);
                // Don't add reading progress messages to the log
                return;
            }
            
            // Also check for initial reading message
            if (message.includes('Reading log file') && !message.includes('Reading:')) {
                updateProgressBar('reading', 'Reading log file', 0, null);
                // Don't add initial reading message to log either
                return;
            }
            
            // Filter out "Extracting metadata from header..." message (part of reading phase)
            if (message.includes('Extracting metadata from header')) {
                // Don't add to log
                return;
            }
            
            // For all other messages, add to log
            updateStorageProgress(message);
        };
        
        const parser = new UnityLogParser(db, progressCallback);
        
        // Parse the file
        updateStorageProgress('Starting to parse log file...');
        window.readingStartTime = Date.now(); // Track start time for time estimation
        const { logId, logLines } = await parser.parseLogFile(file, batchCancelSignal);
        window.readingStartTime = null; // Clear after completion
        
        // Mark reading as complete
        completeProgressBar('reading');
        
        // Store log lines using the existing worker system
        if (logLines.length > 0) {
            updateStorageProgress(`Storing ${logLines.length} log lines in background...`);
            
            // Prepare log lines data (minimal structure)
            const logLinesData = logLines.map(line => ({
                log_id: line.log_id,
                line_number: line.line_number,
                content: line.content,
                line_type: line.line_type,
                indent_level: line.indent_level,
                is_error: line.is_error,
                is_warning: line.is_warning,
                timestamp: line.timestamp
            }));
            
            // Store progress state
            const progressState = {
                status: 'in_progress',
                processed: 0,
                total: logLinesData.length,
                startTime: Date.now(),
                lastUpdateTime: Date.now()
            };
            localStorage.setItem('log_lines_worker_progress', JSON.stringify(progressState));
            
            // Create and start Web Worker
            const worker = new Worker('static/js/log-lines-worker.js');
            
            let workerReady = false;
            
            // Set up message handler BEFORE sending init
            worker.addEventListener('message', (event) => {
                const message = event.data;
                const type = message.type;
                
                if (type === 'ready') {
                    workerReady = true;
                    console.log('[Parser] Worker ready, sending log lines...');
                    // Worker is ready, send log lines
                    worker.postMessage({
                        type: 'insert',
                        logLines: logLinesData,
                        logId: logId
                    });
                } else if (type === 'progress') {
                    // Update progress state
                    const progressData = message.data || message;
                    const progressState = {
                        status: 'in_progress',
                        processed: progressData.processed || 0,
                        total: progressData.total || logLinesData.length,
                        percent: progressData.percent || 0,
                        estimatedTimeRemaining: progressData.estimatedTimeRemaining || null,
                        startTime: Date.now() - ((progressData.processed || 0) * 100), // Approximate
                        lastUpdateTime: Date.now()
                    };
                    localStorage.setItem('log_lines_worker_progress', JSON.stringify(progressState));
                } else if (type === 'complete') {
                    // Mark as complete
                    const completeData = message.data || message;
                    const progressState = {
                        status: 'complete',
                        processed: completeData.total || logLinesData.length,
                        total: completeData.total || logLinesData.length,
                        percent: 100,
                        estimatedTimeRemaining: 0,
                        startTime: Date.now(),
                        lastUpdateTime: Date.now()
                    };
                    localStorage.setItem('log_lines_worker_progress', JSON.stringify(progressState));
                    
                    console.log('[Parser] Worker completed!', completeData);
                    
                    // Don't terminate worker - let it finish naturally
                } else if (type === 'error') {
                    const errorMessage = message.data || message.error || 'Unknown error';
                    console.error('[Parser] Worker error:', errorMessage, message);
                    showError('Failed to store log lines: ' + errorMessage);
                }
            });
            
            worker.addEventListener('error', (error) => {
                console.error('[Parser] Worker error event:', error);
                const errorMsg = error.message || error.filename || 'Unknown worker error';
                showError('Worker error: ' + errorMsg);
            });
            
            // Now send init message (after handler is set up)
            console.log('[Parser] Sending init message to worker with version:', db.version);
            worker.postMessage({
                type: 'init',
                version: db.version
            });
            
            // Store worker reference for cancellation
            window.currentLogLinesWorker = worker;
        }
        
        // Show completion
        updateStorageProgress('✓ Parsing complete!');
        updateStorageProgress(`✓ Database: ${db.dbName}`);
        
        // Automatically close overlay and return to dashboard after a short delay
        setTimeout(() => {
            console.log('[Parser] Closing overlay and refreshing dashboard...');
            closeLogParser(); // This keeps the worker alive
            
            // Force API client to refresh database connection
            if (window.apiClient && window.apiClient.db) {
                window.apiClient.db.close().catch(() => {});
                window.apiClient.db = null;
            }
            
            // Clear dashboard content first
            if (window.clearDashboard) {
                window.clearDashboard();
            }
            
            // Refresh the dashboard
            if (typeof loadLogList === 'function') {
                loadLogList();
            } else if (window.loadLogList) {
                window.loadLogList();
            }
        }, 2000);
        
    } catch (error) {
        console.error('Error parsing log file:', error);
        if (error.message === 'Parsing cancelled') {
            updateStorageProgress('✗ Parsing cancelled by user');
        } else {
            showError('Failed to parse log file: ' + error.message);
        }
    }
}

// Initialize file input handler when overlay is opened
function initializeParserFileInput() {
    const fileInput = document.getElementById('parser-file-input');
    if (fileInput && !fileInput.hasAttribute('data-initialized')) {
        fileInput.setAttribute('data-initialized', 'true');
        fileInput.addEventListener('change', handleFileSelect);
    }
    
    // Drag and drop support
    const uploadArea = document.getElementById('parser-upload-area');
    if (uploadArea) {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0 && fileInput) {
                // Create a new FileList-like object
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(files[0]);
                fileInput.files = dataTransfer.files;
                handleFileSelect({ target: fileInput });
            }
        });
    }
}

// Initialize when overlay opens
const originalOpenLogParser = window.openLogParser;
window.openLogParser = function() {
    originalOpenLogParser();
    initializeParserFileInput();
};

