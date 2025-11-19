/**
 * Overview Module
 * Handles main overview page loading and display
 */

// showChart (lines 77-95)
        function showChart(canvasId) {
            try {
                const canvas = document.getElementById(canvasId);
                if (!canvas) {
                    console.warn(`Canvas element not found: ${canvasId}`);
                    return;
                }
                const container = canvas.parentElement;
                if (!container) {
                    console.warn(`Container not found for canvas: ${canvasId}`);
                    return;
                }
                const spinner = container.querySelector('.element-spinner');
                if (spinner) spinner.style.display = 'none';
                if (canvas) canvas.style.display = 'block';
            } catch (error) {
                console.error(`Error showing chart ${canvasId}:`, error);
            }
        }


// showEmptyState (lines 125-144)
        function showEmptyState() {
            const statsDiv = document.getElementById('stats');
            const chartsDiv = document.getElementById('charts');
            statsDiv.style.display = 'none';
            chartsDiv.style.display = 'none';
            
            // Hide Slack copy button when no log is loaded
            const slackButtonContainer = document.getElementById('slack-button-container');
            if (slackButtonContainer) {
                slackButtonContainer.style.display = 'none';
            }
            
            chartsDiv.innerHTML = `
                <div class="chart-card" style="grid-column: 1 / -1; text-align: center; padding: 60px;">
                    <h2 style="color: #666; margin-bottom: 20px;">No Log File Parsed</h2>
                    <p style="color: #999; margin-bottom: 30px; font-size: 1.1em;">Click "Parse Log File" in the header to upload and analyze a Unity Editor.log file</p>
                    <a href="/log-parser" class="nav-button" style="background: #4CAF50; border: none; cursor: pointer; height: 44px; padding: 0 16px; display: inline-flex; align-items: center; text-decoration: none;">📁 Parse Log File</a>
                </div>
            `;
        }


// loadOverview (lines 338-368)
        async function loadOverview() {
            setCurrentView('overview');
            
            try {
                // Get log metadata to show project name
                const logs = await window.apiClient.getLogs();
                const currentLog = logs.find(log => log.id === getCurrentLogId());
                if (currentLog) {
                    updateProjectName(currentLog.project_name);
                }
                
                const data = await window.apiClient.getSummary();
                
                hideLoading();
                
                // Show Slack copy button when log is loaded
                const slackButtonContainer = document.getElementById('slack-button-container');
                if (slackButtonContainer) {
                    slackButtonContainer.style.display = 'block';
                }
                
                displayStats(data);
                displayCharts(data);
            } catch (error) {
                hideLoading();
                showError('Failed to load summary: ' + error.message);
            }
        }


// displayStats (lines 370-443)
        function displayStats(data) {
            const statsDiv = document.getElementById('stats');
            statsDiv.style.display = 'grid';
            
            const assetImports = data.asset_imports;
            const projectLoadTime = data.project_load_time_seconds || 0;
            
            const unityVersion = data.unity_version || 'Unknown';
            
            // Update Unity version in header
            updateUnityVersion(unityVersion);
            
            // Show skeleton loaders immediately
            statsDiv.innerHTML = `
                <div class="stat-card">
                    <div class="stat-label">Total Project Load Time</div>
                    <div class="stat-value">
                        ${formatTime(projectLoadTime)}
                    </div>
                </div>
                <div class="stat-card clickable" onclick="loadAllAssets()" style="cursor: pointer;" title="Click to view all assets">
                    <div class="stat-label">Total Assets</div>
                    <div class="stat-value">${assetImports.count || 0}</div>
                </div>
                <div class="stat-card" title="Note this can be longer than project load time due to parallelised import worker threads">
                    <div class="stat-label">Raw Asset Import Time</div>
                    <div class="stat-value">
                        ${formatTime((assetImports.total_time || 0) / 1000)}
                    </div>
                </div>
                <div class="stat-card clickable" id="errors-stat-card" style="cursor: pointer;" title="Click to view all errors">
                    <div class="stat-label">Total Errors</div>
                    <div class="stat-value element-spinner" style="color: #667eea;">
                        <span class="loading-spinner"></span>
                        <span>Loading...</span>
                    </div>
                </div>
                <div class="stat-card clickable" id="warnings-stat-card" style="cursor: pointer;" title="Click to view all warnings">
                    <div class="stat-label">Total Warnings</div>
                    <div class="stat-value element-spinner" style="color: #667eea;">
                        <span class="loading-spinner"></span>
                        <span>Loading...</span>
                    </div>
                </div>
            `;
            
            // Fetch error/warning counts and update
            window.apiClient.getErrorWarningCounts()
                .then(counts => {
                    const errorsCard = document.getElementById('errors-stat-card');
                    const warningsCard = document.getElementById('warnings-stat-card');
                    
                    if (errorsCard) {
                        errorsCard.innerHTML = `
                            <div class="stat-label">Total Errors</div>
                            <div class="stat-value" style="color: ${counts.errors > 0 ? '#ff4444' : '#4CAF50'};">
                                ${counts.errors || 0}
                            </div>
                        `;
                        errorsCard.onclick = () => openLogViewerWithFilter('error');
                    }
                    
                    if (warningsCard) {
                        warningsCard.innerHTML = `
                            <div class="stat-label">Total Warnings</div>
                            <div class="stat-value" style="color: ${counts.warnings > 0 ? '#ff9f40' : '#4CAF50'};">
                                ${counts.warnings || 0}
                            </div>
                        `;
                        warningsCard.onclick = () => openLogViewerWithFilter('warning');
                    }
                });
        }


// displayCharts (lines 445-727)
        function displayCharts(data) {
            const chartsDiv = document.getElementById('charts');
            chartsDiv.style.display = 'grid';
            
            chartsDiv.innerHTML = `
                <div class="chart-card" style="grid-column: 1 / -1; min-height: 250px;">
                    <div id="timeline-container" style="padding: 10px 20px;">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading timeline...</span>
                        </div>
                    </div>
                </div>
                <div class="chart-card">
                    <h2>Import Time by Category</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Total time by asset category (click for details)</p>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="categoryChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card">
                    <h2>Import Time by File Type</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Total time by file extension (click for details)</p>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="typeTimeChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card">
                    <h2>Asset Count by File Type</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Number of assets by file extension (click for details)</p>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="typeCountChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card clickable" onclick="loadFolderAnalysis()" style="cursor: pointer;" title="Click to view all folders">
                    <h2>Heaviest Folders</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Top folders by total import time (click for details)</p>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="foldersChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card" style="grid-column: span 2; min-height: 450px;">
                    <h2>Slowest Assets</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Top 50 slowest assets across all file types (click for details)</p>
                    <div style="max-height: 400px; overflow-y: auto;">
                        <table id="slowest-assets-table" style="width: 100%; font-size: 0.9em;">
                            <thead style="position: sticky; top: 0; background: white;">
                                <tr>
                                    <th style="text-align: left; padding: 10px; width: 35%;">Asset Name</th>
                                    <th style="text-align: left; padding: 10px; width: 8%;">File Type</th>
                                    <th style="text-align: left; padding: 10px; width: 10%;">Category</th>
                                    <th style="text-align: left; padding: 10px; width: 12%;">Importer</th>
                                    <th style="text-align: right; padding: 10px; width: 10%;">Import Time</th>
                                    <th style="text-align: left; padding: 10px;">Path</th>
                                </tr>
                            </thead>
                            <tbody id="slowest-assets-body">
                                <tr><td colspan="6" style="text-align: center; padding: 20px;">
                                    <div class="element-spinner">
                                        <span class="loading-spinner"></span>
                                        <span>Loading assets...</span>
                                    </div>
                                </td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="chart-card">
                    <h2>Operations</h2>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="pipelineBreakdownChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card">
                    <h2>Time by Importer</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Total time by Unity importer type (click for details)</p>
                    <div class="chart-container">
                        <div class="element-spinner">
                            <span class="loading-spinner"></span>
                            <span>Loading chart...</span>
                        </div>
                        <canvas id="importerChart" style="display: none;"></canvas>
                    </div>
                </div>
                <div class="chart-card" style="min-height: 400px;">
                    <h2>Import Time Statistics by File Type</h2>
                    <p style="font-size: 0.9em; color: #666; margin-bottom: 10px;">Mean and standard deviation to identify outliers vs. consistently slow imports</p>
                    <div style="max-height: 350px; overflow-y: auto;">
                        <table id="mode-time-table" style="width: 100%; font-size: 0.9em;">
                            <thead style="position: sticky; top: 0; background: white;">
                                <tr>
                                    <th style="text-align: left; padding: 10px;">File Type</th>
                                    <th style="text-align: right; padding: 10px;">Count</th>
                                    <th style="text-align: right; padding: 10px;">Mean</th>
                                    <th style="text-align: right; padding: 10px;">Std Dev</th>
                                    <th style="text-align: left; padding: 10px;">Interpretation</th>
                                    <th style="text-align: right; padding: 10px;">Total Time</th>
                                </tr>
                            </thead>
                            <tbody id="mode-time-body">
                                <tr><td colspan="6" style="text-align: center; padding: 20px;">
                                    <div class="element-spinner">
                                        <span class="loading-spinner"></span>
                                        <span>Calculating statistics...</span>
                                    </div>
                                </td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            
            // Type pie chart (time) - by file extension - sorted by time
            const typeData = (data.by_type || []).slice(0, 15);  // Top 15 types by time
            const typeTimeChart = new Chart(document.getElementById('typeTimeChart'), {
                type: 'pie',
                data: {
                    labels: typeData.map(t => t.asset_type || 'Unknown'),
                    datasets: [{
                        data: typeData.map(t => (t.total_time / 1000).toFixed(2)),
                        backgroundColor: [
                            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', 
                            '#9966FF', '#FF9F40', '#E7E9ED', '#8E5EA2',
                            '#3cba9f', '#e8c3b9', '#c45850', '#95d5b2',
                            '#ffd6a5', '#caffbf', '#fdffb6'
                        ],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { 
                            position: 'right',
                            labels: {
                                font: { size: 11 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = parseFloat(context.parsed);
                                    const total = context.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return label + ': ' + formatTime(value) + ' (' + percentage + '%)';
                                }
                            }
                        },
                        datalabels: {
                            formatter: (value, ctx) => {
                                const total = ctx.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
                                const percentage = ((value / total) * 100);
                                if (percentage > 5) {  // Only show label if > 5%
                                    return formatTime(parseFloat(value));
                                }
                                return '';
                            },
                            color: '#333',
                            font: {
                                weight: 'bold',
                                size: 14
                            }
                        }
                    },
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const type = typeData[index].asset_type;
                            loadTypeDetail(type);
                        }
                    }
                }
            });
            showChart('typeTimeChart');
            
            // Type count chart - more reliable for worker thread imports
            const typeDataByCount = (data.by_type || []).sort((a, b) => b.count - a.count).slice(0, 15);
            const typeCountChart = new Chart(document.getElementById('typeCountChart'), {
                type: 'doughnut',
                data: {
                    labels: typeDataByCount.map(t => t.asset_type || 'Unknown'),
                    datasets: [{
                        data: typeDataByCount.map(t => t.count),
                        backgroundColor: [
                            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', 
                            '#9966FF', '#FF9F40', '#E7E9ED', '#8E5EA2',
                            '#3cba9f', '#e8c3b9', '#c45850', '#95d5b2',
                            '#ffd6a5', '#caffbf', '#fdffb6'
                        ],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { 
                            position: 'right',
                            labels: {
                                font: { size: 11 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return label + ': ' + value + ' assets (' + percentage + '%)';
                                }
                            }
                        },
                        datalabels: {
                            formatter: (value, ctx) => {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100);
                                if (percentage > 3) {  // Lower threshold for count chart
                                    return value;
                                }
                                return '';
                            },
                            color: '#333',
                            font: {
                                weight: 'bold',
                                size: 14
                            }
                        }
                    },
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const type = typeDataByCount[index].asset_type;
                            loadTypeDetail(type);
                        }
                    }
                }
            });
            showChart('typeCountChart');
            
            // Pipeline breakdown chart
            loadPipelineBreakdown();
            
            // Folders chart
            loadFoldersChart();
            
            // Importer type chart
            loadImporterChart(data.by_importer);
            
            // Mode time table
            displayModeTimeTable(data.by_type);
            
            // Slowest assets table
            loadSlowestAssets();
            
            // Category chart
            loadCategoryChart(data.by_category);
            
            // Timeline visualization
            displayTimeline(data);
        }

