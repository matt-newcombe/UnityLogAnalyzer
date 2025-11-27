/**
 * Asset Queries
 * Handles all asset import related database queries.
 * Uses compound indexes for efficient sorted queries.
 */

class AssetQueries {
    constructor(db) {
        this.db = db;
    }

    /**
     * Get all assets sorted by import time
     */
    async getAll() {
        const assets = await this.db.asset_imports.toArray();
        return assets.sort((a, b) => (a.import_time_ms || 0) - (b.import_time_ms || 0));
    }

    /**
     * Get assets by category using compound index
     * @param {string} category - Asset category to filter by
     */
    async getByCategory(category) {
        return await this.db.asset_imports
            .where('[asset_category+import_time_ms]')
            .between([category, Dexie.minKey], [category, Dexie.maxKey])
            .toArray();
    }

    /**
     * Get assets by type using compound index
     * @param {string} assetType - Asset type to filter by
     * @param {number|null} limit - Optional limit for pagination
     */
    async getByType(assetType, limit = null) {
        let query = this.db.asset_imports
            .where('[asset_type+import_time_ms]')
            .between([assetType, Dexie.minKey], [assetType, Dexie.maxKey]);

        if (limit !== null && limit > 0) {
            return await query.limit(limit).toArray();
        }

        return await query.toArray();
    }

    /**
     * Get assets by type with progressive loading
     * Yields batches via callback for responsive UI
     * @param {string} assetType - Asset type to filter by
     * @param {Function} batchCallback - Called with each batch
     * @param {number} batchSize - Size of each batch
     */
    async getByTypeProgressive(assetType, batchCallback, batchSize = 200) {
        // Count total for progress tracking
        let totalCount = 0;
        await this.db.asset_imports
            .where('[asset_type+import_time_ms]')
            .between([assetType, Dexie.minKey], [assetType, Dexie.maxKey])
            .each(() => { totalCount++; });

        let offset = 0;
        const allAssets = [];

        while (offset < totalCount) {
            const batch = await this.db.asset_imports
                .where('[asset_type+import_time_ms]')
                .between([assetType, Dexie.minKey], [assetType, Dexie.maxKey])
                .offset(offset)
                .limit(batchSize)
                .toArray();

            if (batch.length === 0) break;

            allAssets.push(...batch);
            const isLast = (offset + batch.length) >= totalCount;

            await batchCallback(batch, offset, totalCount, isLast);

            offset += batch.length;

            // Yield to event loop for UI responsiveness
            if (!isLast) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return allAssets;
    }

    /**
     * Get count of assets by type
     * @param {string} assetType - Asset type to count
     */
    async getCountByType(assetType) {
        let count = 0;
        await this.db.asset_imports
            .where('[asset_type+import_time_ms]')
            .between([assetType, Dexie.minKey], [assetType, Dexie.maxKey])
            .each(() => { count++; });
        return count;
    }

    /**
     * Get assets by importer type using compound index
     * @param {string} importerType - Importer type to filter by
     */
    async getByImporter(importerType) {
        return await this.db.asset_imports
            .where('[importer_type+import_time_ms]')
            .between([importerType, Dexie.minKey], [importerType, Dexie.maxKey])
            .toArray();
    }

    /**
     * Get top N slowest assets
     * @param {number} limit - Number of assets to return
     */
    async getTopSlowest(limit = 20) {
        const assets = await this.db.asset_imports.toArray();
        return assets
            .sort((a, b) => (b.import_time_ms || 0) - (a.import_time_ms || 0))
            .slice(0, limit);
    }

    /**
     * Get worker thread imports grouped by thread ID
     */
    async getWorkerThreadImports() {
        const workerImports = await this.db.asset_imports
            .filter(asset => asset.worker_thread_id !== null && asset.worker_thread_id !== undefined)
            .toArray();

        const workerThreads = {};
        
        for (const asset of workerImports) {
            const workerId = asset.worker_thread_id;
            if (!workerThreads[workerId]) {
                workerThreads[workerId] = [];
            }
            workerThreads[workerId].push(asset);
        }

        // Sort each worker's operations by start_timestamp
        for (const workerId of Object.keys(workerThreads)) {
            workerThreads[workerId].sort((a, b) => {
                const aTime = a.start_timestamp ? new Date(a.start_timestamp).getTime() : 0;
                const bTime = b.start_timestamp ? new Date(b.start_timestamp).getTime() : 0;
                return aTime - bTime;
            });
        }

        return { workerThreads };
    }
}

// Export for use in other modules
window.AssetQueries = AssetQueries;

