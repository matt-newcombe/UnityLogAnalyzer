/**
 * Pipeline Module
 * Handles pipeline breakdown display
 */

        function displayPipelineTable(refreshes, category) {
            const tablesDiv = document.getElementById('tables');
            
            // Map category to field name
            const categoryFieldMap = {
                'Asset DB Processing': 'asset_db_process_time_ms',
                'Asset DB Callbacks': 'asset_db_callback_time_ms',
                'Domain Reloads': 'domain_reload_time_ms',
                'Script Compilation': 'compile_time_ms',
                'Other Scripting': 'scripting_other_ms'
            };
            
            const fieldName = categoryFieldMap[category];
            
            tablesDiv.innerHTML = `
                <div class="table-container">
                    <h2>Pipeline Refresh: ${category}</h2>
                    <p style="margin-bottom: 20px; color: #666;">
                        💡 <strong>Hover</strong> over rows for details • <strong>Click</strong> any row or line number to jump to that location in the log
                    </p>
                    <div style="max-height: 600px; overflow-y: auto; overflow-x: hidden;">
                        <table>
                            <thead style="position: sticky; top: 0; background: white; z-index: 10;">
                                <tr>
                                    <th style="width: 80px;">Line #</th>
                                    <th style="width: 120px;">Refresh ID</th>
                                    <th style="width: 130px;">${category} Time</th>
                                    <th style="width: 110px;">% of Total</th>
                                    <th style="width: 110px;">Total Time</th>
                                    <th style="min-width: 150px;">Initiated By</th>
                                    <th style="width: 100px;">Imports</th>
                                    <th style="min-width: 200px;">Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${refreshes.map(refresh => {
                                    const timeValue = refresh[fieldName];
                                    const timeFormatted = timeValue ? formatTime(timeValue / 1000) : 'N/A';
                                    const totalTime = formatTime(refresh.total_time_seconds);
                                    const totalTimeMs = refresh.total_time_seconds * 1000;
                                    const percentage = timeValue && totalTimeMs > 0 
                                        ? ((timeValue / totalTimeMs) * 100).toFixed(1) 
                                        : '0.0';
                                    
                                    const refreshIdShort = refresh.refresh_id ? refresh.refresh_id.substring(0, 8) + '...' : 'N/A';
                                    
                                    return `
                                        <tr onclick="openLogViewer(${refresh.line_number})">
                                            <td>
                                                <a href="javascript:void(0)" 
                                                   style="color: #667eea; font-weight: 600; text-decoration: none;"
                                                   onclick="event.stopPropagation(); openLogViewer(${refresh.line_number});"
                                                   title="Jump to line ${refresh.line_number} in log">
                                                    ${refresh.line_number}
                                                </a>
                                            </td>
                                            <td>
                                                <span class="mono" title="${refresh.refresh_id || 'N/A'}">${refreshIdShort}</span>
                                            </td>
                                            <td>
                                                <strong style="color: #1a1a1a; font-size: 1.05em;">${timeFormatted}</strong>
                                            </td>
                                            <td>
                                                <span class="badge ${parseFloat(percentage) > 50 ? 'badge-warning' : ''}" 
                                                      style="font-weight: 600;">
                                                    ${percentage}%
                                                </span>
                                            </td>
                                            <td>
                                                <span style="color: #666; font-weight: 500;">${totalTime}</span>
                                            </td>
                                            <td>
                                                <span style="font-size: 0.9em; color: #555;">${refresh.initiated_by || 'N/A'}</span>
                                            </td>
                                            <td>
                                                <span class="badge">
                                                    ${refresh.imports_actual || 0} / ${refresh.imports_total || 0}
                                                </span>
                                            </td>
                                            <td style="font-size: 0.85em; color: #666;">
                                                ${refresh.domain_reloads ? `<span class="badge badge-warning">${refresh.domain_reloads} reloads</span>` : ''}
                                                ${refresh.compile_time_ms ? `<span class="badge" style="margin-left: 5px;">Compile: ${formatTime(refresh.compile_time_ms / 1000)}</span>` : ''}
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div style="margin-top: 20px; padding: 15px; background: #e3f2fd; border-radius: 8px; border-left: 4px solid #667eea;">
                        <strong style="color: #667eea;">ℹ️ Understanding Pipeline Refresh Breakdown:</strong>
                        <ul style="margin-top: 10px; padding-left: 20px; color: #555;">
                            <li><strong>Asset DB Processing:</strong> Time spent processing asset database</li>
                            <li><strong>Asset DB Callbacks:</strong> Time in callback functions during import</li>
                            <li><strong>Script Compilation:</strong> Time compiling C# scripts (usually the largest)</li>
                            <li><strong>Domain Reloads:</strong> Time reloading the scripting domain</li>
                            <li><strong>Other Scripting:</strong> Other script-related operations</li>
                        </ul>
                        <p style="margin-top: 10px; color: #666; font-size: 0.95em;">
                            <strong>Note:</strong> These times run mostly in parallel with asset imports. 
                            Total pipeline time ≠ sum of all parts.
                        </p>
                    </div>
                </div>
            `;
            
            // Auto-scroll to tables after a brief delay
            setTimeout(() => {
                tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }

