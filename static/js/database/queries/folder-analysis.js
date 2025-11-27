/**
 * Folder Analysis Query
 * Analyzes asset imports grouped by folder path.
 */

class FolderAnalysisQuery {
    constructor(db) {
        this.db = db;
    }

    /**
     * Analyze assets grouped by folder
     * Groups assets into folders up to 4 levels deep
     * @returns {Promise<Array>} Sorted array of folder statistics
     */
    async analyze() {
        const assets = await this.db.asset_imports.toArray();

        const folderStats = {};

        for (const asset of assets) {
            const folder = this._extractFolder(asset.asset_path);
            
            if (!folderStats[folder]) {
                folderStats[folder] = {
                    folder: folder,
                    total_time_ms: 0,
                    asset_count: 0,
                    assets: []
                };
            }

            const timeMs = asset.import_time_ms || 0;
            folderStats[folder].total_time_ms += timeMs;
            folderStats[folder].asset_count++;
            folderStats[folder].assets.push({
                path: asset.asset_path,
                time_ms: timeMs
            });
        }

        // Convert to array, calculate averages, sort assets, and limit
        return Object.values(folderStats)
            .map(folder => ({
                folder: folder.folder,
                total_time_ms: folder.total_time_ms,
                asset_count: folder.asset_count,
                avg_time_ms: folder.total_time_ms / folder.asset_count,
                assets: folder.assets
                    .sort((a, b) => b.time_ms - a.time_ms)
                    .slice(0, 5) // Top 5 slowest assets per folder
            }))
            .sort((a, b) => b.total_time_ms - a.total_time_ms);
    }

    /**
     * Extract folder path from asset path (up to 4 levels)
     * @param {string} path - Full asset path
     * @returns {string} Folder path
     */
    _extractFolder(path) {
        if (!path) return 'Root';
        
        const parts = path.split('/');
        
        if (parts.length >= 4) {
            return parts.slice(0, 4).join('/');
        } else if (parts.length >= 3) {
            return parts.slice(0, 3).join('/');
        } else if (parts.length >= 2) {
            return parts.slice(0, 2).join('/');
        }
        
        return parts[0] || 'Root';
    }
}

// Export for use in other modules
window.FolderAnalysisQuery = FolderAnalysisQuery;

