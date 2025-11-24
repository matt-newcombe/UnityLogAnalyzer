/**
 * LiveMonitorUI
 * Handles DOM updates for the Live Monitor
 */
export class LiveMonitorUI {
    constructor() {
        this.updateDebounceTimer = null;
        this.updateDebounceDelay = 1000; // Update UI at most once per second
        this.pendingUpdate = false;
        this.statusIndicatorId = 'live-monitor-indicator';
    }

    /**
     * Update the status indicator in the UI
     * @param {number} logId 
     * @param {boolean} isMonitoring 
     * @param {string} message 
     */
    updateStatus(logId, isMonitoring, message = null) {
        // Find or create status indicator
        let indicator = document.getElementById(`${this.statusIndicatorId}-${logId}`);

        if (!indicator && isMonitoring) {
            // Create indicator in header
            const headerNav = document.querySelector('.header-nav');
            if (headerNav) {
                indicator = document.createElement('div');
                indicator.id = `${this.statusIndicatorId}-${logId}`;
                indicator.className = 'live-monitor-indicator';
                indicator.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; background: #e8f5e9; border-radius: 4px; font-size: 0.85em; color: #2e7d32; margin-left: 10px;';
                indicator.innerHTML = `
                    <span style="display: inline-block; width: 8px; height: 8px; background: #4CAF50; border-radius: 50%; animation: pulse 2s infinite;"></span>
                    <span class="monitor-text">Watching file...</span>
                    <span class="last-message-time" style="margin-left: 8px; color: #666; font-size: 0.85em; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
                `;
                headerNav.appendChild(indicator);

                // Add pulse animation if not exists
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
     * Update the last message received time and content display
     * @param {number} logId
     * @param {Date|string} timestamp 
     * @param {string} messageContent 
     */
    updateLastMessage(logId, timestamp, messageContent = null) {
        if (!timestamp) return;

        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffSeconds = Math.floor(diffMs / 1000);

        let timeText = '';
        if (diffSeconds < 1) {
            timeText = 'just now';
        } else if (diffSeconds < 60) {
            timeText = `${diffSeconds}s ago`;
        } else {
            const diffMinutes = Math.floor(diffSeconds / 60);
            if (diffMinutes < 60) {
                timeText = `${diffMinutes}m ago`;
            } else {
                const diffHours = Math.floor(diffMinutes / 60);
                timeText = `${diffHours}h ago`;
            }
        }

        // Update header indicator
        const indicator = document.getElementById(`${this.statusIndicatorId}-${logId}`);
        if (indicator) {
            const timeSpan = indicator.querySelector('.last-message-time');
            if (timeSpan) {
                if (messageContent) {
                    // Truncate message if too long for header
                    const truncatedMessage = messageContent.length > 50 ? messageContent.substring(0, 47) + '...' : messageContent;
                    timeSpan.textContent = `Last: ${timeText} - ${truncatedMessage}`;
                } else {
                    timeSpan.textContent = `Last: ${timeText}`;
                }
            }
        }

        // Also update monitoring status in action bar if present
        const monitoringStatus = document.getElementById('monitoring-status');
        if (monitoringStatus && monitoringStatus.style.display !== 'none') {
            const lastMessageElement = document.getElementById('last-message-time');
            if (lastMessageElement) {
                if (messageContent) {
                    const truncatedMessage = messageContent.length > 80 ? messageContent.substring(0, 77) + '...' : messageContent;
                    lastMessageElement.textContent = `Last message (${timeText}): ${truncatedMessage}`;
                } else {
                    lastMessageElement.textContent = `Last message: ${timeText}`;
                }
            }
        }
    }

    /**
     * Schedule a debounced UI update
     * @param {Function} updateFn 
     */
    scheduleUpdate(updateFn) {
        this.pendingUpdate = true;

        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }

        this.updateDebounceTimer = setTimeout(async () => {
            if (this.pendingUpdate) {
                await updateFn();
                this.pendingUpdate = false;
            }
        }, this.updateDebounceDelay);
    }
}
