/**
 * Assets Table Module
 * Handles asset table rendering with pagination
 */

import { formatTime } from '../../core/formatters.js';
import { showContextMenu, setupTableContextMenus } from './context-menu.js';
import * as templates from '../../core/templates.js';

// Pagination state
let allAssetsData = [];
let displayedAssetCount = 100;
const assetPageSize = 100;

/**
 * Get back button config if coming from std dev view
 */
function getBackButtonConfig() {
    if (typeof getStdDevViewState === 'function' && getStdDevViewState()) {
        return { text: 'Back to Histogram', onClick: 'restoreStdDevView()' };
    }
    return null;
}

/**
 * Get asset table headers
 */
function getAssetTableHeaders() {
    return [
        { text: 'Line #', width: '70px' },
        { text: 'Asset Name', minWidth: '250px' },
        { text: 'Category', width: '120px' },
        { text: 'Type', width: '100px' },
        { text: 'Importer', width: '110px' },
        { text: 'Time', width: '100px', align: 'right' },
        { text: 'Path', minWidth: '250px' }
    ];
}

/**
 * Display assets table with progressive loading
 * @param {string} assetType - Type of assets to display
 * @param {string} title - Table title
 */
export async function displayAssetsTableProgressive(assetType, title) {
    const tablesDiv = document.getElementById('tables');

    const tableContent = `
        ${templates.scrollableTable({
            id: 'asset-table-scroll',
            content: templates.table({
                headers: getAssetTableHeaders(),
                bodyId: 'asset-table-body',
                bodyContent: templates.tableLoadingRow(7, 'Loading assets...')
            })
        })}
        ${templates.loadIndicator('asset-load-indicator', 'Loading more assets...')}
        ${templates.infoText('asset-info', 'Loading...')}
    `;

    tablesDiv.innerHTML = templates.tableContainer({
        title,
        backButton: getBackButtonConfig(),
        stats: [
            { label: 'Asset Count', value: 'Loading...', id: 'asset-count-stat' },
            { label: 'Total Time', value: 'Loading...', id: 'asset-time-stat' },
            { label: '% of Full Load Time', value: 'Loading...', id: 'asset-percent-stat' }
        ],
        hint: '<strong>Click</strong> any row or line number to jump to that location in the log',
        content: tableContent
    });

    // Auto-scroll to tables
    setTimeout(() => {
        tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);

    const BATCH_SIZE = 200;
    let allAssets = [];
    let totalTime = 0;
    let firstBatchRendered = false;

    try {
        const db = await window.apiClient.getDatabase();
        const logId = window.apiClient.getCurrentLogId();

        let projectLoadTimeSeconds = 0;
        const summaryPromise = window.apiClient.getSummary().catch(err => {
            console.error('Failed to get project load time:', err);
            return null;
        });

        const loadPromise = db.getAssetsByTypeProgressive(logId, assetType, async (batch, offset, total, isLast) => {
            allAssets.push(...batch);

            const batchTime = batch.reduce((sum, a) => sum + (a.import_time_ms || 0), 0);
            totalTime += batchTime;

            if (!firstBatchRendered && offset === 0) {
                firstBatchRendered = true;

                const summary = await summaryPromise;
                if (summary) {
                    projectLoadTimeSeconds = summary.project_load_time_seconds || 0;
                }

                document.getElementById('asset-count-stat').textContent = total.toLocaleString();
                updateAssetStats(allAssets, totalTime, projectLoadTimeSeconds);

                allAssetsData = allAssets;
                displayedAssetCount = Math.min(assetPageSize, allAssets.length);

                const tbody = document.getElementById('asset-table-body');
                tbody.innerHTML = '';

                renderAssetRows();
                setupAssetTableScroll();
                setupAssetTableContextMenus();
            }

            if (firstBatchRendered) {
                const summary = await summaryPromise;
                if (summary && !projectLoadTimeSeconds) {
                    projectLoadTimeSeconds = summary.project_load_time_seconds || 0;
                }

                updateAssetStats(allAssets, totalTime, projectLoadTimeSeconds);
                allAssetsData = allAssets;

                if (allAssets.length > displayedAssetCount) {
                    renderAssetRows();
                }
            }

            if (firstBatchRendered && !isLast) {
                const indicator = document.getElementById('asset-load-indicator');
                if (indicator) {
                    const percent = ((offset + batch.length) / total * 100).toFixed(0);
                    indicator.style.display = 'block';
                    indicator.textContent = `Loading assets... ${percent}% (${(offset + batch.length).toLocaleString()} of ${total.toLocaleString()})`;
                }
            }

            if (isLast) {
                const indicator = document.getElementById('asset-load-indicator');
                if (indicator) {
                    indicator.style.display = 'none';
                }

                const summary = await summaryPromise;
                if (summary && !projectLoadTimeSeconds) {
                    projectLoadTimeSeconds = summary.project_load_time_seconds || 0;
                }
                updateAssetStats(allAssets, totalTime, projectLoadTimeSeconds);
                allAssetsData = allAssets;
            }
        }, BATCH_SIZE);

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

/**
 * Display assets table (non-progressive)
 * @param {Array} assets - Array of asset objects
 * @param {string} title - Table title
 */
export async function displayAssetsTable(assets, title) {
    const tablesDiv = document.getElementById('tables');

    allAssetsData = assets;
    displayedAssetCount = Math.min(assetPageSize, assets.length);

    const totalTime = assets.reduce((sum, a) => sum + a.import_time_ms, 0);

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

    const tableContent = `
        ${templates.scrollableTable({
            id: 'asset-table-scroll',
            content: templates.table({
                headers: getAssetTableHeaders(),
                bodyId: 'asset-table-body'
            })
        })}
        ${templates.loadIndicator('asset-load-indicator', 'Loading more assets...')}
        ${templates.infoText('asset-info', `Showing ${displayedAssetCount} of ${assets.length} assets`)}
    `;

    tablesDiv.innerHTML = templates.tableContainer({
        title,
        backButton: getBackButtonConfig(),
        stats: [
            { label: 'Asset Count', value: assets.length.toLocaleString() },
            { label: 'Total Time', value: formatTime(totalTime / 1000) },
            { label: '% of Full Load Time', value: `${percentageOfLoad}${percentageOfLoad !== 'N/A' ? '%' : ''}` }
        ],
        hint: '<strong>Click</strong> any row or line number to jump to that location in the log',
        content: tableContent
    });

    renderAssetRows();
    setupAssetTableScroll();
    setupAssetTableContextMenus();

    setTimeout(() => {
        tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

/**
 * Render a single asset row
 */
function renderAssetRow(asset) {
    const category = asset.asset_category || 'Unknown';
    const importer = asset.importer_type || 'Unknown';
    const timeSeconds = asset.import_time_ms / 1000;
    const timeFormatted = formatTime(timeSeconds);

    let timeBadgeClass = 'badge';
    if (timeSeconds > 1) {
        timeBadgeClass = 'badge-warning';
    } else if (timeSeconds < 0.1) {
        timeBadgeClass = 'badge-success';
    }

    const assetPath = asset.asset_path || '';

    return templates.clickableRow({
        onClick: `openLogViewer(${asset.line_number})`,
        data: { line: asset.line_number, path: assetPath },
        cells: `
            ${templates.lineNumberCell(asset.line_number)}
            <td><strong style="color: #1a1a1a; font-size: 0.9em; word-break: break-word;">${asset.asset_name}</strong></td>
            <td><span class="badge">${category}</span></td>
            <td><span class="mono">${asset.asset_type || 'N/A'}</span></td>
            <td><span class="mono" style="font-size: 0.85em;">${importer}</span></td>
            <td style="text-align: right;"><span class="${timeBadgeClass}" style="font-weight: 600;">${timeFormatted}</span></td>
            <td><span class="text-truncate-long" style="font-size: 0.9em; color: #666;">${asset.asset_path}</span></td>
        `
    });
}

/**
 * Render asset rows in the table
 */
export function renderAssetRows() {
    const tbody = document.getElementById('asset-table-body');
    const assetsToShow = allAssetsData.slice(0, displayedAssetCount);

    tbody.innerHTML = assetsToShow.map(renderAssetRow).join('');

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
export function setupAssetTableScroll() {
    const scrollContainer = document.getElementById('asset-table-scroll');
    if (!scrollContainer) return;

    let isLoadingAssets = false;

    scrollContainer.addEventListener('scroll', () => {
        const scrollTop = scrollContainer.scrollTop;
        const scrollHeight = scrollContainer.scrollHeight;
        const clientHeight = scrollContainer.clientHeight;

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
}

/**
 * Setup context menus for asset table rows
 */
export function setupAssetTableContextMenus() {
    const tbody = document.getElementById('asset-table-body');
    if (!tbody) return;
    setupTableContextMenus(tbody);
}

/**
 * Restore standard deviation view
 */
export function restoreStdDevView() {
    const state = typeof getStdDevViewState === 'function' ? getStdDevViewState() : null;
    if (state && typeof loadStdDevView === 'function') {
        loadStdDevView(state.assetType);
    }
}

