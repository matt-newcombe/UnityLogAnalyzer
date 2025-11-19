/**
 * Operations Table Module
 * Handles operations table rendering and interaction
 */

/**
 * Display operations table
 * @param {Array} operations - Array of operation objects
 * @param {string} title - Table title
 */
async function displayOperationsTable(operations, title) {
    const tablesDiv = document.getElementById('tables');
    if (!tablesDiv) {
        console.error('Tables div not found');
        return;
    }
    
    if (!operations || operations.length === 0) {
        tablesDiv.innerHTML = `
            <div class="table-container">
                <h2>${title}</h2>
                <p style="color: #666; text-align: center; padding: 40px;">No operations found</p>
            </div>
        `;
        return;
    }
    
    // Calculate statistics
    const totalTime = operations.reduce((sum, op) => sum + (op.duration_ms || 0), 0);
    const avgTime = totalTime / operations.length;
    const totalTimeSeconds = totalTime / 1000;
    
    // Get timeline data to calculate percentage of total time
    let percentageOfLoad = 'N/A';
    try {
        const timeline = await window.apiClient.getTimeline();
        if (timeline && timeline.total_time_ms && timeline.total_time_ms > 0) {
            percentageOfLoad = ((totalTime / timeline.total_time_ms) * 100).toFixed(1);
        }
    } catch (error) {
        console.warn('Could not get timeline for percentage calculation:', error);
    }
    
    tablesDiv.innerHTML = `
        <div class="table-container">
            <h2>${title}</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Operation Count</div>
                    <div class="stat-value">${operations.length}</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Total Time</div>
                    <div class="stat-value">${formatTime(totalTimeSeconds)}</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Average Time</div>
                    <div class="stat-value">${formatTime(avgTime / 1000)}</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">% of Total Time</div>
                    <div class="stat-value">${percentageOfLoad}${percentageOfLoad !== 'N/A' ? '%' : ''}</div>
                </div>
            </div>
            <p style="margin-bottom: 15px; color: #666;">
                💡 <strong>Click</strong> any row or line number to jump to that location in the log
            </p>
            <div style="max-height: 600px; overflow-y: auto; overflow-x: hidden;" id="operations-table-scroll">
                <table>
                    <thead style="position: sticky; top: 0; background: white; z-index: 10;">
                        <tr>
                            <th style="width: 70px;">Line #</th>
                            <th style="min-width: 200px;">Operation Type</th>
                            <th style="min-width: 300px;">Operation Name</th>
                            <th style="width: 120px; text-align: right;">Duration</th>
                            <th style="width: 100px;">Start Time</th>
                            <th style="width: 100px;">End Time</th>
                        </tr>
                    </thead>
                    <tbody id="operations-table-body">
                    </tbody>
                </table>
            </div>
            <div id="operations-info" style="text-align: center; padding: 10px; color: #999; font-size: 0.9em;">
                Showing ${operations.length} operations
            </div>
        </div>
    `;
    
    // Render operations rows
    const tbody = document.getElementById('operations-table-body');
    if (tbody) {
        tbody.innerHTML = operations.map(op => {
            const timeSeconds = (op.duration_ms || 0) / 1000;
            const timeFormatted = formatTime(timeSeconds);
            
            // Format timestamps
            let startTime = 'N/A';
            let endTime = 'N/A';
            if (op.start_timestamp) {
                const startDate = new Date(op.start_timestamp);
                startTime = startDate.toLocaleTimeString();
            }
            if (op.end_timestamp) {
                const endDate = new Date(op.end_timestamp);
                endTime = endDate.toLocaleTimeString();
            }
            
            const operationType = op.operation_type || 'Unknown';
            const operationName = (op.operation_name || 'N/A').replace(/"/g, '&quot;');
            
            return `
                <tr data-line="${op.line_number}" 
                    onclick="openLogViewer(${op.line_number})"
                    style="cursor: pointer; border-bottom: 1px solid #eee;">
                    <td style="font-size: 0.85em; padding: 10px;">
                        <a href="javascript:void(0)" 
                           style="color: #667eea; font-weight: 600; text-decoration: none;"
                           onclick="event.stopPropagation(); openLogViewer(${op.line_number});"
                           title="Jump to line ${op.line_number} in log">
                            ${op.line_number}
                        </a>
                    </td>
                    <td style="padding: 10px;">
                        <span class="badge" style="background: #9966FF; color: white;">${operationType}</span>
                    </td>
                    <td style="padding: 10px;">
                        <strong style="color: #1a1a1a; font-size: 0.9em; word-break: break-word;">${operationName}</strong>
                    </td>
                    <td style="text-align: right; padding: 10px;">
                        <span style="font-weight: 600; color: #f57c00;">${timeFormatted}</span>
                    </td>
                    <td style="font-size: 0.85em; color: #666; padding: 10px;">
                        ${startTime}
                    </td>
                    <td style="font-size: 0.85em; color: #666; padding: 10px;">
                        ${endTime}
                    </td>
                </tr>
            `;
        }).join('');
    }
    
    // Auto-scroll to tables after a brief delay to ensure rendering
    setTimeout(() => {
        tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

