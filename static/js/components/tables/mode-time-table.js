/**
 * Mode Time Table Module
 * Displays mean/std dev statistics for asset types
 */

import { formatTime } from '../../core/formatters.js';
import * as templates from '../../core/templates.js';

/**
 * Render a type statistics row
 */
function renderTypeStatRow(type) {
    const cvClass = type.cv > 100 ? 'badge-warning' : 
                   type.cv < 20 ? 'badge-success' : 'badge';
    
    return templates.clickableRow({
        onClick: `loadStdDevView('${type.asset_type}')`,
        cells: `
            <td><strong style="color: #1a1a1a;">${type.asset_type}</strong></td>
            <td style="text-align: right;"><span class="badge">${type.count.toLocaleString()}</span></td>
            <td style="text-align: right;"><span class="mono">${formatTime(type.total_time / 1000)}</span></td>
            <td style="text-align: right;"><span class="mono">${formatTime(type.mean)}</span></td>
            <td style="text-align: right;"><span class="mono">${formatTime(type.stdDev)}</span></td>
            <td style="text-align: right;"><span class="${cvClass}">${type.cv.toFixed(1)}%</span></td>
            <td><span style="font-size: 0.9em; color: #666;">${type.interpretation}</span></td>
        `
    });
}

/**
 * Display mode time table with statistics
 * @param {Array} typeData - Array of type statistics
 */
export async function displayModeTimeTable(typeData) {
    const tablesDiv = document.getElementById('tables');
    const title = '📊 Asset Type Statistics';

    if (!typeData || typeData.length === 0) {
        tablesDiv.innerHTML = templates.tableContainer({
            title,
            content: `<p class="table-empty-cell">No asset type data available</p>`
        });
        return;
    }

    // Calculate statistics for each type
    const typeStats = await Promise.all(typeData.map(async (type) => {
        try {
            const assets = await window.apiClient.getAssetsByType(type.asset_type);
            
            if (!assets || assets.length === 0) {
                return {
                    ...type,
                    mean: 0,
                    stdDev: 0,
                    cv: 0,
                    interpretation: 'No data'
                };
            }

            const times = assets.map(a => a.import_time_ms / 1000);
            const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
            const variance = times.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / times.length;
            const stdDev = Math.sqrt(variance);
            const cv = mean > 0 ? (stdDev / mean) * 100 : 0;

            let interpretation = 'Normal';
            if (cv > 100) {
                interpretation = 'High variance';
            } else if (cv > 50) {
                interpretation = 'Moderate variance';
            } else if (cv < 20) {
                interpretation = 'Consistent';
            }

            return {
                ...type,
                mean,
                stdDev,
                cv,
                interpretation
            };
        } catch (error) {
            console.error(`Failed to get stats for ${type.asset_type}:`, error);
            return {
                ...type,
                mean: 0,
                stdDev: 0,
                cv: 0,
                interpretation: 'Error'
            };
        }
    }));

    const tableContent = templates.scrollableTable({
        content: templates.table({
            headers: [
                { text: 'Asset Type', minWidth: '150px' },
                { text: 'Count', width: '100px', align: 'right' },
                { text: 'Total Time', width: '120px', align: 'right' },
                { text: 'Mean', width: '100px', align: 'right' },
                { text: 'Std Dev', width: '100px', align: 'right' },
                { text: 'CV %', width: '80px', align: 'right' },
                { text: 'Interpretation', width: '130px' }
            ],
            bodyContent: typeStats.map(renderTypeStatRow).join('')
        })
    });

    tablesDiv.innerHTML = templates.tableContainer({
        title,
        hint: '<strong>Click</strong> any row to view the distribution histogram for that asset type',
        content: tableContent
    });

    // Scroll to table
    setTimeout(() => {
        tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

