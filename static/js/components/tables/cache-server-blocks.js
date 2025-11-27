/**
 * Cache Server Download Blocks Module
 * Handles display of cache server download blocks
 */

import { formatTime } from '../../core/formatters.js';
import * as templates from '../../core/templates.js';

/**
 * Render a cache server block row
 */
function renderCacheBlockRow(block) {
    const startTime = block.start_timestamp ? new Date(block.start_timestamp).toLocaleTimeString() : 'N/A';
    const endTime = block.end_timestamp ? new Date(block.end_timestamp).toLocaleTimeString() : 'N/A';
    const duration = formatTime((block.duration_ms || 0) / 1000);
    const successRate = block.num_assets_requested > 0 
        ? ((block.num_assets_downloaded / block.num_assets_requested) * 100).toFixed(1)
        : '0';
    const assetsList = (block.downloaded_assets || []).slice(0, 3).map(asset => {
        const name = asset.split('/').pop();
        return name;
    }).join(', ');
    const moreAssets = (block.downloaded_assets || []).length > 3 
        ? ` +${(block.downloaded_assets || []).length - 3} more`
        : '';
    
    return templates.clickableRow({
        onClick: `navigateToLogLine(${block.line_number})`,
        cells: `
            <td class="rank-cell">${block.line_number}</td>
            <td>${startTime}</td>
            <td>${endTime}</td>
            <td style="text-align: right;">${duration}</td>
            <td style="text-align: right;">${block.num_assets_requested || 0}</td>
            <td style="text-align: right;">${block.num_assets_downloaded || 0}</td>
            <td style="text-align: right;">${successRate}%</td>
            <td style="font-size: 0.9em; color: #666;" title="${(block.downloaded_assets || []).join(', ')}">${assetsList}${moreAssets}</td>
        `
    });
}

/**
 * Display cache server download blocks table
 */
async function displayCacheServerBlocks() {
    const tablesDiv = document.getElementById('tables');
    const logId = getCurrentLogId();
    const title = 'Cache Server Download Blocks';
    
    if (!logId) {
        tablesDiv.innerHTML = templates.tableContainer({
            title,
            content: `<p class="table-error-cell">No log file loaded</p>`
        });
        return;
    }
    
    try {
        const db = await window.apiClient.getDatabase();
        const blocks = await db.db.cache_server_download_blocks.toCollection().sortBy('start_timestamp');
        
        if (blocks.length === 0) {
            tablesDiv.innerHTML = templates.tableContainer({
                title,
                content: `<p class="table-empty-cell">No cache server download blocks found in this log file.</p>`
            });
            return;
        }
        
        // Calculate total stats
        const totalBlocks = blocks.length;
        const totalAssetsRequested = blocks.reduce((sum, b) => sum + (b.num_assets_requested || 0), 0);
        const totalAssetsDownloaded = blocks.reduce((sum, b) => sum + (b.num_assets_downloaded || 0), 0);
        const totalDuration = blocks.reduce((sum, b) => sum + (b.duration_ms || 0), 0);
        const successRate = totalAssetsRequested > 0 ? ((totalAssetsDownloaded / totalAssetsRequested) * 100).toFixed(1) : 0;
        
        const tableContent = templates.scrollableTable({
            content: templates.table({
                headers: [
                    { text: 'Line #', width: '70px' },
                    { text: 'Start Time', width: '180px' },
                    { text: 'End Time', width: '180px' },
                    { text: 'Duration', width: '120px', align: 'right' },
                    { text: 'Requested', width: '100px', align: 'right' },
                    { text: 'Downloaded', width: '100px', align: 'right' },
                    { text: 'Success %', width: '100px', align: 'right' },
                    { text: 'Downloaded Assets', minWidth: '300px' }
                ],
                bodyId: 'cache-server-blocks-body',
                bodyContent: blocks.map(renderCacheBlockRow).join('')
            })
        });
        
        tablesDiv.innerHTML = templates.tableContainer({
            title,
            stats: [
                { label: 'Total Blocks', value: totalBlocks },
                { label: 'Total Duration', value: formatTime(totalDuration / 1000) },
                { label: 'Assets Requested', value: totalAssetsRequested },
                { label: 'Assets Downloaded', value: totalAssetsDownloaded },
                { label: 'Success Rate', value: `${successRate}%` }
            ],
            hint: '<strong>Click</strong> any row or line number to jump to that location in the log',
            content: tableContent
        });
    } catch (error) {
        console.error('[CacheServerBlocks] Error loading blocks:', error);
        tablesDiv.innerHTML = templates.tableContainer({
            title,
            content: `<p class="table-error-cell">Error loading cache server download blocks: ${error.message}</p>`
        });
    }
}

// Export for ES modules
export { displayCacheServerBlocks };

// Export to window for global access
window.displayCacheServerBlocks = displayCacheServerBlocks;

