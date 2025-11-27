/**
 * Chart Formatters Module
 * Tooltip and data label formatters for charts
 */

import { formatTime } from '../core/formatters.js';

/**
 * Create a tooltip formatter for time-based data
 * @param {Array} dataArray - Optional array of data objects for context
 * @returns {Function} Tooltip formatter function
 */
export function createTimeTooltipFormatter(dataArray = null) {
    return (context) => {
        const label = context.label || '';
        const value = parseFloat(context.parsed);
        const total = context.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
        const percentage = ((value / total) * 100).toFixed(1);
        return label + ': ' + formatTime(value) + ' (' + percentage + '%)';
    };
}

/**
 * Create a data label formatter for time-based data
 * @param {number} threshold - Minimum percentage to show label (default: 5)
 * @returns {Function} Data label formatter function
 */
export function createTimeLabelFormatter(threshold = 5) {
    return (value, ctx) => {
        const total = ctx.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
        const percentage = ((value / total) * 100);
        if (percentage > threshold) {
            return formatTime(parseFloat(value));
        }
        return '';
    };
}

/**
 * Create a tooltip formatter for folder data
 * @param {Array} folders - Array of folder objects
 * @returns {Function} Tooltip formatter function
 */
export function createFolderTooltipFormatter(folders) {
    return (context) => {
        const folder = folders[context.dataIndex];
        return [
            `Path: ${folder.folder}`,
            `Time: ${formatTime(folder.total_time_ms / 1000)}`,
            `Assets: ${folder.asset_count}`
        ];
    };
}

/**
 * Create a tooltip formatter for importer data
 * @param {Array} importers - Array of importer objects
 * @returns {Function} Tooltip formatter function
 */
export function createImporterTooltipFormatter(importers) {
    return (context) => {
        const importer = importers[context.dataIndex];
        return [
            `Total: ${formatTime(importer.total_time / 1000)}`,
            `Count: ${importer.count} assets`,
            `Avg: ${formatTime(importer.avg_time / 1000)}`
        ];
    };
}

/**
 * Create a tooltip formatter for category data with count
 * @param {Array} categories - Array of category objects
 * @returns {Function} Tooltip formatter function
 */
export function createCategoryTooltipFormatter(categories) {
    return (context) => {
        const value = parseFloat(context.parsed);
        const total = context.dataset.data.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
        const percentage = ((value / total) * 100).toFixed(1);
        const count = categories[context.dataIndex]?.count || 0;
        return [
            formatTime(value) + ' (' + percentage + '%)',
            count + ' assets'
        ];
    };
}

