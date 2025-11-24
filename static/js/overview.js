/**
 * Overview Module
 * Handles main overview page loading and display
 */

// showChart (lines 77-95)
function showChart(canvasId) {
    try {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.warn(`Canvas element not found: ${canvasId}`);
            return;
        }
        const container = canvas.parentElement;
        if (!container) {
            console.warn(`Container not found for canvas: ${canvasId}`);
            return;
        }
        const spinner = container.querySelector('.element-spinner');
        if (spinner) spinner.style.display = 'none';
        if (canvas) canvas.style.display = 'block';
    } catch (error) {
        console.error(`Error showing chart ${canvasId}:`, error);
    }
}


// showEmptyState (lines 125-144)
function showEmptyState() {
    const statsDiv = document.getElementById('stats');
    const chartsDiv = document.getElementById('charts');
    statsDiv.style.display = 'none';
    chartsDiv.style.display = 'none';

    // Hide Slack copy button when no log is loaded
    const slackButtonContainer = document.getElementById('slack-button-container');
    if (slackButtonContainer) {
        slackButtonContainer.style.display = 'none';
    }

    chartsDiv.innerHTML = `
                <div class="chart-card" style="grid-column: 1 / -1; text-align: center; padding: 60px;">
                    <h2 style="color: #666; margin-bottom: 20px;">No Log File Parsed</h2>
                    <p style="color: #999; margin-bottom: 30px; font-size: 1.1em;">Click "Parse Log File" in the header to upload and analyze a Unity Editor.log file</p>
                    <a href="/log-parser" class="nav-button" style="background: #4CAF50; border: none; cursor: grab; height: 44px; padding: 0 16px; display: inline-flex; align-items: center; text-decoration: none;">📁 Parse Log File</a>
                </div>
            `;
}


// loadOverview (lines 338-368)
async function loadOverview(incremental = false) {
    setCurrentView('overview');

    try {
        // Get log metadata to show project name
        const logs = await window.apiClient.getLogs();
        const currentLog = logs.find(log => log.id === getCurrentLogId());
        if (currentLog) {
            updateProjectName(currentLog.project_name);
        }

        const data = await window.apiClient.getSummary();

        // Show Slack copy button when log is loaded
        const slackButtonContainer = document.getElementById('slack-button-container');
        if (slackButtonContainer) {
            slackButtonContainer.style.display = 'block';
        }

        if (incremental && window.chartInstances) {
            // Incremental update: update existing charts without re-animation
            await updateChartsIncremental(data);
            updateStatsIncremental(data);
        } else {
            // Full update: recreate everything
            displayStats(data);
            await displayCharts(data);
        }

    } catch (error) {
        console.error('[loadOverview] Error loading overview:', error);
        console.error('[loadOverview] Error stack:', error.stack);
        console.error('[loadOverview] Error details:', {
            message: error.message,
            name: error.name,
            fileName: error.fileName,
            lineNumber: error.lineNumber,
            columnNumber: error.columnNumber
        });
        showError('Failed to load summary: ' + error.message);
    }
}


// displayStats (lines 370-443)
function displayStats(data) {
    const statsDiv = document.getElementById('stats');
    statsDiv.style.display = 'grid';

    const assetImports = data.asset_imports;
    const projectLoadTime = data.project_load_time_seconds || 0;

    const unityVersion = data.unity_version || 'Unknown';

    // Update Unity version in header
    updateUnityVersion(unityVersion);

    // Show skeleton loaders immediately
    statsDiv.innerHTML = `
                <div class="stat-card">
                    <div class="stat-label">Total Project Load Time</div>
                    <div class="stat-value">
                        ${formatTime(projectLoadTime)}
                    </div>
                </div>
                <div class="stat-card clickable" onclick="loadAllAssets()" style="cursor: grab;" title="Click to view all assets">
                    <div class="stat-label">Total Assets</div>
                    <div class="stat-value">${assetImports.count || 0}</div>
                </div>
                <div class="stat-card" title="Note this can be longer than project load time due to parallelised import worker threads">
                    <div class="stat-label">Raw Asset Import Time</div>
                    <div class="stat-value">
                        ${formatTime((assetImports.total_time || 0) / 1000)}
                    </div>
                </div>
            `;
}


// Store chart instances globally for incremental updates
window.chartInstances = window.chartInstances || {};

// displayCharts (lines 445-727)
async function displayCharts(data) {
    const chartsDiv = document.getElementById('charts');
    if (!chartsDiv) {
        console.warn('[displayCharts] Charts container not found');
        return;
    }

    // Check if current log is in live monitoring mode to disable animations
    let isLiveMonitoring = false;
    let timestampsEnabled = true;
    try {
        const currentLogId = getCurrentLogId();
        if (currentLogId) {
            // Check log metadata
            const logs = await window.apiClient.getLogs();
            const currentLog = logs.find(log => log.id === currentLogId);
            isLiveMonitoring = currentLog?.is_live_monitoring || false;
            timestampsEnabled = currentLog?.timestampsEnabled !== false;
            
            // Also check if liveMonitor has active monitors for this log
            if (!isLiveMonitoring && window.liveMonitor) {
                const activeMonitors = window.liveMonitor.getActiveMonitors();
                isLiveMonitoring = Array.isArray(activeMonitors) && activeMonitors.includes(currentLogId);
            }
        }
        if (isLiveMonitoring) {
            console.log('[displayCharts] Live monitoring detected - disabling chart animations');
        }
    } catch (e) {
        console.warn('[displayCharts] Could not check live monitoring status:', e);
    }

    chartsDiv.style.display = 'grid';

    // Create charts (incremental updates only happen via loadOverview with incremental=true, used by live monitoring)
    chartsDiv.innerHTML = `
                <div class="chart-card" style="grid-column: 1 / -1; min-height: 250px;">
                    <div id="timeline-container" style="padding: 10px 20px; min-height: 280px;">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading timeline...</span>
                        </div>
                    </div>
                </div>
                <div class="chart-card">
                    <h2>Import Time by Category</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Total time by asset category (click for details)</p>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="categoryChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card">
                    <h2>Import Time by File Type</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Total time by file extension (click for details)</p>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="typeTimeChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card">
                    <h2>Asset Count by File Type</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Number of assets by file extension (click for details)</p>
                    <div style="max-height: 400px; overflow-y: auto;">
                        <table id="type-count-table" style="width: 100%; font-size: 0.9em;">
                            <thead style="position: sticky; top: 0; background: white;">
                                <tr>
                                    <th style="text-align: left; padding: 10px;">File Type</th>
                                    <th style="text-align: right; padding: 10px;">Count</th>
                                    <th style="text-align: right; padding: 10px;">Percentage</th>
                                </tr>
                            </thead>
                            <tbody id="type-count-body">
                                <tr><td colspan="3" style="text-align: center; padding: 20px;">
                                    <div class="element-spinner">
                                        <span class="loading-spinner"></span>
                                        <span>Loading data...</span>
                                    </div>
                                </td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="chart-card clickable" onclick="loadFolderAnalysis()" style="cursor: grab;" title="Click to view all folders">
                    <h2>Heaviest Folders</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Top folders by total import time (click for details)</p>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="foldersChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card" style="grid-column: span 2; min-height: 450px;">
                    <h2>Slowest Assets</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Top 50 slowest assets across all file types (click for details)</p>
                    <div style="max-height: 400px; overflow-y: auto;">
                        <table id="slowest-assets-table" style="width: 100%; font-size: 0.9em;">
                            <thead style="position: sticky; top: 0; background: white;">
                                <tr>
                                    <th style="text-align: left; padding: 10px; width: 35%;">Asset Name</th>
                                    <th style="text-align: left; padding: 10px; width: 8%;">File Type</th>
                                    <th style="text-align: left; padding: 10px; width: 10%;">Category</th>
                                    <th style="text-align: left; padding: 10px; width: 12%;">Importer</th>
                                    <th style="text-align: right; padding: 10px; width: 10%;">Import Time</th>
                                    <th style="text-align: left; padding: 10px;">Path</th>
                                </tr>
                            </thead>
                            <tbody id="slowest-assets-body">
                                <tr><td colspan="6" style="text-align: center; padding: 20px;">
                                    <div class="element-spinner">
                                        <span class="loading-spinner"></span>
                                        <span>Loading assets...</span>
                                    </div>
                                </td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="chart-card">
                    <h2>Time by Importer</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Total time by Unity importer type (click for details)</p>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="importerChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card" style="min-height: 400px;">
                    <h2>Import Time Statistics by File Type</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Mean and standard deviation to identify outliers vs. consistently slow imports</p>
                    <div style="max-height: 350px; overflow-y: auto;">
                        <table id="mode-time-table" style="width: 100%; font-size: 0.9em;">
                            <thead style="position: sticky; top: 0; background: white;">
                                <tr>
                                    <th style="text-align: left; padding: 10px;">File Type</th>
                                    <th style="text-align: right; padding: 10px;">Count</th>
                                    <th style="text-align: right; padding: 10px;">Mean</th>
                                    <th style="text-align: right; padding: 10px;">Std Dev</th>
                                    <th style="text-align: left; padding: 10px;">Interpretation</th>
                                    <th style="text-align: right; padding: 10px;">Total Time</th>
                                </tr>
                            </thead>
                            <tbody id="mode-time-body">
                                <tr><td colspan="6" style="text-align: center; padding: 20px;">
                                    <div class="element-spinner">
                                        <span class="loading-spinner"></span>
                                        <span>Calculating statistics...</span>
                                    </div>
                                </td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

    // Type pie chart (time) - by file extension - sorted by time
    const typeData = (data.by_type || []).slice(0, 15);  // Top 15 types by time
    const typeTimeLabels = typeData.map(t => t.asset_type || 'Unknown');
    const typeTimeData = typeData.map(t => (t.total_time / 1000).toFixed(2));

    // Type time chart uses standard 15-color palette
    const typeTimeChart = window.createPieChart ? window.createPieChart('typeTimeChart', typeTimeLabels, typeTimeData, {
        disableAnimation: isLiveMonitoring,
        legendPosition: 'right',
        legendFontSize: 11,
        dataLabelThreshold: 5,
        customColors: [
            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
            '#9966FF', '#FF9F40', '#E7E9ED', '#8E5EA2',
            '#3cba9f', '#e8c3b9', '#c45850', '#95d5b2',
            '#ffd6a5', '#caffbf', '#fdffb6'
        ],
        tooltipFormatter: (context) => {
            const value = parseFloat(context.parsed);
            const total = context.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
            const percentage = ((value / total) * 100).toFixed(1);
            const count = typeData[context.dataIndex]?.count || 0;
            return [
                formatTime(value) + ' (' + percentage + '%)',
                count + ' assets'
            ];
        },
        onClick: (event, elements) => {
            if (elements.length > 0) {
                const index = elements[0].index;
                const chart = window.chartInstances.typeTimeChart;
                if (chart && chart.data && chart.data.labels && chart.data.labels[index]) {
                    const type = chart.data.labels[index];
                    loadTypeDetail(type);
                }
            }
        }
    }) : null;

    if (!typeTimeChart && window.createPieChart) {
        console.error('Failed to create type time chart');
    }

    // Type count table - display as table instead of chart
    const typeDataByCount = (data.by_type || []).sort((a, b) => b.count - a.count);
    const totalAssets = typeDataByCount.reduce((sum, t) => sum + t.count, 0);
    
    const typeCountBody = document.getElementById('type-count-body');
    if (typeCountBody) {
        typeCountBody.innerHTML = typeDataByCount.map(typeData => {
            const percentage = ((typeData.count / totalAssets) * 100).toFixed(1);
            return `
                <tr style="cursor: grab; transition: background 0.2s;" 
                    onmouseover="this.style.background='#f5f5f5'" 
                    onmouseout="this.style.background='white'"
                    onclick="loadTypeDetail('${typeData.asset_type}')">
                    <td style="padding: 10px; font-weight: 500;">${typeData.asset_type || 'Unknown'}</td>
                    <td style="padding: 10px; text-align: right;">${typeData.count.toLocaleString()}</td>
                    <td style="padding: 10px; text-align: right;">${percentage}%</td>
                </tr>
            `;
        }).join('');
    }

    // Use requestAnimationFrame to ensure DOM is fully updated before adding event listeners
    requestAnimationFrame(() => {
        try {

            // Folders chart
            loadFoldersChart(isLiveMonitoring);

            // Importer type chart
            loadImporterChart(data.by_importer, isLiveMonitoring);

            // Mode time table
            displayModeTimeTable(data.by_type);

            // Slowest assets table
            loadSlowestAssets();

            // Category chart
            loadCategoryChart(data.by_category, isLiveMonitoring);

            // Timeline visualization
            if (window.displayTimeline) {
                displayTimeline(data);
            }

            // Cache server download blocks
            if (window.displayCacheServerBlocks) {
                displayCacheServerBlocks();
            }

        } catch (error) {
            console.error('[displayCharts] Error loading charts:', error);
            console.error('[displayCharts] Error stack:', error.stack);
        }
    });

    // Show/hide timestamp status banner
    const timestampStatus = document.getElementById('timestamp-status');
    if (timestampStatus) {
        if (timestampsEnabled) {
            timestampStatus.innerHTML = `
                <div style="background: #d4edda; border: 1px solid #28a745; border-radius: 6px; padding: 8px 16px; display: flex; align-items: center; gap: 8px; font-size: 0.9em;">
                    <span style="font-size: 16px;">✓</span>
                    <span style="color: #155724; font-weight: 500;">Timestamps enabled</span>
                </div>
            `;
            timestampStatus.style.display = 'flex';
        } else {
            timestampStatus.innerHTML = `
                <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 8px 16px; cursor: grab; display: flex; align-items: center; gap: 8px; font-size: 0.9em; transition: background 0.2s;" 
                     onclick="showTimestampWarningDialog()"
                     onmouseover="this.style.background='#ffe69c'"
                     onmouseout="this.style.background='#fff3cd'">
                    <span style="font-size: 16px;">⚠️</span>
                    <span style="color: #856404; font-weight: 500;">No timestamps - <span style="text-decoration: underline;">Click for info</span></span>
                </div>
            `;
            timestampStatus.style.display = 'flex';
        }
    }
}

/**
 * Update charts incrementally without re-animation
 * Only updates data, preserves chart instances
 */
async function updateChartsIncremental(data) {
    // Debug: Log summary data to diagnose chart issues
    console.log('[updateChartsIncremental] Summary data:', {
        by_category: data.by_category?.length || 0,
        by_type: data.by_type?.length || 0,
        asset_imports_count: data.asset_imports?.count || 0
    });

    // Check if charts container exists - if not, charts were cleared, so do full update instead
    const chartsDiv = document.getElementById('charts');
    if (!chartsDiv || !chartsDiv.querySelector('canvas')) {
        displayStats(data);
        await displayCharts(data);
        return;
    }

    // Update type time chart - recreate to ensure plugins work properly
    if (data.by_type && data.by_type.length > 0) {
        const canvas = document.getElementById('typeTimeChart');
        if (canvas && canvas.parentElement) {
            const typeData = (data.by_type || []).slice(0, 15);
            const typeTimeLabels = typeData.map(t => t.asset_type || 'Unknown');
            const typeTimeData = typeData.map(t => (t.total_time / 1000).toFixed(2));

            if (window.createPieChart) {
                window.createPieChart('typeTimeChart', typeTimeLabels, typeTimeData, {
                    disableAnimation: true,
                    legendPosition: 'right',
                    legendFontSize: 11,
                    dataLabelThreshold: 5,
                    customColors: [
                        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
                        '#9966FF', '#FF9F40', '#E7E9ED', '#8E5EA2',
                        '#3cba9f', '#e8c3b9', '#c45850', '#95d5b2',
                        '#ffd6a5', '#caffbf', '#fdffb6'
                    ],
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const chart = window.chartInstances.typeTimeChart;
                            if (chart && chart.data && chart.data.labels && chart.data.labels[index]) {
                                const type = chart.data.labels[index];
                                loadTypeDetail(type);
                            }
                        }
                    }
                });
            }
        }
    }

    // Update type count chart - recreate to ensure plugins work properly
    const canvasCount = document.getElementById('typeCountChart');
    if (canvasCount && canvasCount.parentElement && data.by_type && data.by_type.length > 0) {
        const typeDataByCount = (data.by_type || []).sort((a, b) => b.count - a.count).slice(0, 15);
        const typeCountLabels = typeDataByCount.map(t => t.asset_type || 'Unknown');
        const typeCountData = typeDataByCount.map(t => t.count);

        if (window.createPieChart) {
            window.createPieChart('typeCountChart', typeCountLabels, typeCountData, {
                isDoughnut: true,
                disableAnimation: true,
                legendPosition: 'right',
                legendFontSize: 11,
                dataLabelThreshold: 3,
                customColors: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
                    '#9966FF', '#FF9F40', '#E7E9ED', '#8E5EA2',
                    '#3cba9f', '#e8c3b9', '#c45850', '#95d5b2',
                    '#ffd6a5', '#caffbf', '#fdffb6'
                ],
                tooltipFormatter: (context) => {
                    const label = context.label || '';
                    const value = context.parsed;
                    const total = context.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
                    const percentage = ((value / total) * 100).toFixed(1);
                    return label + ': ' + value + ' assets (' + percentage + '%)';
                },
                dataLabelFormatter: (value) => value,
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const chart = window.chartInstances.typeCountChart;
                        if (chart && chart.data && chart.data.labels && chart.data.labels[index]) {
                            const type = chart.data.labels[index];
                            loadTypeDetail(type);
                        }
                    }
                }
            });
        }
    }

    // Update category chart
    // NOTE: Recreate chart entirely during incremental updates to ensure plugins (tooltips, legend) are properly initialized
    // This is necessary because chart.update() doesn't always properly re-render plugins
    const canvas = document.getElementById('categoryChart');
    if (canvas && canvas.parentElement) {
        if (data.by_category && data.by_category.length > 0) {
            // Always recreate the chart to ensure tooltips and legend work properly
            // Pass disableAnimation=true to prevent animation during live updates
            if (typeof loadCategoryChart === 'function') {
                loadCategoryChart(data.by_category, true);
            } else if (window.loadCategoryChart) {
                window.loadCategoryChart(data.by_category, true);
            }
        } else {
            // No category data, but ensure chart exists (will show empty state)
            if (!window.chartInstances.categoryChart) {
                if (typeof loadCategoryChart === 'function') {
                    loadCategoryChart([], true);
                } else if (window.loadCategoryChart) {
                    window.loadCategoryChart([], true);
                }
            }
        }
    }

    // Update timeline (it handles its own updates)
    if (window.displayTimeline && data) {
        displayTimeline(data);
    }

    // Update slowest assets table
    if (typeof loadSlowestAssets === 'function') {
        loadSlowestAssets();
    } else if (window.loadSlowestAssets) {
        window.loadSlowestAssets();
    }

    // Update importer chart if data is available
    if (data.by_importer && typeof loadImporterChart === 'function') {
        loadImporterChart(data.by_importer, true);
    } else if (data.by_importer && window.loadImporterChart) {
        window.loadImporterChart(data.by_importer, true);
    }

    // Update folders chart
    if (typeof loadFoldersChart === 'function') {
        loadFoldersChart(true);
    } else if (window.loadFoldersChart) {
        window.loadFoldersChart(true);
    }
}

/**
 * Update stats incrementally without full recreation
 */
function updateStatsIncremental(data) {
    const statsDiv = document.getElementById('stats');
    if (!statsDiv) return;

    const assetImports = data.asset_imports;
    const projectLoadTime = data.project_load_time_seconds || 0;

    // Update project load time
    const loadTimeElement = statsDiv.querySelector('.stat-card .stat-value');
    if (loadTimeElement && loadTimeElement.textContent.includes('Total Project Load Time')) {
        const parentCard = loadTimeElement.closest('.stat-card');
        if (parentCard) {
            const valueElement = parentCard.querySelector('.stat-value');
            if (valueElement) {
                valueElement.textContent = formatTime(projectLoadTime);
            }
        }
    }

    // Update total assets count
    const assetsCard = statsDiv.querySelector('.stat-card.clickable');
    if (assetsCard) {
        const valueElement = assetsCard.querySelector('.stat-value');
        if (valueElement && !valueElement.classList.contains('element-spinner')) {
            valueElement.textContent = assetImports.count || 0;
        }
    }
}

/**
 * Show timestamp warning dialog with detailed information
 */
function showTimestampWarningDialog() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 20px 24px;
        max-width: 480px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    `;

    dialog.innerHTML = `
        <h3 style="margin: 0 0 12px 0; color: #333; font-size: 1.1em; display: flex; align-items: center; gap: 8px;">
            <span>⚠️</span>
            Timestamps Not Enabled
        </h3>
        <div style="color: #555; line-height: 1.5; font-size: 0.9em;">
            <p style="margin: 0 0 10px 0;">
                This log lacks timestamps. Impact:
            </p>
            <ul style="margin: 0 0 10px 0; padding-left: 18px; font-size: 0.85em;">
                <li>Timeline ordering may be inaccurate</li>
                <li>Import times exclude I/O operations</li>
            </ul>
            <p style="margin: 0 0 8px 0; font-size: 0.85em;">
                <strong>To enable timestamps:</strong>
            </p>
            <ol style="margin: 0 0 12px 0; padding-left: 18px; font-size: 0.85em;">
                <li>Add <code style="background: #f0f0f0; padding: 1px 4px; border-radius: 2px; font-size: 0.9em;">-timestamps</code> to Unity Editor command line</li>
                <li>Configure in Unity Hub → Projects → ⋮ → Add arguments</li>
                <li>Restart Unity and parse a new log</li>
            </ol>
            <p style="margin: 0 0 14px 0; font-size: 0.8em;">
                <a href="https://docs.unity3d.com/6000.2/Documentation/Manual/EditorCommandLineArguments.html" 
                   target="_blank" 
                   style="color: #4CAF50; text-decoration: none;">
                    Unity Documentation →
                </a>
            </p>
            <button onclick="this.closest('[data-dialog]').remove()" 
                    style="width: 100%; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; font-size: 0.9em; font-weight: 500; cursor: grab;">
                Got it
            </button>
        </div>
    `;

    overlay.setAttribute('data-dialog', 'true');
    overlay.appendChild(dialog);
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    };

    document.body.appendChild(overlay);
}

