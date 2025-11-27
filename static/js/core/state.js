/**
 * Dashboard State Management
 * Centralized state for the Unity Log Analyzer dashboard
 */

// Global state variables
let currentLogId = 1;
let currentView = 'overview';
let stdDevViewState = null;
let currentFilter = null;

/**
 * Get the current log ID
 * @returns {number} Current log ID
 */
export function getCurrentLogId() {
    return currentLogId;
}

/**
 * Set the current log ID
 * @param {number} id - Log ID to set
 */
export function setCurrentLogId(id) {
    currentLogId = id;
}

/**
 * Get the current view name
 * @returns {string} Current view name
 */
export function getCurrentView() {
    return currentView;
}

/**
 * Set the current view name
 * @param {string} view - View name to set
 */
export function setCurrentView(view) {
    currentView = view;
}

/**
 * Get the current filter
 * @returns {string|null} Current filter
 */
export function getCurrentFilter() {
    return currentFilter;
}

/**
 * Set the current filter
 * @param {string|null} filter - Filter to set
 */
export function setCurrentFilter(filter) {
    currentFilter = filter;
}

/**
 * Get the standard deviation view state
 * @returns {object|null} Current stdDev view state
 */
export function getStdDevViewState() {
    return stdDevViewState;
}

/**
 * Set the standard deviation view state
 * @param {object|null} state - State to set
 */
export function setStdDevViewState(state) {
    stdDevViewState = state;
}

/**
 * Check if we're in overview mode
 * @returns {boolean} True if in overview
 */
export function isOverview() {
    return currentView === 'overview';
}

/**
 * Reset state to default (overview)
 */
export function resetState() {
    currentView = 'overview';
    currentFilter = null;
    stdDevViewState = null;
}

