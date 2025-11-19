/**
 * Log Lines Query
 * Handles complex log line querying with pagination, search, and filtering
 */

class LogLinesQuery {
    constructor(db, logId) {
        this.db = db;
        this.logId = logId;
    }

    /**
     * Query log lines with various options
     */
    async query(options = {}) {
        const {
            center_line,
            offset = 0,
            limit = 100,
            search_query,
            filter_type
        } = options;

        // Get total count efficiently using count() instead of iterating
        const totalLines = await this.db.log_lines
            .where('log_id').equals(this.logId)
            .count();

        // For center_line queries, use efficient range query with compound index
        if (center_line) {
            return await this._queryByCenterLine(center_line, totalLines);
        }

        // For paginated view, use efficient offset/limit with compound index
        if (!search_query && !filter_type) {
            return await this._queryPaginated(offset, limit, totalLines);
        }

        // For search and filter, we still need to load and filter (unavoidable)
        // But we can optimize by limiting the initial load
        if (search_query) {
            return await this._querySearch(search_query, totalLines);
        }

        if (filter_type) {
            return await this._queryFilter(filter_type, totalLines);
        }

        // Fallback (shouldn't reach here)
        return {
            lines: [],
            total_lines: totalLines,
            offset: offset,
            limit: limit,
            has_more: false
        };
    }

    /**
     * Query by center line (for log viewer navigation)
     */
    async _queryByCenterLine(center_line, totalLines) {
        const contextSize = 50; // Load 50 lines before and after
        
        // Clamp center_line to valid range
        let clampedCenterLine = Math.max(1, Math.min(center_line, totalLines));
        
        // If the requested line is beyond total, adjust to show the end
        if (center_line > totalLines && totalLines > 0) {
            console.warn(`[Database] Requested line ${center_line} exceeds total lines ${totalLines}, clamping to ${totalLines}`);
            clampedCenterLine = totalLines;
        }
        
        const start = Math.max(1, clampedCenterLine - contextSize);
        const end = Math.min(totalLines, clampedCenterLine + contextSize);
        
        // Use compound index [log_id+line_number] for efficient range query
        let context = [];
        try {
            // Try compound index first
            context = await this.db.log_lines
                .where('[log_id+line_number]')
                .between([this.logId, start], [this.logId, end], true, true) // Include both bounds
                .toArray();
            
            // If compound index query returned empty but we know lines exist, try fallback
            if (context.length === 0 && totalLines > 0) {
                console.warn(`[Database] Compound index query returned 0 results, trying fallback...`);
                // Fallback: use simple filter
                context = await this.db.log_lines
                    .where('log_id').equals(this.logId)
                    .filter(line => {
                        const lineNum = line.line_number || 0;
                        return lineNum >= start && lineNum <= end;
                    })
                    .toArray();
            }
        } catch (error) {
            console.error('[Database] Error querying log lines with compound index:', error);
            // Fallback: try without compound index
            try {
                context = await this.db.log_lines
                    .where('log_id').equals(this.logId)
                    .filter(line => {
                        const lineNum = line.line_number || 0;
                        return lineNum >= start && lineNum <= end;
                    })
                    .toArray();
            } catch (fallbackError) {
                console.error('[Database] Fallback query also failed:', fallbackError);
                context = [];
            }
        }
        
        // Sort by line_number (should already be sorted by index, but ensure it)
        context.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
        
        // If no lines found but totalLines > 0, log detailed warning
        if (context.length === 0 && totalLines > 0) {
            console.warn(`[Database] No log lines found for range ${start}-${end} (center: ${center_line}), but total lines: ${totalLines}`);
            console.warn(`[Database] Attempting to verify log lines exist for log_id: ${this.logId}`);
            
            // Try to get a sample of lines to verify they exist
            const sample = await this.db.log_lines
                .where('log_id').equals(this.logId)
                .limit(5)
                .toArray();
            
            if (sample.length > 0) {
                console.warn(`[Database] Sample lines found:`, sample.map(l => ({ line_number: l.line_number, has_content: !!l.content })));
                // Try a wider range, but clamp to totalLines
                const widerStart = Math.max(1, clampedCenterLine - 200);
                const widerEnd = Math.min(totalLines, clampedCenterLine + 200);
                context = await this.db.log_lines
                    .where('log_id').equals(this.logId)
                    .filter(line => {
                        const lineNum = line.line_number || 0;
                        return lineNum >= widerStart && lineNum <= widerEnd;
                    })
                    .toArray();
                context.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
                // Filter to the original range
                context = context.filter(line => {
                    const lineNum = line.line_number || 0;
                    return lineNum >= start && lineNum <= end;
                });
                
                // If still no results, try getting the last available lines
                if (context.length === 0 && totalLines > 0) {
                    console.warn(`[Database] Still no results after wider search, trying to get last ${contextSize * 2} lines`);
                    const lastStart = Math.max(1, totalLines - (contextSize * 2));
                    context = await this.db.log_lines
                        .where('log_id').equals(this.logId)
                        .filter(line => {
                            const lineNum = line.line_number || 0;
                            return lineNum >= lastStart && lineNum <= totalLines;
                        })
                        .toArray();
                    context.sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
                    clampedCenterLine = totalLines; // Update center to last line
                }
            } else {
                console.error(`[Database] No sample lines found - database may not be populated correctly`);
            }
        }
        
        return {
            lines: context,
            total_lines: totalLines,
            center_line: clampedCenterLine, // Return clamped center line
            requested_line: center_line, // Keep original for reference
            range_start: start,
            range_end: end
        };
    }

    /**
     * Query with pagination
     */
    async _queryPaginated(offset, limit, totalLines) {
        // Use compound index for efficient pagination
        const paginated = await this.db.log_lines
            .where('[log_id+line_number]')
            .between([this.logId, Dexie.minKey], [this.logId, Dexie.maxKey])
            .offset(offset)
            .limit(limit)
            .toArray();
        
        return {
            lines: paginated,
            total_lines: totalLines,
            offset: offset,
            limit: limit,
            has_more: offset + limit < totalLines
        };
    }

    /**
     * Query with search
     */
    async _querySearch(search_query, totalLines) {
        // For search, load in chunks and stop when we have enough matches
        const matching = [];
        const maxResults = 500;
        let processed = 0;
        const chunkSize = 10000; // Process 10k lines at a time
        
        while (matching.length < maxResults && processed < totalLines) {
            const chunk = await this.db.log_lines
                .where('[log_id+line_number]')
                .between([this.logId, Dexie.minKey], [this.logId, Dexie.maxKey])
                .offset(processed)
                .limit(chunkSize)
                .toArray();
            
            if (chunk.length === 0) break;
            
            const chunkMatches = chunk.filter(line => 
                line.content.toLowerCase().includes(search_query.toLowerCase())
            );
            matching.push(...chunkMatches);
            
            processed += chunk.length;
            
            // Stop if we have enough results
            if (matching.length >= maxResults) {
                break;
            }
        }
        
        return {
            lines: matching.slice(0, maxResults),
            total_lines: totalLines,
            is_search: true,
            search_results: matching.length
        };
    }

    /**
     * Query with filter
     */
    async _queryFilter(filter_type, totalLines) {
        // For filters, load in chunks and filter
        let filtered = [];
        const maxResults = 1000;
        let processed = 0;
        const chunkSize = 10000; // Process 10k lines at a time
        
        while (filtered.length < maxResults && processed < totalLines) {
            const chunk = await this.db.log_lines
                .where('[log_id+line_number]')
                .between([this.logId, Dexie.minKey], [this.logId, Dexie.maxKey])
                .offset(processed)
                .limit(chunkSize)
                .toArray();
            
            if (chunk.length === 0) break;
            
            let chunkFiltered;
            if (filter_type === 'error') {
                chunkFiltered = chunk.filter(l => l.is_error);
            } else if (filter_type === 'warning') {
                chunkFiltered = chunk.filter(l => l.is_warning);
            } else if (filter_type === 'import') {
                chunkFiltered = chunk.filter(l => l.line_type === 'import');
            } else if (filter_type === 'pipeline') {
                chunkFiltered = chunk.filter(l => l.line_type === 'pipeline');
            } else {
                chunkFiltered = chunk;
            }
            
            filtered.push(...chunkFiltered);
            processed += chunk.length;
            
            // Stop if we have enough results
            if (filtered.length >= maxResults) {
                break;
            }
        }
        
        return {
            lines: filtered.slice(0, maxResults),
            total_lines: totalLines,
            is_filtered: true,
            filter_type: filter_type,
            filter_results: filtered.length
        };
    }
}

// Export for use in other modules
window.LogLinesQuery = LogLinesQuery;

