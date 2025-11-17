/**
 * Log Lines Progress Tracker
 * Monitors background Web Worker progress for log line insertion
 */

/**
 * Format time remaining in a readable format
 */
function formatTimeRemaining(seconds) {
    if (seconds === null || seconds < 0) {
        return 'Calculating...';
    }
    if (seconds < 60) {
        return `${Math.ceil(seconds)}s`;
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
 * Get current progress state from localStorage
 */
function getLogLinesProgress() {
    try {
        const progressStr = localStorage.getItem('log_lines_worker_progress');
        if (!progressStr) return null;
        return JSON.parse(progressStr);
    } catch (e) {
        return null;
    }
}

/**
 * Update progress indicator on dashboard
 */
function updateLogLinesProgressIndicator() {
    const indicator = document.getElementById('log-lines-progress-indicator');
    const text = document.getElementById('log-lines-progress-text');
    const progressBarContainer = document.getElementById('log-lines-progress-bar-container');
    const progressBarFill = document.getElementById('log-lines-progress-bar-fill');
    const progressBarText = document.getElementById('log-lines-progress-bar-text');
    
    const progress = getLogLinesProgress();
    
    if (!progress || progress.status === 'complete' || progress.status === 'error') {
        // Hide indicators if complete or error
        if (indicator) indicator.style.display = 'none';
        if (progressBarContainer) progressBarContainer.style.display = 'none';
        return;
    }
    
    if (progress.status === 'in_progress') {
        const percent = progress.percent || 0;
        const timeRemaining = progress.estimatedTimeRemaining;
        
        // Update header indicator
        if (indicator && text) {
            indicator.style.display = 'inline';
            let progressText = `${percent.toFixed(1)}%`;
            if (timeRemaining !== null && timeRemaining >= 0) {
                progressText += ` (${formatTimeRemaining(timeRemaining)} remaining)`;
            } else {
                progressText += ' (calculating...)';
            }
            text.textContent = progressText;
        }
        
        // Update thin progress bar above stats (always show it, even if stats aren't visible yet)
        if (progressBarContainer && progressBarFill && progressBarText) {
            progressBarContainer.style.display = 'block';
            progressBarContainer.style.visibility = 'visible';
            progressBarFill.style.width = `${percent}%`;
            progressBarText.textContent = `${percent.toFixed(1)}%`;
            
            // Ensure it's visible even if stats grid isn't shown yet
            const statsGrid = document.getElementById('stats');
            if (statsGrid && statsGrid.style.display === 'none') {
                // Stats aren't visible yet, but show progress bar anyway
                progressBarContainer.style.marginTop = '20px';
            }
        } else {
            // Debug: log if elements aren't found
            if (!progressBarContainer) console.warn('[Progress] progressBarContainer not found');
            if (!progressBarFill) console.warn('[Progress] progressBarFill not found');
            if (!progressBarText) console.warn('[Progress] progressBarText not found');
        }
    }
}

/**
 * Start polling for progress updates
 */
let progressPollInterval = null;

function startProgressPolling() {
    // Clear any existing interval
    if (progressPollInterval) {
        clearInterval(progressPollInterval);
    }
    
    // Update immediately
    updateLogLinesProgressIndicator();
    
    // Poll every 500ms
    progressPollInterval = setInterval(() => {
        updateLogLinesProgressIndicator();
        
        // Stop polling if complete
        const progress = getLogLinesProgress();
        if (progress && (progress.status === 'complete' || progress.status === 'error')) {
            stopProgressPolling();
        }
    }, 500);
}

/**
 * Stop polling for progress updates
 */
function stopProgressPolling() {
    if (progressPollInterval) {
        clearInterval(progressPollInterval);
        progressPollInterval = null;
    }
}

// Export for use in other modules
window.updateLogLinesProgressIndicator = updateLogLinesProgressIndicator;
window.getLogLinesProgress = getLogLinesProgress;
window.startProgressPolling = startProgressPolling;
window.stopProgressPolling = stopProgressPolling;
window.formatTimeRemaining = formatTimeRemaining;

