/**
 * FileReader Module
 * Handles streaming file reading with progress reporting
 * Extracts this concern from the main parser for cleaner separation
 */

import { LogStreamProcessor } from './log-stream-processor.js';

// Default chunk size: 1MB
const CHUNK_SIZE = 1024 * 1024;

// Progress update threshold (percentage)
const PROGRESS_UPDATE_THRESHOLD = 2;

/**
 * Read a file in streaming chunks, calling lineCallback for each line
 * 
 * @param {File} file - The file to read
 * @param {Function} lineCallback - Called for each line: (line, lineNumber, byteOffset) => Promise<void>
 * @param {Object} options - Optional configuration
 * @param {Function} options.onProgress - Progress callback: (percentRead, lineNumber) => void
 * @param {Object} options.cancelSignal - Cancellation signal with .cancelled property
 * @returns {Promise<number>} Total number of lines read
 */
export async function readFileStreaming(file, lineCallback, options = {}) {
    const { onProgress = null, cancelSignal = null } = options;
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const processor = new LogStreamProcessor();
        const totalSize = file.size;
        
        let fileByteOffset = 0;
        let lineNumber = 0;
        let lastProgressUpdate = 0;

        const checkCancelled = () => {
            if (cancelSignal?.cancelled) {
                throw new Error('Parsing cancelled');
            }
        };

        const reportProgress = (percentRead) => {
            if (!onProgress) return;
            
            const percentFloor = Math.floor(percentRead);
            if (percentFloor >= lastProgressUpdate + PROGRESS_UPDATE_THRESHOLD || percentRead >= 100) {
                onProgress(percentRead, lineNumber);
                lastProgressUpdate = percentFloor;
            }
        };

        const processChunk = async (chunkArrayBuffer) => {
            await processor.processChunk(chunkArrayBuffer, fileByteOffset, async (line, lineStartByteOffset) => {
                lineNumber++;
                checkCancelled();
                
                const result = lineCallback(line, lineNumber, lineStartByteOffset);
                if (result?.then) {
                    await result;
                }
            });
        };

        const readNextChunk = () => {
            checkCancelled();

            const slice = file.slice(fileByteOffset, fileByteOffset + CHUNK_SIZE);
            
            if (slice.size === 0) {
                // End of file - flush remaining content
                processor.flush(async (line, lineStartByteOffset) => {
                    lineNumber++;
                    const result = lineCallback(line, lineNumber, lineStartByteOffset);
                    if (result?.then) {
                        await result;
                    }
                }).then(() => {
                    reportProgress(100);
                    resolve(lineNumber);
                }).catch(reject);
                return;
            }

            reader.onload = async (e) => {
                try {
                    await processChunk(e.target.result);
                    fileByteOffset += CHUNK_SIZE;
                    
                    reportProgress((fileByteOffset / totalSize) * 100);

                    // Yield to event loop periodically to keep UI responsive
                    if (fileByteOffset % (CHUNK_SIZE * 10) === 0) {
                        setTimeout(readNextChunk, 0);
                    } else {
                        readNextChunk();
                    }
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file chunk'));
            reader.readAsArrayBuffer(slice);
        };

        try {
            readNextChunk();
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Format file size for display
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size string (e.g., "12.5 MB")
 */
export function formatFileSize(bytes) {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
}

