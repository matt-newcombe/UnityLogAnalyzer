/**
 * Folder Analysis Table Module
 * Displays heaviest folders by import time
 */

import { formatTime } from '../../core/formatters.js';
import { showContextMenu, setupTableContextMenus } from './context-menu.js';
import * as templates from '../../core/templates.js';

/**
 * Render a folder row
 */
function renderFolderRow(folder, index) {
    const avgTime = folder.asset_count > 0 ? folder.total_time_ms / folder.asset_count : 0;
    const timeSeconds = folder.total_time_ms / 1000;
    
    let timeBadgeClass = 'badge';
    if (timeSeconds > 10) {
        timeBadgeClass = 'badge-warning';
    } else if (timeSeconds < 1) {
        timeBadgeClass = 'badge-success';
    }

    // Truncate folder path for display
    const displayPath = folder.folder.length > 60 
        ? '...' + folder.folder.slice(-57) 
        : folder.folder;

    // Truncate heaviest asset name
    const heaviestAsset = folder.heaviest_asset || 'N/A';
    const displayHeaviest = heaviestAsset.length > 25 
        ? heaviestAsset.slice(0, 22) + '...' 
        : heaviestAsset;

    const escapedPath = folder.folder.replace(/"/g, '&quot;');

    return `
        <tr data-folder="${escapedPath}" data-path="${escapedPath}" class="clickable-row">
            ${templates.rankCell(index + 1)}
            <td>
                <a href="javascript:void(0)" 
                   onclick="loadFolderAssets('${escapedPath}')"
                   style="color: #1a1a1a; text-decoration: none; font-weight: 500;"
                   title="${folder.folder}">
                    ${displayPath}
                </a>
            </td>
            <td style="text-align: right;"><span class="badge">${folder.asset_count}</span></td>
            <td style="text-align: right;"><span class="${timeBadgeClass}" style="font-weight: 600;">${formatTime(timeSeconds)}</span></td>
            <td style="text-align: right;"><span class="mono" style="font-size: 0.9em;">${formatTime(avgTime / 1000)}</span></td>
            <td><span class="text-truncate" style="font-size: 0.9em; color: #666;" title="${heaviestAsset}">${displayHeaviest}</span></td>
        </tr>
    `;
}

/**
 * Display folder analysis table
 * @param {Array} folders - Array of folder objects
 * @param {string} title - Table title
 */
export function displayFolderAnalysisTable(folders, title) {
    const tablesDiv = document.getElementById('tables');

    const totalTime = folders.reduce((sum, f) => sum + f.total_time_ms, 0);
    const totalAssets = folders.reduce((sum, f) => sum + f.asset_count, 0);
    const avgTimePerFolder = folders.length > 0 ? totalTime / folders.length : 0;

    const tableContent = templates.scrollableTable({
        id: 'folder-table-scroll',
        content: templates.table({
            headers: [
                { text: '#', width: '50px' },
                { text: 'Folder Path', minWidth: '350px' },
                { text: 'Assets', width: '100px', align: 'right' },
                { text: 'Total Time', width: '120px', align: 'right' },
                { text: 'Avg Time', width: '120px', align: 'right' },
                { text: 'Heaviest Asset', width: '200px' }
            ],
            bodyId: 'folder-table-body',
            bodyContent: folders.map((folder, index) => renderFolderRow(folder, index)).join('')
        })
    });

    tablesDiv.innerHTML = templates.tableContainer({
        title,
        stats: [
            { label: 'Total Folders', value: folders.length.toLocaleString() },
            { label: 'Total Assets', value: totalAssets.toLocaleString() },
            { label: 'Total Time', value: formatTime(totalTime / 1000) },
            { label: 'Avg Time/Folder', value: formatTime(avgTimePerFolder / 1000) }
        ],
        hint: '<strong>Click</strong> folder name to see assets | <strong>Right-click</strong> to copy path',
        content: tableContent
    });

    // Setup context menus
    setupFolderTableContextMenus();

    // Scroll to table
    setTimeout(() => {
        tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

/**
 * Setup context menus for folder table rows
 */
function setupFolderTableContextMenus() {
    const tbody = document.getElementById('folder-table-body');
    if (!tbody) return;
    setupTableContextMenus(tbody, 'data-folder');
}

