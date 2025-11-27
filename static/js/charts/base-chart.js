/**
 * BaseChart - Base class for all chart widgets
 * Encapsulates common chart functionality to reduce duplication
 */

import { PIE_CHART_COLORS } from './colors.js';
import { buildPieChartConfig, buildBarChartConfig } from './config-builders.js';
import { createTimeLabelFormatter } from './formatters.js';

/**
 * Destroy existing chart instance if it exists
 * @param {string} canvasId - ID of the canvas element
 */
export function destroyChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const existingChart = Chart.getChart(canvasId) || ctx.chart;
    if (existingChart) {
        existingChart.destroy();
    }
}

/**
 * Show chart (hide loading spinner)
 * @param {string} canvasId - ID of the canvas element
 */
export function showChart(canvasId) {
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

/**
 * BaseChart class for creating and managing charts
 */
export class BaseChart {
    /**
     * Create a new BaseChart instance
     * @param {string} canvasId - ID of the canvas element
     * @param {Object} options - Configuration options
     */
    constructor(canvasId, options = {}) {
        this.canvasId = canvasId;
        this.disableAnimation = options.disableAnimation || false;
        this.emptyMessage = options.emptyMessage || 'No data available';
        this.errorMessage = options.errorMessage || 'Failed to load chart';
        this.chartInstance = null;
    }

    /**
     * Load chart with data fetcher, processor, and config builder
     * @param {Function} dataFetcher - Async function that fetches data
     * @param {Function} dataProcessor - Function that processes raw data
     * @param {Function} configBuilder - Function that builds chart config
     * @returns {Promise<Chart|null>} Chart instance or null if failed
     */
    async load(dataFetcher, dataProcessor, configBuilder) {
        try {
            const rawData = await dataFetcher();

            if (!rawData || (Array.isArray(rawData) && rawData.length === 0)) {
                this.showEmptyState();
                return null;
            }

            const processedData = dataProcessor(rawData);
            const config = configBuilder(processedData);

            return this.createChart(config);
        } catch (error) {
            this.handleError(error);
            return null;
        }
    }

    /**
     * Create chart from configuration
     * @param {Object} config - Chart configuration
     * @returns {Chart} Chart instance
     */
    createChart(config) {
        this.destroy();

        if (config.type === 'pie' || config.isDoughnut) {
            return this.createPieChart(config);
        } else if (config.type === 'bar') {
            return this.createBarChart(config);
        }

        throw new Error(`Unsupported chart type: ${config.type}`);
    }

    /**
     * Create pie/doughnut chart
     * @param {Object} config - Chart configuration
     * @returns {Chart} Chart instance
     */
    createPieChart(config) {
        const chart = createPieChart(this.canvasId, config.labels, config.data, {
            isDoughnut: config.isDoughnut || false,
            disableAnimation: this.disableAnimation,
            legendPosition: config.legendPosition || 'right',
            legendFontSize: config.legendFontSize || 11,
            dataLabelThreshold: config.dataLabelThreshold || 5,
            customColors: config.colors || PIE_CHART_COLORS,
            tooltipFormatter: config.tooltipFormatter,
            dataLabelFormatter: config.dataLabelFormatter,
            onClick: config.onClick
        });

        this.storeInstance(chart);
        return chart;
    }

    /**
     * Create bar chart
     * @param {Object} config - Chart configuration
     * @returns {Chart} Chart instance
     */
    createBarChart(config) {
        destroyChart(this.canvasId);

        const chartConfig = buildBarChartConfig({
            labels: config.labels,
            data: config.data,
            color: config.color || '#667eea',
            tooltipFormatter: config.tooltipFormatter,
            onClick: config.onClick,
            disableAnimation: this.disableAnimation
        });

        const ctx = document.getElementById(this.canvasId);
        const chart = new Chart(ctx, chartConfig);

        showChart(this.canvasId);
        this.storeInstance(chart);
        return chart;
    }

    /**
     * Destroy existing chart instance
     */
    destroy() {
        destroyChart(this.canvasId);
        this.chartInstance = null;
    }

    /**
     * Store chart instance globally
     * @param {Chart} chart - Chart instance to store
     */
    storeInstance(chart) {
        if (chart) {
            this.chartInstance = chart;
            window.chartInstances = window.chartInstances || {};
            window.chartInstances[this.canvasId] = chart;
        }
    }

    /**
     * Show empty state message
     */
    showEmptyState() {
        const canvas = document.getElementById(this.canvasId);
        if (!canvas) return;

        const container = canvas.parentElement;
        const spinner = container?.querySelector('.element-spinner');
        if (spinner) {
            spinner.innerHTML = `<span>${this.emptyMessage}</span>`;
        }
    }

    /**
     * Handle error
     * @param {Error} error - Error object
     */
    handleError(error) {
        console.error(`Failed to load ${this.canvasId}:`, error);
        const canvas = document.getElementById(this.canvasId);
        if (!canvas) return;

        const container = canvas.parentElement;
        const spinner = container?.querySelector('.element-spinner');
        if (spinner) {
            spinner.innerHTML = `<span style="color: #ff4444;">${this.errorMessage}</span>`;
        }
    }
}

/**
 * Create pie or doughnut chart
 * @param {string} canvasId - ID of the canvas element
 * @param {Array} labels - Array of label strings
 * @param {Array} data - Array of data values
 * @param {Object} options - Configuration options
 * @returns {Chart|null} Chart instance or null if canvas not found
 */
export function createPieChart(canvasId, labels, data, options = {}) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) {
        console.error(`Canvas element not found: ${canvasId}`);
        return null;
    }

    destroyChart(canvasId);

    const colors = options.customColors || PIE_CHART_COLORS;
    const backgroundColor = labels.map((_, i) => colors[i % colors.length]);

    const config = buildPieChartConfig({
        labels: labels,
        data: data,
        colors: backgroundColor,
        isDoughnut: options.isDoughnut || false,
        disableAnimation: options.disableAnimation || false,
        legendPosition: options.legendPosition || 'right',
        legendFontSize: options.legendFontSize || 11,
        tooltipFormatter: options.tooltipFormatter,
        dataLabelFormatter: options.dataLabelFormatter || createTimeLabelFormatter(options.dataLabelThreshold || 5),
        dataLabelThreshold: options.dataLabelThreshold || 5,
        onClick: options.onClick || null,
        onHover: options.onHover || ((event, elements) => {
            event.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
        })
    });

    const chart = new Chart(ctx, config);

    ctx.chart = chart;
    window.chartInstances = window.chartInstances || {};
    window.chartInstances[canvasId] = chart;

    showChart(canvasId);

    return chart;
}

