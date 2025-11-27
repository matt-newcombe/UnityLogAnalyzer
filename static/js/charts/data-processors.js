/**
 * Chart Data Processors Module
 * Functions to process raw data for chart display
 */

/**
 * Process standard deviation data for histogram visualization
 * @param {Array} assets - Array of asset objects
 * @returns {Object} Processed data including stats, bins, and normal curve
 */
export function processStdDevData(assets) {
    const times = assets.map(asset => asset.import_time_ms / 1000);
    const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
    const variance = times.reduce((sum, time) => sum + Math.pow(time - mean, 2), 0) / times.length;
    const stdDev = Math.sqrt(variance);
    const totalTime = times.reduce((sum, time) => sum + time, 0);

    // Create histogram bins
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const binCount = Math.min(30, Math.max(10, Math.floor(Math.sqrt(assets.length))));
    const binWidth = (maxTime - minTime) / binCount || 0.001;

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

    // Calculate normal distribution curve
    const normalCurve = bins.map(bin => {
        const x = bin.center;
        const z = (x - mean) / stdDev;
        const pdf = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z);
        return pdf * assets.length * binWidth;
    });

    return {
        stats: {
            count: assets.length,
            totalTime: totalTime,
            mean: mean,
            stdDev: stdDev
        },
        bins: bins,
        normalCurve: normalCurve
    };
}

/**
 * Process folder data for chart display
 * @param {Array} folders - Array of folder objects
 * @param {number} limit - Maximum number of folders to include
 * @returns {Object} Processed data with labels and values
 */
export function processFolderData(folders, limit = 6) {
    const topFolders = folders.slice(0, limit);
    return {
        labels: topFolders.map(f => f.folder.split('/').slice(-2).join('/')),
        data: topFolders.map(f => (f.total_time_ms / 1000).toFixed(2)),
        folders: topFolders
    };
}

/**
 * Process importer data for chart display
 * @param {Array} importers - Array of importer objects
 * @param {number} limit - Maximum number of importers to include
 * @returns {Object} Processed data with labels and values
 */
export function processImporterData(importers, limit = 10) {
    const topImporters = importers.slice(0, limit);
    return {
        labels: topImporters.map(i => i.importer_type || 'Unknown'),
        data: topImporters.map(i => (i.total_time / 1000).toFixed(2)),
        importers: topImporters
    };
}

/**
 * Process category data for chart display
 * @param {Array} categories - Array of category objects
 * @param {number} limit - Maximum number of categories to include
 * @returns {Object} Processed data with labels and values
 */
export function processCategoryData(categories, limit = 15) {
    const topCategories = categories.slice(0, limit);
    return {
        labels: topCategories.map(c => c.asset_category || 'Unknown'),
        data: topCategories.map(c => (c.total_time / 1000).toFixed(2)),
        categories: topCategories
    };
}

/**
 * Process operations data for chart display
 * @param {Array} operations - Array of operation objects
 * @returns {Object} Processed data with labels and values
 */
export function processOperationsData(operations) {
    const labels = [];
    const values = [];

    operations.forEach(op => {
        if (op.total_time_ms > 0) {
            labels.push(op.type);
            values.push((op.total_time_ms / 1000).toFixed(2));
        }
    });

    return { labels, values, operations };
}

