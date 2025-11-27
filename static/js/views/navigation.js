/**
 * Navigation Module
 * Handles navigation between dashboard views
 */

import { setCurrentView, setCurrentFilter, setStdDevViewState } from '../core/state.js';
import { displayAssetsTable, displayAssetsTableProgressive } from '../components/tables/assets-table.js';
import { displayFolderAnalysisTable } from '../components/tables/folder-table.js';
import { displayModeTimeTable } from '../components/tables/mode-time-table.js';
import { displayOperationsTable } from '../components/tables/operations-table.js';
import { loadSlowestAssets } from '../components/tables/slowest-assets-table.js';
import { loadStdDevView, loadAssetsByType } from '../charts/chart-loaders.js';
import { loadOverview } from './overview.js';

/**
 * Load category detail view
 * @param {string} category - Category name
 */
export async function loadCategoryDetail(category) {
    try {
        setCurrentView('category');
        setCurrentFilter(category);

        const assets = await window.apiClient.getAssetsByCategory(category);
        displayAssetsTable(assets, `${category} Assets`);
    } catch (error) {
        console.error('Failed to load category detail:', error);
        if (typeof showError === 'function') {
            showError('Failed to load category: ' + error.message);
        }
    }
}

/**
 * Load type detail view
 * @param {string} assetType - Asset type
 */
export async function loadTypeDetail(assetType) {
    try {
        setCurrentView('type');
        setCurrentFilter(assetType);

        await displayAssetsTableProgressive(assetType, `${assetType} Assets`);
    } catch (error) {
        console.error('Failed to load type detail:', error);
        if (typeof showError === 'function') {
            showError('Failed to load type: ' + error.message);
        }
    }
}

/**
 * Load all assets view
 */
export async function loadAllAssets() {
    try {
        setCurrentView('all-assets');
        setCurrentFilter(null);

        const assets = await window.apiClient.getAssets();
        displayAssetsTable(assets, 'All Assets');
    } catch (error) {
        console.error('Failed to load all assets:', error);
        if (typeof showError === 'function') {
            showError('Failed to load assets: ' + error.message);
        }
    }
}

/**
 * Load folder analysis view
 */
export async function loadFolderAnalysis() {
    try {
        setCurrentView('folders');
        setCurrentFilter(null);

        const folders = await window.apiClient.getFolderAnalysis();
        displayFolderAnalysisTable(folders, 'Folder Analysis');
    } catch (error) {
        console.error('Failed to load folder analysis:', error);
        if (typeof showError === 'function') {
            showError('Failed to load folder analysis: ' + error.message);
        }
    }
}

/**
 * Load folder assets view
 * @param {string} folderPath - Folder path
 */
export async function loadFolderAssets(folderPath) {
    try {
        setCurrentView('folder-assets');
        setCurrentFilter(folderPath);

        const assets = await window.apiClient.getAssetsByFolder(folderPath);
        displayAssetsTable(assets, `Assets in ${folderPath}`);
    } catch (error) {
        console.error('Failed to load folder assets:', error);
        if (typeof showError === 'function') {
            showError('Failed to load folder assets: ' + error.message);
        }
    }
}

/**
 * Load importer detail view
 * @param {string} importerType - Importer type
 */
export async function loadImporterDetail(importerType) {
    try {
        setCurrentView('importer');
        setCurrentFilter(importerType);

        const assets = await window.apiClient.getAssetsByImporter(importerType);
        displayAssetsTable(assets, `${importerType} Assets`);
    } catch (error) {
        console.error('Failed to load importer detail:', error);
        if (typeof showError === 'function') {
            showError('Failed to load importer: ' + error.message);
        }
    }
}

/**
 * Load operations by type view
 * @param {string} operationType - Operation type
 */
export async function loadOperationsByType(operationType) {
    try {
        setCurrentView('operations');
        setCurrentFilter(operationType);

        const operations = await window.apiClient.getProcessesByType(operationType);
        displayOperationsTable(operations, `${operationType} Operations`);
    } catch (error) {
        console.error('Failed to load operations:', error);
        if (typeof showError === 'function') {
            showError('Failed to load operations: ' + error.message);
        }
    }
}

/**
 * Navigate back to overview
 */
export function navigateToOverview() {
    setCurrentView('overview');
    setCurrentFilter(null);
    setStdDevViewState(null);

    // Clear tables
    const tablesDiv = document.getElementById('tables');
    if (tablesDiv) tablesDiv.innerHTML = '';

    loadOverview();
}

