/**
 * Timeline Normalizer
 * Post-processing step for non-timestamped logs to normalize timestamps after backwards calculations
 * 
 * Problem: Operations with durations calculate start timestamps before the epoch (2000-01-01T00:00:00.000Z).
 * This means subsequent events (worker imports, asset imports) that happened AFTER the operation
 * still have timestamps based on the original epoch, creating a timeline gap.
 * 
 * Solution: Shift all timestamps so the earliest timestamp becomes the new timeline start (t=0),
 * maintaining relative timing between all events.
 */

class TimelineNormalizer {
    constructor(db, logId) {
        this.db = db;
        this.logId = logId;
        this.EPOCH = new Date('2000-01-01T00:00:00.000Z').getTime();
    }

    /**
     * Normalize timeline for non-timestamped logs
     * Only runs if:
     * 1. Log is non-timestamped (metadata.timestampsEnabled === false)
     * 2. There are backwards-calculated timestamps (before epoch)
     */
    async normalize() {
        console.log('[TimelineNormalizer] Starting normalization check...');
        
        // Ensure database is open
        if (!this.db) {
            console.error('[TimelineNormalizer] Database instance is null/undefined');
            return { normalized: false, reason: 'no_database' };
        }
        
        await this.db.open();
        
        if (!this.db.db) {
            console.error('[TimelineNormalizer] Database Dexie instance is null/undefined after open()');
            return { normalized: false, reason: 'no_dexie_instance' };
        }
        
        // Get metadata
        const metadata = await this.db.db.log_metadata.get(this.logId);
        if (!metadata) {
            console.log('[TimelineNormalizer] No metadata found, skipping normalization');
            return { normalized: false, reason: 'no_metadata' };
        }

        // Only process non-timestamped logs
        if (metadata.timestampsEnabled === true) {
            console.log('[TimelineNormalizer] Timestamped log detected, skipping normalization');
            return { normalized: false, reason: 'timestamped_log' };
        }

        // Check if we have start/end timestamps
        if (!metadata.start_timestamp || !metadata.end_timestamp) {
            console.log('[TimelineNormalizer] No timeline range in metadata, skipping normalization');
            return { normalized: false, reason: 'no_timeline_range' };
        }

        const startMs = new Date(metadata.start_timestamp).getTime();
        const endMs = new Date(metadata.end_timestamp).getTime();

        console.log('[TimelineNormalizer] Timeline range:', {
            start: metadata.start_timestamp,
            end: metadata.end_timestamp,
            durationHours: ((endMs - startMs) / 3600000).toFixed(2)
        });

        // Calculate shift needed
        // Problem: Events were stamped with logCurrentTime starting at EPOCH (2000-01-01T00:00:00.000Z)
        // But operations with durations calculated start times BEFORE epoch (e.g., 1999-12-31T20:09:35.204Z)
        // Solution: Shift all events backwards by (EPOCH - actual_start_time) to align with operation start
        const shiftMs = this.EPOCH - startMs; // Positive value = shift backwards
        
        console.log('[TimelineNormalizer] Shift calculation:', {
            startMs: startMs,
            epoch: this.EPOCH,
            isBeforeEpoch: startMs < this.EPOCH,
            shiftMs: shiftMs,
            shiftHours: (shiftMs / 3600000).toFixed(2)
        });

        // Normalize all timestamps by shifting them backwards
        const stats = await this._shiftAllTimestamps(shiftMs);

        // Metadata range stays the same (already correct from parser tracking)
        // No need to update metadata - it already has the correct start/end timestamps

        console.log('[TimelineNormalizer] Normalization complete:', {
            ...stats,
            metadataStart: metadata.start_timestamp,
            metadataEnd: metadata.end_timestamp
        });

        return {
            normalized: true,
            stats,
            timelineStart: metadata.start_timestamp,
            timelineEnd: metadata.end_timestamp,
            shiftAppliedMs: shiftMs
        };
    }

    /**
     * Shift all timestamps in the database
     */
    async _shiftAllTimestamps(shiftMs) {
        const stats = {
            operations: 0,
            assetImports: 0,
            workerPhases: 0,
            cacheServerBlocks: 0
        };

        // Shift operations
        console.log('[TimelineNormalizer] Fetching operations...');
        const operations = await this.db.db.processes.toArray();
        
        console.log(`[TimelineNormalizer] Shifting ${operations.length} operations...`);
        for (const op of operations) {
            const updates = {};
            
            if (op.start_timestamp) {
                const startMs = new Date(op.start_timestamp).getTime();
                updates.start_timestamp = new Date(startMs - shiftMs).toISOString();
            }
            
            if (op.end_timestamp) {
                const endMs = new Date(op.end_timestamp).getTime();
                updates.end_timestamp = new Date(endMs - shiftMs).toISOString();
            }
            
            if (Object.keys(updates).length > 0) {
                await this.db.db.processes.update(op.id, updates);
                stats.operations++;
            }
        }

        // Shift asset imports (including worker imports)
        console.log('[TimelineNormalizer] Fetching asset imports...');
        const assetImports = await this.db.db.asset_imports.toArray();
        
        console.log(`[TimelineNormalizer] Shifting ${assetImports.length} asset imports...`);
        const totalImports = assetImports.length;
        for (let i = 0; i < assetImports.length; i++) {
            const imp = assetImports[i];
            
            // Log progress every 10000 items
            if (i > 0 && i % 10000 === 0) {
                console.log(`[TimelineNormalizer] Progress: ${i}/${totalImports} asset imports (${((i/totalImports)*100).toFixed(1)}%)`);
            }
            const updates = {};
            
            if (imp.start_timestamp) {
                const startMs = new Date(imp.start_timestamp).getTime();
                updates.start_timestamp = new Date(startMs - shiftMs).toISOString();
            }
            
            if (imp.end_timestamp) {
                const endMs = new Date(imp.end_timestamp).getTime();
                updates.end_timestamp = new Date(endMs - shiftMs).toISOString();
            }
            
            if (Object.keys(updates).length > 0) {
                await this.db.db.asset_imports.update(imp.id, updates);
                stats.assetImports++;
            }
        }
        console.log(`[TimelineNormalizer] Completed shifting ${stats.assetImports} asset imports`);

        // Shift worker thread phases
        console.log('[TimelineNormalizer] Fetching worker phases...');
        const workerPhases = await this.db.db.worker_thread_phases.toArray();
        
        console.log(`[TimelineNormalizer] Shifting ${workerPhases.length} worker phases...`);
        for (const phase of workerPhases) {
            const updates = {};
            
            if (phase.start_timestamp) {
                const startMs = new Date(phase.start_timestamp).getTime();
                updates.start_timestamp = new Date(startMs - shiftMs).toISOString();
            }
            
            if (phase.end_timestamp) {
                const endMs = new Date(phase.end_timestamp).getTime();
                updates.end_timestamp = new Date(endMs - shiftMs).toISOString();
            }
            
            if (Object.keys(updates).length > 0) {
                await this.db.db.worker_thread_phases.update(phase.id, updates);
                stats.workerPhases++;
            }
        }

        // Shift cache server blocks
        console.log('[TimelineNormalizer] Fetching cache server blocks...');
        const cacheBlocks = await this.db.db.cache_server_download_blocks.toArray();
        
        console.log(`[TimelineNormalizer] Shifting ${cacheBlocks.length} cache server blocks...`);
        for (const block of cacheBlocks) {
            const updates = {};
            
            if (block.start_timestamp) {
                const startMs = new Date(block.start_timestamp).getTime();
                updates.start_timestamp = new Date(startMs - shiftMs).toISOString();
            }
            
            if (block.end_timestamp) {
                const endMs = new Date(block.end_timestamp).getTime();
                updates.end_timestamp = new Date(endMs - shiftMs).toISOString();
            }
            
            if (block.last_timestamp) {
                const lastMs = new Date(block.last_timestamp).getTime();
                updates.last_timestamp = new Date(lastMs - shiftMs).toISOString();
            }
            
            if (Object.keys(updates).length > 0) {
                await this.db.db.cache_server_download_blocks.update(block.id, updates);
                stats.cacheServerBlocks++;
            }
        }

        return stats;
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.TimelineNormalizer = TimelineNormalizer;
}

export { TimelineNormalizer };
