/**
 * Chart Loaders Module
 * Functions to load specific charts with data
 */

import { formatTime } from '../core/formatters.js';
import { BaseChart, destroyChart, showChart, createPieChart } from './base-chart.js';
import { CATEGORY_CHART_COLORS, PIE_CHART_COLORS, OPERATIONS_CHART_COLORS } from './colors.js';
import { buildHistogramConfig } from './config-builders.js';
import { 
    createFolderTooltipFormatter, 
    createImporterTooltipFormatter,
    createCategoryTooltipFormatter 
} from './formatters.js';
import { 
    processFolderData, 
    processImporterData, 
    processCategoryData,
    processOperationsData,
    processStdDevData 
} from './data-processors.js';

/**
 * Load folders chart (top 6 folders by import time)
 * @param {boolean} disableAnimation - Whether to disable chart animation
 */
export async function loadFoldersChart(disableAnimation = false) {
    const chart = new BaseChart('foldersChart', {
        disableAnimation,
        emptyMessage: 'No folder data available',
        errorMessage: 'Failed to load chart'
    });

    await chart.load(
        () => window.apiClient.getFolderAnalysis(),
        (folders) => processFolderData(folders),
        (processedData) => ({
            type: 'pie',
            isDoughnut: true,
            labels: processedData.labels,
            data: processedData.data,
            legendPosition: 'right',
            legendFontSize: 10,
            dataLabelThreshold: 0,
            colors: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'],
            tooltipFormatter: createFolderTooltipFormatter(processedData.folders),
            dataLabelFormatter: (value) => formatTime(parseFloat(value))
        })
    );
}

/**
 * Load importer chart (top 10 importers by time)
 * @param {Array} importerData - Array of importer objects
 * @param {boolean} disableAnimation - Whether to disable chart animation
 */
export function loadImporterChart(importerData, disableAnimation = false) {
    const chart = new BaseChart('importerChart', {
        disableAnimation,
        emptyMessage: 'No importer data available',
        errorMessage: 'Failed to load chart'
    });

    chart.load(
        () => Promise.resolve(importerData),
        (data) => processImporterData(data),
        (processedData) => ({
            type: 'bar',
            labels: processedData.labels,
            data: processedData.data,
            color: '#667eea',
            tooltipFormatter: createImporterTooltipFormatter(processedData.importers),
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const importer = processedData.importers[index];
                    if (typeof loadImporterDetail === 'function') {
                        loadImporterDetail(importer.importer_type);
                    }
                }
            }
        })
    );
}

/**
 * Load category chart (top 15 categories by time)
 * @param {Array} categoryData - Array of category objects
 * @param {boolean} disableAnimation - Whether to disable animation
 */
export function loadCategoryChart(categoryData, disableAnimation = false) {
    const chart = new BaseChart('categoryChart', {
        disableAnimation,
        emptyMessage: 'No category data available',
        errorMessage: 'Failed to load chart'
    });

    chart.load(
        () => Promise.resolve(categoryData),
        (data) => processCategoryData(data),
        (processedData) => ({
            type: 'pie',
            labels: processedData.labels,
            data: processedData.data,
            legendPosition: 'right',
            legendFontSize: 11,
            dataLabelThreshold: 5,
            colors: CATEGORY_CHART_COLORS,
            tooltipFormatter: createCategoryTooltipFormatter(processedData.categories),
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const chart = window.chartInstances.categoryChart;
                    if (chart && chart.data && chart.data.labels && chart.data.labels[index]) {
                        const category = chart.data.labels[index];
                        if (typeof loadCategoryDetail === 'function') {
                            loadCategoryDetail(category);
                        }
                    }
                }
            }
        })
    );
}

/**
 * Load pipeline breakdown chart (operations by type)
 * @param {boolean} disableAnimation - Whether to disable animation
 */
export async function loadPipelineBreakdown(disableAnimation = false) {
    const chart = new BaseChart('pipelineBreakdownChart', {
        disableAnimation,
        emptyMessage: 'No operations found',
        errorMessage: 'Failed to load chart'
    });

    await chart.load(
        () => window.apiClient.getProcessesBreakdown(),
        (operations) => processOperationsData(operations),
        (processedData) => ({
            type: 'pie',
            labels: processedData.labels,
            data: processedData.values,
            legendPosition: 'right',
            dataLabelThreshold: 0,
            colors: OPERATIONS_CHART_COLORS,
            dataLabelFormatter: (value) => formatTime(parseFloat(value)),
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const chart = window.chartInstances.pipelineBreakdownChart;
                    if (chart && chart.data && chart.data.labels && chart.data.labels[index]) {
                        const label = chart.data.labels[index];
                        if (typeof loadOperationsByType === 'function') {
                            loadOperationsByType(label);
                        }
                    }
                }
            }
        })
    );
}

/**
 * Load standard deviation view for an asset type
 * @param {string} assetType - Type of asset to analyze
 */
export async function loadStdDevView(assetType) {
    try {
        const assets = await window.apiClient.getAssetsByType(assetType);

        if (!assets || assets.length === 0) {
            if (typeof showError === 'function') {
                showError('No assets found for this type');
            }
            return;
        }

        const processedData = processStdDevData(assets);

        const summary = await window.apiClient.getSummary();
        const projectLoadTime = summary.project_load_time || 0;
        const percentageOfLoad = projectLoadTime > 0
            ? ((processedData.stats.totalTime / projectLoadTime) * 100).toFixed(1)
            : 'N/A';

        // Store view state for back button
        if (typeof setStdDevViewState === 'function') {
            setStdDevViewState({
                assetType: assetType,
                assets: assets,
                mean: processedData.stats.mean,
                stdDev: processedData.stats.stdDev,
                totalTime: processedData.stats.totalTime,
                percentageOfLoad: percentageOfLoad
            });
        }

        // Generate and display HTML
        const tablesDiv = document.getElementById('tables');
        tablesDiv.innerHTML = generateStdDevViewHTML(assetType, processedData.stats, percentageOfLoad);

        // Build and render chart
        const chartConfig = buildHistogramConfig({
            bins: processedData.bins,
            normalCurve: processedData.normalCurve,
            mean: processedData.stats.mean,
            stdDev: processedData.stats.stdDev,
            onClick: (event, elements) => handleStdDevChartClick(event, elements, processedData.bins, assetType),
            onHover: (event, elements) => {
                const isClickable = elements.length > 0 && (elements[0].datasetIndex === 0 || elements[0].datasetIndex === 1);
                event.native.target.style.cursor = isClickable ? 'pointer' : 'default';
            }
        });

        const ctx = document.getElementById('stdDevChart').getContext('2d');
        destroyChart('stdDevChart');
        window.stdDevBins = processedData.bins;
        window.stdDevChartInstance = new Chart(ctx, chartConfig);

        // Scroll to view
        setTimeout(() => {
            tablesDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

    } catch (error) {
        if (typeof showError === 'function') {
            showError('Failed to load standard deviation view: ' + error.message);
        }
        console.error('Error loading std dev view:', error);
    }
}

/**
 * Handle click on standard deviation histogram
 */
function handleStdDevChartClick(event, elements, bins, assetType) {
    const chart = window.stdDevChartInstance;

    const canvasPosition = Chart.helpers.getRelativePosition(event, chart);
    const xValue = chart.scales.x.getValueForPixel(canvasPosition.x);

    let binIndex = -1;

    if (elements && elements.length > 0) {
        const barElement = elements.find(el => (el.datasetIndex === 0 || el.datasetIndex === 1) && el.index !== undefined);
        if (barElement && barElement.index !== undefined) {
            binIndex = barElement.index;
        }
    }

    if (binIndex < 0) {
        binIndex = bins.findIndex(bin => xValue >= bin.start && xValue <= bin.end);
    }

    if (binIndex >= 0 && binIndex < bins.length) {
        const bin = bins[binIndex];
        if (bin && bin.assets && bin.assets.length > 0) {
            if (typeof displayAssetsTable === 'function') {
                displayAssetsTable(bin.assets, `${assetType} Assets (${formatTime(bin.start)} - ${formatTime(bin.end)})`);
            }
        }
    }
}

/**
 * Generate HTML for standard deviation view
 */
function generateStdDevViewHTML(assetType, stats, percentageOfLoad) {
    return `
        <div class="table-container">
            <h2>📊 Standard Deviation Analysis: ${assetType}</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Asset Count</div>
                    <div class="stat-value">${stats.count.toLocaleString()}</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Total Time</div>
                    <div class="stat-value">${formatTime(stats.totalTime)}</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">% of Full Load Time</div>
                    <div class="stat-value">${percentageOfLoad}${percentageOfLoad !== 'N/A' ? '%' : ''}</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Mean</div>
                    <div class="stat-value">${formatTime(stats.mean)}</div>
                </div>
                <div class="stat-card" style="margin: 0;">
                    <div class="stat-label">Std Dev</div>
                    <div class="stat-value">${formatTime(stats.stdDev)}</div>
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
                    <span style="font-size: 0.9em;">Theoretical Normal Curve (Mean: ${formatTime(stats.mean)}, Std Dev: ${formatTime(stats.stdDev)})</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Load assets by type (displays table)
 * @param {string} assetType - Type of asset to load
 */
export async function loadAssetsByType(assetType) {
    try {
        if (typeof displayAssetsTableProgressive === 'function') {
            await displayAssetsTableProgressive(assetType, `${assetType} Assets`);
        }
    } catch (error) {
        if (typeof showError === 'function') {
            showError('Failed to load type detail: ' + error.message);
        }
    }
}

