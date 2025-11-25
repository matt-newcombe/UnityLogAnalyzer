// Asset mappings are loaded globally via asset-mappings.js in index.html

/**
 * Parser Utilities
 * Shared helper functions for log parsing.
 */

/**
 * Convert import_time_ms to seconds
 * @param {number} timeMs - Time in milliseconds
 * @returns {number} Time in seconds (rounded to 3 decimal places)
 */
export function convertImportTimeToSeconds(timeMs) {
    if (timeMs == null || isNaN(timeMs)) {
        return 0;
    }
    return Math.round((timeMs / 1000) * 1000) / 1000; // Round to 3 decimal places
}

/**
 * Get file extension from path
 */
export function getExtension(path) {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) return '';
    return path.substring(lastDot).toLowerCase();
}

/**
 * Get filename from path
 */
export function getFilename(path) {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash === -1 ? path : path.substring(lastSlash + 1);
}

/**
 * Extract importer type from raw importer string
 */
export function extractImporterType(importerRaw) {
    if (!importerRaw || typeof importerRaw !== 'string') {
        return null;
    }

    const trimmed = importerRaw.trim();

    // Match "Importer(...)" specifically
    const importerMatch = trimmed.match(/Importer\(([^)]+)\)/);
    if (importerMatch) {
        const importerValue = importerMatch[1];
        // If it's -1 or starts with -1, it's null/unknown importer
        if (importerValue.startsWith('-1') || importerValue === '-1') {
            return null;
        }
        // Extract the actual importer type (may be comma-separated)
        const parts = importerValue.split(',');
        const importerType = parts[0].trim();
        // If it's just a GUID or numeric, it's not a valid importer type
        if (/^[a-f0-9]+$/i.test(importerType) || /^-?\d+$/.test(importerType)) {
            return null;
        }
        return importerType;
    }

    // Fallback: if it's just in parentheses without "Importer" prefix
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        const importerType = trimmed.slice(1, -1);
        // Validate it's not a GUID or -1
        if (/^[a-f0-9]+$/i.test(importerType) || importerType === '-1' || /^-?\d+$/.test(importerType)) {
            return null;
        }
        return importerType;
    }

    return null;
}

/**
 * Categorize asset by file extension and importer type
 */
export function categorizeAsset(path, importerType = null) {
    const ext = getExtension(path);

    // Check if this is a folder (no extension)
    if (!ext || ext === '') {
        return { assetType: 'Folder', category: 'Folders' };
    }

    // Use global maps if available (should be loaded via script tags)
    const extMap = (typeof ASSET_EXT_DISPLAY_MAP !== 'undefined') ? ASSET_EXT_DISPLAY_MAP : {};
    const catMap = (typeof ASSET_CATEGORY_MAP !== 'undefined') ? ASSET_CATEGORY_MAP : {};

    const assetType = extMap[ext] || (ext || 'no-extension');
    let category = catMap[ext] || 'Other';

    // Override category if importer is TextureImporter
    if (importerType && importerType !== '-1' && importerType === 'TextureImporter') {
        category = 'Textures';
    }

    return { assetType, category };
}

/**
 * Check if asset path should be skipped
 */
export function shouldSkipAsset(assetPath, importerType = null) {
    const pathParts = assetPath.split('/');
    const lastPart = pathParts[pathParts.length - 1] || '';

    // Skip package folders
    if (lastPart.startsWith('com.') && pathParts.length <= 2) {
        return true;
    }

    return false;
}

/**
 * Calculate wall-to-wall time from timestamps
 */
export function calculateWallTime(startTimestamp, endTimestamp, explicitTimeSeconds) {
    const explicitTimeMs = explicitTimeSeconds * 1000;

    if (startTimestamp && endTimestamp) {
        const startTime = new Date(startTimestamp).getTime();
        const endTime = new Date(endTimestamp).getTime();
        const wallTimeMs = endTime - startTime;
        if (wallTimeMs > 0) {
            return {
                timeSeconds: wallTimeMs / 1000,
                timeMs: wallTimeMs
            };
        }
    }

    return {
        timeSeconds: explicitTimeSeconds,
        timeMs: explicitTimeMs
    };
}

/**
 * Fill in missing timestamps when one timestamp and duration are known
 */
export function fillMissingTimestamps(startTimestamp, endTimestamp, explicitTimeSeconds) {
    let calculatedStart = startTimestamp;
    let calculatedEnd = endTimestamp;

    if (!calculatedStart && calculatedEnd) {
        const endTime = new Date(calculatedEnd).getTime();
        calculatedStart = new Date(endTime - (explicitTimeSeconds * 1000)).toISOString();
    }

    if (!calculatedEnd && calculatedStart) {
        const startTime = new Date(calculatedStart).getTime();
        calculatedEnd = new Date(startTime + (explicitTimeSeconds * 1000)).toISOString();
    }

    return { startTimestamp: calculatedStart, endTimestamp: calculatedEnd };
}

/**
 * Create asset import object
 */
export function createAssetImport({
    logId,
    lineNumber,
    byteOffset = null,
    assetPath,
    guid,
    artifactId = null,
    importerType = null,
    timeSeconds,
    timeMs,
    startTimestamp = null,
    endTimestamp = null,
    isAnimation = false,
    workerThreadId = null
}) {
    // Infer importer type if missing
    if (!importerType) {
        const ext = getExtension(assetPath);
        const importerMap = (typeof ASSET_IMPORTER_MAP !== 'undefined') ? ASSET_IMPORTER_MAP : {};
        importerType = importerMap[ext] || null;
    }

    const assetName = getFilename(assetPath);
    let { assetType, category } = categorizeAsset(assetPath, importerType);

    // Override category to "3D Animation" if keyframe reduction was detected
    if (isAnimation && category === '3D Models') {
        category = '3D Animation';
    }

    // Calculate end timestamp if not provided
    if (!endTimestamp && startTimestamp) {
        const startTime = new Date(startTimestamp).getTime();
        if (!isNaN(startTime) && timeMs && !isNaN(timeMs)) {
            const endTime = startTime + timeMs;
            if (!isNaN(endTime)) {
                endTimestamp = new Date(endTime).toISOString();
            }
        }
    }

    // Calculate duration_ms
    let durationMs = timeMs;
    if (startTimestamp && endTimestamp) {
        const startTime = new Date(startTimestamp).getTime();
        const endTime = new Date(endTimestamp).getTime();
        const wallTimeMs = endTime - startTime;
        if (wallTimeMs > 0) {
            durationMs = wallTimeMs;
        }
    }

    return {
        line_number: lineNumber,
        byte_offset: byteOffset,
        asset_path: assetPath,
        asset_name: assetName,
        asset_type: assetType,
        asset_category: category,
        guid: guid,
        importer_type: importerType,
        import_time_ms: timeMs,
        duration_ms: durationMs,
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp,
        worker_thread_id: workerThreadId
    };
}
