/**
 * BaseChart - Base class for all chart widgets
 * Encapsulates common chart functionality to reduce duplication
 */
class BaseChart {
    /**
     * Create a new BaseChart instance
     * @param {string} canvasId - ID of the canvas element
     * @param {Object} options - Configuration options
     * @param {boolean} options.disableAnimation - Whether to disable chart animations
     * @param {string} options.emptyMessage - Message to show when no data is available
     * @param {string} options.errorMessage - Message to show when an error occurs
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
            // 1. Fetch data
            const rawData = await dataFetcher();

            // 2. Check for empty data
            if (!rawData || (Array.isArray(rawData) && rawData.length === 0)) {
                this.showEmptyState();
                return null;
            }

            // 3. Process data
            const processedData = dataProcessor(rawData);

            // 4. Build configuration
            const config = configBuilder(processedData);

            // 5. Create chart
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
        // Destroy existing chart
        this.destroy();

        // Determine chart type and create accordingly
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
