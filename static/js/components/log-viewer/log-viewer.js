/**
 * Log Viewer Module
 * Handles the overlay log viewer functionality
 */

/**
 * Open the log viewer overlay at a specific line number or with a filter
 * @param {number|string} lineNumberOrFilter - Line number to highlight and scroll to, or filter type ('import', 'pipeline')
 * @param {string} filter - Optional filter type if lineNumberOrFilter is a number
 */
function openLogViewer(lineNumberOrFilter, filter) {
    const overlay = document.getElementById('log-viewer-overlay');
    const panel = document.getElementById('log-viewer-panel');
    
    if (!overlay || !panel) {
        console.error('Log viewer overlay not found');
        return;
    }
    
    overlay.classList.add('active');
    panel.classList.add('active');
    
    // Prevent body scroll when overlay is open
    document.body.style.overflow = 'hidden';
    
    // Determine if we have a filter or line number
    let lineNumber = null;
    let filterType = null;
    
    if (typeof lineNumberOrFilter === 'number') {
        lineNumber = lineNumberOrFilter;
        filterType = filter || null;
    } else if (typeof lineNumberOrFilter === 'string') {
        // It's a filter type
        filterType = lineNumberOrFilter;
    }
    
    // Load log content with filter or line number
    loadLogViewerContent(lineNumber, filterType);
}

/**
 * Open log viewer with a filter using the inline overlay
 * @param {string} filter - Filter to apply ('import', 'pipeline')
 */
function openLogViewerWithFilter(filter) {
    openLogViewer(filter);
}

/**
 * Close the log viewer overlay
 */
function closeLogViewer() {
    const overlay = document.getElementById('log-viewer-overlay');
    const panel = document.getElementById('log-viewer-panel');
    
    if (overlay) overlay.classList.remove('active');
    if (panel) panel.classList.remove('active');
    
    // Restore body scroll
    document.body.style.overflow = '';
}

/**
 * Load log content from the API
 * @param {number} lineNumber - Line number to load content around (optional if filter is provided)
 * @param {string} filterType - Filter type ('import', 'pipeline') (optional)
 */
async function loadLogViewerContent(lineNumber, filterType) {
    const content = document.getElementById('log-viewer-content');
    const loading = document.getElementById('log-viewer-loading');
    const stats = document.getElementById('log-viewer-stats');
    
    if (!content || !getCurrentLogId()) return;
    
    // Check if log lines are still being loaded in background
    const progress = window.getLogLinesProgress ? window.getLogLinesProgress() : null;
    const currentLogId = getCurrentLogId();
    
    // If worker just completed, wait longer for IndexedDB to finalize transactions
    if (progress && progress.status === 'complete' && progress.logId === currentLogId) {
        // Worker just completed - give IndexedDB more time to finalize
        // IndexedDB transactions can take a moment to commit
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (progress && progress.status === 'in_progress' && progress.logId === currentLogId) {
        // Show progress instead of trying to load
        if (loading) loading.style.display = 'none';
        if (content) {
            const percent = progress.percent || 0;
            const timeRemaining = progress.estimatedTimeRemaining;
            const processed = progress.processedLines || 0;
            const total = progress.totalLines || 0;
            
            let progressText = `Log lines are being loaded in the background...<br>`;
            progressText += `Progress: ${percent.toFixed(1)}% (${processed.toLocaleString()} / ${total.toLocaleString()} lines)<br>`;
            if (timeRemaining !== null && timeRemaining >= 0) {
                progressText += `Estimated time remaining: ${window.formatTimeRemaining ? window.formatTimeRemaining(timeRemaining) : timeRemaining.toFixed(0) + 's'}`;
            } else {
                progressText += `Calculating time remaining...`;
            }
            
            content.innerHTML = `
                <div style="color: #667eea; text-align: center; padding: 50px; line-height: 1.8;">
                    <div style="font-size: 1.2em; margin-bottom: 20px;">⏳ Loading Log Lines</div>
                    <div style="font-size: 0.9em; color: #666;">
                        ${progressText}
                    </div>
                    <div style="margin-top: 30px; width: 100%; max-width: 400px; margin-left: auto; margin-right: auto;">
                        <div style="width: 100%; height: 24px; background-color: #e0e0e0; border-radius: 12px; overflow: hidden; position: relative;">
                            <div style="height: 100%; background-color: #4CAF50; width: ${percent}%; transition: width 0.3s ease; border-radius: 12px;"></div>
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 0.85em; font-weight: bold; color: #333; text-shadow: 0 0 2px white;">
                                ${percent.toFixed(1)}%
                            </div>
                        </div>
                    </div>
                    <div style="margin-top: 20px; font-size: 0.85em; color: #999;">
                        You can close this and return to the dashboard. The log viewer will be available once loading completes.
                    </div>
                </div>
            `;
            
            // Poll for updates
            const progressInterval = setInterval(() => {
                const updatedProgress = window.getLogLinesProgress ? window.getLogLinesProgress() : null;
                if (updatedProgress && updatedProgress.status === 'in_progress' && updatedProgress.logId === currentLogId) {
                    // Update progress display
                    const newPercent = updatedProgress.percent || 0;
                    const newTimeRemaining = updatedProgress.estimatedTimeRemaining;
                    const newProcessed = updatedProgress.processedLines || 0;
                    const newTotal = updatedProgress.totalLines || 0;
                    
                    let newProgressText = `Log lines are being loaded in the background...<br>`;
                    newProgressText += `Progress: ${newPercent.toFixed(1)}% (${newProcessed.toLocaleString()} / ${newTotal.toLocaleString()} lines)<br>`;
                    if (newTimeRemaining !== null && newTimeRemaining >= 0) {
                        newProgressText += `Estimated time remaining: ${window.formatTimeRemaining ? window.formatTimeRemaining(newTimeRemaining) : newTimeRemaining.toFixed(0) + 's'}`;
                    } else {
                        newProgressText += `Calculating time remaining...`;
                    }
                    
                    content.innerHTML = `
                        <div style="color: #667eea; text-align: center; padding: 50px; line-height: 1.8;">
                            <div style="font-size: 1.2em; margin-bottom: 20px;">⏳ Loading Log Lines</div>
                            <div style="font-size: 0.9em; color: #666;">
                                ${newProgressText}
                            </div>
                            <div style="margin-top: 30px; width: 100%; max-width: 400px; margin-left: auto; margin-right: auto;">
                                <div style="width: 100%; height: 24px; background-color: #e0e0e0; border-radius: 12px; overflow: hidden; position: relative;">
                                    <div style="height: 100%; background-color: #4CAF50; width: ${newPercent}%; transition: width 0.3s ease; border-radius: 12px;"></div>
                                    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 0.85em; font-weight: bold; color: #333; text-shadow: 0 0 2px white;">
                                        ${newPercent.toFixed(1)}%
                                    </div>
                                </div>
                            </div>
                            <div style="margin-top: 20px; font-size: 0.85em; color: #999;">
                                You can close this and return to the dashboard. The log viewer will be available once loading completes.
                            </div>
                        </div>
                    `;
                } else {
                    // Loading complete or error - try to load again
                    clearInterval(progressInterval);
                    if (updatedProgress && updatedProgress.status === 'complete') {
                        // Retry loading
                        loadLogViewerContent(lineNumber, filterType);
                    } else if (updatedProgress && updatedProgress.status === 'error') {
                        content.innerHTML = `<div style="color: #f48771; text-align: center; padding: 50px;">Error loading log lines: ${updatedProgress.error || 'Unknown error'}</div>`;
                    }
                }
            }, 500);
            
            return;
        }
    }
    
    // Show loading
    if (loading) loading.style.display = 'block';
    if (content) content.innerHTML = '';
    
    try {
        // Build query options
        const queryOptions = {};
        if (lineNumber) {
            queryOptions.center_line = lineNumber;
        }
        if (filterType) {
            queryOptions.filter_type = filterType;
            // For filters, start from the beginning
            queryOptions.offset = 0;
            queryOptions.limit = 100;
        }
        
        const data = await window.apiClient.getLogViewer(queryOptions);
        
        if (data.lines && data.lines.length > 0) {
            renderLogLines(data.lines, lineNumber);
            
            // Update stats
            if (stats) {
                let statsText = `Total lines: ${data.total_lines || 0}`;
                if (filterType) {
                    statsText += ` | Filter: ${filterType} | Showing: ${data.lines.length} lines`;
                } else if (lineNumber) {
                    statsText += ` | Showing: ${data.lines.length} lines (around line ${lineNumber})`;
                } else {
                    statsText += ` | Showing: ${data.lines.length} lines`;
                }
                stats.innerHTML = `<span>${statsText}</span>`;
            }
        } else {
            // No lines found - check if worker just completed and retry with exponential backoff
            const progress = window.getLogLinesProgress ? window.getLogLinesProgress() : null;
            if (data.total_lines > 0) {
                
                // Retry up to 3 times with increasing delays
                let retryCount = 0;
                const maxRetries = 3;
                let retryData = null;
                
                while (retryCount < maxRetries && (!retryData || !retryData.lines || retryData.lines.length === 0)) {
                    const delay = 500 * Math.pow(2, retryCount); // 500ms, 1000ms, 2000ms
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    try {
                        retryData = await window.apiClient.getLogViewer(queryOptions);
                        if (retryData.lines && retryData.lines.length > 0) {
                            break;
                        }
                    } catch (retryError) {
                        console.error(`[Log Viewer] Retry ${retryCount + 1} failed:`, retryError);
                    }
                    retryCount++;
                }
                
                if (retryData && retryData.lines && retryData.lines.length > 0) {
                    renderLogLines(retryData.lines, lineNumber);
                    if (stats) {
                        stats.innerHTML = `
                            <span>Total lines: ${retryData.total_lines || 0}</span>
                            <span>Showing: ${retryData.lines.length} lines (around line ${lineNumber})</span>
                        `;
                    }
                } else {
                    console.error(`[Log Viewer] Failed to load lines after ${maxRetries} retries. Total lines: ${data.total_lines}`);
                    if (content) {
                        content.innerHTML = `
                            <div style="color: #858585; text-align: center; padding: 50px;">
                                <div>No log content available</div>
                                <div style="font-size: 0.9em; margin-top: 10px; color: #999;">
                                    Total lines in database: ${data.total_lines || 0}
                                </div>
                            </div>
                        `;
                    }
                }
            } else {
                if (content) content.innerHTML = '<div style="color: #858585; text-align: center; padding: 50px;">No log content available</div>';
            }
        }
    } catch (error) {
        console.error('Failed to load log content:', error);
        
        // Check if file blob is missing (page was reloaded)
        if (error.message && error.message.includes('File not found in memory cache')) {
            if (content) {
                content.innerHTML = `
                    <div style="text-align: center; padding: 50px; max-width: 500px; margin: 0 auto;">
                        <div style="font-size: 2.5em; margin-bottom: 20px;">📄</div>
                        <div style="font-size: 1.1em; color: #e67e22; font-weight: 600; margin-bottom: 15px;">
                            Log File No Longer Available
                        </div>
                        <div style="color: #666; line-height: 1.6; margin-bottom: 25px;">
                            The page was reloaded and the log file is no longer in memory. 
                            To view log contents, please re-parse the original log file using the 
                            <strong>Parse Log File</strong> button.
                        </div>
                        <button onclick="closeLogViewer(); openLogParser();" 
                            style="background: #667eea; color: white; border: none; padding: 12px 24px; 
                                   border-radius: 6px; cursor: pointer; font-size: 1em; font-weight: 500;">
                            📁 Parse Log File
                        </button>
                    </div>
                `;
            }
            return;
        }
        
        // Check if it's because log lines aren't loaded yet
        if (error.message && error.message.includes('No log lines found')) {
            const progress = window.getLogLinesProgress ? window.getLogLinesProgress() : null;
            if (progress && progress.status === 'in_progress') {
                // Recursively call to show progress
                loadLogViewerContent(lineNumber, filterType);
                return;
            }
        }
        if (content) content.innerHTML = '<div style="color: #f48771; text-align: center; padding: 50px;">Failed to load log content</div>';
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

/**
 * Render log lines in the viewer
 * @param {Array} lines - Array of log line objects
 * @param {number} highlightLine - Line number to highlight
 */
function renderLogLines(lines, highlightLine) {
    const content = document.getElementById('log-viewer-content');
    if (!content) return;
    
    content.innerHTML = lines.map(line => {
        const lineClasses = ['log-viewer-line'];
        if (line.line_type) lineClasses.push(line.line_type);
        if (line.line_number == highlightLine) lineClasses.push('highlighted');
        
        const timestamp = line.timestamp ? `<span class="timestamp">${line.timestamp}</span>` : '';
        
        return `
            <div class="${lineClasses.join(' ')}" data-line="${line.line_number}">
                <span class="log-viewer-line-number">${line.line_number}</span>
                <span class="log-viewer-line-content">${timestamp}${escapeHtml(line.content || '')}</span>
            </div>
        `;
    }).join('');
    
    // Scroll to highlighted line
    if (highlightLine) {
        setTimeout(() => {
            const highlighted = content.querySelector(`[data-line="${highlightLine}"]`);
            if (highlighted) {
                highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Navigate to a specific log line (alias for openLogViewer)
 * @param {number} lineNumber - Line number to navigate to
 */
function navigateToLogLine(lineNumber) {
    if (lineNumber && lineNumber > 0) {
        openLogViewer(lineNumber);
    } else {
        console.warn('No line number available for this timeline segment');
    }
}

/**
 * Filter log viewer content by type
 * @param {string} filter - Filter type ('all', 'import', 'pipeline')
 */
function filterLogViewer(filter) {
    // Filtering not yet supported for file-based log viewing
    
    // Update active button state
    document.querySelectorAll('.log-viewer-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
}

/**
 * Search log viewer content
 * @param {string} query - Search query
 */
function searchLogViewer(query) {
    // Search not yet supported for file-based log viewing
}

/**
 * Initialize log viewer keyboard shortcuts
 */
function initLogViewerKeyboard() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('log-viewer-overlay');
            if (overlay && overlay.classList.contains('active')) {
                closeLogViewer();
            }
        }
    });
}

// Initialize keyboard shortcuts when module loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogViewerKeyboard);
} else {
    initLogViewerKeyboard();
}

