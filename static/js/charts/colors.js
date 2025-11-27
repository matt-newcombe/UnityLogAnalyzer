/**
 * Chart Colors Module
 * Centralized color definitions for charts
 */

/**
 * Default color palette for pie/doughnut charts
 */
export const PIE_CHART_COLORS = [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
    '#9966FF', '#FF9F40', '#E7E9ED', '#8E5EA2',
    '#3cba9f', '#e8c3b9', '#c45850', '#95d5b2',
    '#ffd6a5', '#caffbf', '#fdffb6'
];

/**
 * Category chart colors - distinct colors for asset categories
 */
export const CATEGORY_CHART_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
    '#EC7063', '#5DADE2', '#F1948A', '#82E0AA', '#F4D03F'
];

/**
 * Operations chart colors
 */
export const OPERATIONS_CHART_COLORS = [
    '#9966FF', '#FF9F40', '#4CAF50', '#2196F3',
    '#F44336', '#9C27B0', '#00BCD4', '#FFC107',
    '#795548', '#607D8B'
];

/**
 * Build category color map from category data
 * @param {Array} categoryData - Array of category objects
 * @returns {Object} Map of category name to color
 */
export function buildCategoryColorMap(categoryData) {
    const categoryColorMap = {};

    if (categoryData && categoryData.length > 0) {
        categoryData.forEach((category, index) => {
            const categoryName = category.asset_category || category.category || 'Other';
            categoryColorMap[categoryName] = CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length];
        });
    }

    return categoryColorMap;
}

/**
 * Build category color map from segments/imports
 * @param {Array} items - Array of segments or imports
 * @returns {Object} Map of category name to color
 */
export function buildCategoryColorMapFromItems(items) {
    const categoryTimes = {};
    items.forEach(item => {
        const category = item.asset_category || item.category || 'Other';
        if (!categoryTimes[category]) {
            categoryTimes[category] = 0;
        }
        categoryTimes[category] += (item.duration_ms || item.import_time_ms || 0);
    });

    const sortedCategories = Object.keys(categoryTimes).sort((a, b) => {
        return categoryTimes[b] - categoryTimes[a];
    });

    const categoryColorMap = {};
    sortedCategories.forEach((category, index) => {
        categoryColorMap[category] = CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length];
    });

    return categoryColorMap;
}

/**
 * Get color for a specific category
 * @param {string} category - Category name
 * @param {Object} categoryColorMap - Map of category to color
 * @returns {string} Color hex code
 */
export function getCategoryColor(category, categoryColorMap) {
    if (categoryColorMap && categoryColorMap[category]) {
        return categoryColorMap[category];
    }
    return '#999999';
}

