/**
 * Unity Editor Log Parser (JavaScript)
 * Ported from Python log_parser.py
 * Parses Unity Editor.log files and stores data directly in IndexedDB
 */

class UnityLogParser {
    /**
     * Initialize the parser
     * @param {UnityLogDatabase} db - IndexedDB database instance
     * @param {Function} progressCallback - Optional callback for progress updates
     */
    constructor(db, progressCallback = null) {
        this.db = db;
        this.progressCallback = progressCallback;
        
        // Asset type and category mappings
        this._initAssetMappings();
    }

    /**
     * Initialize asset type and category mappings
     */
    _initAssetMappings() {
        // Extension to display name mapping
        this.extDisplayMap = {
            '.shader': '.shader',
            '.compute': '.compute',
            '.cginc': '.cginc',
            '.hlsl': '.hlsl',
            '.png': '.png',
            '.jpg': '.jpg',
            '.jpeg': '.jpeg',
            '.tga': '.tga',
            '.psd': '.psd',
            '.exr': '.exr',
            '.hdr': '.hdr',
            '.tif': '.tif',
            '.tiff': '.tiff',
            '.bmp': '.bmp',
            '.fbx': '.fbx',
            '.obj': '.obj',
            '.blend': '.blend',
            '.mat': '.mat',
            '.prefab': '.prefab',
            '.unity': '.unity',
            '.asset': '.asset',
            '.controller': '.controller',
            '.anim': '.anim',
            '.physicmaterial': '.physicmaterial',
            '.cs': '.cs',
            '.js': '.js',
            '.dll': '.dll',
            '.asmdef': '.asmdef',
            '.ttf': '.ttf',
            '.otf': '.otf',
            '.wav': '.wav',
            '.mp3': '.mp3',
            '.ogg': '.ogg',
        };

        // Extension to category mapping
        this.categoryMap = {
            '.shader': 'Rendering',
            '.compute': 'Rendering',
            '.cginc': 'Rendering',
            '.hlsl': 'Rendering',
            '.png': 'Textures',
            '.jpg': 'Textures',
            '.jpeg': 'Textures',
            '.tga': 'Textures',
            '.psd': 'Textures',
            '.exr': 'Textures',
            '.hdr': 'Textures',
            '.tif': 'Textures',
            '.tiff': 'Textures',
            '.bmp': 'Textures',
            '.mat': 'Materials',
            '.prefab': 'Prefabs',
            '.unity': 'Scenes',
            '.fbx': '3D Models',
            '.obj': '3D Models',
            '.blend': '3D Models',
            '.cs': 'Scripts',
            '.js': 'Scripts',
            '.dll': 'Assemblies',
            '.asmdef': 'Assemblies',
            '.asset': 'Scriptable Objects',
            '.controller': 'Animation',
            '.anim': 'Animation',
            '.physicmaterial': 'Physics',
            '.ttf': 'Fonts',
            '.otf': 'Fonts',
            '.wav': 'Audio',
            '.mp3': 'Audio',
            '.ogg': 'Audio',
        };

        // Extension to importer type mapping
        this.importerMap = {
            '.fbx': 'FBXImporter',
            '.png': 'TextureImporter',
            '.jpg': 'TextureImporter',
            '.jpeg': 'TextureImporter',
            '.exr': 'TextureImporter',
            '.tga': 'TextureImporter',
            '.hdr': 'TextureImporter',
            '.tif': 'TextureImporter',
            '.tiff': 'TextureImporter',
            '.bmp': 'TextureImporter',
            '.mat': 'NativeFormatImporter',
            '.prefab': 'PrefabImporter',
            '.anim': 'NativeFormatImporter',
            '.controller': 'NativeFormatImporter',
            '.mp4': 'VideoClipImporter',
            '.mov': 'VideoClipImporter',
            '.avi': 'VideoClipImporter',
            '.webm': 'VideoClipImporter',
            '.m4v': 'VideoClipImporter',
            '.mpg': 'VideoClipImporter',
            '.mpeg': 'VideoClipImporter',
            '.wav': 'AudioImporter',
            '.mp3': 'AudioImporter',
            '.ogg': 'AudioImporter',
            '.aif': 'AudioImporter',
            '.aiff': 'AudioImporter',
            '.flac': 'AudioImporter',
        };
    }

    /**
     * Report progress
     */
    _reportProgress(message) {
        if (this.progressCallback) {
            this.progressCallback(message);
        }
    }

    /**
     * Extract Unity version from log header
     */
    _extractUnityVersion(line) {
        const match = line.match(/Unity Editor version:\s+(\S+)/);
        return match ? match[1] : null;
    }

    /**
     * Extract platform from log header
     */
    _extractPlatform(line) {
        if (line.includes('macOS version:')) return 'macOS';
        if (line.includes('Windows version:')) return 'Windows';
        if (line.includes('Linux version:')) return 'Linux';
        return null;
    }

    /**
     * Extract architecture from log header
     */
    _extractArchitecture(line) {
        const match = line.match(/Architecture:\s+(\S+)/);
        return match ? match[1] : null;
    }

    /**
     * Get file extension from path
     */
    _getExtension(path) {
        const lastDot = path.lastIndexOf('.');
        if (lastDot === -1) return '';
        return path.substring(lastDot).toLowerCase();
    }

    /**
     * Get filename from path
     */
    _getFilename(path) {
        const lastSlash = path.lastIndexOf('/');
        return lastSlash === -1 ? path : path.substring(lastSlash + 1);
    }

    /**
     * Categorize asset by file extension and importer type
     */
    _categorizeAsset(path, importerType = null) {
        const ext = this._getExtension(path);
        const assetType = this.extDisplayMap[ext] || (ext || 'no-extension');
        let category = this.categoryMap[ext] || 'Other';

        // Override category if importer is TextureImporter
        if (importerType && importerType !== '-1' && importerType === 'TextureImporter') {
            category = 'Textures';
        }

        return { assetType, category };
    }

    /**
     * Parse asset import line
     * Returns object with import data or null if not an import line
     */
    _parseAssetImport(line, lineNumber, timestamp = null) {
        // Primary pattern: Start importing PATH using Guid(GUID) IMPORTER -> (artifact id: 'HASH') in X.XXX seconds
        let pattern = /Start importing (.+?) using Guid\(([a-f0-9]+)\) (.+?)(?: -> \(artifact id: '([a-f0-9]+)'\))? in ([\d.]+) seconds/;
        let match = line.match(pattern);

        if (match) {
            const assetPath = match[1];
            const guid = match[2];
            const importerRaw = match[3];
            const artifactId = match[4] || null;
            const timeSeconds = parseFloat(match[5] || match[4]);
            const timeMs = timeSeconds * 1000;

            const importerType = this._extractImporterType(importerRaw);
            
            if (this._shouldSkipAsset(assetPath, importerType)) {
                return null;
            }

            return this._createAssetImport({
                logId: null, // Will be set later
                lineNumber,
                assetPath,
                guid,
                artifactId,
                importerType,
                timeSeconds,
                timeMs,
                startTimestamp: timestamp,
                endTimestamp: timestamp // Single-line import: same timestamp for start and end
            });
        }

        // Fallback pattern 1: Worker thread format without importer type
        pattern = /Start importing (.+?) using Guid\(([a-f0-9]+)\)\s*$/;
        match = line.match(pattern);
        if (match) {
            const assetPath = match[1];
            const guid = match[2];
            const ext = this._getExtension(assetPath);
            const importerType = this.importerMap[ext] || null;
            const artifactId = null;
            const timeSeconds = 0.001;
            const timeMs = 1.0;

            if (this._shouldSkipAsset(assetPath, importerType)) {
                return null;
            }

            return this._createAssetImport({
                logId: null,
                lineNumber,
                assetPath,
                guid,
                artifactId,
                importerType,
                timeSeconds,
                timeMs,
                startTimestamp: timestamp,
                endTimestamp: timestamp
            });
        }

        // Fallback pattern 2: incomplete lines with importer
        pattern = /Start importing (.+?) using Guid\(([a-f0-9]+)\) \((\w+)\)/;
        match = line.match(pattern);
        if (match) {
            const assetPath = match[1];
            const guid = match[2];
            let importerType = match[3];

            if (importerType === '-1' || !importerType) {
                importerType = null;
            }

            if (this._shouldSkipAsset(assetPath, importerType)) {
                return null;
            }

            // Multi-line importers (will be handled as pending)
            const multiLineImporters = ['VideoClipImporter', 'AudioImporter', 'MovieImporter'];
            if (multiLineImporters.includes(importerType)) {
                return null; // Will be handled as pending import
            }

            return this._createAssetImport({
                logId: null,
                lineNumber,
                assetPath,
                guid,
                artifactId: null,
                importerType,
                timeSeconds: 0.001,
                timeMs: 1.0,
                startTimestamp: timestamp,
                endTimestamp: timestamp
            });
        }

        return null;
    }

    /**
     * Parse pipeline refresh event
     */
    _parsePipelineRefresh(lines, startLine, logId) {
        const firstLine = lines[0];
        const pattern = /Asset Pipeline Refresh \(id=([a-f0-9]+)\): Total: ([\d.]+) seconds - Initiated by (.+?)$/;
        const match = firstLine.match(pattern);

        if (!match) return null;

        const refreshId = match[1];
        const totalTime = parseFloat(match[2]);
        const initiatedBy = match[3];

        let importsTotal = null;
        let importsActual = null;
        let assetDbProcessMs = null;
        let assetDbCallbackMs = null;
        let domainReloads = null;
        let domainReloadMs = null;
        let compileMs = null;
        let scriptingOtherMs = null;

        // Parse summary details from following lines
        for (let i = 1; i < Math.min(lines.length, 11); i++) {
            const line = lines[i];
            
            if (line.includes('Imports: total=')) {
                const importsMatch = line.match(/total=(\d+).*actual=(\d+)/);
                if (importsMatch) {
                    importsTotal = parseInt(importsMatch[1]);
                    importsActual = parseInt(importsMatch[2]);
                }
            } else if (line.includes('Asset DB Process Time:')) {
                const timeMatch = line.match(/managed=(\d+)\s*ms.*native=(\d+)\s*ms/);
                if (timeMatch) {
                    assetDbProcessMs = parseInt(timeMatch[1]) + parseInt(timeMatch[2]);
                }
            } else if (line.includes('Asset DB Callback time:')) {
                const timeMatch = line.match(/managed=(\d+)\s*ms.*native=(\d+)\s*ms/);
                if (timeMatch) {
                    assetDbCallbackMs = parseInt(timeMatch[1]) + parseInt(timeMatch[2]);
                }
            } else if (line.includes('Scripting:') && line.includes('domain reload')) {
                const scriptingMatch = line.match(/domain reloads=(\d+).*domain reload time=([\d]+)\s*ms.*compile time=([\d]+)\s*ms.*other=([\d]+)\s*ms/);
                if (scriptingMatch) {
                    domainReloads = parseInt(scriptingMatch[1]);
                    domainReloadMs = parseInt(scriptingMatch[2]);
                    compileMs = parseInt(scriptingMatch[3]);
                    scriptingOtherMs = parseInt(scriptingMatch[4]);
                }
            }
        }

        return {
            log_id: logId,
            line_number: startLine,
            refresh_id: refreshId,
            total_time_seconds: totalTime,
            initiated_by: initiatedBy,
            imports_total: importsTotal,
            imports_actual: importsActual,
            asset_db_process_time_ms: assetDbProcessMs,
            asset_db_callback_time_ms: assetDbCallbackMs,
            domain_reloads: domainReloads,
            domain_reload_time_ms: domainReloadMs,
            compile_time_ms: compileMs,
            scripting_other_ms: scriptingOtherMs
        };
    }

    /**
     * Parse domain reload profiling section
     */
    _parseDomainReload(lines, startLine, logId) {
        const pattern = /^(\t*)(.+?) \((\d+)ms\)/;
        const steps = [];
        const parentStack = {};
        const lastIdAtLevel = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(pattern);
            
            if (match) {
                const indent = match[1].length;
                const stepName = match[2];
                const timeMs = parseFloat(match[3]);
                const lineNumber = startLine + i;
                const parentId = indent > 0 ? lastIdAtLevel[indent - 1] : null;

                steps.push({
                    log_id: logId,
                    line_number: lineNumber,
                    parent_id: parentId,
                    step_name: stepName,
                    time_ms: timeMs,
                    indent_level: indent
                });

                // Track parent relationships (will be resolved when inserting)
                lastIdAtLevel[indent] = steps.length - 1;
                
                // Clear deeper levels
                for (const key in lastIdAtLevel) {
                    if (parseInt(key) > indent) {
                        delete lastIdAtLevel[key];
                    }
                }
            } else {
                break;
            }
        }

        return steps;
    }


    /**
     * Parse telemetry data
     */
    _parseTelemetry(line, lineNumber, logId) {
        const pattern = /##utp:(\{.+\})/;
        const match = line.match(pattern);

        if (match) {
            try {
                const jsonData = JSON.parse(match[1]);
                const telemetryType = jsonData.type || 'Unknown';
                
                return {
                    log_id: logId,
                    line_number: lineNumber,
                    telemetry_type: telemetryType,
                    json_data: match[1]
                };
            } catch (e) {
                console.warn(`Failed to parse JSON at line ${lineNumber}:`, e);
                return null;
            }
        }
        return null;
    }

    /**
     * Parse operation timing line
     */
    _parseOperation(line, lineNumber, logId) {
        // Strip timestamp prefix if present (format: YYYY-MM-DDTHH:MM:SS.sssZ|thread_id|)
        let lineToParse = line;
        const timestampPrefix = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[^|]+\|/;
        if (timestampPrefix.test(line)) {
            lineToParse = line.replace(timestampPrefix, '');
        }
        
        const pattern = /([^:]+)\s*:\s*"\s*##\s*(.+?)\s*##\s*"\s+took\s+([\d.]+)\s+sec(?:.*current mem:\s*(\d+)\s*MB)?/;
        const match = lineToParse.match(pattern);

        if (match) {
            return {
                log_id: logId,
                line_number: lineNumber,
                operation_type: match[1].trim(),
                operation_name: match[2].trim(),
                duration_seconds: parseFloat(match[3]),
                duration_ms: parseFloat(match[3]) * 1000,
                memory_mb: match[4] ? parseInt(match[4]) : null
            };
        }
        return null;
    }

    /**
     * Parse Tundra operation
     */
    _parseTundraOperation(line, lineNumber, logId) {
        const pattern = /\*\*\*\s+Tundra\s+([^\(]+)\s+\(([\d.]+)\s+seconds?\),\s+(\d+)\s+items?\s+updated,\s+(\d+)\s+evaluated/;
        const match = line.match(pattern);

        if (match) {
            const operationName = match[1].trim();
            const durationSeconds = parseFloat(match[2]);
            const itemsUpdated = parseInt(match[3]);
            const itemsEvaluated = parseInt(match[4]);
            const fullOperationName = `${operationName} (${itemsUpdated} items updated, ${itemsEvaluated} evaluated)`;

            return {
                log_id: logId,
                line_number: lineNumber,
                operation_type: 'Tundra',
                operation_name: fullOperationName,
                duration_seconds: durationSeconds,
                duration_ms: durationSeconds * 1000
            };
        }
        return null;
    }

    /**
     * Classify log line type
     */
    _classifyLine(line) {
        let lineType = 'normal';
        let indentLevel = 0;
        let isError = false;
        let isWarning = false;

        // Count indentation
        indentLevel = line.length - line.replace(/^\t+/, '').length;

        // Check for errors and warnings
        const lineLower = line.toLowerCase();
        if (lineLower.includes('error') || lineLower.includes('exception')) {
            isError = true;
            lineType = 'error';
        } else if (lineLower.includes('warning')) {
            isWarning = true;
            lineType = 'warning';
        } else if (line.startsWith('[')) {
            lineType = 'system';
        } else if (line.includes('Start importing')) {
            lineType = 'import';
        } else if (line.includes('Asset Pipeline Refresh')) {
            lineType = 'pipeline';
        } else if (line.includes('Domain Reload')) {
            lineType = 'domain_reload';
        } else if (line.includes('##utp:')) {
            lineType = 'telemetry';
        }

        return { lineType, indentLevel, isError, isWarning };
    }

    /**
     * Extract timestamp from line
     * Supports formats:
     * - 2025-11-15T15:13:34 (basic format, seconds precision)
     * - 2025-11-15T15:13:34.080391Z (with microseconds and Z, highest precision)
     * - 2025-11-15T15:13:34.080Z (with milliseconds and Z, 3dp precision)
     * 
     * Preserves full precision when available (especially Z format with milliseconds)
     * for accurate wall-to-wall time calculations
     */
    _extractTimestamp(line) {
        // Try full format with milliseconds/microseconds and Z first (highest precision)
        // Pattern: YYYY-MM-DDTHH:MM:SS.sssZ or YYYY-MM-DDTHH:MM:SS.ssssssZ
        let match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z)/);
        if (match) {
            // Preserve full format with milliseconds/microseconds and Z
            // This provides the highest precision (3-6 decimal places)
            return match[1];
        }
        
        // Try format with milliseconds/microseconds but no Z
        match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6})/);
        if (match) {
            // Preserve milliseconds/microseconds precision
            return match[1];
        }
        
        // Fallback to basic format (seconds precision only)
        match = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        return match ? match[1] : null;
    }

    /**
     * Extract importer type from raw importer string
     * Handles formats like "Importer(-1,...)" or "Importer(TextureImporter)"
     */
    _extractImporterType(importerRaw) {
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
     * Check if asset path should be skipped (package folders, folders without extensions)
     */
    _shouldSkipAsset(assetPath, importerType = null) {
        const pathParts = assetPath.split('/');
        const lastPart = pathParts[pathParts.length - 1] || '';
        
        // Skip package folders
        if (lastPart.startsWith('com.') && pathParts.length <= 2) {
            return true;
        }
        
        // Skip DefaultImporter folders without extensions
        if (importerType === 'DefaultImporter' && !lastPart.includes('.')) {
            return true;
        }
        
        // Skip folders without extensions (unless they have a valid importer)
        if (!lastPart.includes('.') && !importerType) {
            return true;
        }
        
        return false;
    }

    /**
     * Calculate wall-to-wall time from timestamps, falling back to explicit time
     * @param {string|null} startTimestamp - Start timestamp (ISO format)
     * @param {string|null} endTimestamp - End timestamp (ISO format)
     * @param {number} explicitTimeSeconds - Explicit time from log (fallback)
     * @returns {{timeSeconds: number, timeMs: number}} Calculated time
     */
    _calculateWallTime(startTimestamp, endTimestamp, explicitTimeSeconds) {
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
     * Create asset import object
     * @param {Object} params - Asset import parameters
     * @returns {Object} Asset import object
     */
    _createAssetImport({
        logId,
        lineNumber,
        assetPath,
        guid,
        artifactId = null,
        importerType = null,
        timeSeconds,
        timeMs,
        startTimestamp = null,
        endTimestamp = null,
        isAnimation = false
    }) {
        // Infer importer type if missing
        if (!importerType) {
            const ext = this._getExtension(assetPath);
            importerType = this.importerMap[ext] || null;
        }

        const assetName = this._getFilename(assetPath);
        let { assetType, category } = this._categorizeAsset(assetPath, importerType);
        
        // Override category to "3D Animation" if keyframe reduction was detected
        if (isAnimation && category === '3D Models') {
            category = '3D Animation';
        }

        // Calculate end timestamp if not provided
        if (!endTimestamp && startTimestamp) {
            const startTime = new Date(startTimestamp).getTime();
            endTimestamp = new Date(startTime + timeMs).toISOString();
        }

        return {
            log_id: logId,
            line_number: lineNumber,
            asset_path: assetPath,
            asset_name: assetName,
            asset_type: assetType,
            asset_category: category,
            guid: guid,
            artifact_id: artifactId,
            importer_type: importerType,
            import_time_seconds: timeSeconds,
            import_time_ms: timeMs,
            start_timestamp: startTimestamp,
            end_timestamp: endTimestamp
        };
    }

    /**
     * Parse log file
     * @param {File} file - File object from file input
     * @param {Function} cancelSignal - Optional cancellation signal
     * @returns {Promise<{logId: number, logLines: Array}>} Log ID and log lines
     */
    /**
     * Process file in streaming fashion to avoid memory issues
     * Reads file in chunks and processes line-by-line without loading everything into memory
     */
    async _processFileStreaming(file, lineCallback, progressCallback = null, cancelSignal = null) {
        return new Promise((resolve, reject) => {
            const chunkSize = 1024 * 1024; // 1MB chunks
            const reader = new FileReader();
            let offset = 0;
            let buffer = '';
            let lineNumber = 0;
            const totalSize = file.size;
            let lastProgressUpdate = 0;
            
            const processChunk = async (chunkText) => {
                // Add to buffer and process complete lines
                buffer += chunkText;
                const lines = buffer.split(/\r?\n/);
                
                // Keep incomplete line in buffer
                buffer = lines.pop() || '';
                
                // Process each complete line (await if callback is async)
                for (const line of lines) {
                    lineNumber++;
                    if (cancelSignal && cancelSignal.cancelled) {
                        reject(new Error('Parsing cancelled'));
                        return;
                    }
                    const result = lineCallback(line, lineNumber);
                    // If callback returns a promise, await it
                    if (result && typeof result.then === 'function') {
                        await result;
                    }
                }
            };
            
            const readChunk = () => {
                if (cancelSignal && cancelSignal.cancelled) {
                    reject(new Error('Parsing cancelled'));
                    return;
                }
                
                const slice = file.slice(offset, offset + chunkSize);
                if (slice.size === 0) {
                    // Process remaining buffer
                    if (buffer) {
                        lineNumber++;
                        const result = lineCallback(buffer, lineNumber);
                        // If callback returns a promise, await it
                        if (result && typeof result.then === 'function') {
                            result.then(() => {
                                buffer = '';
                                if (progressCallback) {
                                    progressCallback(100, lineNumber);
                                }
                                resolve(lineNumber);
                            }).catch(reject);
                            return;
                        }
                        buffer = '';
                    }
                    if (progressCallback) {
                        progressCallback(100, lineNumber);
                    }
                    resolve(lineNumber);
                    return;
                }
                
                reader.onload = async (e) => {
                    await processChunk(e.target.result);
                    offset += chunkSize;
                    
                    // Report progress every 1% for smoother updates
                    const percentRead = (offset / totalSize) * 100;
                    if (progressCallback && (percentRead - lastProgressUpdate >= 1 || percentRead >= 100)) {
                        progressCallback(percentRead, lineNumber);
                        lastProgressUpdate = percentRead;
                    }
                    
                    // Yield to browser periodically
                    if (offset % (chunkSize * 10) === 0) {
                        setTimeout(readChunk, 0);
                    } else {
                        readChunk();
                    }
                };
                
                reader.onerror = () => {
                    reject(new Error('Failed to read file chunk'));
                };
                
                reader.readAsText(slice, 'utf-8');
            };
            
            readChunk();
        });
    }

    async parseLogFile(file, cancelSignal = null) {
        const startTime = performance.now();
        
        try {
            const fileSizeMB = file.size / (1024 * 1024);
            this._reportProgress(`Reading log file (${fileSizeMB.toFixed(1)} MB)...`);
            
            // STEP 1: Read first 100 lines to extract metadata
            this._reportProgress(`Extracting metadata from header...`);
            let unityVersion = null;
            let platform = null;
            let architecture = null;
            let projectName = null;
            
            const headerLines = [];
            let headerLineCount = 0;
            const maxHeaderLines = 100;
            
            // Read first 100 lines
            await new Promise((resolve, reject) => {
                const reader = new FileReader();
                const chunkSize = 1024 * 1024; // 1MB chunks
                let offset = 0;
                let buffer = '';
                let linesRead = 0;
                
                const readChunk = () => {
                    if (cancelSignal && cancelSignal.cancelled) {
                        reject(new Error('Parsing cancelled'));
                        return;
                    }
                    
                    if (linesRead >= maxHeaderLines || offset >= file.size) {
                        resolve();
                        return;
                    }
                    
                    const slice = file.slice(offset, offset + chunkSize);
                    reader.onload = (e) => {
                        buffer += e.target.result;
                        const lines = buffer.split('\n');
                        
                        // Process complete lines (keep last incomplete line in buffer)
                        for (let i = 0; i < lines.length - 1 && linesRead < maxHeaderLines; i++) {
                            const line = lines[i];
                            headerLines.push(line);
                            headerLineCount++;
                            linesRead++;
                            
                            // Extract metadata
                            if (!unityVersion) unityVersion = this._extractUnityVersion(line);
                            if (!platform) platform = this._extractPlatform(line);
                            if (!architecture) architecture = this._extractArchitecture(line);
                            if (!projectName) {
                                const projectPathMatch = line.match(/-projectpath\s+([^\s]+)/);
                                if (projectPathMatch) {
                                    const projectPath = projectPathMatch[1];
                                    projectName = this._getFilename(projectPath.replace(/\/$/, ''));
                                } else if (line.includes('Successfully changed project path to:')) {
                                    const pathMatch = line.match(/Successfully changed project path to:\s+([^\s]+)/);
                                    if (pathMatch) {
                                        const projectPath = pathMatch[1];
                                        projectName = this._getFilename(projectPath.replace(/\/$/, ''));
                                    }
                                }
                            }
                        }
                        
                        buffer = lines[lines.length - 1]; // Keep incomplete line
                        offset += chunkSize;
                        
                        if (linesRead >= maxHeaderLines || offset >= file.size) {
                            resolve();
                        } else {
                            readChunk();
                        }
                    };
                    
                    reader.onerror = () => reject(new Error('Failed to read header'));
                    reader.readAsText(slice, 'utf-8');
                };
                
                readChunk();
            });
            
            // STEP 2: Insert metadata and get logId (will be 1 in a fresh database)
            const metadata = {
                log_file: file.name,
                unity_version: unityVersion,
                platform: platform,
                architecture: architecture,
                project_name: projectName,
                date_parsed: new Date().toISOString(),
                total_lines: null,
                total_parse_time_ms: null
            };
            
            const logId = await this.db.insertLogMetadata(metadata);
            this._reportProgress(`Metadata stored (log_id: ${logId})`);
            this._reportProgress(`Parsing log lines...`);

            // Collections for batch insertion
            const assetImports = [];
            const pipelineRefreshes = [];
            const domainReloadSteps = [];
            const telemetryData = [];
            const operations = [];
            const logLines = [];

            // State tracking
            let inDomainReload = false;
            let domainReloadLines = [];
            let domainReloadStart = 0;
            let inPipelineRefresh = false;
            let pipelineRefreshLines = [];
            let pipelineRefreshStart = 0;
            const workerStates = {}; // worker_num -> {asset_path, guid, line_number, importer_type, start_timestamp}
            const pendingImports = {}; // guid -> {asset_path, guid, line_number, importer_type, start_timestamp, is_animation}
            
            // Sprite atlas operation tracking
            // Track sprite atlas operations that span multiple lines
            let spriteAtlasState = null; // {atlas_name, start_line, start_timestamp, steps: [{operation_name, duration_ms, timestamp}]}
            
            // Script compilation operation tracking
            // Track script compilation from "NetCoreRuntime/dotnet" exec to "*** Tundra"
            let scriptCompilationState = null; // {start_line, start_timestamp, assembly_name}
            
            let totalLines = 0;

            // Reading progress tracking
            let readingStartTime = performance.now();
            let lastReadingProgressUpdate = 0;
            
            // Progress callback for reading phase
            const readingProgressCallback = (percentRead, linesRead) => {
                const now = performance.now();
                const elapsed = (now - readingStartTime) / 1000; // seconds
                
                // Calculate estimated time remaining
                let estimatedTimeRemaining = null;
                if (percentRead > 0 && elapsed > 0) {
                    const totalTime = (elapsed / percentRead) * 100;
                    estimatedTimeRemaining = Math.max(0, totalTime - elapsed);
                }
                
                // Report progress every 1% for smoother updates
                if (percentRead - lastReadingProgressUpdate >= 1 || percentRead >= 100) {
                    this._reportProgress(`Reading: ${percentRead.toFixed(1)}% (${linesRead.toLocaleString()} lines read)`);
                    lastReadingProgressUpdate = percentRead;
                }
            };

            // Track processing statistics
            let linesProcessedCount = 0;
            
            // Track error and warning counts for fast retrieval
            let errorCount = 0;
            let warningCount = 0;
            
            // Track first and last timestamps for timeline sizing
            let firstTimestamp = null;
            let lastTimestamp = null;
            let hasTimestamps = false;
            
            // Line processing callback - logId is always available now
            const processLine = (line, lineNumber) => {
                totalLines = lineNumber;
                linesProcessedCount++;

                // Progress update every 1000 lines
                if (lineNumber % 1000 === 0) {
                    this._reportProgress(`Processed ${lineNumber.toLocaleString()} lines...`);
                }
                
                // Report estimated total lines periodically (current line number is our best estimate)
                // This allows progress calculation during streaming
                // Report every 10000 lines to avoid too many updates
                if (lineNumber === 1 || lineNumber % 10000 === 0) {
                    this._reportProgress(`Total lines: ${lineNumber}`);
                }

                // Prepare log line data (we'll add this to logLines at the end, regardless of parsing)
                const { lineType, indentLevel, isError, isWarning } = this._classifyLine(line);
                const timestamp = this._extractTimestamp(line);
                
                // Track error and warning counts
                if (isError) errorCount++;
                if (isWarning) warningCount++;
                
                // Track first and last timestamps if present
                if (timestamp) {
                    hasTimestamps = true;
                    if (!firstTimestamp || timestamp < firstTimestamp) {
                        firstTimestamp = timestamp;
                    }
                    if (!lastTimestamp || timestamp > lastTimestamp) {
                        lastTimestamp = timestamp;
                    }
                }
                const logLineData = {
                    log_id: logId,
                    line_number: lineNumber,
                    content: line,
                    line_type: lineType,
                    indent_level: indentLevel,
                    is_error: Boolean(isError),
                    is_warning: Boolean(isWarning),
                    timestamp: timestamp
                };

                // Check for worker thread patterns first
                const workerMatch = line.match(/^\[Worker(\d+)\]\s+(.+)/);
                if (workerMatch) {
                    const workerNum = parseInt(workerMatch[1]);
                    const workerLine = workerMatch[2];

                    // Worker starting an import?
                    if (workerLine.includes('Start importing')) {
                        const startPattern = /Start importing (.+?) using Guid\(([a-f0-9]+)\)\s*$/;
                        const startMatch = workerLine.match(startPattern);
                        if (startMatch) {
                            workerStates[workerNum] = {
                                asset_path: startMatch[1],
                                guid: startMatch[2],
                                line_number: lineNumber,
                                importer_type: null,
                                start_timestamp: timestamp // Store start timestamp for wall-to-wall time calculation
                            };
                            logLines.push(logLineData);
                            return;
                        }
                    }

                    // Check for importer type on next line
                    if (workerStates[workerNum] && workerStates[workerNum].importer_type === null) {
                        const importerMatch = workerLine.match(/^\(([A-Za-z0-9\-]+)\)\s*$/);
                        if (importerMatch) {
                            let importerType = importerMatch[1];
                            if (importerType === '-1' || !importerType.endsWith('Importer')) {
                                importerType = null;
                            }
                            workerStates[workerNum].importer_type = importerType;
                            logLines.push(logLineData);
                            return;
                        }
                    }

                    // Worker completing an import?
                    if (workerLine.includes('-> (artifact id:')) {
                        const artifactPattern = /-> \(artifact id: '([a-f0-9]+)'\) in ([\d.]+) seconds/;
                        const artifactMatch = workerLine.match(artifactPattern);
                        if (artifactMatch && workerStates[workerNum]) {
                            const artifactId = artifactMatch[1];
                            const explicitTimeSeconds = parseFloat(artifactMatch[2]);
                            const state = workerStates[workerNum];
                            
                            if (this._shouldSkipAsset(state.asset_path, state.importer_type)) {
                                delete workerStates[workerNum];
                                logLines.push(logLineData);
                                return;
                            }

                            const { timeSeconds, timeMs } = this._calculateWallTime(
                                state.start_timestamp,
                                timestamp,
                                explicitTimeSeconds
                            );

                            const assetImport = this._createAssetImport({
                                logId,
                                lineNumber: state.line_number,
                                assetPath: state.asset_path,
                                guid: state.guid,
                                artifactId,
                                importerType: state.importer_type,
                                timeSeconds,
                                timeMs,
                                startTimestamp: state.start_timestamp,
                                endTimestamp: timestamp
                            });

                            assetImports.push(assetImport);
                            delete workerStates[workerNum];
                            logLines.push(logLineData);
                            return;
                        }
                    }
                    logLines.push(logLineData);
                    return;
                }

                // Check for artifact ID completion for sprite atlas operations FIRST
                // This must come before regular pending imports to avoid conflicts
                // This comes after "Packing completed." and is the final completion
                if (line.includes('-> (artifact id:') && !line.includes('[Worker') && spriteAtlasState) {
                    const artifactPattern = /-> \(artifact id: '([a-f0-9]+)'\) in ([\d.]+) seconds/;
                    const artifactMatch = line.match(artifactPattern);
                    if (artifactMatch) {
                        const artifactId = artifactMatch[1];
                        const explicitTimeSeconds = parseFloat(artifactMatch[2]);
                        const atlasName = spriteAtlasState.atlas_name || 'Unknown Atlas';
                        
                        const { timeSeconds, timeMs } = this._calculateWallTime(
                            spriteAtlasState.start_timestamp,
                            timestamp,
                            explicitTimeSeconds
                        );
                        
                        // Create asset import entry for sprite pack
                        // Sprite packs get their own category, separate from Textures
                        assetImports.push({
                            log_id: logId,
                            line_number: spriteAtlasState.start_line,
                            asset_path: `SpriteAtlas/${atlasName}`,
                            asset_name: atlasName,
                            asset_type: 'Sprite Pack',
                            asset_category: 'Sprite Pack',
                            guid: null, // Sprite atlases don't have GUIDs in the same way
                            artifact_id: artifactId,
                            importer_type: 'SpriteAtlasImporter',
                            import_time_seconds: timeSeconds,
                            import_time_ms: timeMs,
                            start_timestamp: spriteAtlasState.start_timestamp || null,
                            end_timestamp: timestamp || null
                        });
                        
                        spriteAtlasState = null;
                        logLines.push(logLineData);
                        return;
                    }
                }

                // Check for artifact ID completion for pending imports
                if (line.includes('-> (artifact id:') && !line.includes('[Worker')) {
                    const artifactPattern = /-> \(artifact id: '([a-f0-9]+)'\) in ([\d.]+) seconds/;
                    const artifactMatch = line.match(artifactPattern);
                    if (artifactMatch && Object.keys(pendingImports).length > 0) {
                        const artifactId = artifactMatch[1];
                        const explicitTimeSeconds = parseFloat(artifactMatch[2]);
                        
                        // Find the pending import that best matches this completion
                        // Try to match by timing: find the pending import whose start time + explicit time
                        // is closest to the current timestamp
                        let bestMatch = null;
                        let bestGuid = null;
                        let bestTimeDiff = Infinity;
                        
                        const currentTimestamp = timestamp ? new Date(timestamp).getTime() : null;
                        
                        for (const guid of Object.keys(pendingImports)) {
                            const state = pendingImports[guid];
                            if (state.start_timestamp && currentTimestamp) {
                                const startTime = new Date(state.start_timestamp).getTime();
                                const expectedEndTime = startTime + (explicitTimeSeconds * 1000);
                                const timeDiff = Math.abs(currentTimestamp - expectedEndTime);
                                
                                // Prefer matches where the timing is close (within 5 seconds)
                                if (timeDiff < bestTimeDiff && timeDiff < 5000) {
                                    bestTimeDiff = timeDiff;
                                    bestMatch = state;
                                    bestGuid = guid;
                                }
                            }
                        }
                        
                        // Fallback to most recent pending import if no timing match found
                        if (!bestMatch) {
                            const guids = Object.keys(pendingImports);
                            bestGuid = guids[guids.length - 1];
                            bestMatch = pendingImports[bestGuid];
                        }
                        
                        if (bestMatch && bestGuid) {
                            const state = bestMatch;
                            const { timeSeconds, timeMs } = this._calculateWallTime(
                                state.start_timestamp,
                                timestamp,
                                explicitTimeSeconds
                            );
                            
                            const assetImport = this._createAssetImport({
                                logId,
                                lineNumber: state.line_number,
                                assetPath: state.asset_path,
                                guid: state.guid,
                                artifactId,
                                importerType: state.importer_type,
                                timeSeconds,
                                timeMs,
                                startTimestamp: state.start_timestamp,
                                endTimestamp: timestamp,
                                isAnimation: state.is_animation
                            });

                            assetImports.push(assetImport);
                            delete pendingImports[bestGuid];
                        }
                        logLines.push(logLineData);
                        return;
                    }
                }

                // Sprite Atlas import detection - must come BEFORE general "Start importing" check
                // Check for sprite atlas import start (the actual start of the import, not when "Generating Atlas Masks" appears)
                if (line.includes('Start importing') && !line.includes('[Worker') && line.includes('.spriteatlasv2')) {
                    const startPattern = /Start importing (.+?\.spriteatlasv2) using Guid\(([a-f0-9]+)\)/;
                    const startMatch = line.match(startPattern);
                    if (startMatch) {
                        const spriteAtlasPath = startMatch[1];
                        const guid = startMatch[2];
                        // Extract atlas name from path (e.g., "Assets/SpriteAtlases/VRChatSprites.spriteatlasv2" -> "VRChatSprites")
                        const pathParts = spriteAtlasPath.split('/');
                        const fileName = pathParts[pathParts.length - 1];
                        const atlasName = fileName.replace('.spriteatlasv2', '');
                        
                        // Initialize sprite atlas state with the actual start timestamp
                        spriteAtlasState = {
                            atlas_name: atlasName, // Set from path, may be updated from "Processing Atlas" line
                            start_line: lineNumber,
                            start_timestamp: timestamp, // Use the "Start importing" timestamp as the actual start
                            guid: guid,
                            steps: []
                        };
                        logLines.push(logLineData);
                        return; // Don't process as regular asset import
                    }
                }
                
                // Non-worker thread asset imports
                if (line.includes('Start importing') && !line.includes('[Worker')) {
                    const importData = this._parseAssetImport(line, lineNumber, timestamp);
                    
                    if (importData) {
                        // Single-line import (start and completion on same line)
                        // For single-line imports, the explicit time is correct
                        // (timestamps would be the same or very close)
                        importData.log_id = logId;
                        assetImports.push(importData);
                    } else {
                        // This is a multi-line import (start without completion on same line)
                        // Extract GUID and path to store as pending
                        // Pattern: Start importing PATH using Guid(GUID) [rest of line]
                        const startPattern = /Start importing (.+?) using Guid\(([a-f0-9]+)\)/;
                        const startMatch = line.match(startPattern);
                        if (startMatch) {
                            const assetPath = startMatch[1];
                            const guid = startMatch[2];
                            
                            // Extract importer type if present: Importer(ImporterType) or Importer(-1,...)
                            const importerMatch = line.match(/Importer\(([^)]+)\)/);
                            const importerType = importerMatch ? this._extractImporterType(importerMatch[0]) : null;
                            
                            // Store as pending with start timestamp for wall-to-wall time calculation
                            pendingImports[guid] = {
                                asset_path: assetPath,
                                guid: guid,
                                line_number: lineNumber,
                                importer_type: importerType,
                                start_timestamp: timestamp, // Store start timestamp for wall-to-wall time
                                is_animation: false // Will be set to true if "Keyframe reduction" message appears
                            };
                            
                            // Check if this line also contains "Keyframe reduction" (can happen on same line)
                            if (line.includes('Keyframe reduction:')) {
                                pendingImports[guid].is_animation = true;
                            }
                        }
                    }
                }
                
                // Check for "Keyframe reduction" messages - indicates animation import
                // These can appear on worker threads, so we check all pending imports
                // This check must come AFTER "Start importing" so pending imports are created first
                if (line.includes('Keyframe reduction:')) {
                    // Mark all pending FBX imports as animations (keyframe reduction indicates animation processing)
                    // Only mark .fbx files since keyframe reduction is specific to animation imports
                    // Prefer marking imports in Animations folder, but mark any FBX if no Animations folder imports exist
                    const animationsFolderImports = Object.keys(pendingImports).filter(guid => {
                        const pending = pendingImports[guid];
                        return pending && (pending.asset_path || '').toLowerCase().includes('/animations/') && 
                               (pending.asset_path || '').toLowerCase().endsWith('.fbx');
                    });
                    
                    if (animationsFolderImports.length > 0) {
                        // Mark only Animations folder imports
                        animationsFolderImports.forEach(guid => {
                            if (pendingImports[guid]) {
                                pendingImports[guid].is_animation = true;
                            }
                        });
                    } else {
                        // Fallback: mark all pending FBX imports
                        Object.keys(pendingImports).forEach(guid => {
                            const pending = pendingImports[guid];
                            if (pending && (pending.asset_path || '').toLowerCase().endsWith('.fbx')) {
                                pending.is_animation = true;
                            }
                        });
                    }
                    logLines.push(logLineData);
                    return;
                }
                // Pipeline refreshes
                else if (line.includes('Asset Pipeline Refresh')) {
                    // If we're already in a pipeline refresh, process the previous one first
                    if (inPipelineRefresh) {
                        const refreshData = this._parsePipelineRefresh(pipelineRefreshLines, pipelineRefreshStart, logId);
                        if (refreshData) {
                            pipelineRefreshes.push(refreshData);
                        }
                    }
                    inPipelineRefresh = true;
                    pipelineRefreshStart = lineNumber;
                    pipelineRefreshLines = [line];
                } else if (inPipelineRefresh) {
                    // Collect up to 10 following lines for pipeline refresh details
                    pipelineRefreshLines.push(line);
                    // End pipeline refresh collection when we have 11 lines (first line + 10 context lines)
                    // or when we hit a blank line after collecting some data
                    if (pipelineRefreshLines.length >= 11) {
                        const refreshData = this._parsePipelineRefresh(pipelineRefreshLines, pipelineRefreshStart, logId);
                        if (refreshData) {
                            pipelineRefreshes.push(refreshData);
                        }
                        inPipelineRefresh = false;
                        pipelineRefreshLines = [];
                    } else if (pipelineRefreshLines.length > 1 && line.trim() === '') {
                        // Empty line after some data - end of pipeline refresh section
                        const refreshData = this._parsePipelineRefresh(pipelineRefreshLines, pipelineRefreshStart, logId);
                        if (refreshData) {
                            pipelineRefreshes.push(refreshData);
                        }
                        inPipelineRefresh = false;
                        pipelineRefreshLines = [];
                    }
                }
                // Domain reload profiling
                else if (line.includes('Domain Reload Profiling:')) {
                    inDomainReload = true;
                    domainReloadStart = lineNumber;
                    domainReloadLines = [line];
                } else if (inDomainReload) {
                    if (line.match(/^\t+.+? \(\d+ms\)/)) {
                        domainReloadLines.push(line);
                    } else {
                        // End of domain reload section
                        const steps = this._parseDomainReload(domainReloadLines, domainReloadStart, logId);
                        domainReloadSteps.push(...steps);
                        inDomainReload = false;
                        domainReloadLines = [];
                    }
                }
                // Script compilation is now calculated from Tundra operations (see below)
                // JSON telemetry
                else if (line.includes('##utp:')) {
                    const telemetryData_item = this._parseTelemetry(line, lineNumber, logId);
                    if (telemetryData_item) {
                        telemetryData.push(telemetryData_item);
                    }
                }
                // Sprite Atlas Operations - treat as asset imports
                // Pattern: 
                // 1. "Start importing Assets/.../Something.spriteatlasv2" appears (actual start - use this timestamp!)
                // 2. "Sprite Atlas Operation : Generating Atlas Masks" appears (intermediate step)
                // 3. "Processing Atlas : AtlasName" appears on next line (gives us name, may override path-based name)
                // 4. "Sprite Atlas Operation : Generate Texture and Render Datas" appears (intermediate step)
                // 5. "Packing completed." appears
                // 6. "-> (artifact id: '...') in X seconds" appears (final completion)
                
                // Check for "Processing Atlas" line which comes after first sprite atlas operation
                if (line.includes('Processing Atlas')) {
                    const atlasMatch = line.match(/Processing Atlas\s*:\s*(.+)/);
                    if (atlasMatch && spriteAtlasState) {
                        // Update the atlas name (may override the one from path)
                        spriteAtlasState.atlas_name = atlasMatch[1].trim();
                    }
                    logLines.push(logLineData);
                    return;
                }
                
                // Check for Sprite Atlas Operation lines
                if (line.includes('Sprite Atlas Operation')) {
                    const opData = this._parseOperation(line, lineNumber, logId);
                    if (opData && opData.operation_type === 'Sprite Atlas Operation') {
                        // If spriteAtlasState doesn't exist yet, create it (fallback for cases without "Start importing" line)
                        if (!spriteAtlasState) {
                            if (opData.operation_name.includes('Generating Atlas Masks')) {
                                spriteAtlasState = {
                                    atlas_name: null, // Will be set from next "Processing Atlas" line
                                    start_line: lineNumber,
                                    start_timestamp: timestamp, // Fallback: use this timestamp if no "Start importing" line found
                                    steps: [{
                                        operation_name: opData.operation_name,
                                        duration_ms: opData.duration_ms,
                                        timestamp: timestamp
                                    }]
                                };
                            }
                        } else {
                            // spriteAtlasState already exists (from "Start importing" line)
                            // Just track this as a step, but keep the original start_timestamp
                            spriteAtlasState.steps.push({
                                operation_name: opData.operation_name,
                                duration_ms: opData.duration_ms,
                                timestamp: timestamp
                            });
                        }
                        logLines.push(logLineData);
                        return;
                    }
                }
                
                // Operations (non-sprite atlas)
                else if (line.includes('Operation') && line.includes('took') && line.includes('sec')) {
                    const opData = this._parseOperation(line, lineNumber, logId);
                    if (opData && opData.operation_type !== 'Sprite Atlas Operation') {
                        operations.push(opData);
                    }
                }
                // Script compilation detection - must come BEFORE Tundra check
                // Check for raw "NetCoreRuntime/dotnet" exec line - this is the actual start
                // Note: This line may not have a timestamp, so we'll calculate start time from Tundra end time - explicit time
                if (line.includes('NetCoreRuntime/dotnet') && line.includes('exec') && !line.includes('## CmdLine:')) {
                    // Extract assembly name from the .rsp file path if available
                    // Pattern: "@Library/Bee/artifacts/.../Assembly-CSharp.rsp"
                    let assemblyName = 'Unknown Assembly';
                    const rspMatch = line.match(/@Library\/Bee\/artifacts\/[^\/]+\/([^\.]+)\.rsp/);
                    if (rspMatch) {
                        assemblyName = rspMatch[1];
                    }
                    
                    // Initialize script compilation state
                    // If this line has a timestamp, use it; otherwise we'll calculate from Tundra line
                    scriptCompilationState = {
                        start_line: lineNumber,
                        start_timestamp: timestamp, // May be null if line has no timestamp
                        assembly_name: assemblyName
                    };
                    logLines.push(logLineData);
                    return;
                }
                
                // Tundra operations - end of script compilation
                else if (line.includes('*** Tundra') && line.includes('seconds')) {
                    const tundraData = this._parseTundraOperation(line, lineNumber, logId);
                    if (tundraData) {
                        // If we have script compilation state, use it for wall-to-wall time
                        if (scriptCompilationState) {
                            const explicitTimeSeconds = tundraData.duration_seconds;
                            let startTimestamp = scriptCompilationState.start_timestamp;
                            
                            // If no start timestamp, calculate it from end timestamp minus explicit time
                            if (!startTimestamp && timestamp) {
                                const endTime = new Date(timestamp).getTime();
                                const calculatedStartTime = endTime - (explicitTimeSeconds * 1000);
                                // Preserve full precision (including milliseconds) when available
                                startTimestamp = new Date(calculatedStartTime).toISOString();
                            }
                            
                            const { timeSeconds, timeMs } = this._calculateWallTime(
                                startTimestamp,
                                timestamp,
                                explicitTimeSeconds
                            );
                            
                            // Create script compilation operation
                            operations.push({
                                log_id: logId,
                                line_number: scriptCompilationState.start_line,
                                operation_type: 'Script Compilation',
                                operation_name: `${scriptCompilationState.assembly_name} - ${tundraData.operation_name}`,
                                duration_seconds: timeSeconds,
                                duration_ms: timeMs,
                                memory_mb: null,
                                start_timestamp: startTimestamp,
                                end_timestamp: timestamp
                            });
                            
                            scriptCompilationState = null;
                        } else {
                            // No script compilation state - treat as regular Tundra operation
                            // Add timestamps if available
                            tundraData.start_timestamp = timestamp; // Use Tundra line timestamp as both start and end if no state
                            tundraData.end_timestamp = timestamp;
                            operations.push(tundraData);
                        }
                    }
                    logLines.push(logLineData);
                    return;
                }

                // Store log line for viewer (for lines that didn't match any special pattern above)
                logLines.push(logLineData);
            };

            // Simple line processing callback
            // Header lines (1-100) were already read for metadata, but we still need to store them as log lines
            const processLineCallback = (line, lineNumber) => {
                totalLines = lineNumber;
                
                // For header lines, just store them as log lines (no parsing needed)
                if (lineNumber <= maxHeaderLines) {
                    const { lineType, indentLevel, isError, isWarning } = this._classifyLine(line);
                    const timestamp = this._extractTimestamp(line);
                    
                    logLines.push({
                        log_id: logId,
                        line_number: lineNumber,
                        content: line,
                        line_type: lineType,
                        indent_level: indentLevel,
                        is_error: Boolean(isError),
                        is_warning: Boolean(isWarning),
                        timestamp: timestamp
                    });
                    return;
                }
                
                // Process all other lines normally
                processLine(line, lineNumber);
            };

            // Stream the entire file (header lines will be skipped in callback)
            await this._processFileStreaming(file, processLineCallback, readingProgressCallback, cancelSignal);
            
            // Log final counts for debugging
            console.log(`[Parser] Parsing complete:`);
            console.log(`  - Total lines in file: ${totalLines}`);
            console.log(`  - Lines processed: ${linesProcessedCount}`);
            console.log(`  - Log lines collected: ${logLines.length}`);
            
            // All lines should be stored (including header lines)
            if (logLines.length < totalLines * 0.95) { // Allow 5% tolerance
                console.warn(`[Parser] WARNING: Only ${logLines.length} log lines collected out of ${totalLines} total lines!`);
            }
            
            // Report final total lines for progress calculation
            this._reportProgress(`Total lines: ${totalLines}`);
            
            // Update metadata with total_lines and timestamps IMMEDIATELY (before storing data)
            // This ensures timestamps are available when dashboard loads, even if log lines are still being stored
            await this.db.open();
            const metadataUpdate = { total_lines: totalLines };
            if (hasTimestamps && firstTimestamp && lastTimestamp) {
                metadataUpdate.start_timestamp = firstTimestamp;
                metadataUpdate.end_timestamp = lastTimestamp;
                this._reportProgress(`Timestamps found: ${firstTimestamp} to ${lastTimestamp}`);
                console.log(`[Parser] Storing timestamps in metadata: ${firstTimestamp} to ${lastTimestamp}`);
            }
            await this.db.db.log_metadata.update(logId, metadataUpdate);

            // Store all parsed data in batches
            this._reportProgress(`Storing ${assetImports.length} asset imports...`);
            if (assetImports.length > 0) {
                await this.db.bulkInsertAssetImports(assetImports);
            }

            this._reportProgress(`Storing ${pipelineRefreshes.length} pipeline refreshes...`);
            if (pipelineRefreshes.length > 0) {
                await this.db.bulkInsertPipelineRefreshes(pipelineRefreshes);
            }

            this._reportProgress(`Storing ${domainReloadSteps.length} domain reload steps...`);
            if (domainReloadSteps.length > 0) {
                // Resolve parent_id references before bulk insert
                // Since we can't get IDs during bulk insert, we'll insert in batches
                // and resolve parent references by line number and step name
                const stepMap = new Map();
                for (let i = 0; i < domainReloadSteps.length; i++) {
                    stepMap.set(i, domainReloadSteps[i]);
                }
                
                // Insert in order, tracking inserted IDs by index
                const insertedIds = new Map();
                for (let i = 0; i < domainReloadSteps.length; i++) {
                    const step = { ...domainReloadSteps[i] };
                    if (step.parent_id !== null && step.parent_id !== undefined) {
                        // Find parent's inserted ID
                        if (insertedIds.has(step.parent_id)) {
                            step.parent_id = insertedIds.get(step.parent_id);
                        } else {
                            step.parent_id = null;
                        }
                    }
                    // Insert one at a time to get IDs
                    await this.db.open();
                    const insertedId = await this.db.db.domain_reload_steps.add(step);
                    insertedIds.set(i, insertedId);
                }
            }

            // Script compilation is now calculated from Tundra operations, no need to store separately

            this._reportProgress(`Storing ${telemetryData.length} telemetry records...`);
            if (telemetryData.length > 0) {
                await this.db.bulkInsertTelemetryData(telemetryData);
            }

            this._reportProgress(`Storing ${operations.length} operations...`);
            if (operations.length > 0) {
                await this.db.bulkInsertOperations(operations);
            }

            // Update parse time, error count, and warning count (timestamps already stored above)
            const endTime = performance.now();
            const parseDuration = endTime - startTime;
            await this.db.open();
            await this.db.db.log_metadata.update(logId, {
                total_parse_time_ms: parseDuration,
                error_count: errorCount,
                warning_count: warningCount
            });

            this._reportProgress(`Storing ${logLines.length} log lines for viewer...`);
            // Log lines will be stored by the caller using bulkInsertLogLines (with worker support)

            const totalTime = (parseDuration / 1000).toFixed(2);
            this._reportProgress(`✓ Parsing complete in ${totalTime} seconds`);

            return { logId, logLines };
        } catch (error) {
            console.error('[Parser] Error during parsing:', error);
            this._reportProgress(`✗ Error: ${error.message}`);
            throw error;
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnityLogParser;
} else {
    window.UnityLogParser = UnityLogParser;
}

