/**
 * Module Registry
 * Central registry for all window exports - single source of truth for backward compatibility.
 * 
 * This file:
 * - Imports from all ES modules that need global exposure
 * - Registers everything to window in one place
 * - Makes it easy to see what's globally available
 * - Enables future cleanup by identifying unused globals
 */

// ============================================================================
// IMPORTS - All modules that export functions needing global access
// ============================================================================

// Core
import * as state from './state.js';
import * as formatters from './formatters.js';
import * as domUtils from './dom-utils.js';

// Charts
import * as baseChart from '../charts/base-chart.js';
import * as chartLoaders from '../charts/chart-loaders.js';
import * as dataProcessors from '../charts/data-processors.js';

// Views
import * as navigation from '../views/navigation.js';
import * as overview from '../views/overview.js';

// Components - Timeline
import * as timelineIndex from '../components/timeline/index.js';
import * as timelineRenderer from '../components/timeline/renderer.js';
import * as timelineTooltip from '../components/timeline/tooltip.js';

// Components - Tables
import * as assetsTable from '../components/tables/assets-table.js';
import * as contextMenu from '../components/tables/context-menu.js';
import * as folderTable from '../components/tables/folder-table.js';
import * as modeTimeTable from '../components/tables/mode-time-table.js';
import * as operationsTable from '../components/tables/operations-table.js';
import * as pipelineTable from '../components/tables/pipeline-table.js';
import * as slowestAssetsTable from '../components/tables/slowest-assets-table.js';

// ============================================================================
// REGISTER ALL GLOBALS
// ============================================================================

export function registerAllGlobals() {
    Object.assign(window, {
        // --------------------------------------------------------------------
        // Core - State Management
        // --------------------------------------------------------------------
        getCurrentLogId: state.getCurrentLogId,
        setCurrentLogId: state.setCurrentLogId,
        getCurrentView: state.getCurrentView,
        setCurrentView: state.setCurrentView,
        getCurrentFilter: state.getCurrentFilter,
        setCurrentFilter: state.setCurrentFilter,
        getStdDevViewState: state.getStdDevViewState,
        setStdDevViewState: state.setStdDevViewState,
        isOverview: state.isOverview,
        resetState: state.resetState,

        // --------------------------------------------------------------------
        // Core - Formatters
        // --------------------------------------------------------------------
        formatTime: formatters.formatTime,
        formatTimeRemaining: formatters.formatTimeRemaining,
        escapeHtml: formatters.escapeHtml,
        formatTimestamp: formatters.formatTimestamp,
        formatBytes: formatters.formatBytes,

        // --------------------------------------------------------------------
        // Core - DOM Utils
        // --------------------------------------------------------------------
        DOMUtils: domUtils.DOMUtils,
        showToast: domUtils.showToast,

        // --------------------------------------------------------------------
        // Charts - Base
        // --------------------------------------------------------------------
        BaseChart: baseChart.BaseChart,
        destroyChart: baseChart.destroyChart,
        showChart: baseChart.showChart,
        createPieChart: baseChart.createPieChart,

        // --------------------------------------------------------------------
        // Charts - Loaders
        // --------------------------------------------------------------------
        loadFoldersChart: chartLoaders.loadFoldersChart,
        loadImporterChart: chartLoaders.loadImporterChart,
        loadCategoryChart: chartLoaders.loadCategoryChart,
        loadPipelineBreakdown: chartLoaders.loadPipelineBreakdown,
        loadStdDevView: chartLoaders.loadStdDevView,
        loadAssetsByType: chartLoaders.loadAssetsByType,

        // --------------------------------------------------------------------
        // Charts - Data Processors
        // --------------------------------------------------------------------
        processStdDevData: dataProcessors.processStdDevData,
        processFolderData: dataProcessors.processFolderData,
        processImporterData: dataProcessors.processImporterData,
        processCategoryData: dataProcessors.processCategoryData,
        processOperationsData: dataProcessors.processOperationsData,

        // --------------------------------------------------------------------
        // Views - Navigation
        // --------------------------------------------------------------------
        loadCategoryDetail: navigation.loadCategoryDetail,
        loadTypeDetail: navigation.loadTypeDetail,
        loadAllAssets: navigation.loadAllAssets,
        loadFolderAnalysis: navigation.loadFolderAnalysis,
        loadFolderAssets: navigation.loadFolderAssets,
        loadImporterDetail: navigation.loadImporterDetail,
        loadOperationsByType: navigation.loadOperationsByType,
        navigateToOverview: navigation.navigateToOverview,

        // --------------------------------------------------------------------
        // Views - Overview
        // --------------------------------------------------------------------
        showEmptyState: overview.showEmptyState,
        loadOverview: overview.loadOverview,
        displayStats: overview.displayStats,
        displayCharts: overview.displayCharts,
        updateChartsIncremental: overview.updateChartsIncremental,
        updateStatsIncremental: overview.updateStatsIncremental,
        showTimestampWarningDialog: overview.showTimestampWarningDialog,

        // --------------------------------------------------------------------
        // Components - Timeline
        // --------------------------------------------------------------------
        displayTimeline: timelineIndex.displayTimeline,
        navigateToLogLine: timelineIndex.navigateToLogLine,
        renderTimelineVisualization: timelineRenderer.renderTimelineVisualization,
        drawConnectingLines: timelineRenderer.drawConnectingLines,
        showTimelineTooltip: timelineTooltip.showTimelineTooltip,
        hideTimelineTooltip: timelineTooltip.hideTimelineTooltip,

        // --------------------------------------------------------------------
        // Components - Tables
        // --------------------------------------------------------------------
        displayAssetsTableProgressive: assetsTable.displayAssetsTableProgressive,
        displayAssetsTable: assetsTable.displayAssetsTable,
        renderAssetRows: assetsTable.renderAssetRows,
        setupAssetTableScroll: assetsTable.setupAssetTableScroll,
        setupAssetTableContextMenus: assetsTable.setupAssetTableContextMenus,
        restoreStdDevView: assetsTable.restoreStdDevView,

        showContextMenu: contextMenu.showContextMenu,
        hideContextMenu: contextMenu.hideContextMenu,
        copyToClipboard: contextMenu.copyToClipboard,
        setupTableContextMenus: contextMenu.setupTableContextMenus,

        displayFolderAnalysisTable: folderTable.displayFolderAnalysisTable,
        displayModeTimeTable: modeTimeTable.displayModeTimeTable,
        displayOperationsTable: operationsTable.displayOperationsTable,
        displayPipelineTable: pipelineTable.displayPipelineTable,
        loadSlowestAssets: slowestAssetsTable.loadSlowestAssets,
    });

    // Initialize chartInstances if not already set
    window.chartInstances = window.chartInstances || {};
}

// Auto-register when this module loads
registerAllGlobals();
