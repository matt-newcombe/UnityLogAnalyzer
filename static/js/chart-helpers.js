/**
 * Chart Helpers for Unity Log Analyzer
 * Common Chart.js configurations and utilities
 */

const ChartHelpers = {
    // Common color palette
    colors: [
        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
        '#FF9F40', '#FF6384', '#C9CBCF', '#4BC0C0', '#FF6384',
        '#36A2EB', '#FFCE56'
    ],

    /**
     * Common datalabels plugin configuration
     */
    getDataLabelsConfig(formatter) {
        return {
            color: '#fff',
            font: { weight: 'bold', size: 11 },
            formatter: formatter || ((value) => value > 0 ? value : ''),
            display: (context) => context.dataset.data[context.dataIndex] > 0
        };
    },

    /**
     * Common legend configuration
     */
    getLegendConfig(position = 'right') {
        return {
            display: true,
            position: position,
            labels: {
                boxWidth: 15,
                padding: 10,
                font: { size: 11 }
            }
        };
    },

    /**
     * Common responsive configuration
     */
    getResponsiveConfig() {
        return {
            responsive: true,
            maintainAspectRatio: false
        };
    },

    /**
     * Create a pie/doughnut chart with common settings
     */
    createPieChart(canvasId, labels, data, options = {}) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return null;

        return new Chart(ctx, {
            type: options.doughnut ? 'doughnut' : 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: this.colors,
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                ...this.getResponsiveConfig(),
                plugins: {
                    legend: this.getLegendConfig(options.legendPosition),
                    datalabels: this.getDataLabelsConfig(options.dataLabelFormatter),
                    tooltip: options.tooltip || {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                return `${label}: ${value}`;
                            }
                        }
                    }
                },
                onClick: options.onClick
            }
        });
    },

    /**
     * Create a bar chart with common settings
     */
    createBarChart(canvasId, labels, data, options = {}) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return null;

        return new Chart(ctx, {
            type: options.horizontal ? 'bar' : 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: options.label || 'Value',
                    data: data,
                    backgroundColor: options.backgroundColor || this.colors[0],
                    borderColor: options.borderColor || '#667eea',
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: options.horizontal ? 'y' : 'x',
                ...this.getResponsiveConfig(),
                plugins: {
                    legend: { display: false },
                    datalabels: this.getDataLabelsConfig(options.dataLabelFormatter),
                    tooltip: options.tooltip
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ...options.xScale
                    },
                    y: {
                        beginAtZero: true,
                        ...options.yScale
                    }
                },
                onClick: options.onClick
            }
        });
    },

    /**
     * Show a chart (hide spinner, show canvas)
     */
    showChart(canvasId) {
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
            canvas.style.display = 'block';
        } catch (error) {
            console.error(`Error showing chart ${canvasId}:`, error);
        }
    }
};

// Make available globally
window.ChartHelpers = ChartHelpers;

