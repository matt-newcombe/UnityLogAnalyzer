/**
 * Charts Module
 * Handles all chart rendering and visualization
 */

        async function loadAssetsByType(assetType) {
            try {
                // Don't show loading overlay - table structure will show immediately
                // Load assets progressively in batches
                await displayAssetsTableProgressive(assetType, `${assetType} Assets`);
            } catch (error) {
                showError('Failed to load type detail: ' + error.message);
            }
        }

        async function loadStdDevView(assetType) {
            try {
                const assets = await window.apiClient.getAssetsByType(assetType);
                
                if (!assets || assets.length === 0) {
                    showError('No assets found for this type');
                    return;
                }
                
                // Convert to seconds and sort by import time
                const times = assets.map(asset => asset.import_time_ms / 1000);
                const sortedAssets = assets.slice().sort((a, b) => a.import_time_ms - b.import_time_ms);
                
                // Calculate mean and standard deviation
                const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
                const variance = times.reduce((sum, time) => sum + Math.pow(time - mean, 2), 0) / times.length;
                const stdDev = Math.sqrt(variance);
                
                // Calculate total time and percentage
                const totalTime = times.reduce((sum, time) => sum + time, 0);
                const summary = await window.apiClient.getSummary();
                const projectLoadTime = summary.project_load_time || 0;
                const percentageOfLoad = projectLoadTime > 0 
                    ? ((totalTime / projectLoadTime) * 100).toFixed(1)
                    : 'N/A';
                
                // Store the view state for back button
                setStdDevViewState({
                    assetType: assetType,
                    assets: assets,
                    mean: mean,
                    stdDev: stdDev,
                    totalTime: totalTime,
                    percentageOfLoad: percentageOfLoad
                });
                
                // Display the view
                const tablesDiv = document.getElementById('tables');
                tablesDiv.innerHTML = `
                    <div class="table-container">
                        <h2>📊 Standard Deviation Analysis: ${assetType}</h2>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                            <div class="stat-card" style="margin: 0;">
                                <div class="stat-label">Asset Count</div>
                                <div class="stat-value">${assets.length.toLocaleString()}</div>
                            </div>
                            <div class="stat-card" style="margin: 0;">
                                <div class="stat-label">Total Time</div>
                                <div class="stat-value">${formatTime(totalTime)}</div>
                            </div>
                            <div class="stat-card" style="margin: 0;">
                                <div class="stat-label">% of Full Load Time</div>
                                <div class="stat-value">${percentageOfLoad}${percentageOfLoad !== 'N/A' ? '%' : ''}</div>
                            </div>
                            <div class="stat-card" style="margin: 0;">
                                <div class="stat-label">Mean</div>
                                <div class="stat-value">${formatTime(mean)}</div>
                            </div>
                            <div class="stat-card" style="margin: 0;">
                                <div class="stat-label">Std Dev</div>
                                <div class="stat-value">${formatTime(stdDev)}</div>
                            </div>
                        </div>
                        <p style="margin-bottom: 15px; color: #666;">
                            💡 Distribution of import times with theoretical normal curve. <strong>Click</strong> any bar to see assets in that time range.
                        </p>
                        <div style="position: relative; height: 500px; margin-bottom: 20px;">
                            <canvas id="stdDevChart"></canvas>
                        </div>
                        <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="width: 20px; height: 12px; background: #667eea;"></div>
                                <span style="font-size: 0.9em;">Actual Distribution (Histogram)</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="width: 20px; height: 2px; background: #28a745;"></div>
                                <span style="font-size: 0.9em;">Theoretical Normal Curve (Mean: ${formatTime(mean)}, Std Dev: ${formatTime(stdDev)})</span>
                            </div>
                        </div>
                    </div>
                `;
                
                // Create histogram bins
                const minTime = Math.min(...times);
                const maxTime = Math.max(...times);
                const binCount = Math.min(30, Math.max(10, Math.floor(Math.sqrt(assets.length)))); // Adaptive bin count
                const binWidth = (maxTime - minTime) / binCount || 0.001; // Avoid division by zero
                
                // Create bins and count assets in each
                const bins = Array(binCount).fill(0).map((_, i) => {
                    const binStart = minTime + (i * binWidth);
                    const binEnd = i === binCount - 1 ? maxTime + 0.001 : minTime + ((i + 1) * binWidth);
                    return {
                        start: binStart,
                        end: binEnd,
                        center: (binStart + binEnd) / 2,
                        count: 0,
                        assets: []
                    };
                });
                
                // Assign assets to bins
                assets.forEach(asset => {
                    const timeSeconds = asset.import_time_ms / 1000;
                    const binIndex = Math.min(
                        Math.floor((timeSeconds - minTime) / binWidth),
                        binCount - 1
                    );
                    bins[binIndex].count++;
                    bins[binIndex].assets.push(asset);
                });
                
                // Calculate theoretical normal distribution curve at bin centers
                // Normal distribution PDF: f(x) = (1 / (σ * √(2π))) * e^(-0.5 * ((x - μ) / σ)²)
                const maxCount = Math.max(...bins.map(b => b.count), 1); // Avoid division by zero
                
                // Create invisible full-height bars for better click/hover interaction
                // These will be positioned behind the visible bars
                const interactionHeight = maxCount * 1.2; // Extend slightly above max for full coverage
                
                // Calculate normal distribution values at each bin center
                // Scale to match the histogram height
                const normalCurveValues = bins.map(bin => {
                    const x = bin.center;
                    const z = (x - mean) / stdDev;
                    const pdf = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z);
                    
                    // Scale to match histogram: multiply by total number of assets and bin width
                    // This gives the expected count in each bin for a normal distribution
                    const expectedCount = pdf * assets.length * binWidth;
                    return expectedCount;
                });
                
                // Create chart
                const ctx = document.getElementById('stdDevChart').getContext('2d');
                
                // Destroy existing chart if it exists
                if (window.stdDevChartInstance) {
                    window.stdDevChartInstance.destroy();
                }
                
                // Store bin data for click handling
                window.stdDevBins = bins;
                
                window.stdDevChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: bins.map(b => formatTime(b.center)),
                        datasets: [
                            {
                                // Invisible interaction layer - full height bars for easier clicking
                                // Using very low opacity instead of transparent to ensure clicks register
                                label: '',
                                data: bins.map(() => interactionHeight),
                                backgroundColor: 'rgba(0, 0, 0, 0.01)', // Nearly transparent but clickable
                                borderColor: 'rgba(0, 0, 0, 0.01)',
                                borderWidth: 0,
                                order: 3, // Behind other datasets
                                datalabels: {
                                    display: false
                                }
                            },
                            {
                                label: 'Asset Count',
                                data: bins.map(b => b.count),
                                backgroundColor: 'rgba(102, 126, 234, 0.7)',
                                borderColor: 'rgba(102, 126, 234, 1)',
                                borderWidth: 1,
                                order: 2 // In front of interaction layer
                            },
                            {
                                label: 'Normal Distribution',
                                data: normalCurveValues,
                                type: 'line',
                                borderColor: '#28a745',
                                borderWidth: 2,
                                pointRadius: 0,
                                pointHitRadius: 0, // Don't intercept clicks
                                fill: false,
                                tension: 0.4,
                                order: 1, // In front of bars
                                datalabels: {
                                    display: false  // Hide labels on the normal distribution curve
                                }
                            },
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            mode: 'index',
                            intersect: false
                        },
                        scales: {
                            x: {
                                title: {
                                    display: true,
                                    text: 'Import Time (seconds)'
                                },
                                ticks: {
                                    maxRotation: 45,
                                    minRotation: 45,
                                    callback: function(value, index) {
                                        // Show every nth label to avoid crowding
                                        const step = Math.max(1, Math.floor(bins.length / 10));
                                        return index % step === 0 ? formatTime(bins[index].center) : '';
                                    }
                                }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'Number of Assets'
                                },
                                beginAtZero: true
                            }
                        },
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top',
                                labels: {
                                    filter: function(item, chart) {
                                        // Only show the visible histogram bars in legend (dataset index 1)
                                        return item.datasetIndex === 1;
                                    }
                                }
                            },
                            datalabels: {
                                display: function(context) {
                                    // Only show labels on the visible histogram bars (dataset index 1), not interaction layer or curve
                                    return context.datasetIndex === 1;
                                }
                            },
                            tooltip: {
                                displayColors: false,
                                callbacks: {
                                    title: function(context) {
                                        // Show tooltip for interaction layer (0) or visible bars (1)
                                        if (context[0].datasetIndex === 0 || context[0].datasetIndex === 1) {
                                            const binIndex = context[0].dataIndex;
                                            const bin = bins[binIndex];
                                            return `${formatTime(bin.start)} - ${formatTime(bin.end)}`;
                                        }
                                        return '';
                                    },
                                    label: function(context) {
                                        // Show tooltip for interaction layer (0) or visible bars (1)
                                        if (context.datasetIndex === 0 || context.datasetIndex === 1) {
                                            const binIndex = context.dataIndex;
                                            const bin = bins[binIndex];
                                            // Return only our custom label, no dataset label or value
                                            return `${bin.count} assets in this range`;
                                        }
                                        // Hide other datasets (normal distribution curve)
                                        return null;
                                    },
                                    filter: function(tooltipItem) {
                                        // Only show tooltip for interaction layer (0) or visible bars (1)
                                        // Hide the normal distribution curve (dataset 2) from tooltip
                                        return tooltipItem.datasetIndex === 0 || tooltipItem.datasetIndex === 1;
                                    }
                                }
                            }
                        },
                        onClick: (event, elements) => {
                            console.log('Chart clicked', elements);
                            const chart = window.stdDevChartInstance;
                            
                            // Get the x position of the click
                            const canvasPosition = Chart.helpers.getRelativePosition(event, chart);
                            const xValue = chart.scales.x.getValueForPixel(canvasPosition.x);
                            
                            console.log('Click x position (time value):', xValue);
                            
                            // Find the bin that contains this x value (time value)
                            // The x-axis shows time values, so we need to match the clicked time to a bin
                            let binIndex = -1;
                            
                            // Try to get binIndex from element if available
                            if (elements && elements.length > 0) {
                                const barElement = elements.find(el => (el.datasetIndex === 0 || el.datasetIndex === 1) && el.index !== undefined);
                                if (barElement && barElement.index !== undefined) {
                                    binIndex = barElement.index;
                                    console.log('Found bin index from element:', binIndex);
                                }
                            }
                            
                            // If we couldn't get it from element, find by time value
                            if (binIndex < 0) {
                                binIndex = bins.findIndex(bin => {
                                    return xValue >= bin.start && xValue <= bin.end;
                                });
                                console.log('Found bin index from time value:', binIndex, 'for time:', xValue);
                            }
                            
                            if (binIndex >= 0 && binIndex < bins.length) {
                                const bin = bins[binIndex];
                                console.log('Bin found:', binIndex, 'with', bin.assets ? bin.assets.length : 0, 'assets');
                                
                                if (bin && bin.assets && bin.assets.length > 0) {
                                    console.log('Displaying assets table for bin:', binIndex);
                                    displayAssetsTable(bin.assets, `${assetType} Assets (${formatTime(bin.start)} - ${formatTime(bin.end)})`);
                                } else {
                                    console.log('No assets in bin');
                                }
                            } else {
                                console.log('Could not determine bin index');
                            }
                        },
                        onHover: (event, elements) => {
                            // Show pointer cursor for interaction layer or visible bars
                            const isClickable = elements.length > 0 && (elements[0].datasetIndex === 0 || elements[0].datasetIndex === 1);
                            event.native.target.style.cursor = isClickable ? 'pointer' : 'default';
                        }
                    }
                });
                
                // Auto-scroll to view
                setTimeout(() => {
                    tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
                
            } catch (error) {
                showError('Failed to load standard deviation view: ' + error.message);
                console.error('Error loading std dev view:', error);
            }
        }

        async function loadFoldersChart() {
            try {
                const folders = await window.apiClient.getFolderAnalysis();
                
                // Top 6 folders
                const topFolders = folders.slice(0, 6);
                
                const foldersChart = new Chart(document.getElementById('foldersChart'), {
                    type: 'doughnut',
                    data: {
                        labels: topFolders.map(f => f.folder.split('/').slice(-2).join('/')),  // Show last 2 parts
                        datasets: [{
                            data: topFolders.map(f => (f.total_time_ms / 1000).toFixed(2)),
                            backgroundColor: [
                                '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'
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
                                    font: { size: 10 }
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const folder = topFolders[context.dataIndex];
                                        return [
                                            `Path: ${folder.folder}`,
                                            `Time: ${formatTime(folder.total_time_ms / 1000)}`,
                                            `Assets: ${folder.asset_count}`
                                        ];
                                    }
                                }
                            },
                            datalabels: {
                                formatter: (value, ctx) => {
                                    return formatTime(parseFloat(value));
                                },
                                color: '#333',
                                font: {
                                    weight: 'bold',
                                    size: 13
                                }
                            }
                        }
                    }
                });
                showChart('foldersChart');
            } catch (error) {
                console.error('Failed to load folders chart:', error);
                const container = document.getElementById('foldersChart').parentElement;
                const spinner = container.querySelector('.element-spinner');
                if (spinner) spinner.innerHTML = '<span style="color: #ff4444;">Failed to load chart</span>';
            }
        }

        function loadImporterChart(importerData) {
            if (!importerData || importerData.length === 0) {
                const container = document.getElementById('importerChart').parentElement;
                const spinner = container.querySelector('.element-spinner');
                if (spinner) spinner.innerHTML = '<span>No importer data available</span>';
                return;
            }
            
            // Top 10 importers by time
            const topImporters = importerData.slice(0, 10);
            
            const ctx = document.getElementById('importerChart');
            const importerChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: topImporters.map(i => (i.importer_type || 'Unknown').replace('Importer', '')),
                    datasets: [{
                        label: 'Total Time',
                        data: topImporters.map(i => (i.total_time / 1000).toFixed(2)),
                        backgroundColor: '#667eea'
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const importer = topImporters[context.dataIndex];
                                    return [
                                        `Total: ${formatTime(importer.total_time / 1000)}`,
                                        `Count: ${importer.count} assets`,
                                        `Avg: ${formatTime(importer.avg_time / 1000)}`
                                    ];
                                }
                            }
                        },
                        datalabels: {
                            anchor: 'end',
                            align: 'end',
                            formatter: (value) => formatTime(parseFloat(value)),
                            color: '#333',
                            font: {
                                weight: 'bold',
                                size: 10
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Total Import Time'
                            }
                        }
                    },
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const importer = topImporters[index];
                            loadImporterDetail(importer.importer_type);
                        }
                    }
                }
            });
            showChart('importerChart');
        }

        function loadCategoryChart(categoryData) {
            if (!categoryData || categoryData.length === 0) {
                console.warn('No category data available');
                const ctx = document.getElementById('categoryChart');
                if (ctx && ctx.parentElement) {
                    ctx.parentElement.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No category data available</p>';
                }
                return;
            }
            
            // Top 15 categories by time
            const topCategories = categoryData.slice(0, 15);
            
            const ctx = document.getElementById('categoryChart');
            if (!ctx) {
                console.error('Category chart canvas not found');
                return;
            }
            
            // Destroy existing chart if it exists
            if (ctx.chart) {
                ctx.chart.destroy();
            }
            
            // Convert total_time (in ms) to seconds for chart
            const chartData = topCategories.map(c => {
                const timeMs = c.total_time || 0;
                return parseFloat((timeMs / 1000).toFixed(2));
            });
            
            ctx.chart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: topCategories.map(c => c.asset_category || 'Unknown'),
                    datasets: [{
                        data: chartData,
                        backgroundColor: [
                            '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
                            '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
                            '#EC7063', '#5DADE2', '#F1948A', '#82E0AA', '#F4D03F'
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
                                padding: 15,
                                font: { size: 11 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const category = topCategories[context.dataIndex];
                                    const total = chartData.reduce((sum, val) => sum + parseFloat(val), 0);
                                    const percentage = total > 0 ? ((parseFloat(context.parsed) / total) * 100).toFixed(1) : '0.0';
                                    return [
                                        `${context.label}: ${formatTime(parseFloat(context.parsed))}`,
                                        `Count: ${category.count || 0} assets`,
                                        `Avg: ${formatTime((category.avg_time || 0) / 1000)}`,
                                        `${percentage}% of total`
                                    ];
                                }
                            }
                        },
                        datalabels: {
                            formatter: (value, ctx) => {
                                const total = ctx.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
                                if (total === 0 || !value || value === 0) return '';
                                const percentage = ((parseFloat(value) / total) * 100);
                                if (percentage > 5) {
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
                            const category = topCategories[index];
                            loadCategoryDetail(category.asset_category);
                        }
                    }
                }
            });
            showChart('categoryChart');
        }

        async function loadPipelineBreakdown() {
            try {
                // Get operations breakdown instead of pipeline breakdown
                const operations = await window.apiClient.getOperationsBreakdown();
                
                const labels = [];
                const values = [];
                
                // Show all operation types
                operations.forEach(op => {
                    if (op.total_time_ms > 0) {
                        labels.push(op.type);
                        values.push((op.total_time_ms / 1000).toFixed(2));
                    }
                });
                
                // If no operations, show message
                if (labels.length === 0) {
                    const container = document.getElementById('pipelineBreakdownChart').parentElement;
                    const spinner = container.querySelector('.element-spinner');
                    if (spinner) spinner.innerHTML = '<span style="color: #666;">No operations found</span>';
                    return;
                }
                
                // Generate colors for operations (use distinct colors)
                const colors = [
                    '#9966FF', '#FF9F40', '#4CAF50', '#2196F3', 
                    '#F44336', '#9C27B0', '#00BCD4', '#FFC107',
                    '#795548', '#607D8B'
                ];
                const backgroundColor = labels.map((_, i) => colors[i % colors.length]);
                
                const pipelineChart = new Chart(document.getElementById('pipelineBreakdownChart'), {
                    type: 'pie',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: values,
                            backgroundColor: backgroundColor,
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'right' },
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
                                return formatTime(parseFloat(value));
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
                                const label = labels[index];
                                // Load operations by type instead of pipeline details
                                loadOperationsByType(label);
                            }
                        }
                    }
                });
                showChart('pipelineBreakdownChart');
            } catch (error) {
                console.error('Failed to load pipeline breakdown:', error);
                const container = document.getElementById('pipelineBreakdownChart').parentElement;
                const spinner = container.querySelector('.element-spinner');
                if (spinner) spinner.innerHTML = '<span style="color: #ff4444;">Failed to load chart</span>';
            }
        }
