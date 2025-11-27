/**
 * Timeline Renderer Module
 * Handles rendering of timeline visualization
 */

import { formatTime, formatTimestamp } from '../../core/formatters.js';
import { showTimelineTooltip, hideTimelineTooltip } from './tooltip.js';
import { buildCategoryColorMap, buildCategoryColorMapFromItems } from '../../charts/colors.js';

/**
 * Render the timeline visualization with segments
 * @param {HTMLElement} container - Container element
 * @param {Object} timelineData - Timeline data from API
 * @param {Array} categoryData - Category breakdown data from API
 */
export function renderTimelineVisualization(container, timelineData, categoryData = []) {
    if (!timelineData || !timelineData.segments) {
        console.error('Invalid timeline data:', timelineData);
        container.innerHTML = '<p style="color: #ff4444;">Invalid timeline data</p>';
        return;
    }

    const totalTime = timelineData.total_time_ms / 1000;
    const segments = timelineData.segments || [];
    const summary = timelineData.summary || {};
    const totalTimeMs = timelineData.total_time_ms;

    if (!totalTimeMs || totalTimeMs <= 0) {
        console.error('Invalid total_time_ms:', totalTimeMs);
        container.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <p style="color: #ff4444; font-size: 1.1em; margin-bottom: 10px;">
                    No timeline data available
                </p>
                <p style="color: #666; font-size: 0.9em;">
                    The log file may not contain any import or operation data, or the data may still be processing.
                </p>
            </div>
        `;
        return;
    }

    // Build category color map
    const categoryColors = categoryData && categoryData.length > 0
        ? buildCategoryColorMap(categoryData)
        : buildCategoryColorMapFromItems(segments.filter(s => s.phase === 'AssetImports' && s.category));

    // Get unique categories for legend
    const uniqueCategories = categoryData && categoryData.length > 0
        ? categoryData.map(c => c.asset_category || c.category || 'Other')
        : Object.keys(categoryColors);

    // Detect segment types
    const hasOperations = segments.some(s => s.operation_type === 'Asset Pipeline Refresh');
    const hasCacheServer = segments.some(s => s.phase === 'CacheServerDownload');
    const hasWorkerPhases = timelineData.worker_threads && Object.keys(timelineData.worker_threads).length > 0 &&
        Object.keys(timelineData.worker_threads).some(workerId => {
            const workerData = timelineData.worker_threads[workerId];
            return workerData && workerData.phase_blocks && workerData.phase_blocks.length > 0;
        });

    // Build filter toggles HTML
    let filterTogglesHtml = '';
    if (hasOperations) {
        filterTogglesHtml += '<label style="font-size:0.9em; color:#555;"><input id="toggle-operations" type="checkbox" style="margin-right:6px;">Pipeline Refreshes</label>';
    }
    if (hasCacheServer) {
        filterTogglesHtml += '<label style="font-size:0.9em; color:#555;"><input id="toggle-cache" type="checkbox" checked style="margin-right:6px;">Cache Server</label>';
    }
    if (hasWorkerPhases) {
        filterTogglesHtml += '<label style="font-size:0.9em; color:#555;"><input id="toggle-worker-wait" type="checkbox" checked style="margin-right:6px;">Worker Wait Blocks</label>';
    }

    // Build main HTML
    let html = buildTimelineHeader(totalTime, summary, filterTogglesHtml);
    html += '<div id="main-timeline-lane" style="position: relative; width: 100%; height: 80px; background: #f5f5f5; border-radius: 8px; overflow: visible; margin-top: 50px; margin-bottom: 15px;">';

    // Render segments
    segments.forEach((segment) => {
        html += renderSegment(segment, totalTimeMs, categoryColors);
    });

    // Add timestamp labels
    if (timelineData.first_timestamp && timelineData.last_timestamp) {
        html += renderTimestampLabels(timelineData.first_timestamp, timelineData.last_timestamp);
    }

    // Worker thread phases
    const workerThreads = timelineData.worker_threads || {};
    const workerIds = Object.keys(workerThreads).sort((a, b) => parseInt(a) - parseInt(b));

    // Add worker phase overlays
    workerIds.forEach(workerId => {
        const workerData = workerThreads[workerId];
        const phaseBlocks = workerData.phase_blocks || [];
        phaseBlocks.forEach(phaseBlock => {
            html += renderWorkerPhaseOverlay(phaseBlock, totalTimeMs);
        });
    });

    html += '</div>';

    // Worker lanes
    if (workerIds.length > 0) {
        html += renderWorkerLanes(workerIds, workerThreads, totalTimeMs);
    }

    // Legend
    html += renderLegend(uniqueCategories, categoryColors);

    container.innerHTML = html;

    // Wire up filter toggles
    setupFilterToggles(container);

    // Draw connecting lines after render
    setTimeout(() => {
        drawConnectingLines(container, timelineData);
    }, 0);
}

/**
 * Build timeline header HTML
 */
function buildTimelineHeader(totalTime, summary, filterTogglesHtml) {
    return `
        <div style="margin-bottom: 10px; display:flex; flex-direction: column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items: center;">
                <h3 style="font-size: 1.8em; color: #667eea; margin: 0;">
                    Log Timeline
                </h3>
                ${filterTogglesHtml ? `<div style="display:flex; gap:12px; align-items:center;">${filterTogglesHtml}</div>` : ''}
            </div>
            <p style="color: #666; font-size: 0.9em; margin: 0;">
                Total time: ${formatTime(totalTime)} | Asset imports: ${formatTime(summary.asset_import_time_ms / 1000)} | Total imports: ${summary.total_imports || 0}
            </p>
        </div>
    `;
}

/**
 * Render a single timeline segment
 */
function renderSegment(segment, totalTimeMs, categoryColors) {
    const durationMs = segment.duration_ms || 0;
    const startTime = segment.start_time || 0;
    const widthPercent = Math.max(0, Math.min(100, (durationMs / totalTimeMs) * 100));
    const leftPercent = Math.max(0, Math.min(100, (startTime / totalTimeMs) * 100));

    let segmentColor = segment.color;
    if (segment.phase === 'AssetImports' && segment.category) {
        segmentColor = categoryColors[segment.category] || segment.color;
    }

    const isPipelineRefresh = segment.operation_type === 'Asset Pipeline Refresh';
    const isCacheServerDownload = segment.phase === 'CacheServerDownload';

    let segmentOpacity = '1';
    let segmentZIndex = '1';
    let segmentHeight = 'calc(100% - 6px)';
    let segmentTop = '3px';
    let wrapperBorder = { top: 'none', bottom: 'none', left: 'none', right: 'none' };

    if (isPipelineRefresh) {
        const borderStyle = '2px dashed rgba(59, 130, 246, 0.8)';
        segmentOpacity = '0.125';
        if (widthPercent >= 0.5) {
            wrapperBorder = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
        }
        segmentZIndex = '0';
        segmentColor = '#3b82f6';
        segmentHeight = '100%';
        segmentTop = '0';
    } else if (isCacheServerDownload) {
        const borderStyle = '2px dashed rgba(156, 39, 176, 0.8)';
        segmentOpacity = '0.125';
        if (widthPercent >= 0.5) {
            wrapperBorder = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
        }
        segmentZIndex = '0';
        segmentColor = '#9C27B0';
        segmentHeight = '100%';
        segmentTop = '0';
    }

    const lineNumber = segment.line_number || null;
    const descriptionEscaped = (segment.description || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

    return `
        <div class="timeline-segment-wrapper" 
             style="position: absolute; 
                    left: ${leftPercent}%; 
                    width: ${widthPercent}%; 
                    height: 100%; 
                    cursor: pointer;
                    z-index: ${segmentZIndex};
                    border-top: ${wrapperBorder.top};
                    border-bottom: ${wrapperBorder.bottom};
                    border-left: ${wrapperBorder.left};
                    border-right: ${wrapperBorder.right};"
             data-phase="${segment.phase}"
             data-description="${descriptionEscaped}"
             data-duration="${segment.duration_ms}"
             data-line-number="${lineNumber || ''}"
             data-category="${segment.category || ''}"
             onmouseover="showTimelineTooltip(event, this)"
             onmouseout="hideTimelineTooltip()"
             onclick="navigateToLogLine(${lineNumber || 'null'})">
            <div class="timeline-segment-visual" 
                 style="position: absolute;
                        top: ${segmentTop};
                        left: 0;
                        width: 100%;
                        height: ${segmentHeight};
                        background: ${segmentColor}; 
                        opacity: ${segmentOpacity};
                        transition: transform 0.15s ease-out;">
            </div>
        </div>
    `;
}

/**
 * Render timestamp labels
 */
function renderTimestampLabels(firstTimestamp, lastTimestamp) {
    const firstTime = formatTimestamp(firstTimestamp);
    const lastTime = formatTimestamp(lastTimestamp);

    const labelStyle = `
        position: absolute; 
        top: -32px; 
        font-size: 0.85em; 
        font-weight: 500;
        color: #495057; 
        white-space: nowrap;
        background: white;
        padding: 6px 12px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        letter-spacing: 0.3px;
    `;

    return `
        <div style="${labelStyle} left: 0;">${firstTime}</div>
        <div style="${labelStyle} right: 0; text-align: right;">${lastTime}</div>
    `;
}

/**
 * Render worker phase overlay
 */
function renderWorkerPhaseOverlay(phaseBlock, totalTimeMs) {
    const widthPercent = Math.max(0, Math.min(100, (phaseBlock.duration_ms / totalTimeMs) * 100));
    const leftPercent = Math.max(0, Math.min(100, (phaseBlock.start_time / totalTimeMs) * 100));

    const waitDurationSeconds = phaseBlock.duration_ms / 1000;
    const formattedWaitTime = waitDurationSeconds >= 60
        ? `${Math.floor(waitDurationSeconds / 60)}m ${Math.floor(waitDurationSeconds % 60)}s`
        : `${waitDurationSeconds.toFixed(2)}s`;

    return `
        <div class="timeline-phase-overlay" 
             style="position: absolute; 
                    left: ${leftPercent}%; 
                    width: ${widthPercent}%; 
                    height: 100%; 
                    background: rgba(255, 152, 0, 0.15);
                    border: 2px solid rgba(255, 152, 0, 0.6);
                    border-radius: 4px;
                    pointer-events: auto;
                    cursor: help;
                    z-index: 5;"
             data-phase="Worker Wait"
             data-description="Mainthread waiting for worker thread completion (${formattedWaitTime})"
             data-duration="${phaseBlock.duration_ms}"
             onmouseover="showTimelineTooltip(event, this)"
             onmouseout="hideTimelineTooltip()">
        </div>
    `;
}

/**
 * Render worker lanes
 */
function renderWorkerLanes(workerIds, workerThreads, totalTimeMs) {
    let html = '<div style="margin-top: 30px;">';

    workerIds.forEach(workerId => {
        const workerData = workerThreads[workerId];
        const workerSegments = workerData.segments || [];

        html += `
            <div style="margin-bottom: 15px;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
                    <span style="font-size: 0.9em; font-weight: 500; color: #495057; min-width: 80px;">
                        Worker ${workerId}
                    </span>
                    <span style="font-size: 0.8em; color: #999;">
                        ${workerData.total_operations} operations
                    </span>
                </div>
                <div id="worker-lane-${workerId}" style="position: relative; width: 100%; height: 40px; background: #f5f5f5; border-radius: 6px; overflow: visible;">
        `;

        workerSegments.forEach(segment => {
            const widthPercent = Math.max(0, Math.min(100, (segment.duration_ms / totalTimeMs) * 100));
            const leftPercent = Math.max(0, Math.min(100, (segment.start_time / totalTimeMs) * 100));
            const lineNumber = segment.line_number || null;
            const descriptionEscaped = (segment.description || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const operationCount = segment.operation_count || 1;

            html += `
                <div class="timeline-segment-wrapper" 
                     style="position: absolute; 
                            left: ${leftPercent}%; 
                            width: ${widthPercent}%; 
                            height: 100%; 
                            cursor: pointer;"
                     data-phase="${segment.phase}"
                     data-description="${descriptionEscaped}"
                     data-duration="${segment.duration_ms}"
                     data-line-number="${lineNumber || ''}"
                     data-category="${segment.category || ''}"
                     data-worker-id="${workerId}"
                     data-operation-count="${operationCount}"
                     onmouseover="showTimelineTooltip(event, this)"
                     onmouseout="hideTimelineTooltip()"
                     onclick="navigateToLogLine(${lineNumber || 'null'})">
                    <div class="timeline-segment-visual" 
                         style="position: absolute;
                                top: 0;
                                left: 0;
                                width: 100%;
                                height: 100%;
                                background: ${segment.color}; 
                                opacity: 0.8;
                                transition: transform 0.15s ease-out, opacity 0.15s ease-out;
                                border-right: 1px solid rgba(0,0,0,0.1);">
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

/**
 * Render legend
 */
function renderLegend(uniqueCategories, categoryColors) {
    let html = '<div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; margin-top: 15px;">';

    const top10Categories = uniqueCategories.slice(0, 10);
    top10Categories.forEach(category => {
        const color = categoryColors[category];
        if (color) {
            html += `
                <div style="display: flex; align-items: center; gap: 5px;">
                    <div style="width: 20px; height: 20px; background: ${color}; border-radius: 3px;"></div>
                    <span style="font-size: 0.9em;">${category}</span>
                </div>
            `;
        }
    });

    html += '</div>';
    return html;
}

/**
 * Setup filter toggle handlers
 */
function setupFilterToggles(container) {
    try {
        const updateFilters = () => {
            const showOperations = document.getElementById('toggle-operations')?.checked ?? false;
            const showCache = document.getElementById('toggle-cache')?.checked ?? true;
            const showWorkerWait = document.getElementById('toggle-worker-wait')?.checked ?? true;

            const wrappers = container.querySelectorAll('.timeline-segment-wrapper, .timeline-phase-overlay');
            wrappers.forEach(el => {
                const phase = (el.getAttribute('data-phase') || '').trim();
                const isOperation = phase === 'Operation';
                const isCache = phase === 'CacheServerDownload';
                const isWorkerWait = phase === 'Worker Wait';

                if ((isOperation && !showOperations) || (isCache && !showCache) || (isWorkerWait && !showWorkerWait)) {
                    el.style.display = 'none';
                } else {
                    el.style.display = '';
                }
            });

            const workerLanes = container.querySelectorAll('[id^="worker-lane-"]');
            workerLanes.forEach(lane => {
                const visibleChild = Array.from(lane.children).some(c => c.style.display !== 'none');
                lane.parentElement.style.display = visibleChild ? '' : 'none';
            });
        };

        ['toggle-operations', 'toggle-cache', 'toggle-worker-wait'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', updateFilters);
        });

        updateFilters();
    } catch (e) {
        console.warn('[Timeline] Failed to wire filter toggles:', e);
    }
}

/**
 * Draw connecting lines from Main Thread to Worker Threads
 */
export function drawConnectingLines(container, timelineData) {
    const mainLane = document.getElementById('main-timeline-lane');
    if (!mainLane) return;

    const totalTimeMs = timelineData.total_time_ms;
    const workerThreads = timelineData.worker_threads || {};
    const workerIds = Object.keys(workerThreads);

    // Remove existing SVG
    const existingSvg = document.getElementById('timeline-connections-svg');
    if (existingSvg) existingSvg.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'timeline-connections-svg';
    svg.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; overflow: visible;';

    container.style.position = 'relative';

    const mainRect = mainLane.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const mainBottomY = mainRect.bottom - containerRect.top;
    const mainLeftX = mainRect.left - containerRect.left;
    const mainWidth = mainRect.width;

    workerIds.forEach(workerId => {
        const workerLane = document.getElementById(`worker-lane-${workerId}`);
        if (!workerLane) return;

        const workerRect = workerLane.getBoundingClientRect();
        const workerTopY = workerRect.top - containerRect.top;

        const phases = workerThreads[workerId].phase_blocks || [];
        phases.forEach(phase => {
            const startRatio = phase.start_time / totalTimeMs;
            const endRatio = (phase.start_time + phase.duration_ms) / totalTimeMs;

            const startX = mainLeftX + (startRatio * mainWidth);
            const endX = mainLeftX + (endRatio * mainWidth);

            const createLine = (xPos) => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', xPos);
                line.setAttribute('y1', mainBottomY);
                line.setAttribute('x2', xPos);
                line.setAttribute('y2', workerTopY);
                line.setAttribute('stroke', '#999');
                line.setAttribute('stroke-width', '2');
                line.setAttribute('stroke-dasharray', '4 4');
                return line;
            };

            svg.appendChild(createLine(startX));
            svg.appendChild(createLine(endX));
        });
    });

    container.appendChild(svg);
}

