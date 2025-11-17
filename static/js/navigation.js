/**
 * Navigation Module
 * Handles navigation between different views and detail pages
 */

        // Breadcrumb functionality removed - redundant with page content


        async function loadCategoryDetail(category) {
            setCurrentView('category');
            currentFilter = category;
            
            showLoading();
            
            try {
                const assets = await window.apiClient.getAssetsByCategory(category);
                
                hideLoading();
                
                displayAssetsTable(assets, `${category} Assets`);
            } catch (error) {
                showError('Failed to load category detail: ' + error.message);
            }
        }


        async function loadTypeDetail(type) {
            setCurrentView('type');
            currentFilter = type;
            
            showLoading();
            
            try {
                const assets = await window.apiClient.getAssetsByType(type);
                
                hideLoading();
                
                displayAssetsTable(assets, `${type} Assets`);
            } catch (error) {
                showError('Failed to load type detail: ' + error.message);
            }
        }


        async function loadAllAssets() {
            setCurrentView('all_assets');
            currentFilter = 'All Assets';
            
            showLoading();
            
            try {
                const assets = await window.apiClient.getAssets();
                
                hideLoading();
                
                displayAssetsTable(assets, 'All Assets');
            } catch (error) {
                showError('Failed to load all assets: ' + error.message);
            }
        }


        async function loadFolderAnalysis() {
            setCurrentView('folder_analysis');
            currentFilter = 'Folder Analysis';
            
            showLoading();
            
            try {
                const folders = await window.apiClient.getFolderAnalysis();
                
                hideLoading();
                
                displayFolderAnalysisTable(folders);
                
                // Auto-scroll to tables
                setTimeout(() => {
                    document.getElementById('tables').scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            } catch (error) {
                showError('Failed to load folder analysis: ' + error.message);
            }
        }


        async function loadFolderAssets(folderPath) {
            setCurrentView('folder_assets');
            currentFilter = `Assets in ${folderPath}`;
            
            showLoading();
            
            try {
                // Get all assets and filter by folder path
                const allAssets = await window.apiClient.getAssets();
                
                // Filter assets that start with this folder path
                const folderAssets = allAssets.filter(asset => 
                    asset.asset_path.startsWith(folderPath + '/')
                ).sort((a, b) => b.import_time_ms - a.import_time_ms);
                
                hideLoading();
                
                displayAssetsTable(folderAssets, `Assets in ${folderPath}`, `Showing ${folderAssets.length} assets in folder`);
            } catch (error) {
                showError('Failed to load folder assets: ' + error.message);
            }
        }


        async function loadImporterDetail(importerType) {
            try {
                const assets = await window.apiClient.getAssetsByImporter(importerType);
                
                setCurrentView('importer');
                currentFilter = importerType;
                
                displayAssetsTable(assets, `Assets using ${importerType}`);
            } catch (error) {
                showError('Failed to load importer details: ' + error.message);
            }
        }


        async function loadPipelineDetails(category) {
            setCurrentView('pipeline');
            currentFilter = category;
            
            showLoading();
            
            try {
                const refreshes = await window.apiClient.getPipelineRefreshes();
                
                hideLoading();
                
                displayPipelineTable(refreshes, category);
                
                // Auto-scroll to tables
                setTimeout(() => {
                    document.getElementById('tables').scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            } catch (error) {
                showError('Failed to load pipeline details: ' + error.message);
            }
        }

