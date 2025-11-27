/**
 * File Watcher Setup UI
 * Provides download button and instructions for running the file watcher service
 * Works with both local and remote (GitHub Pages) hosting
 */

class FileWatcherSetup {
    constructor() {
        this.checkInterval = null;
    }

    /**
     * Show setup instructions if file watcher is not available
     */
    async checkAndShowSetup() {
        if (window.liveMonitor) {
            const available = await window.liveMonitor.checkFileWatcherAvailability();
            if (!available) {
                this.showSetupInstructions();
            } else {
                this.hideSetupInstructions();
            }
        }
    }

    /**
     * Show setup instructions UI as a modal dialog
     */
    showSetupInstructions() {
        // Check if instructions already exist
        let backdrop = document.getElementById('file-watcher-setup-backdrop');
        if (backdrop) {
            backdrop.style.display = 'flex';
            return;
        }

        // Create backdrop overlay
        backdrop = document.createElement('div');
        backdrop.id = 'file-watcher-setup-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        backdrop.onclick = (e) => {
            if (e.target === backdrop) {
                this.hideSetupInstructions();
            }
        };

        // Create instructions div (modal)
        const instructionsDiv = document.createElement('div');
        instructionsDiv.id = 'file-watcher-setup';
        instructionsDiv.style.cssText = `
            position: relative;
            background: #fff;
            border: 2px solid #667eea;
            border-radius: 8px;
            padding: 25px;
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10001;
            font-size: 0.95em;
        `;

        instructionsDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #667eea;">📡 Enable File Monitoring</h3>
                <button onclick="window.fileWatcherSetup.hideSetupInstructions()" style="background: none; border: none; font-size: 1.5em; cursor: grab; color: #999;">×</button>
            </div>
            <p style="margin: 0 0 15px 0; color: #666;">
                To live monitor the Unity Editor log file, download and run the editor log watcher service. For previously saved logs, use the "Parse Log File" button instead.
            </p>
            <ol style="margin: 0 0 15px 0; padding-left: 20px; color: #666;">
                <li>Download the editor log watcher script</li>
                <li>Open terminal in the download folder</li>
                <li>Run: <code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">python3 editor_log_watcher.py</code></li>
                <li>Keep it running while monitoring</li>
            </ol>
            <div style="display: flex; gap: 10px;">
                <button id="download-watcher-btn" style="flex: 1; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: grab; font-weight: 600;">
                    📥 Download Editor Log Watcher
                </button>
                <button onclick="window.fileWatcherSetup.checkAndShowSetup()" style="flex: 1; padding: 10px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: grab; font-weight: 600;">
                    🔄 Check Again
                </button>
            </div>
            <p style="margin: 15px 0 0 0; font-size: 0.85em; color: #999;">
                The editor log watcher runs locally and only communicates with this browser tab.
            </p>
        `;

        backdrop.appendChild(instructionsDiv);
        document.body.appendChild(backdrop);

        // Setup download button
        const downloadBtn = document.getElementById('download-watcher-btn');
        if (downloadBtn) {
            downloadBtn.onclick = () => this.downloadFileWatcher();
        }

        // Periodically check if file watcher becomes available
        if (!this.checkInterval) {
            this.checkInterval = setInterval(() => {
                if (window.liveMonitor) {
                    window.liveMonitor.checkFileWatcherAvailability().then(available => {
                        if (available) {
                            this.hideSetupInstructions();
                        }
                    });
                }
            }, 5000); // Check every 5 seconds
        }
    }

    /**
     * Hide setup instructions
     */
    hideSetupInstructions() {
        const backdrop = document.getElementById('file-watcher-setup-backdrop');
        if (backdrop) {
            backdrop.remove();
        }
        const instructionsDiv = document.getElementById('file-watcher-setup');
        if (instructionsDiv) {
            instructionsDiv.remove();
        }
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    /**
     * Download the file watcher script
     */
    async downloadFileWatcher() {
        const downloadBtn = document.getElementById('download-watcher-btn');
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.textContent = '⏳ Downloading...';
        }

        try {
            let scriptContent = null;
            let source = '';

            // Try to fetch from the same origin first (if running locally via start.py)
            try {
                const response = await fetch('/editor_log_watcher.py');
                if (response.ok) {
                    scriptContent = await response.text();
                    source = 'local server';
                }
            } catch (e) {
                // Not available locally
            }

            // If not available locally, try GitHub raw URL
            if (!scriptContent) {
                const githubRawUrl = this.getGitHubRawUrl();
                if (githubRawUrl) {
                    try {
                        const response = await fetch(githubRawUrl);
                        if (response.ok) {
                            scriptContent = await response.text();
                            source = 'GitHub';
                        }
                    } catch (e) {
                        console.warn('Could not fetch from GitHub:', e);
                    }
                }
            }

            // If still no content, show instructions to download manually
            if (!scriptContent) {
                const githubRawUrl = this.getGitHubRawUrl() || 'the repository';
                if (window.showToast) {
                    window.showToast(`Could not download automatically. Please download manually from: ${githubRawUrl}`, 'error', 6000);
                } else {
                    console.error(`Could not download automatically. Please download manually from: ${githubRawUrl}`);
                }
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                    downloadBtn.textContent = '📥 Download Editor Log Watcher';
                }
                return;
            }

            // Create download
            const blob = new Blob([scriptContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'editor_log_watcher.py';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Hide the setup instructions modal
            this.hideSetupInstructions();
            
            // Show download complete modal with auto-polling
            this.showDownloadCompleteModal();

            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = '📥 Download Editor Log Watcher';
            }
        } catch (error) {
            console.error('Error downloading editor log watcher:', error);
            if (window.showToast) {
                window.showToast('Error downloading editor log watcher. Please check the console for details or download manually from the repository.', 'error');
            }
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = '📥 Download Editor Log Watcher';
            }
        }
    }

    /**
     * Get GitHub raw URL for editor_log_watcher.py
     */
    getGitHubRawUrl() {
        const hostname = window.location.hostname;
        
        // Try to detect GitHub Pages URL pattern: username.github.io/repo-name
        if (hostname.includes('github.io')) {
            const pathParts = window.location.pathname.split('/').filter(p => p);
            if (pathParts.length >= 1) {
                const repoName = pathParts[0];
                const username = hostname.split('.')[0];
                // Try main branch first, then master
                return `https://raw.githubusercontent.com/${username}/${repoName}/main/editor_log_watcher.py`;
            }
        }
        
        // If we can't detect, return null and let the user know
        return null;
    }

    /**
     * Show download complete modal with auto-polling for watcher service
     */
    showDownloadCompleteModal() {
        // Remove existing dialog if any
        const existing = document.getElementById('file-watcher-download-complete-dialog');
        if (existing) {
            existing.remove();
        }

        // Clear any existing poll interval
        if (this.downloadCompletePollInterval) {
            clearInterval(this.downloadCompletePollInterval);
            this.downloadCompletePollInterval = null;
        }

        // Create backdrop overlay
        const backdrop = document.createElement('div');
        backdrop.id = 'file-watcher-download-complete-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10002;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        backdrop.onclick = (e) => {
            if (e.target === backdrop) {
                this.hideDownloadCompleteModal();
            }
        };

        const dialog = document.createElement('div');
        dialog.id = 'file-watcher-download-complete-dialog';
        dialog.style.cssText = `
            position: relative;
            background: white;
            border: 2px solid #667eea;
            border-radius: 8px;
            padding: 25px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10003;
            font-size: 0.95em;
        `;

        // Store state on the instance
        this.downloadCompleteStatus = 'waiting'; // 'waiting' or 'found'

        // Add pulse animation if not already present
        if (!document.getElementById('pulse-animation-style')) {
            const style = document.createElement('style');
            style.id = 'pulse-animation-style';
            style.textContent = '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }';
            document.head.appendChild(style);
        }

        const updateDialog = () => {
            const statusLight = this.downloadCompleteStatus === 'waiting' 
                ? '<span class="monitoring-light" style="width: 12px; height: 12px; border-radius: 50%; background: #ff9800; animation: pulse 2s infinite; display: inline-block;"></span>'
                : '<span class="monitoring-light" style="width: 12px; height: 12px; border-radius: 50%; background: #4CAF50; display: inline-block;"></span>';
            
            const statusText = this.downloadCompleteStatus === 'waiting'
                ? '<span style="color: #666;">Waiting for editor log watcher service...</span>'
                : '<span style="color: #2e7d32; font-weight: 500;">✓ Success! Service found</span>';
            
            const watchButton = this.downloadCompleteStatus === 'found'
                ? '<button id="watch-log-btn" onclick="window.fileWatcherSetup.startWatchingFromModal()" style="width: 100%; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: grab; font-weight: 600; margin-top: 15px;">Watch Log</button>'
                : '';

            dialog.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0; color: #667eea;">✓ Download Complete!</h3>
                    <button onclick="window.fileWatcherSetup.hideDownloadCompleteModal()" style="background: none; border: none; font-size: 1.5em; cursor: grab; color: #999;">×</button>
                </div>
                <div style="margin-bottom: 20px;">
                    <p style="margin: 0 0 15px 0; color: #666;">
                        Next steps:
                    </p>
                    <ol style="margin: 0 0 20px 0; padding-left: 20px; color: #666;">
                        <li>Open terminal/command prompt</li>
                        <li>Navigate to the download folder</li>
                        <li>Run: <code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">python3 editor_log_watcher.py</code></li>
                        <li>Keep it running while monitoring</li>
                    </ol>
                    <div style="display: flex; align-items: center; gap: 10px; padding: 12px; background: #f8f9fa; border-radius: 6px; margin-bottom: 15px;">
                        ${statusLight}
                        ${statusText}
                    </div>
                    ${watchButton}
                </div>
                <button onclick="window.fileWatcherSetup.hideDownloadCompleteModal()" style="width: 100%; padding: 10px; background: #f0f0f0; color: #666; border: none; border-radius: 6px; cursor: grab; font-weight: 600;">
                    Cancel
                </button>
            `;
        };

        // Initial render
        updateDialog();

        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        // Start polling for watcher service
        const pollForService = async () => {
            if (!window.liveMonitor) return;
            
            const available = await window.liveMonitor.checkFileWatcherAvailability();
            if (available && this.downloadCompleteStatus === 'waiting') {
                this.downloadCompleteStatus = 'found';
                updateDialog();
                if (this.downloadCompletePollInterval) {
                    clearInterval(this.downloadCompletePollInterval);
                    this.downloadCompletePollInterval = null;
                }
            }
        };

        // Poll every 2 seconds
        this.downloadCompletePollInterval = setInterval(pollForService, 2000);
        // Also check immediately
        pollForService();
    }

    /**
     * Hide download complete modal
     */
    hideDownloadCompleteModal() {
        const backdrop = document.getElementById('file-watcher-download-complete-backdrop');
        if (backdrop) {
            backdrop.remove();
        }
        const dialog = document.getElementById('file-watcher-download-complete-dialog');
        if (dialog) {
            dialog.remove();
        }
        if (this.downloadCompletePollInterval) {
            clearInterval(this.downloadCompletePollInterval);
            this.downloadCompletePollInterval = null;
        }
        this.downloadCompleteStatus = null;
    }

    /**
     * Start watching from the download complete modal
     */
    async startWatchingFromModal() {
        this.hideDownloadCompleteModal();
        
        // Trigger the watch editor log function
        if (typeof toggleWatchEditorLog === 'function') {
            await toggleWatchEditorLog();
        } else if (window.toggleWatchEditorLog) {
            await window.toggleWatchEditorLog();
        }
    }
}

// Initialize
window.fileWatcherSetup = new FileWatcherSetup();

// Don't check on page load - only show when user clicks "Watch Editor Log" and service isn't available

