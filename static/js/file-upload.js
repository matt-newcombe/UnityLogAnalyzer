/**
 * File Upload Module
 * Handles log file upload and progress tracking
 * Note: File upload functionality has been moved to log-parser-page.js overlay
 * This file now only contains utility functions for the dashboard
 */
        
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
         * Update batch progress bar
         */
        function updateBatchProgress(percent, estimatedTimeRemaining) {
            const container = document.getElementById('batch-progress-container');
            const progressBar = document.getElementById('batch-progress-bar');
            const progressText = document.getElementById('batch-progress-text');
            const timeText = document.getElementById('batch-progress-time');
            
            if (!container || !progressBar || !progressText || !timeText) return;
            
            // Show container
            container.style.display = 'block';
            
            // Update progress bar
            progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
            progressText.textContent = `${percent.toFixed(1)}%`;
            
            // Update time remaining
            timeText.textContent = `Estimated time remaining: ${formatTimeRemaining(estimatedTimeRemaining)}`;
        }
        
        /**
         * Hide batch progress bar
         */
        function hideBatchProgress() {
            const container = document.getElementById('batch-progress-container');
            if (container) {
                container.style.display = 'none';
            }
        }
        
        /**
         * Update progress display with message and database size
         */
        function updateStorageProgress(message, dbSizeMB = null) {
            // Progress feedback removed - no UI updates
        }

        /**
         * Store parsed data from server into IndexedDB
         * 
         * NOTE: This function has been REMOVED.
         * File upload is now handled by log-parser-page.js overlay which uses Web Workers.
         * This stub prevents any accidental calls from breaking.
         */
        async function storeParsedDataInIndexedDB(logId) {
            console.error('ERROR: Old storeParsedDataInIndexedDB called from file-upload.js - this should not happen!');
            console.error('File upload should use the overlay parser (log-parser-page.js) instead.');
            throw new Error('Old file upload function called - use the overlay parser instead');
        }

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

        // Export loadLogList to global scope
        window.loadLogList = async function() {
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
        };
        
        // Export clearDashboard to global scope
        window.clearDashboard = clearDashboard;


        // OLD handleFileSelect - DEPRECATED
        // This function is no longer used - file upload is now handled by log-parser-page.js overlay
        // Keeping for reference but it should not be called
        function handleFileSelect_OLD_DEPRECATED(event) {
            console.warn('Old handleFileSelect called - this should not happen. Use the overlay parser instead.');
            // Do nothing - file upload should go through the overlay
        }


                    function updateProgress() {
                        if (messageBuffer.length === 0) return;
                        
                        // Get current content
                        let currentText = progressDiv.textContent;
                        const currentLines = currentText.split('\n').filter(l => l.trim());
                        
                        // Add new messages
                        messageBuffer.forEach(msg => {
                            if (msg.trim()) {
                                currentLines.push(msg.trim());
                            }
                        });
                        
                        // Keep only recent lines to prevent DOM bloat
                        if (currentLines.length > MAX_LINES) {
                            currentLines.splice(0, currentLines.length - MAX_LINES);
                        }
                        
                        // Update DOM in one operation
                        progressDiv.textContent = currentLines.join('\n');
                        progressDiv.scrollTop = progressDiv.scrollHeight;
                        
                        // Clear buffer
                        messageBuffer.length = 0;
                        updateScheduled = false;
                    }


                    function scheduleUpdate() {
                        if (!updateScheduled) {
                            updateScheduled = true;
                            requestAnimationFrame(updateProgress);
                        }
                    }


        function updateProjectName(projectName) {
            const projectNameEl = document.getElementById('project-name');
            if (projectNameEl && projectName) {
                projectNameEl.textContent = `- ${projectName}`;
            } else if (projectNameEl) {
                projectNameEl.textContent = '';
            }
        }


        function updateUnityVersion(unityVersion) {
            const unityVersionEl = document.getElementById('unity-version');
            if (unityVersionEl && unityVersion && unityVersion !== 'Unknown') {
                unityVersionEl.textContent = `(${unityVersion})`;
            } else if (unityVersionEl) {
                unityVersionEl.textContent = '';
            }
        }

