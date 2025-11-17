/**
 * Folder Analysis Module
 * Handles folder-based asset analysis
 */

        function displayFolderAnalysisTable(folders) {
            const tablesDiv = document.getElementById('tables');
            
            // Calculate summary stats
            const totalAssets = folders.reduce((sum, f) => sum + (f.asset_count || 0), 0);
            const totalTime = folders.reduce((sum, f) => sum + (f.total_time_ms || 0), 0);
            
            // Get project load time for percentage
            let projectLoadTimeSeconds = 0;
            window.apiClient.getSummary()
                .then(summary => {
                    projectLoadTimeSeconds = summary.project_load_time_seconds || 0;
                    const percentageOfLoad = projectLoadTimeSeconds > 0 
                        ? ((totalTime / 1000 / projectLoadTimeSeconds) * 100).toFixed(1)
                        : 'N/A';
                    
                    tablesDiv.innerHTML = `
                        <div class="table-container">
                            <h2>📁 Folder Analysis - Heaviest Folders by Import Time</h2>
                            <p style="margin-bottom: 15px; color: #666;">
                                💡 Shows folders 3-4 levels deep, sorted by total import time. <strong>Click</strong> a folder to see all assets in that folder. <strong>Right-click</strong> to copy folder path.
                            </p>
                            <div style="max-height: 600px; overflow-y: auto; overflow-x: hidden;" id="folder-table-scroll">
                                <table>
                                    <thead style="position: sticky; top: 0; background: white; z-index: 10;">
                                        <tr>
                                            <th style="width: 40%;">Folder</th>
                                            <th style="width: 70px; text-align: center;">Count</th>
                                            <th style="width: 90px; text-align: right;">Total Time</th>
                                            <th style="width: 80px; text-align: right;">Avg Time</th>
                                            <th>Top Assets</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                ${folders.map((folder, idx) => {
                                    // Handle null folder path
                                    const folderPath = folder.folder || '';
                                    
                                    // Truncate folder path intelligently - show more parts with 300px width
                                    let folderDisplay = folderPath;
                                    const parts = folderDisplay.split('/');
                                    if (parts.length > 4) {
                                        folderDisplay = '.../' + parts.slice(-4).join('/');
                                    } else if (folderDisplay.length > 50) {
                                        folderDisplay = folderDisplay.substring(0, 47) + '...';
                                    }
                                    
                                    const escapedFolderPath = folderPath.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                                    
                                    // Truncate asset names - allow more space now
                                    const truncateAssetName = (name, maxLength = 50) => {
                                        if (name.length <= maxLength) return name;
                                        return name.substring(0, maxLength - 3) + '...';
                                    };
                                    
                                    return `
                                    <tr onclick="loadFolderAssets('${escapedFolderPath}')" 
                                        title="${folderPath} - Click to view all assets"
                                        data-folder-path="${escapedFolderPath}">
                                        <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                            <span class="mono" style="font-size: 0.9em;">${folderDisplay}</span>
                                        </td>
                                        <td style="text-align: center;">
                                            <span class="badge">${folder.asset_count.toLocaleString()}</span>
                                        </td>
                                        <td style="text-align: right;">
                                            <strong>${formatTime(folder.total_time_ms / 1000)}</strong>
                                        </td>
                                        <td style="text-align: right; color: #666;">${formatTime(folder.avg_time_ms / 1000)}</td>
                                        <td style="font-size: 0.85em;">
                                            ${folder.assets.slice(0, 5).map(asset => {
                                                const assetName = asset.path.split('/').pop();
                                                const truncatedName = truncateAssetName(assetName, 50);
                                                return `
                                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 0;">
                                                    <span style="color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px;" title="${assetName}">${truncatedName}</span>
                                                    <span style="color: #667eea; font-weight: 500; flex-shrink: 0;">${formatTime(asset.time_ms / 1000)}</span>
                                                </div>
                                            `;
                                            }).join('')}
                                            ${folder.assets.length > 5 ? `<div style="color: #999; font-size: 0.8em; padding-top: 4px; font-style: italic;">+${folder.assets.length - 5} more</div>` : ''}
                                        </td>
                                    </tr>
                                `;
                                }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `;
                    
                    // Setup context menu for folder paths
                    setupFolderTableContextMenus();
                })
                .catch(err => {
                    console.error('Failed to get project load time:', err);
                    // Fallback without percentage
                    tablesDiv.innerHTML = `
                        <div class="table-container">
                            <h2>📁 Folder Analysis - Heaviest Folders by Import Time</h2>
                            <p style="margin-bottom: 15px; color: #666;">
                                💡 Shows folders 3-4 levels deep, sorted by total import time. <strong>Click</strong> a folder to see all assets in that folder. <strong>Right-click</strong> to copy folder path.
                            </p>
                            <div style="max-height: 600px; overflow-y: auto; overflow-x: hidden;" id="folder-table-scroll">
                                <table>
                                    <thead style="position: sticky; top: 0; background: white; z-index: 10;">
                                        <tr>
                                            <th style="width: 40%;">Folder</th>
                                            <th style="width: 70px; text-align: center;">Count</th>
                                            <th style="width: 90px; text-align: right;">Total Time</th>
                                            <th style="width: 80px; text-align: right;">Avg Time</th>
                                            <th>Top Assets</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${folders.map((folder, idx) => {
                                            const folderPath = folder.folder || '';
                                            const parts = folderPath.split('/');
                                            let folderDisplay = parts.length > 3 
                                                ? '.../' + parts.slice(-3).join('/')
                                                : folderPath.length > 30 
                                                    ? folderPath.substring(0, 27) + '...'
                                                    : folderPath;
                                            const escapedFolderPath = folderPath.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                                            const truncateAssetName = (name, maxLength = 22) => {
                                                if (name.length <= maxLength) return name;
                                                return name.substring(0, maxLength - 3) + '...';
                                            };
                                            return `
                                            <tr onclick="loadFolderAssets('${escapedFolderPath}')" 
                                                title="${folderPath} - Click to view all assets"
                                                data-folder-path="${escapedFolderPath}">
                                                <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                    <span class="mono" style="font-size: 0.9em;">${folderDisplay}</span>
                                                </td>
                                                <td style="text-align: center;">
                                                    <span class="badge">${folder.asset_count.toLocaleString()}</span>
                                                </td>
                                                <td style="text-align: right;">
                                                    <strong>${formatTime(folder.total_time_ms / 1000)}</strong>
                                                </td>
                                                <td style="text-align: right; color: #666;">${formatTime(folder.avg_time_ms / 1000)}</td>
                                                <td style="font-size: 0.85em;">
                                                    ${folder.assets.slice(0, 5).map(asset => {
                                                        const assetName = asset.path.split('/').pop();
                                                        const truncatedName = truncateAssetName(assetName, 22);
                                                        return `
                                                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 0;">
                                                            <span style="color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px;" title="${assetName}">${truncatedName}</span>
                                                            <span style="color: #667eea; font-weight: 500; flex-shrink: 0;">${formatTime(asset.time_ms / 1000)}</span>
                                                        </div>
                                                    `;
                                                    }).join('')}
                                                    ${folder.assets.length > 5 ? `<div style="color: #999; font-size: 0.8em; padding-top: 4px; font-style: italic;">+${folder.assets.length - 5} more</div>` : ''}
                                                </td>
                                            </tr>
                                        `;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `;
                    
                    // Setup context menu for folder paths
                    setupFolderTableContextMenus();
                });
        }


        function setupFolderTableContextMenus() {
            const tbody = document.querySelector('#folder-table-scroll tbody');
            if (!tbody) {
                console.log('Folder table tbody not found');
                return;
            }
            
            const rows = tbody.querySelectorAll('tr');
            console.log('Found', rows.length, 'rows in folder table');
            
            rows.forEach((row, index) => {
                const path = row.getAttribute('data-folder-path');
                if (!path) {
                    console.log('Row', index, 'has no data-folder-path attribute');
                    return;
                }
                
                // Decode the path from HTML entity
                const decodedPath = path.replace(/&quot;/g, '"');
                
                row.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Right-click on folder row, path:', decodedPath);
                    showContextMenu(e, decodedPath);
                });
            });
        }

