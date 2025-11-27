/**
 * Overview View Module
 * Handles the main dashboard overview display
 */

import { formatTime } from '../core/formatters.js';
import { destroyChart, showChart, createPieChart } from '../charts/base-chart.js';
import { loadFoldersChart, loadCategoryChart, loadImporterChart, loadPipelineBreakdown, loadStdDevView } from '../charts/chart-loaders.js';
import { displayTimeline } from '../components/timeline/index.js';
import { displayModeTimeTable } from '../components/tables/mode-time-table.js';
import { loadSlowestAssets } from '../components/tables/slowest-assets-table.js';
import * as templates from '../core/templates.js';

// Store chart instances globally for incremental updates
window.chartInstances = window.chartInstances || {};

/**
 * Show empty state when no log is parsed
 */
export function showEmptyState() {
    const statsDiv = document.getElementById('stats');
    const chartsDiv = document.getElementById('charts');
    if (statsDiv) statsDiv.style.display = 'none';
    if (chartsDiv) chartsDiv.style.display = 'none';

    // Hide Slack copy button when no log is loaded
    const slackButtonContainer = document.getElementById('slack-button-container');
    if (slackButtonContainer) {
        slackButtonContainer.style.display = 'none';
    }

    if (chartsDiv) {
        chartsDiv.innerHTML = templates.chartCard({
            colspan: 'full',
            content: templates.emptyState({
                title: 'No Log File Parsed',
                message: 'Click "Parse Log File" in the header to upload and analyze a Unity Editor.log file',
                buttonText: '📁 Parse Log File',
                buttonAction: 'openLogParser()'
            })
        });
    }
}

/**
 * Load overview data and display
 * @param {boolean} incremental - Whether this is an incremental update (live monitoring)
 */
export async function loadOverview(incremental = false) {
    if (typeof setCurrentView === 'function') {
        setCurrentView('overview');
    }

    try {
        // Get log metadata to show project name
        const logs = await window.apiClient.getLogs();
        const currentLogId = typeof getCurrentLogId === 'function' ? getCurrentLogId() : 1;
        const currentLog = logs.find(log => log.id === currentLogId);
        if (currentLog && typeof updateProjectName === 'function') {
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
        if (typeof showError === 'function') {
            showError('Failed to load summary: ' + error.message);
        }
    }
}

/**
 * Display summary statistics
 * @param {Object} data - Summary data from API
 */
export function displayStats(data) {
    const statsDiv = document.getElementById('stats');
    if (!statsDiv) return;
    
    statsDiv.style.display = 'grid';

    const assetImports = data.asset_imports || {};
    const projectLoadTime = data.project_load_time_seconds || 0;
    const unityVersion = data.unity_version || 'Unknown';

    // Update Unity version in header
    if (typeof updateUnityVersion === 'function') {
        updateUnityVersion(unityVersion);
    }

    statsDiv.innerHTML = [
        templates.statCard({ label: 'Total Project Load Time', value: formatTime(projectLoadTime) }),
        templates.statCard({ 
            label: 'Total Assets', 
            value: assetImports.count || 0,
            clickable: true,
            onClick: 'loadAllAssets()',
            title: 'Click to view all assets'
        }),
        templates.statCard({ 
            label: 'Raw Asset Import Time', 
            value: formatTime((assetImports.total_time || 0) / 1000),
            title: 'Note this can be longer than project load time due to parallelised import worker threads'
        })
    ].join('');
}

/**
 * Display all charts
 * @param {Object} data - Summary data from API
 */
export async function displayCharts(data) {
    const chartsDiv = document.getElementById('charts');
    if (!chartsDiv) {
        console.warn('[displayCharts] Charts container not found');
        return;
    }

    // Check if current log is in live monitoring mode to disable animations
    let isLiveMonitoring = false;
    let timestampsEnabled = true;
    try {
        const currentLogId = typeof getCurrentLogId === 'function' ? getCurrentLogId() : 1;
        if (currentLogId) {
            const logs = await window.apiClient.getLogs();
            const currentLog = logs.find(log => log.id === currentLogId);
            isLiveMonitoring = currentLog?.is_live_monitoring || false;
            timestampsEnabled = currentLog?.timestampsEnabled !== false;
            
            if (!isLiveMonitoring && window.liveMonitor) {
                const activeMonitors = window.liveMonitor.getActiveMonitors();
                isLiveMonitoring = Array.isArray(activeMonitors) && activeMonitors.includes(currentLogId);
            }
        }
    } catch (e) {
        console.warn('[displayCharts] Could not check live monitoring status:', e);
    }

    chartsDiv.style.display = 'grid';

    // Create chart layout HTML using templates
    chartsDiv.innerHTML = [
        // Timeline card
        templates.chartCard({
            colspan: 'full',
            minHeight: '250px',
            content: templates.timelineContainer('timeline-container', 'Loading timeline...')
        }),
        // Category chart
        templates.chartCard({
            title: 'Import Time by Category',
            subtitle: 'Total time by asset category (click for details)',
            content: templates.chartContainer('categoryChart')
        }),
        // File type time chart
        templates.chartCard({
            title: 'Import Time by File Type',
            subtitle: 'Total time by file extension (click for details)',
            content: templates.chartContainer('typeTimeChart')
        }),
        // Asset count by type table
        templates.chartCard({
            title: 'Asset Count by File Type',
            subtitle: 'Number of assets by file extension (click for details)',
            content: templates.scrollableTable({
                maxHeight: '400px',
                content: templates.table({
                    headers: [
                        { text: 'File Type' },
                        { text: 'Count', align: 'right' },
                        { text: 'Percentage', align: 'right' }
                    ],
                    bodyId: 'type-count-body',
                    bodyContent: templates.tableLoadingRow(3, 'Loading data...')
                })
            })
        }),
        // Heaviest folders chart
        templates.chartCard({
            title: 'Heaviest Folders',
            subtitle: 'Top folders by total import time (click for details)',
            clickable: true,
            onClick: 'loadFolderAnalysis()',
            content: templates.chartContainer('foldersChart')
        }),
        // Slowest assets table
        templates.chartCard({
            title: 'Slowest Assets',
            subtitle: 'Top 50 slowest assets across all file types (click for details)',
            colspan: 2,
            minHeight: '450px',
            content: templates.scrollableTable({
                maxHeight: '400px',
                content: templates.table({
                    headers: [
                        { text: 'Asset Name', width: '35%' },
                        { text: 'File Type', width: '8%' },
                        { text: 'Category', width: '10%' },
                        { text: 'Importer', width: '12%' },
                        { text: 'Import Time', width: '10%', align: 'right' },
                        { text: 'Path' }
                    ],
                    bodyId: 'slowest-assets-body',
                    bodyContent: templates.tableLoadingRow(6, 'Loading assets...')
                })
            })
        }),
        // Importer chart
        templates.chartCard({
            title: 'Time by Importer',
            subtitle: 'Total time by Unity importer type (click for details)',
            content: templates.chartContainer('importerChart')
        }),
        // Mode time statistics table
        templates.chartCard({
            title: 'Import Time Statistics by File Type',
            subtitle: 'Mean and standard deviation to identify outliers vs. consistently slow imports',
            minHeight: '400px',
            content: templates.scrollableTable({
                maxHeight: '350px',
                content: templates.table({
                    headers: [
                        { text: 'File Type' },
                        { text: 'Count', align: 'right' },
                        { text: 'Mean', align: 'right' },
                        { text: 'Std Dev', align: 'right' },
                        { text: 'Interpretation' },
                        { text: 'Total Time', align: 'right' }
                    ],
                    bodyId: 'mode-time-body',
                    bodyContent: templates.tableLoadingRow(6, 'Calculating statistics...')
                })
            })
        })
    ].join('');

    // Type pie chart (time) - by file extension - sorted by time
    const typeData = (data.by_type || []).slice(0, 15);
    const typeTimeLabels = typeData.map(t => t.asset_type || 'Unknown');
    const typeTimeData = typeData.map(t => (t.total_time / 1000).toFixed(2));

    if (createPieChart && typeTimeLabels.length > 0) {
        createPieChart('typeTimeChart', typeTimeLabels, typeTimeData, {
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
                        if (typeof loadTypeDetail === 'function') {
                            loadTypeDetail(type);
                        }
                    }
                }
            }
        });
    }

    // Type count table
    const typeDataByCount = (data.by_type || []).sort((a, b) => b.count - a.count);
    const totalAssets = typeDataByCount.reduce((sum, t) => sum + t.count, 0);
    
    const typeCountBody = document.getElementById('type-count-body');
    if (typeCountBody) {
        typeCountBody.innerHTML = typeDataByCount.map(typeData => {
            const percentage = ((typeData.count / totalAssets) * 100).toFixed(1);
            return templates.clickableRow({
                onClick: `loadTypeDetail('${typeData.asset_type}')`,
                cells: `
                    <td style="padding: 10px; font-weight: 500;">${typeData.asset_type || 'Unknown'}</td>
                    <td style="padding: 10px; text-align: right;">${typeData.count.toLocaleString()}</td>
                    <td style="padding: 10px; text-align: right;">${percentage}%</td>
                `
            });
        }).join('');
    }

    // Load charts after DOM is ready
    requestAnimationFrame(() => {
        try {
            // Folders chart
            loadFoldersChart(isLiveMonitoring);

            // Importer type chart
            loadImporterChart(data.by_importer, isLiveMonitoring);

            // Mode time table
            displayModeTimeTableInline(data.by_type);

            // Slowest assets table
            loadSlowestAssetsInline();

            // Category chart
            loadCategoryChart(data.by_category, isLiveMonitoring);

            // Timeline visualization
            displayTimeline(data);

            // Cache server download blocks
            if (typeof displayCacheServerBlocks === 'function') {
                displayCacheServerBlocks();
            }

        } catch (error) {
            console.error('[displayCharts] Error loading charts:', error);
        }
    });

    // Show/hide timestamp status banner
    const timestampStatus = document.getElementById('timestamp-status');
    if (timestampStatus) {
        if (timestampsEnabled) {
            timestampStatus.innerHTML = templates.successBanner('Timestamps enabled');
            timestampStatus.style.display = 'flex';
        } else {
            timestampStatus.innerHTML = templates.warningBanner(
                'No timestamps - <span style="text-decoration: underline;">Click for info</span>',
                'showTimestampWarningDialog()'
            );
            timestampStatus.style.display = 'flex';
        }
    }
}

/**
 * Display mode time table inline (in the overview)
 */
function displayModeTimeTableInline(typeData) {
    const modeTimeBody = document.getElementById('mode-time-body');
    if (!modeTimeBody || !typeData) return;

    // Calculate stats for each type
    const rows = typeData.map(type => {
        const mean = type.count > 0 ? type.total_time / type.count : 0;
        const meanSeconds = mean / 1000;
        
        // Interpretation based on mean time
        let interpretation = 'Normal';
        if (meanSeconds > 1) {
            interpretation = 'Slow';
        } else if (meanSeconds < 0.1) {
            interpretation = 'Fast';
        }

        return templates.clickableRow({
            onClick: `loadStdDevView('${type.asset_type}')`,
            cells: `
                <td style="padding: 10px; font-weight: 500;">${type.asset_type || 'Unknown'}</td>
                <td style="padding: 10px; text-align: right;">${type.count.toLocaleString()}</td>
                <td style="padding: 10px; text-align: right;">${formatTime(meanSeconds)}</td>
                <td style="padding: 10px; text-align: right;">-</td>
                <td style="padding: 10px;">${interpretation}</td>
                <td style="padding: 10px; text-align: right;">${formatTime(type.total_time / 1000)}</td>
            `
        });
    }).join('');

    modeTimeBody.innerHTML = rows;
}

/**
 * Load slowest assets inline (in the overview)
 */
async function loadSlowestAssetsInline() {
    const slowestBody = document.getElementById('slowest-assets-body');
    if (!slowestBody) return;

    try {
        const assets = await window.apiClient.getTopSlowest(50);
        
        if (!assets || assets.length === 0) {
            slowestBody.innerHTML = templates.tableEmptyRow(6, 'No assets found');
            return;
        }

        slowestBody.innerHTML = assets.map(asset => {
            const timeSeconds = asset.import_time_ms / 1000;
            return templates.clickableRow({
                onClick: `openLogViewer(${asset.line_number})`,
                cells: `
                    <td style="padding: 10px; font-weight: 500;">${asset.asset_name || 'Unknown'}</td>
                    <td style="padding: 10px;">${asset.asset_type || 'N/A'}</td>
                    <td style="padding: 10px;">${asset.asset_category || 'Unknown'}</td>
                    <td style="padding: 10px;">${asset.importer_type || 'Unknown'}</td>
                    <td style="padding: 10px; text-align: right; font-weight: 600; color: #e74c3c;">${formatTime(timeSeconds)}</td>
                    <td style="padding: 10px; color: #666; font-size: 0.85em; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${asset.asset_path || ''}">${asset.asset_path || 'N/A'}</td>
                `
            });
        }).join('');
    } catch (error) {
        console.error('Error loading slowest assets:', error);
        slowestBody.innerHTML = templates.tableErrorRow(6, 'Failed to load assets');
    }
}

/**
 * Update charts incrementally (for live monitoring)
 */
export async function updateChartsIncremental(data) {
    const chartsDiv = document.getElementById('charts');
    if (!chartsDiv || !chartsDiv.querySelector('canvas')) {
        displayStats(data);
        await displayCharts(data);
        return;
    }

    // Update category chart
    if (data.by_category && data.by_category.length > 0) {
        loadCategoryChart(data.by_category, true);
    }

    // Update timeline
    displayTimeline(data);

    // Update slowest assets
    loadSlowestAssetsInline();

    // Update importer chart
    if (data.by_importer) {
        loadImporterChart(data.by_importer, true);
    }

    // Update folders chart
    loadFoldersChart(true);
}

/**
 * Update stats incrementally (for live monitoring)
 */
export function updateStatsIncremental(data) {
    const statsDiv = document.getElementById('stats');
    if (!statsDiv) return;

    const assetImports = data.asset_imports || {};
    const projectLoadTime = data.project_load_time_seconds || 0;

    const statValues = statsDiv.querySelectorAll('.stat-value');
    if (statValues.length >= 3) {
        statValues[0].textContent = formatTime(projectLoadTime);
        statValues[1].textContent = assetImports.count || 0;
        statValues[2].textContent = formatTime((assetImports.total_time || 0) / 1000);
    }
}

/**
 * Show timestamp warning dialog
 */
export function showTimestampWarningDialog() {
    const dialogContent = `
        <p>This log lacks timestamps. Impact:</p>
        <ul>
            <li>Timeline ordering may be inaccurate</li>
            <li>Import times exclude I/O operations</li>
        </ul>
        <p><strong>To enable timestamps:</strong></p>
        <ol>
            <li>Add <code>-timestamps</code> to Unity Editor command line</li>
            <li>Configure in Unity Hub → Projects → ⋮ → Add arguments</li>
            <li>Restart Unity and parse a new log</li>
        </ol>
    `;

    const overlay = document.createElement('div');
    overlay.innerHTML = templates.dialogOverlay({
        title: 'Timestamps Not Enabled',
        icon: '⚠️',
        content: dialogContent,
        buttonText: 'Got it'
    });

    const dialogEl = overlay.firstElementChild;
    dialogEl.onclick = (e) => {
        if (e.target === dialogEl) {
            dialogEl.remove();
        }
    };

    document.body.appendChild(dialogEl);
}

