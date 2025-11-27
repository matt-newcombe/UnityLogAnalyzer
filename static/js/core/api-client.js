/**
 * API Client for Unity Log Analyzer
 * Handles all data access using IndexedDB via Dexie.js
 */

class APIClient {
    constructor() {
        this.currentLogId = 1;
        this.db = null;
    }

    /**
     * Get the current database instance
     * Always gets the latest database version to ensure we're using the most recent database
     */
    async getDatabase() {
        // Always get a fresh database instance to ensure we're using the latest version
        // This is important when a new log file is parsed and a new database is created
        const currentVersion = getCurrentDbVersion();
        
        // If we have a cached database, check if it's still the current version
        if (this.db && this.db.version === currentVersion) {
            // Same version, reuse it
            return this.db;
        }
        
        // Need to get a new database instance (either first time or version changed)
        if (this.db) {
            // Close old database before creating new one
            try {
                await this.db.close();
            } catch (e) {
                // Ignore errors when closing
            }
        }
        
        // Get the current database (which will use the latest version from localStorage)
        this.db = await getCurrentDatabase();
        await this.db.open();
        return this.db;
    }

    /**
     * Set the current log ID
     */
    setCurrentLogId(logId) {
        this.currentLogId = logId;
    }

    /**
     * Get the current log ID
     */
    getCurrentLogId() {
        return this.currentLogId;
    }

    // Convenience methods for common endpoints
    async getLogs() {
        try {
            const db = await this.getDatabase();
            return await db.getLogs();
        } catch (error) {
            console.error('Error getting logs:', error);
            // Return empty array if database doesn't exist yet
            return [];
        }
    }

    async getSummary() {
        try {
            const db = await this.getDatabase();
            return await db.getSummary(this.currentLogId);
        } catch (error) {
            console.error('Error getting summary:', error);
            throw error;
        }
    }

    async getTimeline() {
        try {
            // Force a fresh database connection to ensure we get the latest data
            this.db = null;
            const db = await this.getDatabase();
            return await db.getTimeline(this.currentLogId);
        } catch (error) {
            console.error('Error getting timeline:', error);
            throw error;
        }
    }

    async getAssets() {
        try {
            const db = await this.getDatabase();
            return await db.getAssets(this.currentLogId);
        } catch (error) {
            console.error('Error getting assets:', error);
            throw error;
        }
    }

    async getAssetsByType(type) {
        try {
            const db = await this.getDatabase();
            return await db.getAssetsByType(this.currentLogId, type);
        } catch (error) {
            console.error('Error getting assets by type:', error);
            throw error;
        }
    }

    async getAssetsByCategory(category) {
        try {
            const db = await this.getDatabase();
            return await db.getAssetsByCategory(this.currentLogId, category);
        } catch (error) {
            console.error('Error getting assets by category:', error);
            throw error;
        }
    }

    async getAssetsByImporter(importer) {
        try {
            const db = await this.getDatabase();
            return await db.getAssetsByImporter(this.currentLogId, importer);
        } catch (error) {
            console.error('Error getting assets by importer:', error);
            throw error;
        }
    }

    async getFolderAnalysis() {
        try {
            const db = await this.getDatabase();
            return await db.getFolderAnalysis(this.currentLogId);
        } catch (error) {
            console.error('Error getting folder analysis:', error);
            throw error;
        }
    }

    async getAssetsByFolder(folderPath) {
        try {
            const db = await this.getDatabase();
            return await db.getAssetsByFolder(this.currentLogId, folderPath);
        } catch (error) {
            console.error('Error getting assets by folder:', error);
            throw error;
        }
    }

    async getProcessesBreakdown() {
        try {
            const db = await this.getDatabase();
            return await db.getProcessesBreakdown(this.currentLogId);
        } catch (error) {
            console.error('Error getting operations breakdown:', error);
            throw error;
        }
    }

    async getProcessesByType(processType) {
        try {
            const db = await this.getDatabase();
            return await db.getProcessesByType(processType, this.currentLogId);
        } catch (error) {
            console.error('Error getting operations by type:', error);
            throw error;
        }
    }

    async getPipelineRefreshes() {
        try {
            const db = await this.getDatabase();
            return await db.getPipelineRefreshes(this.currentLogId);
        } catch (error) {
            console.error('Error getting pipeline refreshes:', error);
            throw error;
        }
    }


    async getLogViewer(options = {}) {
        try {
            const db = await this.getDatabase();
            return await db.getLogLines(this.currentLogId, options);
        } catch (error) {
            console.error('Error getting log viewer data:', error);
            throw error;
        }
    }

    async getTopSlowest(limit = 20) {
        try {
            const db = await this.getDatabase();
            return await db.getTopSlowest(this.currentLogId, limit);
        } catch (error) {
            console.error('Error getting top slowest:', error);
            throw error;
        }
    }

}

// Create global instance and register with AppContext
const apiClientInstance = new APIClient();

// Register with AppContext (preferred way)
if (window.appContext) {
    window.appContext.register('apiClient', apiClientInstance);
}

// Also export to window for backward compatibility
window.apiClient = apiClientInstance;
window.APIClient = APIClient;

