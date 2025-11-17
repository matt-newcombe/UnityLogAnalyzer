/**
 * Web Worker for background insertion of log lines into IndexedDB
 * This keeps the main thread responsive during large log file processing
 */

// Import Dexie (Web Workers can't use script tags, so we'll use importScripts)
importScripts('https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js');

// Database version counter - stored in localStorage (but workers can't access localStorage)
// We'll pass the version from the main thread
let dbVersion = null;
let dbName = null;
let db = null;

/**
 * Initialize the database connection
 */
function initDatabase(version) {
    dbVersion = version;
    dbName = `UnityLogAnalyzer_v${version}`;
    
    db = new Dexie(dbName);
    
    // Define schema (same as main database)
    db.version(1).stores({
        log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms',
        asset_imports: '++id, log_id, line_number, asset_path, asset_name, asset_type, asset_category, guid, artifact_id, importer_type, import_time_seconds, import_time_ms',
        pipeline_refreshes: '++id, log_id, line_number, refresh_id, total_time_seconds, initiated_by, imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms',
        domain_reload_steps: '++id, log_id, line_number, parent_id, step_name, time_ms, indent_level',
        script_compilation: '++id, log_id, line_number, assembly_path, defines_count, references_count',
        telemetry_data: '++id, log_id, line_number, telemetry_type, json_data',
        operations: '++id, log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb',
        log_lines: '++id, log_id, line_number, content, line_type, indent_level, is_error, is_warning, timestamp'
    });

    db.version(2).stores({
        log_metadata: '++id, log_file, unity_version, platform, architecture, project_name, date_parsed, total_lines, total_parse_time_ms',
        asset_imports: '++id, log_id, line_number, asset_path, asset_name, asset_type, asset_category, guid, artifact_id, importer_type, import_time_seconds, import_time_ms, [log_id+asset_type+import_time_ms], [log_id+asset_category+import_time_ms], [log_id+importer_type+import_time_ms], [log_id+import_time_ms]',
        pipeline_refreshes: '++id, log_id, line_number, refresh_id, total_time_seconds, initiated_by, imports_total, imports_actual, asset_db_process_time_ms, asset_db_callback_time_ms, domain_reloads, domain_reload_time_ms, compile_time_ms, scripting_other_ms',
        domain_reload_steps: '++id, log_id, line_number, parent_id, step_name, time_ms, indent_level',
        script_compilation: '++id, log_id, line_number, assembly_path, defines_count, references_count',
        telemetry_data: '++id, log_id, line_number, telemetry_type, json_data',
        operations: '++id, log_id, line_number, operation_type, operation_name, duration_seconds, duration_ms, memory_mb',
        log_lines: '++id, log_id, line_number, content, line_type, indent_level, is_error, is_warning, timestamp, [log_id+line_number]'
    });
}

/**
 * Insert log lines in batches
 */
async function insertLogLines(logLines, logId) {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase first.');
    }
    if (!dbName) {
        throw new Error('Database name not set. Call initDatabase first.');
    }
    
    console.log('[Worker] Opening database:', dbName);
    await db.open();
    console.log('[Worker] Database opened successfully');
    
    const batchSize = 1000;
    const totalBatches = Math.ceil(logLines.length / batchSize);
    
    console.log('[Worker] Starting insertion:', {
        totalLines: logLines.length,
        totalBatches: totalBatches,
        batchSize: batchSize
    });
    
    // Timing for first 3 batches to estimate remaining time
    const batchTimes = [];
    const startTime = performance.now();
    
    let processed = 0;
    
    for (let i = 0; i < logLines.length; i += batchSize) {
        const batchStartTime = performance.now();
        const batch = logLines.slice(i, i + batchSize);
        
        console.log(`[Worker] Processing batch ${Math.floor(i / batchSize) + 1}/${totalBatches} (${batch.length} lines)`);
        
        await db.log_lines.bulkAdd(batch);
        
        const batchEndTime = performance.now();
        const batchTime = batchEndTime - batchStartTime;
        
        const batchNum = Math.floor(i / batchSize) + 1;
        processed += batch.length;
        
        console.log(`[Worker] Batch ${batchNum} completed in ${(batchTime / 1000).toFixed(2)}s`);
        
        // Track timing for first 3 batches
        if (batchNum <= 3) {
            batchTimes.push(batchTime);
        }
        
        // Calculate estimated time remaining after first 3 batches
        let estimatedTimeRemaining = null;
        if (batchNum >= 3 && batchTimes.length === 3) {
            const avgBatchTime = batchTimes.reduce((sum, t) => sum + t, 0) / batchTimes.length;
            const remainingBatches = totalBatches - batchNum;
            estimatedTimeRemaining = (remainingBatches * avgBatchTime) / 1000; // Convert to seconds
        }
        
        // Send progress update to main thread
        self.postMessage({
            type: 'progress',
            batchNum: batchNum,
            totalBatches: totalBatches,
            processed: processed,
            total: logLines.length,
            percent: (processed / logLines.length) * 100,
            estimatedTimeRemaining: estimatedTimeRemaining
        });
    }
    
    const totalTime = (performance.now() - startTime) / 1000;
    
    console.log(`[Worker] All batches complete! Total time: ${totalTime.toFixed(2)}s`);
    
    // Verify insertion by counting
    const count = await db.log_lines.where('log_id').equals(logId).count();
    console.log(`[Worker] Verification: ${count} log lines in database for log_id ${logId}`);
    
    // Send completion message
    self.postMessage({
        type: 'complete',
        totalTime: totalTime,
        totalLines: logLines.length,
        verifiedCount: count
    });
    
    await db.close();
    console.log('[Worker] Database closed');
}

/**
 * Handle messages from main thread
 */
self.addEventListener('message', async function(e) {
    const message = e.data;
    const { type } = message;
    
    try {
        if (type === 'init') {
            const version = message.version;
            console.log('[Worker] Initializing database with version:', version);
            if (!version) {
                throw new Error('Database version not provided');
            }
            // Initialize database
            initDatabase(version);
            self.postMessage({ type: 'ready' });
            console.log('[Worker] Database initialized, ready for insertions');
        } else if (type === 'insert') {
            const logLines = message.logLines;
            const logId = message.logId;
            console.log('[Worker] Received insert request:', {
                logLinesCount: logLines ? logLines.length : 0,
                logId: logId
            });
            if (!logLines || !logId) {
                throw new Error('Missing logLines or logId in insert message');
            }
            if (!db) {
                throw new Error('Database not initialized. Ensure init message was sent first.');
            }
            // Insert log lines
            await insertLogLines(logLines, logId);
            console.log('[Worker] Insertion complete');
        } else if (type === 'cancel') {
            // Cancel operation (we'll handle this by checking a flag)
            // For now, we'll just acknowledge
            console.log('[Worker] Cancellation requested');
            self.postMessage({ type: 'cancelled' });
        }
    } catch (error) {
        console.error('[Worker] Error:', error);
        // Extract error message more reliably
        let errorMessage = 'Unknown error';
        if (error && typeof error === 'object') {
            errorMessage = error.message || error.toString() || JSON.stringify(error);
        } else if (error) {
            errorMessage = String(error);
        }
        console.error('[Worker] Error message:', errorMessage);
        self.postMessage({
            type: 'error',
            data: errorMessage
        });
    }
});

