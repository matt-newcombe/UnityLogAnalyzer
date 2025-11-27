/**
 * AppContext
 * Centralized service registry to reduce window.* globals
 * 
 * Usage:
 *   // Register a service
 *   appContext.register('apiClient', new ApiClient());
 *   
 *   // Get a service
 *   const api = appContext.get('apiClient');
 *   
 *   // Check if service exists
 *   if (appContext.has('apiClient')) { ... }
 */

class AppContext {
    constructor() {
        this._services = new Map();
        this._initialized = false;
    }

    /**
     * Register a service
     * @param {string} name - Service name
     * @param {*} service - Service instance
     * @returns {AppContext} - For chaining
     */
    register(name, service) {
        if (this._services.has(name)) {
            console.warn(`[AppContext] Service '${name}' is being overwritten`);
        }
        this._services.set(name, service);
        return this;
    }

    /**
     * Get a service
     * @param {string} name - Service name
     * @returns {*} Service instance or undefined
     */
    get(name) {
        if (!this._services.has(name)) {
            console.warn(`[AppContext] Service '${name}' not found`);
            return undefined;
        }
        return this._services.get(name);
    }

    /**
     * Check if a service exists
     * @param {string} name - Service name
     * @returns {boolean}
     */
    has(name) {
        return this._services.has(name);
    }

    /**
     * Remove a service
     * @param {string} name - Service name
     * @returns {boolean} - True if service was removed
     */
    remove(name) {
        return this._services.delete(name);
    }

    /**
     * Get all registered service names
     * @returns {string[]}
     */
    getServiceNames() {
        return Array.from(this._services.keys());
    }

    /**
     * Mark context as initialized
     */
    markInitialized() {
        this._initialized = true;
    }

    /**
     * Check if context is initialized
     */
    isInitialized() {
        return this._initialized;
    }

    /**
     * Clear all services (useful for testing)
     */
    clear() {
        this._services.clear();
        this._initialized = false;
    }
}

// Create singleton instance
const appContext = new AppContext();

// Export to window for global access (during transition period)
window.appContext = appContext;

// Also export the class for testing
window.AppContext = AppContext;


