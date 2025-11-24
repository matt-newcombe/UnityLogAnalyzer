/**
 * Cache Server Download Blocks Module
 * Handles display of cache server download blocks
 */

/**
 * Display cache server download blocks table
 */
async function displayCacheServerBlocks() {
    const tablesDiv = document.getElementById('tables');
    const logId = getCurrentLogId();
    
    if (!logId) {
        tablesDiv.innerHTML = '<p style="color: #ff4444;">No log file loaded</p>';
        return;
    }
    
    try {
        const db = await window.apiClient.getDatabase();
        const blocks = await db.db.cache_server_download_blocks.toCollection().sortBy('start_timestamp');
        
        if (blocks.length === 0) {
            tablesDiv.innerHTML = `
                <div class="table-container">
                    <h2>Cache Server Download Blocks</h2>
                    <p style="color: #666; padding: 20px;">No cache server download blocks found in this log file.</p>
                </div>
            `;
            return;
        }
        
        // Calculate total stats
        const totalBlocks = blocks.length;
        const totalAssetsRequested = blocks.reduce((sum, b) => sum + (b.num_assets_requested || 0), 0);
        const totalAssetsDownloaded = blocks.reduce((sum, b) => sum + (b.num_assets_downloaded || 0), 0);
        const totalDuration = blocks.reduce((sum, b) => sum + (b.duration_ms || 0), 0);
        
        tablesDiv.innerHTML = `
            <div class="table-container">
                <h2>Cache Server Download Blocks</h2>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                    <div class="stat-card" style="margin: 0;">
                        <div class="stat-label">Total Blocks</div>
                        <div class="stat-value">${totalBlocks}</div>
                    </div>
                    <div class="stat-card" style="margin: 0;">
                        <div class="stat-label">Total Duration</div>
                        <div class="stat-value">${formatTime(totalDuration / 1000)}</div>
                    </div>
                    <div class="stat-card" style="margin: 0;">
                        <div class="stat-label">Assets Requested</div>
                        <div class="stat-value">${totalAssetsRequested}</div>
                    </div>
                    <div class="stat-card" style="margin: 0;">
                        <div class="stat-label">Assets Downloaded</div>
                        <div class="stat-value">${totalAssetsDownloaded}</div>
                    </div>
                    <div class="stat-card" style="margin: 0;">
                        <div class="stat-label">Success Rate</div>
                        <div class="stat-value">${totalAssetsRequested > 0 ? ((totalAssetsDownloaded / totalAssetsRequested) * 100).toFixed(1) : 0}%</div>
                    </div>
                </div>
                <p style="margin-bottom: 15px; color: #666;">
                    💡 <strong>Click</strong> any row or line number to jump to that location in the log
                </p>
                <div style="max-height: 600px; overflow-y: auto; overflow-x: hidden;">
                    <table>
                        <thead style="position: sticky; top: 0; background: white; z-index: 10;">
                            <tr>
                                <th style="width: 70px;">Line #</th>
                                <th style="width: 180px;">Start Time</th>
                                <th style="width: 180px;">End Time</th>
                                <th style="width: 120px; text-align: right;">Duration</th>
                                <th style="width: 100px; text-align: right;">Requested</th>
                                <th style="width: 100px; text-align: right;">Downloaded</th>
                                <th style="width: 100px; text-align: right;">Success %</th>
                                <th style="min-width: 300px;">Downloaded Assets</th>
                            </tr>
                        </thead>
                        <tbody id="cache-server-blocks-body">
                            ${blocks.map(block => {
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
                                
                                return `
                                    <tr style="cursor: grab;" onclick="navigateToLogLine(${block.line_number})" 
                                        onmouseover="this.style.backgroundColor='#f5f5f5'" 
                                        onmouseout="this.style.backgroundColor=''">
                                        <td style="color: #667eea; font-weight: 600;">${block.line_number}</td>
                                        <td>${startTime}</td>
                                        <td>${endTime}</td>
                                        <td style="text-align: right;">${duration}</td>
                                        <td style="text-align: right;">${block.num_assets_requested || 0}</td>
                                        <td style="text-align: right;">${block.num_assets_downloaded || 0}</td>
                                        <td style="text-align: right;">${successRate}%</td>
                                        <td style="font-size: 0.9em; color: #666;" title="${(block.downloaded_assets || []).join(', ')}">
                                            ${assetsList}${moreAssets}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('[CacheServerBlocks] Error loading blocks:', error);
        tablesDiv.innerHTML = `
            <div class="table-container">
                <h2>Cache Server Download Blocks</h2>
                <p style="color: #ff4444; padding: 20px;">Error loading cache server download blocks: ${error.message}</p>
            </div>
        `;
    }
}

// Make function globally available
window.displayCacheServerBlocks = displayCacheServerBlocks;

