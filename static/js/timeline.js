/**
 * Timeline Module
 * Handles project load timeline visualization
 */

/**
 * Display timeline visualization
 * @param {Object} data - Timeline data (unused, fetches from API)
 */
function displayTimeline(data) {
    const container = document.getElementById('timeline-container');
    
    // Fetch timeline data
    window.apiClient.getTimeline()
        .then(timelineData => {
            renderTimelineVisualization(container, timelineData);
        })
        .catch(error => {
            console.error('Failed to load timeline:', error);
            container.innerHTML = '<p style="color: #ff4444;">Failed to load timeline data</p>';
        });
}

/**
 * Render the timeline visualization with segments
 * @param {HTMLElement} container - Container element
 * @param {Object} timelineData - Timeline data from API
 */
function renderTimelineVisualization(container, timelineData) {
    if (!timelineData || !timelineData.segments) {
        console.error('Invalid timeline data:', timelineData);
        container.innerHTML = '<p style="color: #ff4444;">Invalid timeline data</p>';
        return;
    }
    
    const totalTime = timelineData.total_time_ms / 1000; // Convert to seconds
    const segments = timelineData.segments || [];
    const summary = timelineData.summary || {};
    
    // Category colors - must match the category chart
    const categoryChartColors = [
        '#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe',
        '#43e97b', '#fa709a', '#fee140', '#30cfd0', '#330867',
        '#a8edea', '#fed6e3', '#ffecd2', '#fcb69f', '#ff9a9e'
    ];
    
    // Calculate total time per category from segments
    const categoryTimes = {};
    segments.filter(s => s.phase === 'AssetImports' && s.category).forEach(s => {
        if (!categoryTimes[s.category]) {
            categoryTimes[s.category] = 0;
        }
        categoryTimes[s.category] += s.duration_ms;
    });
    
    // Sort categories by total time (descending) to match category chart order
    const uniqueCategories = Object.keys(categoryTimes).sort((a, b) => {
        return categoryTimes[b] - categoryTimes[a];  // Descending order
    });
    
    // Create category -> color mapping based on time-sorted position
    const categoryColors = {};
    uniqueCategories.forEach((category, index) => {
        categoryColors[category] = categoryChartColors[index % categoryChartColors.length];
    });
    
    // Create timeline HTML
    let html = `
        <div style="margin-bottom: 10px;">
            <h3 style="font-size: 1.8em; color: #667eea; margin-bottom: 8px;">
                Project Load Timeline
            </h3>
            <p style="color: #666; font-size: 0.9em; margin-bottom: 10px;">
                ${(() => {
                    const parts = [`Total time: ${formatTime(totalTime)}`];
                    if (summary.scan_time_ms > 0) parts.push(`Scan: ${formatTime(summary.scan_time_ms / 1000)}`);
                    if (summary.categorize_time_ms > 0) parts.push(`Categorize: ${formatTime(summary.categorize_time_ms / 1000)}`);
                    parts.push(`Asset imports: ${formatTime(summary.asset_import_time_ms / 1000)}`);
                    if (summary.operations_time_ms > 0) parts.push(`Operations: ${formatTime(summary.operations_time_ms / 1000)}`);
                    if (summary.script_compilation_time_ms > 0) parts.push(`Script compilation: ${formatTime(summary.script_compilation_time_ms / 1000)}`);
                    if (summary.post_process_time_ms > 0) parts.push(`Post-process: ${formatTime(summary.post_process_time_ms / 1000)}`);
                    if (summary.import_overhead_time_ms > 0) parts.push(`Import overhead: ${formatTime(summary.import_overhead_time_ms / 1000)}`);
                    if (summary.untracked_time_ms > 0) parts.push(`Untracked: ${formatTime(summary.untracked_time_ms / 1000)}`);
                    parts.push(`Unknown time: ${formatTime(summary.unknown_time_ms / 1000)}`);
                    return parts.join(' | ');
                })()}
            </p>
        </div>
        
        <div style="position: relative; width: 100%; height: 80px; background: #f5f5f5; border-radius: 8px; overflow: hidden; margin-bottom: 15px;">
    `;
    
    // Render sequential segments (non-overlapping)
    const sequentialSegments = segments.filter(s => !s.overlaps);
    
    sequentialSegments.forEach((segment, index) => {
        const widthPercent = (segment.duration_ms / timelineData.total_time_ms) * 100;
        const leftPercent = (segment.start_time / timelineData.total_time_ms) * 100;
        
        // Use category color for AssetImports segments
        let segmentColor = segment.color;
        if (segment.phase === 'AssetImports' && segment.category) {
            segmentColor = categoryColors[segment.category] || segment.color;
        }
        
        const lineNumber = segment.line_number || null;
        const descriptionEscaped = (segment.description || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        html += `
            <div class="timeline-segment" 
                 style="position: absolute; 
                        left: ${leftPercent}%; 
                        width: ${widthPercent}%; 
                        height: 100%; 
                        background: ${segmentColor}; 
                        cursor: pointer;
                        transition: opacity 0.2s;
                        border-right: 1px solid rgba(0,0,0,0.1);"
                 data-phase="${segment.phase}"
                 data-description="${descriptionEscaped}"
                 data-duration="${segment.duration_ms}"
                 data-line-number="${lineNumber || ''}"
                 data-category="${segment.category || ''}"
                 onmouseover="showTimelineTooltip(event, this)"
                 onmouseout="hideTimelineTooltip()"
                 onclick="navigateToLogLine(${lineNumber || 'null'})">
            </div>
        `;
    });
    
    html += `</div>`;
    
    // Legend - show top 5 categories only
    html += `
        <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; margin-top: 15px;">
    `;
    
    const top5Categories = uniqueCategories.slice(0, 5);
    top5Categories.forEach(category => {
        const color = categoryColors[category];
        html += `
            <div style="display: flex; align-items: center; gap: 5px;">
                <div style="width: 20px; height: 20px; background: ${color}; border-radius: 3px;"></div>
                <span style="font-size: 0.9em;">${category}</span>
            </div>
        `;
    });
    
    html += `</div>`;
    
    // Tooltip container
    html += `
        <div id="timeline-tooltip" style="position: absolute; 
                                             background: rgba(0,0,0,0.9); 
                                             color: white; 
                                             padding: 10px 15px; 
                                             border-radius: 5px; 
                                             font-size: 0.9em; 
                                             pointer-events: none; 
                                             z-index: 1000; 
                                             display: none;
                                             max-width: 300px;">
        </div>
    `;
    
    container.innerHTML = html;
}

/**
 * Show tooltip for timeline segment on hover
 * @param {Event} event - Mouse event
 * @param {HTMLElement} element - Timeline segment element
 */
function showTimelineTooltip(event, element) {
    const tooltip = document.getElementById('timeline-tooltip');
    if (!tooltip) return;
    
    const description = element.getAttribute('data-description');
    const category = element.getAttribute('data-category');
    
    // Build tooltip text (description already includes time)
    let tooltipText = description;
    
    // Add category info for asset imports
    if (category && category !== '') {
        tooltipText += `\nCategory: ${category}`;
    }
    
    tooltip.textContent = tooltipText;
    tooltip.style.display = 'block';
    tooltip.style.left = (event.pageX + 10) + 'px';
    tooltip.style.top = (event.pageY - 40) + 'px';
    tooltip.style.whiteSpace = 'pre-line';  // Allow newlines in tooltip
    
    // Highlight this segment
    element.style.opacity = '0.8';
    element.style.transform = 'scaleY(1.1)';
}

/**
 * Hide timeline tooltip
 */
function hideTimelineTooltip() {
    const tooltip = document.getElementById('timeline-tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
    
    // Reset all segments
    document.querySelectorAll('.timeline-segment').forEach(seg => {
        seg.style.opacity = '1';
        seg.style.transform = 'scaleY(1)';
    });
}

