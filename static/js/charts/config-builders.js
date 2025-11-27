/**
 * Chart Configuration Builders Module
 * Builds Chart.js configuration objects
 */

import { formatTime } from '../core/formatters.js';
import { externalTooltipHandler } from './tooltips.js';
import { createTimeTooltipFormatter, createTimeLabelFormatter } from './formatters.js';

/**
 * Build Chart.js configuration for pie/doughnut charts
 * @param {Object} options - Configuration options
 * @returns {Object} Chart.js configuration object
 */
export function buildPieChartConfig(options) {
    const {
        labels,
        data,
        colors,
        isDoughnut = false,
        disableAnimation = false,
        legendPosition = 'right',
        legendFontSize = 11,
        tooltipFormatter,
        dataLabelFormatter,
        onClick = null,
        onHover = null
    } = options;

    const dataLabelThreshold = options.dataLabelThreshold !== undefined 
        ? options.dataLabelThreshold 
        : (isDoughnut ? 7 : 5);

    return {
        type: isDoughnut ? 'doughnut' : 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: disableAnimation ? false : undefined,
            plugins: {
                legend: {
                    position: legendPosition,
                    labels: {
                        font: { size: legendFontSize }
                    }
                },
                tooltip: {
                    enabled: false,
                    external: externalTooltipHandler,
                    callbacks: {
                        title: (context) => context[0].label || '',
                        label: tooltipFormatter || createTimeTooltipFormatter()
                    }
                },
                datalabels: buildDataLabelsConfig(dataLabelThreshold, dataLabelFormatter)
            },
            onClick: onClick,
            onHover: onHover
        }
    };
}

/**
 * Build datalabels plugin configuration
 * @param {number} threshold - Minimum percentage to show label
 * @param {Function} formatter - Custom formatter function
 * @returns {Object} Datalabels configuration
 */
function buildDataLabelsConfig(threshold, formatter) {
    const baseFormatter = formatter || createTimeLabelFormatter(threshold);

    return {
        formatter: (value, ctx) => {
            const total = ctx.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0) || 1;
            const percentage = ((value / total) * 100);
            if (percentage > threshold) {
                try {
                    return baseFormatter.length === 2 ? baseFormatter(value, ctx) : baseFormatter(value);
                } catch (e) {
                    return value;
                }
            }
            return '';
        },
        color: '#333',
        font: {
            weight: 'bold',
            size: 14
        }
    };
}

/**
 * Build Chart.js configuration for horizontal bar charts
 * @param {Object} options - Configuration options
 * @returns {Object} Chart.js configuration object
 */
export function buildBarChartConfig(options) {
    const {
        labels,
        data,
        color = '#667eea',
        tooltipFormatter,
        onClick = null,
        disableAnimation = false
    } = options;

    return {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Time',
                data: data,
                backgroundColor: color
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: disableAnimation ? false : undefined,
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    titleColor: '#fff',
                    titleFont: { size: 13, weight: '600' },
                    bodyColor: '#ccc',
                    bodyFont: { size: 12 },
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: tooltipFormatter
                    }
                },
                datalabels: {
                    anchor: 'end',
                    align: 'end',
                    formatter: (value) => formatTime(parseFloat(value)),
                    color: '#fff',
                    font: {
                        weight: 'bold',
                        size: 12
                    }
                }
            },
            onClick: onClick,
            scales: {
                x: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Total Import Time'
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        autoSkip: false
                    }
                }
            }
        }
    };
}

/**
 * Build Chart.js configuration for histogram with normal distribution overlay
 * @param {Object} options - Configuration options
 * @returns {Object} Chart.js configuration object
 */
export function buildHistogramConfig(options) {
    const {
        bins,
        normalCurve,
        onClick,
        onHover
    } = options;

    const maxCount = Math.max(...bins.map(b => b.count), 1);
    const interactionHeight = maxCount * 1.2;

    return {
        type: 'bar',
        data: {
            labels: bins.map(b => formatTime(b.center)),
            datasets: [
                {
                    label: '',
                    data: bins.map(() => interactionHeight),
                    backgroundColor: 'rgba(0, 0, 0, 0.01)',
                    borderColor: 'rgba(0, 0, 0, 0.01)',
                    borderWidth: 0,
                    order: 3,
                    datalabels: { display: false }
                },
                {
                    label: 'Asset Count',
                    data: bins.map(b => b.count),
                    backgroundColor: 'rgba(102, 126, 234, 0.7)',
                    borderColor: 'rgba(102, 126, 234, 1)',
                    borderWidth: 1,
                    order: 2
                },
                {
                    label: 'Normal Distribution',
                    data: normalCurve,
                    type: 'line',
                    borderColor: '#28a745',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 0,
                    fill: false,
                    tension: 0.4,
                    order: 1,
                    datalabels: { display: false }
                }
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
                        callback: function (value, index) {
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
                        filter: (item) => item.datasetIndex === 1
                    }
                },
                datalabels: {
                    display: (context) => context.datasetIndex === 1
                },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        title: (context) => {
                            if (context[0].datasetIndex === 0 || context[0].datasetIndex === 1) {
                                const bin = bins[context[0].dataIndex];
                                return `${formatTime(bin.start)} - ${formatTime(bin.end)}`;
                            }
                            return '';
                        },
                        label: (context) => {
                            if (context.datasetIndex === 0 || context.datasetIndex === 1) {
                                const bin = bins[context.dataIndex];
                                return `${bin.count} assets in this range`;
                            }
                            return null;
                        },
                        filter: (tooltipItem) => tooltipItem.datasetIndex === 0 || tooltipItem.datasetIndex === 1
                    }
                }
            },
            onClick: onClick,
            onHover: onHover
        }
    };
}

