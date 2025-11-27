/**
 * Operations Table Module
 * Displays detailed operations table
 */

import { formatTime } from '../../core/formatters.js';
import * as templates from '../../core/templates.js';

/**
 * Render operation row
 */
function renderOperationRow(op) {
    const durationSeconds = (op.duration_ms || 0) / 1000;
    
    let timeBadgeClass = 'badge';
    if (durationSeconds > 1) {
        timeBadgeClass = 'badge-warning';
    } else if (durationSeconds < 0.1) {
        timeBadgeClass = 'badge-success';
    }

    return templates.clickableRow({
        onClick: `openLogViewer(${op.line_number})`,
        cells: `
            ${templates.lineNumberCell(op.line_number || 'N/A')}
            <td><span class="badge">${op.operation_type || 'Unknown'}</span></td>
            <td><span class="text-truncate" style="font-size: 0.9em;">${op.name || op.description || 'N/A'}</span></td>
            <td style="text-align: right;"><span class="${timeBadgeClass}" style="font-weight: 600;">${formatTime(durationSeconds)}</span></td>
            <td style="text-align: right;"><span class="mono" style="font-size: 0.85em;">${op.start_time ? formatTime(op.start_time / 1000) : 'N/A'}</span></td>
            <td style="text-align: right;"><span class="mono" style="font-size: 0.85em;">${op.end_time ? formatTime(op.end_time / 1000) : 'N/A'}</span></td>
        `
    });
}

/**
 * Display operations table
 * @param {Array} operations - Array of operation objects
 * @param {string} title - Table title
 */
export function displayOperationsTable(operations, title) {
    const tablesDiv = document.getElementById('tables');

    if (!operations || operations.length === 0) {
        tablesDiv.innerHTML = templates.tableContainer({
            title,
            content: templates.tableEmptyRow(6, 'No operations found')
        });
        return;
    }

    const totalTime = operations.reduce((sum, op) => sum + (op.duration_ms || 0), 0);
    const avgTime = operations.length > 0 ? totalTime / operations.length : 0;

    // Get project load time for percentage calculation
    window.apiClient.getSummary().then(summary => {
        const projectLoadTimeMs = (summary.project_load_time_seconds || 0) * 1000;
        const percentDiv = document.getElementById('operations-percent-stat');
        if (percentDiv && projectLoadTimeMs > 0) {
            percentDiv.textContent = ((totalTime / projectLoadTimeMs) * 100).toFixed(1) + '%';
        }
    }).catch(() => {});

    const tableContent = templates.scrollableTable({
        content: templates.table({
            headers: [
                { text: 'Line #', width: '70px' },
                { text: 'Operation Type', width: '150px' },
                { text: 'Name', minWidth: '250px' },
                { text: 'Duration', width: '100px', align: 'right' },
                { text: 'Start', width: '100px', align: 'right' },
                { text: 'End', width: '100px', align: 'right' }
            ],
            bodyContent: operations.map(renderOperationRow).join('')
        })
    });

    tablesDiv.innerHTML = templates.tableContainer({
        title,
        stats: [
            { label: 'Operation Count', value: operations.length.toLocaleString() },
            { label: 'Total Time', value: formatTime(totalTime / 1000) },
            { label: 'Average Time', value: formatTime(avgTime / 1000) },
            { label: '% of Full Load', value: 'Calculating...', id: 'operations-percent-stat' }
        ],
        hint: '<strong>Click</strong> any row or line number to jump to that location in the log',
        content: tableContent
    });

    // Scroll to table
    setTimeout(() => {
        tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

