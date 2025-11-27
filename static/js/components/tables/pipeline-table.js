/**
 * Pipeline Table Module
 * Displays pipeline refresh details
 */

import { formatTime } from '../../core/formatters.js';
import * as templates from '../../core/templates.js';

/**
 * Render a pipeline refresh row
 */
function renderRefreshRow(refresh, category) {
    const percentage = refresh.total_time > 0 
        ? ((refresh.category_time / refresh.total_time) * 100).toFixed(1) 
        : '0.0';
    const timeSeconds = refresh.category_time / 1000;
    
    let timeBadgeClass = 'badge';
    if (timeSeconds > 5) {
        timeBadgeClass = 'badge-warning';
    } else if (timeSeconds < 0.5) {
        timeBadgeClass = 'badge-success';
    }

    return templates.clickableRow({
        onClick: `openLogViewer(${refresh.line_number})`,
        cells: `
            <td><span class="mono" style="font-weight: 600; color: #667eea;">#${refresh.refresh_id}</span></td>
            ${templates.lineNumberCell(refresh.line_number)}
            <td style="text-align: right;"><span class="${timeBadgeClass}" style="font-weight: 600;">${formatTime(timeSeconds)}</span></td>
            <td style="text-align: right;"><span class="mono">${percentage}%</span></td>
            <td><span class="text-truncate" style="font-size: 0.9em; color: #666;">${refresh.initiated_by || 'Unknown'}</span></td>
        `
    });
}

/**
 * Display pipeline table
 * @param {Array} refreshes - Array of pipeline refresh objects
 * @param {string} category - Category name for filtering
 */
export function displayPipelineTable(refreshes, category) {
    const tablesDiv = document.getElementById('tables');
    const title = `Pipeline Refreshes: ${category}`;

    if (!refreshes || refreshes.length === 0) {
        tablesDiv.innerHTML = templates.tableContainer({
            title,
            content: `<p class="table-empty-cell">No pipeline refresh data available</p>`
        });
        return;
    }

    const totalTime = refreshes.reduce((sum, r) => sum + (r.category_time || 0), 0);
    const avgTime = refreshes.length > 0 ? totalTime / refreshes.length : 0;

    const tableContent = templates.scrollableTable({
        content: templates.table({
            headers: [
                { text: 'Refresh ID', width: '100px' },
                { text: 'Line #', width: '70px' },
                { text: `${category} Time`, width: '120px', align: 'right' },
                { text: '% of Total', width: '100px', align: 'right' },
                { text: 'Initiated By', minWidth: '200px' }
            ],
            bodyContent: refreshes.map(r => renderRefreshRow(r, category)).join('')
        })
    });

    const footerContent = `
        <h4>Understanding Pipeline Breakdown</h4>
        <p>Each pipeline refresh consists of multiple phases. The time shown above represents 
        how much of each refresh was spent in the <strong>${category}</strong> phase.</p>
    `;

    tablesDiv.innerHTML = templates.tableContainer({
        title,
        stats: [
            { label: 'Total Refreshes', value: refreshes.length.toLocaleString() },
            { label: `Total Time (${category})`, value: formatTime(totalTime / 1000) },
            { label: 'Average Time', value: formatTime(avgTime / 1000) }
        ],
        hint: '<strong>Click</strong> refresh ID to view in log',
        content: tableContent,
        footer: footerContent
    });

    // Scroll to table
    setTimeout(() => {
        tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

