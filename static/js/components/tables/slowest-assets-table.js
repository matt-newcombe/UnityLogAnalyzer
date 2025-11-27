/**
 * Slowest Assets Table Module
 * Displays top 50 slowest assets
 */

import { formatTime } from '../../core/formatters.js';
import { setupTableContextMenus } from './context-menu.js';
import * as templates from '../../core/templates.js';

/**
 * Render a slowest asset row
 */
function renderSlowestAssetRow(asset, index) {
    const timeSeconds = asset.import_time_ms / 1000;
    const escapedPath = (asset.asset_path || '').replace(/"/g, '&quot;');

    return templates.clickableRow({
        onClick: `openLogViewer(${asset.line_number})`,
        data: { line: asset.line_number, path: escapedPath },
        cells: `
            ${templates.rankCell(index + 1)}
            ${templates.lineNumberCell(asset.line_number)}
            <td><strong style="color: #1a1a1a; font-size: 0.9em;">${asset.asset_name}</strong></td>
            <td><span class="badge">${asset.asset_category || 'Unknown'}</span></td>
            <td><span class="mono">${asset.asset_type || 'N/A'}</span></td>
            <td style="text-align: right;"><span class="badge-warning" style="font-weight: 600;">${formatTime(timeSeconds)}</span></td>
            <td><span class="text-truncate-long" style="font-size: 0.9em; color: #666;">${asset.asset_path || 'N/A'}</span></td>
        `
    });
}

/**
 * Load and display slowest assets
 */
export async function loadSlowestAssets() {
    const tablesDiv = document.getElementById('tables');
    const title = '🐢 Top 50 Slowest Assets';

    tablesDiv.innerHTML = templates.tableContainer({
        title,
        content: templates.loadingSpinner('Loading slowest assets...')
    });

    try {
        const assets = await window.apiClient.getTopSlowest(50);

        if (!assets || assets.length === 0) {
            tablesDiv.innerHTML = templates.tableContainer({
                title,
                content: `<p class="table-empty-cell">No assets found</p>`
            });
            return;
        }

        const totalTime = assets.reduce((sum, a) => sum + a.import_time_ms, 0);

        // Get project load time for percentage calculation
        let projectLoadTimeMs = 0;
        try {
            const summary = await window.apiClient.getSummary();
            projectLoadTimeMs = (summary.project_load_time_seconds || 0) * 1000;
        } catch (e) {
            console.error('Failed to get project load time:', e);
        }

        const percentageOfLoad = projectLoadTimeMs > 0
            ? ((totalTime / projectLoadTimeMs) * 100).toFixed(1)
            : 'N/A';

        const tableContent = templates.scrollableTable({
            content: templates.table({
                headers: [
                    { text: '#', width: '50px' },
                    { text: 'Line #', width: '70px' },
                    { text: 'Asset Name', minWidth: '200px' },
                    { text: 'Category', width: '120px' },
                    { text: 'Type', width: '100px' },
                    { text: 'Time', width: '100px', align: 'right' },
                    { text: 'Path', minWidth: '200px' }
                ],
                bodyId: 'slowest-assets-body',
                bodyContent: assets.map((asset, index) => renderSlowestAssetRow(asset, index)).join('')
            })
        });

        tablesDiv.innerHTML = templates.tableContainer({
            title,
            stats: [
                { label: 'Assets Shown', value: assets.length },
                { label: 'Combined Time', value: formatTime(totalTime / 1000) },
                { label: '% of Full Load', value: `${percentageOfLoad}${percentageOfLoad !== 'N/A' ? '%' : ''}` }
            ],
            hint: '<strong>Click</strong> any row to view in log | <strong>Right-click</strong> to copy path',
            content: tableContent
        });

        // Setup context menus
        const tbody = document.getElementById('slowest-assets-body');
        if (tbody) {
            setupTableContextMenus(tbody);
        }

        // Scroll to table
        setTimeout(() => {
            tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

    } catch (error) {
        console.error('Failed to load slowest assets:', error);
        tablesDiv.innerHTML = templates.tableContainer({
            title,
            content: `<p class="table-error-cell">Failed to load slowest assets: ${error.message}</p>`
        });
    }
}

