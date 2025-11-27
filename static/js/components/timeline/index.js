/**
 * Timeline Module
 * Handles project load timeline visualization
 */

import { renderTimelineVisualization, drawConnectingLines } from './renderer.js';
import { showTimelineTooltip, hideTimelineTooltip } from './tooltip.js';

// Store timeline data and resize handler for cleanup
let currentTimelineData = null;
let currentTimelineContainer = null;
let resizeTimeoutId = null;
let resizeHandler = null;

/**
 * Display timeline visualization
 * @param {Object} data - Timeline data (unused, fetches from API)
 */
export function displayTimeline(data) {
    const container = document.getElementById('timeline-container');
    if (!container) {
        console.error('[Timeline] timeline-container element not found');
        return;
    }

    const startTime = performance.now();

    // Fetch both timeline data and summary to get category breakdown for color matching
    Promise.all([
        window.apiClient.getTimeline(),
        window.apiClient.getSummary()
    ])
        .then(([timelineData, summary]) => {
            // Extract category data from summary
            const categoryData = summary.by_category || [];

            try {
                // Store data for resize handler
                currentTimelineData = timelineData;
                currentTimelineContainer = container;

                // Remove old resize handler if exists
                if (resizeHandler) {
                    window.removeEventListener('resize', resizeHandler);
                }

                // Create new resize handler with debouncing
                resizeHandler = function () {
                    if (resizeTimeoutId) {
                        clearTimeout(resizeTimeoutId);
                    }
                    resizeTimeoutId = setTimeout(() => {
                        if (currentTimelineContainer && currentTimelineData) {
                            drawConnectingLines(currentTimelineContainer, currentTimelineData);
                        }
                    }, 150);
                };

                window.addEventListener('resize', resizeHandler);

                renderTimelineVisualization(container, timelineData, categoryData);
            } catch (renderError) {
                console.error('[Timeline] Error during rendering:', renderError);
                container.innerHTML = '<p style="color: #ff4444;">Error rendering timeline: ' + renderError.message + '</p>';
            }
        })
        .catch(error => {
            const totalTime = performance.now() - startTime;
            console.error(`[Timeline] Failed to load timeline after ${totalTime.toFixed(2)}ms:`, error);
            if (container) {
                container.innerHTML = '<p style="color: #ff4444;">Failed to load timeline data: ' + error.message + '</p>';
            }
        });
}

/**
 * Navigate to a log line (used by timeline click handlers)
 * @param {number} lineNumber - Line number to navigate to
 */
export function navigateToLogLine(lineNumber) {
    if (lineNumber && lineNumber > 0) {
        if (typeof openLogViewer === 'function') {
            openLogViewer(lineNumber);
        } else if (window.openLogViewer) {
            window.openLogViewer(lineNumber);
        }
    } else {
        console.warn('No line number available for this timeline segment');
    }
}

// Re-export tooltip functions for global access
export { showTimelineTooltip, hideTimelineTooltip };

