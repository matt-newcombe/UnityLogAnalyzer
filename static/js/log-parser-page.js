/**
 * Log Parser Overlay Module
 * Handles log file upload and parsing in an overlay modal
 */

// Cancel signal for batch storage
let batchCancelSignal = { cancelled: false };

/**
 * Open the log parser overlay
 */
window.openLogParser = function () {
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
window.cancelLogParser = function () {

    // Cancel batch storage operations
    batchCancelSignal.cancelled = true;

    // Terminate Web Worker if it exists

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
window.closeLogParser = function () {

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
 * Close parser and refresh dashboard
 * Called when user clicks "Close & Refresh Dashboard" button
 */
window.closeLogParserAndRefresh = function () {
    closeLogParser();

    // Force API client to refresh database connection to ensure it uses the new database
    if (window.apiClient && window.apiClient.db) {
        window.apiClient.db.close().catch(() => { });
        window.apiClient.db = null; // Clear cache
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
};

/**
 * Cancel batch storage operation
 */
window.cancelBatchStorage = function () {
    batchCancelSignal.cancelled = true;
    // Disable all cancel buttons on progress bars
    progressBars.forEach((barData) => {
        if (barData.cancelBtn) {
            barData.cancelBtn.disabled = true;
            barData.cancelBtn.textContent = 'Cancelling...';
        }
    });
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
    'processing',
    'storing_asset_imports',
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

    // Create progress bar HTML - match dashboard log-lines-progress-bar styling exactly (single row: label, bar, percentage)
    const barContainer = document.createElement('div');
    barContainer.id = `progress-bar-${phaseId}`;
    barContainer.style.cssText = 'margin-bottom: 15px; width: 100%;';

    // Single row: label, progress bar, percentage - match dashboard exactly
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 5px;';

    // Label (phase name) on the left
    const labelDiv = document.createElement('span');
    labelDiv.style.cssText = 'font-size: 0.85em; color: #666; white-space: nowrap;';
    labelDiv.textContent = phaseLabel;

    // Progress bar wrapper - thin bar (4px height) matching dashboard exactly
    const barWrapper = document.createElement('div');
    barWrapper.style.cssText = 'flex: 1; height: 4px; background-color: #e0e0e0; border-radius: 2px; overflow: hidden; position: relative;';

    const progressBar = document.createElement('div');
    progressBar.id = `progress-bar-fill-${phaseId}`;
    progressBar.style.cssText = 'height: 100%; background-color: #4CAF50; width: 0%; transition: width 0.3s ease;';

    barWrapper.appendChild(progressBar);

    // Percentage text on the right
    const progressText = document.createElement('span');
    progressText.id = `progress-text-${phaseId}`;
    progressText.style.cssText = 'font-size: 0.85em; color: #666; white-space: nowrap; min-width: 80px; text-align: right;';
    progressText.textContent = '0%';

    // Cancel button on the right (only shown for active progress bars)
    const cancelBtn = document.createElement('button');
    cancelBtn.id = `progress-cancel-${phaseId}`;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = cancelBatchStorage;
    cancelBtn.style.cssText = 'display: none; padding: 4px 12px; background-color: #f44336; color: white; border: none; border-radius: 4px; cursor: grab; font-size: 0.8em; white-space: nowrap; margin-left: 10px;';

    // Time remaining (optional, shown below the bar if available)
    const timeDiv = document.createElement('div');
    timeDiv.id = `progress-time-${phaseId}`;
    timeDiv.style.cssText = 'font-size: 0.75em; color: #999; margin-top: 2px; display: none;';
    timeDiv.textContent = '';

    row.appendChild(labelDiv);
    row.appendChild(barWrapper);
    row.appendChild(progressText);
    row.appendChild(cancelBtn);

    barContainer.appendChild(row);
    barContainer.appendChild(timeDiv);

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
        cancelBtn: cancelBtn,
        phaseId: phaseId,
        phaseLabel: phaseLabel
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

    // Show cancel button for active progress bars (not complete)
    if (percent > 0 && percent < 100) {
        // Hide cancel button on all other progress bars
        progressBars.forEach((otherBar, otherPhaseId) => {
            if (otherBar.cancelBtn && otherPhaseId !== phaseId) {
                otherBar.cancelBtn.style.display = 'none';
            }
        });
        // Show cancel button on this progress bar
        if (barData.cancelBtn) {
            barData.cancelBtn.style.display = 'inline-block';
        }
    }

    // Update time remaining - show below the bar if available
    if (estimatedTimeRemaining !== null && estimatedTimeRemaining >= 0) {
        barData.time.textContent = `Estimated time remaining: ${formatTimeRemaining(estimatedTimeRemaining)}`;
        barData.time.style.display = 'block';
    } else {
        barData.time.textContent = '';
        barData.time.style.display = 'none';
    }
}

/**
 * Mark a progress bar as complete
 */
function completeProgressBar(phaseId) {
    const barData = progressBars.get(phaseId);
    if (!barData) return;

    barData.bar.style.width = '100%';
    barData.text.textContent = '100%';
    barData.time.textContent = '';
    barData.time.style.display = 'none';
    barData.bar.style.backgroundColor = '#4CAF50';

    // Hide cancel button on this completed progress bar
    if (barData.cancelBtn) {
        barData.cancelBtn.style.display = 'none';
    }

    // Move cancel button to next active progress bar if any
    const orderIndex = PROGRESS_BAR_ORDER.indexOf(phaseId);
    if (orderIndex >= 0) {
        for (let i = orderIndex + 1; i < PROGRESS_BAR_ORDER.length; i++) {
            const nextPhaseId = PROGRESS_BAR_ORDER[i];
            const nextBar = progressBars.get(nextPhaseId);
            if (nextBar) {
                const nextPercent = parseFloat(nextBar.text.textContent) || 0;
                if (nextPercent > 0 && nextPercent < 100 && nextBar.cancelBtn) {
                    nextBar.cancelBtn.style.display = 'inline-block';
                    break;
                }
            }
        }
    }
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
 * Show cancel button (deprecated - cancel buttons are now on progress bars)
 */
function showCancelButton() {
    // Cancel buttons are now managed per progress bar
}

/**
 * Hide cancel button (deprecated - cancel buttons are now on progress bars)
 */
function hideCancelButton() {
    // Hide all cancel buttons on progress bars
    progressBars.forEach((barData) => {
        if (barData.cancelBtn) {
            barData.cancelBtn.style.display = 'none';
        }
    });
}

/**
 * Toggle parser output visibility
 */
window.toggleParserOutput = function () {
    const outputDiv = document.getElementById('parser-loading-progress');
    const toggleBtn = document.getElementById('parser-output-toggle-btn');

    if (!outputDiv || !toggleBtn) return;

    if (outputDiv.style.display === 'none' || !outputDiv.style.display) {
        outputDiv.style.display = 'block';
        toggleBtn.textContent = 'Hide output';
    } else {
        outputDiv.style.display = 'none';
        toggleBtn.textContent = 'Show output';
    }
};

/**
 * Reset parser to initial state
 */
window.resetParser = function () {

    // Terminate any background workers when starting a new parse

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

    // Reset output toggle (hide output, reset button text)
    const outputDiv = document.getElementById('parser-loading-progress');
    const toggleBtn = document.getElementById('parser-output-toggle-btn');
    if (outputDiv) {
        outputDiv.style.display = 'none';
    }
    if (toggleBtn) {
        toggleBtn.textContent = 'Show output';
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

        // Terminate any existing background workers from previous parses

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
            script_compilation: [],
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

                    } else if (chunk.type === 'script_compilation') {
                        data.script_compilation = chunk.data;
                        updateStorageProgress(`Received ${data.script_compilation.length} script compilation records...`);

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

        // Store all data
        const assetImports = data.asset_imports.map(ai => {
            const item = { ...ai };
            delete item.id;
            return item;
        });
        if (assetImports.length > 0) {
            updateStorageProgress(`Storing ${assetImports.length} asset imports...`);
            updateProgressBar('storing_asset_imports', 'Filling Database', 0, null);

            // Progress callback for asset import storage
            let lastReportedPercent = 0;
            const assetProgressCallback = (batchNum, totalBatches, processed, total, percent, estimatedTimeRemaining) => {
                // Only update UI every 2%
                if (percent - lastReportedPercent >= 2 || percent === 100) {
                    updateProgressBar('storing_asset_imports', 'Filling Database', percent, estimatedTimeRemaining);
                    lastReportedPercent = percent;
                }
            };

            await db.bulkInsertAssetImports(assetImports, assetProgressCallback, batchCancelSignal);
            completeProgressBar('storing_asset_imports');
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`✓ Asset imports stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }

        const pipelineRefreshes = data.pipeline_refreshes.map(pr => {
            const item = { ...pr };
            delete item.id;
            return item;
        });
        if (pipelineRefreshes.length > 0) {
            updateStorageProgress(`Storing ${pipelineRefreshes.length} pipeline refreshes...`);
            await db.bulkInsertPipelineRefreshes(pipelineRefreshes);
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`Pipeline refreshes stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }



        const scriptCompilation = data.script_compilation.map(sc => {
            const item = { ...sc };
            delete item.id;
            return item;
        });
        if (scriptCompilation.length > 0) {
            updateStorageProgress(`Storing ${scriptCompilation.length} script compilation records...`);
            await db.bulkInsertScriptCompilation(scriptCompilation);
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`Script compilation stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }



        const operations = data.operations.map(op => {
            const item = { ...op };
            delete item.id;
            return item;
        });
        if (operations.length > 0) {
            updateStorageProgress(`Storing ${operations.length} operations...`);
            await db.bulkInsertOperations(operations);
            dbSizeMB = await db.getDatabaseSizeMB();
            updateStorageProgress(`Operations stored (Database size: ${dbSizeMB.toFixed(2)} MB)`);
        }

        // Log lines are no longer stored - we use file-based reading with line index
        // The line index was already stored during parsing

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

        // No longer need to store log lines - they're read from file on demand using line index
        // Mark progress as complete (no worker needed)

        // Final completion message
        updateStorageProgress(`✓ Storage complete! Database: ${db.dbName} (Size: ${dbSizeMB.toFixed(2)} MB)`);
        updateStorageProgress('✓ Parsing complete! Log lines are read from file on demand.');

        // Output final size to console

        // Automatically close overlay after a short delay
        // The worker will continue processing log lines in the background
        // Dashboard refresh will happen when user clicks "Close & Refresh Dashboard" button
        setTimeout(() => {
            closeLogParser(); // This keeps the worker alive
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
    let file = event.target.files ? event.target.files[0] : null;

    if (!file) return;

    // Clear any file handle/path (no longer using File System Access API)
    window.currentFileHandle = null;
    window.currentFilePath = null;

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

        // Initialize processing progress bar at the start
        updateProgressBar('processing', 'Processing log file', 0, null);

        // Track processing state for time estimation
        let processingStartTime = null;

        // Create parser instance
        const progressCallback = (message) => {
            // Check if this is a reading progress message (don't add to log, just update progress bar)
            const readingMatch = message.match(/Reading:\s*([\d.]+)%\s*\(([\d,]+)\s+lines read\)/i);
            if (readingMatch) {
                const percent = parseFloat(readingMatch[1]);
                const linesRead = parseInt(readingMatch[2].replace(/,/g, ''), 10);

                // Calculate estimated time remaining
                if (!window.readingStartTime) {
                    window.readingStartTime = Date.now();
                    processingStartTime = Date.now();
                }

                let estimatedTimeRemaining = null;
                if (percent > 0) {
                    const elapsed = (Date.now() - window.readingStartTime) / 1000; // seconds
                    const totalTime = (elapsed / percent) * 100;
                    estimatedTimeRemaining = Math.max(0, totalTime - elapsed);
                }

                updateProgressBar('processing', 'Processing log file', percent, estimatedTimeRemaining);
                // Don't add reading progress messages to the log
                return;
            }

            // Also check for initial reading message
            if (message.includes('Reading log file') && !message.includes('Reading:')) {
                updateProgressBar('processing', 'Processing log file', 0, null);
                processingStartTime = Date.now();
                // Don't add initial reading message to log either
                return;
            }

            // Filter out "Extracting metadata from header..." message (part of processing phase)
            if (message.includes('Extracting metadata from header')) {
                // Don't add to log
                return;
            }

            // For all other messages, add to log
            updateStorageProgress(message);

            // Update processing progress based on "Processed X lines" messages
            const processedMatch = message.match(/Processed\s+(\d+)\s+lines/i);
            if (processedMatch) {
                const processed = parseInt(processedMatch[1], 10);

                // Try to get total from message or estimate
                const totalLinesMatch = message.match(/Total lines:\s*(\d+)/i);
                const totalLines = totalLinesMatch ? parseInt(totalLinesMatch[1], 10) : null;

                if (totalLines && processed <= totalLines) {
                    const percent = (processed / totalLines) * 100;

                    // Calculate estimated time remaining
                    let estimatedTimeRemaining = null;
                    if (processingStartTime && percent > 0) {
                        const elapsed = (Date.now() - processingStartTime) / 1000; // seconds
                        const totalTime = (elapsed / percent) * 100;
                        estimatedTimeRemaining = Math.max(0, totalTime - elapsed);
                    }

                    updateProgressBar('processing', 'Processing log file', percent, estimatedTimeRemaining);
                } else if (!totalLines && processed > 0) {
                    // If we don't have total yet, show minimal progress (just to indicate activity)
                    updateProgressBar('processing', 'Processing log file', 1, null);
                }
            }
        };

        const parser = new UnityLogParser(db, progressCallback);

        // Storage progress callback for database operations
        const storageProgressCallback = (phaseId, phaseLabel, percent, estimatedTimeRemaining) => {
            updateProgressBar(phaseId, phaseLabel, percent, estimatedTimeRemaining);
        };

        // Parse the file
        updateStorageProgress('Starting to parse log file...');
        window.readingStartTime = Date.now(); // Track start time for time estimation

        const { logId, logLines, assetImports, pipelineRefreshes, operations } = await parser.parseLogFile(file, batchCancelSignal, storageProgressCallback);

        window.readingStartTime = null; // Clear after completion

        // Mark processing as complete
        completeProgressBar('processing');

        // Store asset imports with progress reporting
        if (assetImports && assetImports.length > 0) {
            updateStorageProgress(`Storing ${assetImports.length} asset imports...`);
            updateProgressBar('storing_asset_imports', 'Filling Database', 0, null);

            // Progress callback for asset import storage
            let lastReportedPercent = 0;
            const assetProgressCallback = (batchNum, totalBatches, processed, total, percent, estimatedTimeRemaining) => {
                // Only update UI every 2%
                if (percent - lastReportedPercent >= 2 || percent === 100) {
                    updateProgressBar('storing_asset_imports', 'Filling Database', percent, estimatedTimeRemaining);
                    lastReportedPercent = percent;
                }
            };

            await db.bulkInsertAssetImports(assetImports, assetProgressCallback, batchCancelSignal);
            completeProgressBar('storing_asset_imports');
            updateStorageProgress(`✓ Stored ${assetImports.length} asset imports`);
        }

        // Store other data types (these are smaller, so no progress bars needed)
        if (pipelineRefreshes && pipelineRefreshes.length > 0) {
            updateStorageProgress(`Storing ${pipelineRefreshes.length} pipeline refreshes...`);
            await db.bulkInsertPipelineRefreshes(pipelineRefreshes);
            updateStorageProgress(`✓ Stored ${pipelineRefreshes.length} pipeline refreshes`);
        }



        if (operations && operations.length > 0) {
            updateStorageProgress(`Storing ${operations.length} operations...`);
            await db.bulkInsertOperations(operations);
            updateStorageProgress(`✓ Stored ${operations.length} operations`);
        }

        // Store log lines using the existing worker system
        // Log lines are no longer stored - they're read from file on demand

        // Show completion
        updateStorageProgress('✓ Parsing complete!');
        updateStorageProgress(`✓ Database: ${db.dbName}`);

        // Cancel any active file watching when parsing a new file
        if (window.liveMonitor) {
            const activeMonitors = window.liveMonitor.getActiveMonitors();
            for (const activeLogId of activeMonitors) {
                await window.liveMonitor.stopMonitoring(activeLogId);
            }
        }

        // Clear file handle and path
        window.currentFileHandle = null;
        window.currentFilePath = null;

        // Final dashboard update after parsing completes
        if (typeof loadOverview === 'function') {
            loadOverview(false); // Full update after completion
        }

        // Automatically close overlay after a short delay
        // Dashboard refresh will happen when user clicks "Close & Refresh Dashboard" button
        setTimeout(() => {
            closeLogParser(); // This keeps the worker alive
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
window.openLogParser = function () {
    originalOpenLogParser();
    initializeParserFileInput();
};

