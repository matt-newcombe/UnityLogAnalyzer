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
    const startTime = performance.now();
    console.log('[Timeline] Starting timeline load...');
    
    // Fetch both timeline data and summary to get category breakdown for color matching
    const timelineStart = performance.now();
    Promise.all([
        window.apiClient.getTimeline(),
        window.apiClient.getSummary()
    ])
        .then(([timelineData, summary]) => {
            const apiTime = performance.now() - timelineStart;
            console.log(`[Timeline] API calls completed in ${apiTime.toFixed(2)}ms`);
            
            // Extract category data from summary (same as used by category chart)
            const categoryData = summary.by_category || [];
            
            const renderStart = performance.now();
            renderTimelineVisualization(container, timelineData, categoryData);
            const renderTime = performance.now() - renderStart;
            const totalTime = performance.now() - startTime;
            
            console.log(`[Timeline] Rendering completed in ${renderTime.toFixed(2)}ms`);
            console.log(`[Timeline] Total timeline load time: ${totalTime.toFixed(2)}ms (API: ${apiTime.toFixed(2)}ms, Render: ${renderTime.toFixed(2)}ms)`);
        })
        .catch(error => {
            const totalTime = performance.now() - startTime;
            console.error(`[Timeline] Failed to load timeline after ${totalTime.toFixed(2)}ms:`, error);
            container.innerHTML = '<p style="color: #ff4444;">Failed to load timeline data</p>';
        });
}

/**
 * Render the timeline visualization with segments
 * @param {HTMLElement} container - Container element
 * @param {Object} timelineData - Timeline data from API
 * @param {Array} categoryData - Category breakdown data from API (to match chart colors)
 */
function renderTimelineVisualization(container, timelineData, categoryData = []) {
    if (!timelineData || !timelineData.segments) {
        console.error('Invalid timeline data:', timelineData);
        container.innerHTML = '<p style="color: #ff4444;">Invalid timeline data</p>';
        return;
    }
    
    const totalTime = timelineData.total_time_ms / 1000; // Convert to seconds
    const segments = timelineData.segments || [];
    const summary = timelineData.summary || {};
    
    // Category colors - must match the category chart exactly
    // Top colors are more distinct to avoid similar bluey-purple shades
    const categoryChartColors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
        '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
        '#EC7063', '#5DADE2', '#F1948A', '#82E0AA', '#F4D03F'
    ];
    
    // Use category data from API to ensure exact match with chart
    // Category data is already sorted by total_time (descending) - same as chart
    const categoryColors = {};
    if (categoryData && categoryData.length > 0) {
        // Use the exact same order and colors as the category chart
        categoryData.forEach((category, index) => {
            const categoryName = category.asset_category || category.category || 'Other';
            categoryColors[categoryName] = categoryChartColors[index % categoryChartColors.length];
        });
    } else {
        // Fallback: calculate from segments if category data not available
        const categoryTimes = {};
        segments.filter(s => s.phase === 'AssetImports' && s.category).forEach(s => {
            if (!categoryTimes[s.category]) {
                categoryTimes[s.category] = 0;
            }
            categoryTimes[s.category] += s.duration_ms;
        });
        
        const uniqueCategories = Object.keys(categoryTimes).sort((a, b) => {
            return categoryTimes[b] - categoryTimes[a];  // Descending order
        });
        
        uniqueCategories.forEach((category, index) => {
            categoryColors[category] = categoryChartColors[index % categoryChartColors.length];
        });
    }
    
    // Get unique categories for legend (use categoryData order if available, otherwise from segments)
    const uniqueCategories = categoryData && categoryData.length > 0
        ? categoryData.map(c => c.asset_category || c.category || 'Other')
        : Object.keys(categoryColors);
    
    // Create timeline HTML
    let html = `
        <div style="margin-bottom: 10px;">
            <h3 style="font-size: 1.8em; color: #667eea; margin-bottom: 8px;">
                Log Timeline
            </h3>
            <p style="color: #666; font-size: 0.9em; margin-bottom: 10px;">
                Total time: ${formatTime(totalTime)} | Asset imports: ${formatTime(summary.asset_import_time_ms / 1000)} | Total imports: ${summary.total_imports || 0}
            </p>
        </div>
        
        <div style="position: relative; width: 100%; height: 80px; background: #f5f5f5; border-radius: 8px; overflow: hidden; margin-bottom: 15px;">
    `;
    
    // Render all segments (using timestamps for accurate positioning)
    // Normalize all positions and widths relative to total_time_ms
    // Formula: width = (duration_ms / total_time_ms) * 100%
    // Formula: position = (start_time / total_time_ms) * 100%
    const totalTimeMs = timelineData.total_time_ms;
    
    if (!totalTimeMs || totalTimeMs <= 0) {
        console.error('Invalid total_time_ms:', totalTimeMs);
        container.innerHTML = '<p style="color: #ff4444;">Invalid timeline data: total time is zero or missing</p>';
        return;
    }
    
    segments.forEach((segment, index) => {
        // Ensure segment has valid values
        const durationMs = segment.duration_ms || 0;
        const startTime = segment.start_time || 0;
        
        // Calculate width as proportion of total time: duration_ms / total_time_ms
        const widthPercent = Math.max(0, Math.min(100, (durationMs / totalTimeMs) * 100));
        // Calculate position as proportion of total time: start_time / total_time_ms
        const leftPercent = Math.max(0, Math.min(100, (startTime / totalTimeMs) * 100));
        
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
    
    // Legend - show top 10 categories
    html += `
        <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; margin-top: 15px;">
    `;
    
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

