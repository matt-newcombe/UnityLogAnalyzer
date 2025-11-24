/**
 * Tables Module
 * Handles all table rendering and interaction functionality
 */

// Pagination state for asset tables
let allAssetsData = [];
let displayedAssetCount = 100;
const assetPageSize = 100;

// Context menu state
let contextMenu = null;

/**
 * Display the main assets table with pagination
 * @param {Array} assets - Array of asset objects
 * @param {string} title - Table title
 */
/**
 * Display assets table with progressive loading for better responsiveness
 */
async function displayAssetsTableProgressive(assetType, title) {
    const tablesDiv = document.getElementById('tables');
    
    // Check if we're coming from std dev view and add back button
    const backButtonHtml = getStdDevViewState() ? `
        <div style="margin-bottom: 15px;">
            <button onclick="restoreStdDevView()" style="
                padding: 8px 16px;
                background: #667eea;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: grab;
                font-size: 0.9em;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            ">
                ← Back to Histogram
            </button>
        </div>
    ` : '';
    
    // Show table structure immediately
    tablesDiv.innerHTML = `
        <div class="table-container">
            ${backButtonHtml}
            <h2>${title}</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Asset Count</div>
                    <div class="stat-value" id="asset-count-stat">Loading...</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Total Time</div>
                    <div class="stat-value" id="asset-time-stat">Loading...</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">% of Full Load Time</div>
                    <div class="stat-value" id="asset-percent-stat">Loading...</div>
                </div>
            </div>
            <p style="margin-bottom: 15px; color: #666;">
                💡 <strong>Click</strong> any row or line number to jump to that location in the log
            </p>
            <div style="max-height: 600px; overflow-y: auto; overflow-x: hidden;" id="asset-table-scroll">
                <table>
                    <thead style="position: sticky; top: 0; background: white; z-index: 10;">
                        <tr>
                            <th style="width: 70px;">Line #</th>
                            <th style="min-width: 250px;">Asset Name</th>
                            <th style="width: 120px;">Category</th>
                            <th style="width: 100px;">Type</th>
                            <th style="width: 110px;">Importer</th>
                            <th style="width: 100px; text-align: right;">Time</th>
                            <th style="min-width: 250px;">Path</th>
                        </tr>
                    </thead>
                    <tbody id="asset-table-body">
                        <tr><td colspan="7" style="text-align: center; padding: 20px; color: #667eea;">
                            <div class="element-spinner">
                                <span class="loading-spinner"></span>
                                <span>Loading assets...</span>
                            </div>
                        </td></tr>
                    </tbody>
                </table>
            </div>
            <div id="asset-load-indicator" style="text-align: center; padding: 15px; color: #667eea; display: none;">
                Loading more assets...
            </div>
            <div id="asset-info" style="text-align: center; padding: 10px; color: #999; font-size: 0.9em;">
                Loading...
            </div>
        </div>
    `;
    
    // Auto-scroll to tables immediately
    setTimeout(() => {
        tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    
    // Progressive loading configuration
    const INITIAL_BATCH_SIZE = 200; // First batch to render immediately
    const BATCH_SIZE = 200; // Subsequent batch sizes
    let allAssets = [];
    let totalTime = 0;
    let firstBatchRendered = false;
    
    try {
        // Get database instance
        const db = await window.apiClient.getDatabase();
        const logId = window.apiClient.getCurrentLogId();
        
        // Get project load time for percentage (start early, don't wait)
        let projectLoadTimeSeconds = 0;
        const summaryPromise = window.apiClient.getSummary().catch(err => {
            console.error('Failed to get project load time:', err);
            return null;
        });
        
        // Load assets progressively - render first batch immediately, then continue loading
        const loadPromise = db.getAssetsByTypeProgressive(logId, assetType, async (batch, offset, total, isLast) => {
            // Add batch to our collection
            allAssets.push(...batch);
            
            // Update total time as we go
            const batchTime = batch.reduce((sum, a) => sum + (a.import_time_ms || 0), 0);
            totalTime += batchTime;
            
            // Render first batch immediately for instant feedback
            if (!firstBatchRendered && offset === 0) {
                firstBatchRendered = true;
                
                // Get summary if ready
                const summary = await summaryPromise;
                if (summary) {
                    projectLoadTimeSeconds = summary.project_load_time_seconds || 0;
                }
                
                // Update count
                document.getElementById('asset-count-stat').textContent = total.toLocaleString();
                
                // Update stats with first batch
                updateAssetStats(allAssets, totalTime, projectLoadTimeSeconds);
                
                // Render first page immediately
                allAssetsData = allAssets;
                displayedAssetCount = Math.min(assetPageSize, allAssets.length);
                
                // Clear loading indicator
                const tbody = document.getElementById('asset-table-body');
                tbody.innerHTML = '';
                
                // Render rows immediately
                renderAssetRows();
                setupAssetTableScroll();
                setupAssetTableContextMenus();
            }
            
            // Update stats progressively as more data arrives
            if (firstBatchRendered) {
                const summary = await summaryPromise;
                if (summary && !projectLoadTimeSeconds) {
                    projectLoadTimeSeconds = summary.project_load_time_seconds || 0;
                }
                
                // Update with current totals
                updateAssetStats(allAssets, totalTime, projectLoadTimeSeconds);
                
                // Update allAssetsData for scrolling/pagination
                allAssetsData = allAssets;
                
                // Re-render if we're showing more than initial page
                if (allAssets.length > displayedAssetCount) {
                    renderAssetRows();
                }
            }
            
            // Show loading indicator for subsequent batches
            if (firstBatchRendered && !isLast) {
                const indicator = document.getElementById('asset-load-indicator');
                if (indicator) {
                    const percent = ((offset + batch.length) / total * 100).toFixed(0);
                    indicator.style.display = 'block';
                    indicator.textContent = `Loading assets... ${percent}% (${(offset + batch.length).toLocaleString()} of ${total.toLocaleString()})`;
                }
            }
            
            // Hide loading indicator when done
            if (isLast) {
                const indicator = document.getElementById('asset-load-indicator');
                if (indicator) {
                    indicator.style.display = 'none';
                }
                
                // Final update with complete data
                const summary = await summaryPromise;
                if (summary && !projectLoadTimeSeconds) {
                    projectLoadTimeSeconds = summary.project_load_time_seconds || 0;
                }
                updateAssetStats(allAssets, totalTime, projectLoadTimeSeconds);
                allAssetsData = allAssets;
            }
        }, BATCH_SIZE);
        
        // Don't await immediately - let first batch render first
        await loadPromise;
        
    } catch (error) {
        console.error('Error loading assets:', error);
        document.getElementById('asset-table-body').innerHTML = 
            '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #ff4444;">Failed to load assets</td></tr>';
        throw error;
    }
}

/**
 * Update asset statistics display
 */
function updateAssetStats(assets, totalTime, projectLoadTimeSeconds) {
    const percentageOfLoad = projectLoadTimeSeconds > 0 
        ? ((totalTime / 1000 / projectLoadTimeSeconds) * 100).toFixed(1)
        : 'N/A';
    
    document.getElementById('asset-count-stat').textContent = assets.length.toLocaleString();
    document.getElementById('asset-time-stat').textContent = formatTime(totalTime / 1000);
    document.getElementById('asset-percent-stat').textContent = 
        percentageOfLoad + (percentageOfLoad !== 'N/A' ? '%' : '');
    
    const infoDiv = document.getElementById('asset-info');
    if (infoDiv) {
        if (displayedAssetCount >= assets.length) {
            infoDiv.textContent = `Showing all ${assets.length} assets`;
        } else {
            infoDiv.textContent = `Showing ${displayedAssetCount} of ${assets.length} assets (scroll to load more)`;
        }
    }
}

async function displayAssetsTable(assets, title) {
    const tablesDiv = document.getElementById('tables');
    
    allAssetsData = assets;
    displayedAssetCount = Math.min(assetPageSize, assets.length);
    
    const totalTime = assets.reduce((sum, a) => sum + a.import_time_ms, 0);
    
    // Get project load time for percentage calculation
    let projectLoadTimeSeconds = 0;
    try {
        const summary = await window.apiClient.getSummary();
        projectLoadTimeSeconds = summary.project_load_time_seconds || 0;
    } catch (error) {
        console.error('Failed to get project load time:', error);
    }
    
    const percentageOfLoad = projectLoadTimeSeconds > 0 
        ? ((totalTime / 1000 / projectLoadTimeSeconds) * 100).toFixed(1)
        : 'N/A';
    
    // Check if we're coming from std dev view and add back button
    const backButtonHtml = getStdDevViewState() ? `
        <div style="margin-bottom: 15px;">
            <button onclick="restoreStdDevView()" style="
                padding: 8px 16px;
                background: #667eea;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: grab;
                font-size: 0.9em;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            ">
                ← Back to Histogram
            </button>
        </div>
    ` : '';
    
    tablesDiv.innerHTML = `
        <div class="table-container">
            ${backButtonHtml}
            <h2>${title}</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Asset Count</div>
                    <div class="stat-value">${assets.length.toLocaleString()}</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Total Time</div>
                    <div class="stat-value">${formatTime(totalTime / 1000)}</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">% of Full Load Time</div>
                    <div class="stat-value">${percentageOfLoad}${percentageOfLoad !== 'N/A' ? '%' : ''}</div>
                </div>
            </div>
            <p style="margin-bottom: 15px; color: #666;">
                💡 <strong>Click</strong> any row or line number to jump to that location in the log
            </p>
            <div style="max-height: 600px; overflow-y: auto; overflow-x: hidden;" id="asset-table-scroll">
                <table>
                    <thead style="position: sticky; top: 0; background: white; z-index: 10;">
                        <tr>
                            <th style="width: 70px;">Line #</th>
                            <th style="min-width: 250px;">Asset Name</th>
                            <th style="width: 120px;">Category</th>
                            <th style="width: 100px;">Type</th>
                            <th style="width: 110px;">Importer</th>
                            <th style="width: 100px; text-align: right;">Time</th>
                            <th style="min-width: 250px;">Path</th>
                        </tr>
                    </thead>
                    <tbody id="asset-table-body">
                    </tbody>
                </table>
            </div>
            <div id="asset-load-indicator" style="text-align: center; padding: 15px; color: #667eea; display: none;">
                Loading more assets...
            </div>
            <div id="asset-info" style="text-align: center; padding: 10px; color: #999; font-size: 0.9em;">
                Showing ${displayedAssetCount} of ${assets.length} assets
            </div>
        </div>
    `;
    
    renderAssetRows();
    setupAssetTableScroll();
    setupAssetTableContextMenus();
    
    // Auto-scroll to tables after a brief delay to ensure rendering
    setTimeout(() => {
        tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

/**
 * Render asset rows in the table (with pagination)
 */
function renderAssetRows() {
    const tbody = document.getElementById('asset-table-body');
    const assetsToShow = allAssetsData.slice(0, displayedAssetCount);
    
    tbody.innerHTML = assetsToShow.map(asset => {
        const category = asset.asset_category || 'Unknown';
        const importer = asset.importer_type || 'Unknown';
        const timeSeconds = asset.import_time_ms / 1000;
        const timeFormatted = formatTime(timeSeconds);
        
        // Determine badge color based on time
        let timeBadgeClass = 'badge';
        if (timeSeconds > 1) {
            timeBadgeClass = 'badge-warning';
        } else if (timeSeconds < 0.1) {
            timeBadgeClass = 'badge-success';
        }
        
        const assetPath = asset.asset_path || '';
        const escapedPath = assetPath.replace(/"/g, '&quot;');
        
        return `
        <tr data-line="${asset.line_number}" 
            data-path="${escapedPath}"
            onclick="openLogViewer(${asset.line_number})">
            <td style="font-size: 0.85em;">
                <a href="javascript:void(0)" 
                   style="color: #667eea; font-weight: 600; text-decoration: none;"
                   onclick="event.stopPropagation(); openLogViewer(${asset.line_number});"
                   title="Jump to line ${asset.line_number} in log">
                    ${asset.line_number}
                </a>
            </td>
            <td>
                <strong style="color: #1a1a1a; font-size: 0.9em; word-break: break-word;">${asset.asset_name}</strong>
            </td>
            <td>
                <span class="badge">${category}</span>
            </td>
            <td>
                <span class="mono">${asset.asset_type || 'N/A'}</span>
            </td>
            <td>
                <span class="mono" style="font-size: 0.85em;">${importer}</span>
            </td>
            <td style="text-align: right;">
                <span class="${timeBadgeClass}" style="font-weight: 600;">${timeFormatted}</span>
            </td>
            <td>
                <span class="text-truncate-long" 
                      style="font-size: 0.9em; color: #666;">
                    ${asset.asset_path}
                </span>
            </td>
        </tr>
    `;
    }).join('');
    
    // Update info
    const infoDiv = document.getElementById('asset-info');
    if (infoDiv) {
        if (displayedAssetCount >= allAssetsData.length) {
            infoDiv.textContent = `Showing all ${allAssetsData.length} assets`;
        } else {
            infoDiv.textContent = `Showing ${displayedAssetCount} of ${allAssetsData.length} assets (scroll to load more)`;
        }
    }
}

/**
 * Setup infinite scroll for asset table
 */
function setupAssetTableScroll() {
    const scrollContainer = document.getElementById('asset-table-scroll');
    if (!scrollContainer) {
        console.warn('[setupAssetTableScroll] scrollContainer is null, cannot add event listener');
        return;
    }
    
    let isLoadingAssets = false;
    
    try {
        scrollContainer.addEventListener('scroll', () => {
        const scrollTop = scrollContainer.scrollTop;
        const scrollHeight = scrollContainer.scrollHeight;
        const clientHeight = scrollContainer.clientHeight;
        
        // Load more when within 100px of bottom
        if (scrollTop + clientHeight > scrollHeight - 100 && !isLoadingAssets && displayedAssetCount < allAssetsData.length) {
            isLoadingAssets = true;
            document.getElementById('asset-load-indicator').style.display = 'block';
            
            setTimeout(() => {
                displayedAssetCount = Math.min(displayedAssetCount + assetPageSize, allAssetsData.length);
                renderAssetRows();
                setupAssetTableContextMenus();
                isLoadingAssets = false;
                document.getElementById('asset-load-indicator').style.display = 'none';
            }, 100);
        }
    });
    } catch (error) {
        console.error('[setupAssetTableScroll] Error adding scroll listener:', error, scrollContainer);
    }
}

/**
 * Setup context menus for asset table rows
 */
function setupAssetTableContextMenus() {
    const tbody = document.getElementById('asset-table-body');
    if (!tbody) {
        console.warn('[setupAssetTableContextMenus] tbody is null, cannot add context menus');
        return;
    }
    
    const rows = tbody.querySelectorAll('tr[data-path]');
    
    rows.forEach((row, index) => {
        if (!row) {
            console.error(`[setupAssetTableContextMenus] Row ${index} is null, skipping`);
            return;
        }
        
        const path = row.getAttribute('data-path');
        if (!path) {
            console.warn(`[setupAssetTableContextMenus] Row ${index} has no data-path, skipping`);
            return;
        }
        
        const decodedPath = path.replace(/&quot;/g, '"');
        
        try {
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e, decodedPath);
            });
        } catch (error) {
            console.error(`[setupAssetTableContextMenus] Error adding listener to row ${index}:`, error, row);
        }
    });
}

/**
 * Display mode time table with statistics
 * @param {Array} typeData - Array of asset type data
 */
async function displayModeTimeTable(typeData) {
    const tbody = document.getElementById('mode-time-body');
    if (!tbody) {
        console.error('Import time statistics table body not found');
        return;
    }
    
    if (!typeData || typeData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No data</td></tr>';
        return;
    }
    
    // Show loading state
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Calculating statistics...</td></tr>';
    
    try {
        // For each type, fetch assets and calculate mean and standard deviation
        const statsPromises = typeData.map(async (type) => {
            try {
                const assets = await window.apiClient.getAssetsByType(type.asset_type);
                
                if (!assets || assets.length === 0) {
                    return { ...type, mean: 0, stdDev: 0, interpretation: 'No data' };
                }
                
                // Convert to seconds
                const times = assets.map(asset => asset.import_time_ms / 1000);
                
                // Calculate mean
                const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
                
                // Calculate standard deviation
                const variance = times.reduce((sum, time) => sum + Math.pow(time - mean, 2), 0) / times.length;
                const stdDev = Math.sqrt(variance);
                
                // Determine interpretation
                const coefficientOfVariation = mean > 0 ? stdDev / mean : 0;
                let interpretation;
                let interpretationColor = '#666';
                
                if (mean < 0.1) {
                    interpretation = 'Consistently fast';
                    interpretationColor = '#28a745';
                } else if (coefficientOfVariation > 1.0) {
                    interpretation = 'Large Outliers';
                    interpretationColor = '#dc3545';
                } else if (mean > 1.0) {
                    interpretation = 'Consistently slow';
                    interpretationColor = '#dc3545';
                } else {
                    interpretation = 'Moderate variance';
                    interpretationColor = '#666';
                }
                
                return { ...type, mean, stdDev, interpretation, interpretationColor };
            } catch (error) {
                console.error(`Failed to load assets for type ${type.asset_type}:`, error);
                return { ...type, mean: 0, stdDev: 0, interpretation: 'Error' };
            }
        });
        
        const typesWithStats = await Promise.all(statsPromises);
        
        // Sort by priority: Large Outliers first, then Consistently slow
        typesWithStats.sort((a, b) => {
            if (a.interpretation === 'Large Outliers' && b.interpretation !== 'Large Outliers') return -1;
            if (a.interpretation !== 'Large Outliers' && b.interpretation === 'Large Outliers') return 1;
            if (a.interpretation === 'Consistently slow' && b.interpretation !== 'Consistently slow') return -1;
            if (a.interpretation !== 'Consistently slow' && b.interpretation === 'Consistently slow') return 1;
            return 0;
        });
        
        tbody.innerHTML = typesWithStats.map(type => {
            // Create tooltip text
            let tooltipText = '';
            if (type.interpretation === 'Consistently fast') {
                tooltipText = `Mean: ${formatTime(type.mean)}, Std Dev: ${formatTime(type.stdDev)}\n\nMost assets import quickly with low variance. The standard deviation is small relative to the mean, indicating consistent performance across all assets of this type.`;
            } else if (type.interpretation === 'Large Outliers') {
                tooltipText = `Mean: ${formatTime(type.mean)}, Std Dev: ${formatTime(type.stdDev)}\n\nHigh variance detected (std dev > mean). Most assets import quickly, but there are significant outliers that are much slower. The standard deviation being larger than the mean indicates inconsistent performance - investigate the slow outliers.`;
            } else if (type.interpretation === 'Consistently slow') {
                tooltipText = `Mean: ${formatTime(type.mean)}, Std Dev: ${formatTime(type.stdDev)}\n\nAll assets of this type import slowly on average. The standard deviation is relatively small compared to the mean, indicating that most assets take a similar (slow) amount of time. This suggests a systemic issue rather than outliers.`;
            } else {
                tooltipText = `Mean: ${formatTime(type.mean)}, Std Dev: ${formatTime(type.stdDev)}\n\nModerate variance in import times. The standard deviation is less than the mean, indicating some variation but not extreme outliers.`;
            }
            
            const escapedTooltip = (tooltipText || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '<br>');
            const escapedType = (type.asset_type || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            
            return `
                <tr style="cursor: grab; border-bottom: 1px solid #eee;" 
                    onclick="loadStdDevView('${escapedType}')">
                    <td style="padding: 10px;">
                        <strong style="color: #1a1a1a; font-size: 0.9em;">${type.asset_type}</strong>
                    </td>
                    <td style="padding: 10px; text-align: right;">
                        <span style="font-weight: 600;">${type.count}</span>
                    </td>
                    <td style="padding: 10px; text-align: right;">
                        <span style="font-weight: 600; color: #f57c00;">${formatTime(type.mean)}</span>
                    </td>
                    <td style="padding: 10px; text-align: right;">
                        <span style="color: #666;">${formatTime(type.stdDev)}</span>
                    </td>
                    <td style="padding: 10px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="color: ${type.interpretationColor}; font-weight: 500;">${type.interpretation}</span>
                            <button onclick="event.stopPropagation(); alert('${escapedTooltip}');" 
                                    style="background: none; border: none; cursor: help; font-size: 16px; padding: 0 4px;"
                                    title="Click for details">ℹ️</button>
                        </div>
                    </td>
                    <td style="padding: 10px; text-align: right;">
                        <span style="color: #666;">${formatTime((type.total_time || 0) / 1000)}</span>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Failed to calculate statistics:', error);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: #dc3545;">Failed to load statistics</td></tr>';
    }
}

/**
 * Load slowest assets table
 */
async function loadSlowestAssets() {
    const tbody = document.getElementById('slowest-assets-body');
    if (!tbody) return;
    
    try {
        const assets = await window.apiClient.getAssets();
        
        if (!assets || assets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No assets found</td></tr>';
            return;
        }
        
        // Sort by import time (descending) and take top 50
        const slowest = assets
            .sort((a, b) => b.import_time_ms - a.import_time_ms)
            .slice(0, 50);
        
        tbody.innerHTML = slowest.map((asset, index) => {
            const timeSeconds = asset.import_time_ms / 1000;
            const timeFormatted = formatTime(timeSeconds);
            const category = asset.asset_category || 'Unknown';
            const importer = asset.importer_type || 'Unknown';
            const assetPath = asset.asset_path || '';
            const path = assetPath.length > 60
                ? assetPath.substring(0, 57) + '...'
                : assetPath;
            const escapedPath = assetPath.replace(/"/g, '&quot;');
        
        return `
                <tr data-line="${asset.line_number}" 
                    data-path="${escapedPath}"
                    style="cursor: grab; border-bottom: 1px solid #eee;">
                    <td style="padding: 10px; width: 35%;">
                        <strong style="color: #1a1a1a; font-size: 0.9em; word-break: break-word;">${asset.asset_name}</strong>
                    </td>
                    <td style="padding: 10px; font-family: monospace; font-size: 0.85em; width: 8%;">${asset.asset_type || 'N/A'}</td>
                    <td style="padding: 10px; font-size: 0.85em; width: 10%;">
                        <span style="display: inline-block; padding: 2px 8px; background: #e3f2fd; color: #1976d2; border-radius: 3px; font-size: 0.8em;">${category}</span>
                    </td>
                    <td style="padding: 10px; font-family: monospace; font-size: 0.95em; color: #666; width: 12%;">${importer}</td>
                    <td style="text-align: right; padding: 10px; font-weight: bold; color: #f57c00; width: 10%;">
                        ${timeFormatted}
                    </td>
                    <td style="padding: 10px; font-size: 0.85em; color: #666;">
                        ${path}
                    </td>
                </tr>
            `;
        }).join('');
        
        // Add event listeners for click and context menu
        if (!tbody) {
            console.error('[loadSlowestAssets] tbody is null, cannot add event listeners');
            return;
        }
        
        const rows = tbody.querySelectorAll('tr');
        
        rows.forEach((row, index) => {
            if (!row) {
                console.error(`[loadSlowestAssets] Row ${index} is null, skipping`);
                return;
            }
            
            const lineNumber = row.getAttribute('data-line');
            const path = row.getAttribute('data-path');
            
            if (!lineNumber) {
                console.warn(`[loadSlowestAssets] Row ${index} has no data-line attribute, skipping`);
                return;
            }
            
            try {
                // Left click to navigate
                row.addEventListener('click', () => {
                    openLogViewer(lineNumber);
                });
                
                // Right click for context menu
                row.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const decodedPath = path.replace(/&quot;/g, '"');
                    showContextMenu(e, decodedPath);
                });
            } catch (error) {
                console.error(`[loadSlowestAssets] Error adding listeners to row ${index}:`, error, row);
            }
        });
    } catch (error) {
        console.error('Failed to load slowest assets:', error);
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: #dc3545;">Failed to load assets</td></tr>';
        }
    }
}

// Export to global scope
window.loadSlowestAssets = loadSlowestAssets;

/**
 * Show context menu for asset path
 * @param {Event} event - Mouse event
 * @param {string} path - Asset path
 */
function showContextMenu(event, path) {
    event.preventDefault();
    event.stopPropagation();
    
    // Remove existing menu
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
    }
    
    // Create menu
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.cssText = `
        position: fixed;
        left: ${event.clientX}px;
        top: ${event.clientY}px;
        display: block;
        visibility: visible;
        opacity: 1;
        z-index: 1000000;
        background-color: white;
        border: 1px solid #ddd;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        padding: 4px 0;
        min-width: 150px;
    `;
    
    // Create menu item
    const menuItem = document.createElement('div');
    if (!menuItem) {
        console.error('[showContextMenu] Failed to create menuItem element');
        return;
    }
    
    menuItem.className = 'context-menu-item';
    menuItem.textContent = 'Copy Path';
    menuItem.style.cssText = `
        padding: 8px 16px;
        cursor: grab;
        font-size: 13px;
        color: #333;
    `;
    
    try {
        menuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(path);
            hideContextMenu();
        });
        
        menuItem.addEventListener('mouseenter', () => {
            menuItem.style.backgroundColor = '#f5f5f5';
        });
        
        menuItem.addEventListener('mouseleave', () => {
            menuItem.style.backgroundColor = 'transparent';
        });
    } catch (error) {
        console.error('[showContextMenu] Error adding event listeners to menuItem:', error, menuItem);
        return;
    }
    
    contextMenu.appendChild(menuItem);
    document.body.appendChild(contextMenu);
    
    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
    }, 10);
}

/**
 * Hide context menu
 */
function hideContextMenu() {
    if (contextMenu) {
        contextMenu.remove();
        contextMenu = null;
    }
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 */
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Show feedback
        const feedback = document.createElement('div');
        feedback.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #4CAF50; color: white; padding: 10px 20px; border-radius: 5px; z-index: 10001;';
        feedback.textContent = '✓ Path copied to clipboard';
        document.body.appendChild(feedback);
        setTimeout(() => feedback.remove(), 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

/**
 * Restore standard deviation view (for back button)
 */
function restoreStdDevView() {
    const state = getStdDevViewState();
    if (state) {
        // Restore the histogram view
        loadStdDevView(state.assetType);
    }
}


