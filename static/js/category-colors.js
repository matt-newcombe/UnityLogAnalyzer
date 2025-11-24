/**
 * Centralized category color definitions
 * Used across timeline visualization, charts, and worker thread rendering
 */

/**
 * Category chart colors - distinct colors for asset categories
 * Top colors are more distinct to avoid similar bluey-purple shades
 */
const CATEGORY_CHART_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
    '#EC7063', '#5DADE2', '#F1948A', '#82E0AA', '#F4D03F'
];

/**
 * Build category color map from category data
 * Categories should be sorted by total time (descending) to match chart order
 * @param {Array} categoryData - Array of category objects with asset_category/category and total_time
 * @returns {Object} Map of category name to color
 */
function buildCategoryColorMap(categoryData) {
    const categoryColorMap = {};
    
    if (categoryData && categoryData.length > 0) {
        // Use the exact same order and colors as the category chart
        categoryData.forEach((category, index) => {
            const categoryName = category.asset_category || category.category || 'Other';
            categoryColorMap[categoryName] = CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length];
        });
    }
    
    return categoryColorMap;
}

/**
 * Build category color map from segments/imports
 * Calculates total time per category and sorts by time (descending)
 * @param {Array} items - Array of segments or imports with category and duration_ms/import_time_ms
 * @returns {Object} Map of category name to color
 */
function buildCategoryColorMapFromItems(items) {
    // Calculate total time per category
    const categoryTimes = {};
    items.forEach(item => {
        const category = item.asset_category || item.category || 'Other';
        if (!categoryTimes[category]) {
            categoryTimes[category] = 0;
        }
        categoryTimes[category] += (item.duration_ms || item.import_time_ms || 0);
    });

    // Sort categories by total time (descending)
    const sortedCategories = Object.keys(categoryTimes).sort((a, b) => {
        return categoryTimes[b] - categoryTimes[a];
    });

    // Assign colors to categories in the same order
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
function getCategoryColor(category, categoryColorMap) {
    if (categoryColorMap && categoryColorMap[category]) {
        return categoryColorMap[category];
    }
    // Fallback to gray for unknown categories
    return '#999999';
}

// Export to window for use in non-module scripts
window.CategoryColors = {
    CATEGORY_CHART_COLORS,
    buildCategoryColorMap,
    buildCategoryColorMapFromItems,
    getCategoryColor
};
