/**
 * LogStreamProcessor
 * Handles processing of log data streams (chunks of bytes)
 * Extracts lines and tracks byte offsets consistently
 */
export class LogStreamProcessor {
    constructor() {
        this.decoder = new TextDecoder('utf-8');
        this.lineBuffer = new Uint8Array(0);
        this.bufferOffset = 0;
        this.bufferStartByteOffset = null;
    }

    /**
     * Reset the processor state
     */
    reset() {
        this.lineBuffer = new Uint8Array(0);
        this.bufferOffset = 0;
        this.bufferStartByteOffset = null;
    }

    /**
     * Process a chunk of data
     * @param {ArrayBuffer|Uint8Array} chunk - Data chunk
     * @param {number} chunkStartByteOffset - Byte offset where this chunk starts in the file
     * @param {Function} lineCallback - Callback for each line found: (line, byteOffset) => void
     */
    async processChunk(chunk, chunkStartByteOffset, lineCallback) {
        let chunkArray = new Uint8Array(chunk);

        // Check if we have remaining data from previous chunk
        const remainingLength = this.lineBuffer.length - this.bufferOffset;

        // Overlap/Gap Check
        if (this.bufferStartByteOffset !== null) {
            const expectedEnd = this.bufferStartByteOffset + this.lineBuffer.length;

            if (chunkStartByteOffset < expectedEnd) {
                // Overlap detected!
                // The new chunk starts before the current buffer ends.
                // We must skip the overlapping data to avoid double-counting.
                const overlap = expectedEnd - chunkStartByteOffset;
                if (overlap < chunkArray.length) {
                    chunkArray = chunkArray.subarray(overlap);
                    // Adjust chunkStartByteOffset to match where we are actually starting
                    chunkStartByteOffset += overlap;
                } else {
                    // Chunk is entirely within the overlap? Ignore it.
                    return;
                }
            } else if (chunkStartByteOffset > expectedEnd) {
                // Gap detected!
                // The new chunk starts after the current buffer ends.
                // We accept the gap. The bufferStartByteOffset will jump.
                // This handles the case where we seeked in the file.
            }
        }

        if (remainingLength > 0) {
            // We have unprocessed data in the buffer, append new chunk
            const newBuffer = new Uint8Array(remainingLength + chunkArray.byteLength);
            newBuffer.set(this.lineBuffer.subarray(this.bufferOffset), 0);
            newBuffer.set(chunkArray, remainingLength);

            // Update buffer start offset to point to the start of the remaining data
            if (this.bufferStartByteOffset !== null) {
                this.bufferStartByteOffset += this.bufferOffset;
            } else {
                this.bufferStartByteOffset = chunkStartByteOffset - remainingLength;
            }

            this.lineBuffer = newBuffer;
            this.bufferOffset = 0;
        } else {
            // Buffer was empty or fully processed, start fresh with new chunk
            this.lineBuffer = chunkArray;
            this.bufferOffset = 0;
            this.bufferStartByteOffset = chunkStartByteOffset;
        }

        // Process buffer for newlines
        while (this.bufferOffset < this.lineBuffer.length) {
            let newlineIndex = -1;
            let nlLength = 0;

            // Look for newline
            for (let i = this.bufferOffset; i < this.lineBuffer.length; i++) {
                if (this.lineBuffer[i] === 10) { // '\n'
                    if (i > this.bufferOffset && this.lineBuffer[i - 1] === 13) { // '\r\n'
                        newlineIndex = i - 1;
                        nlLength = 2;
                    } else {
                        newlineIndex = i;
                        nlLength = 1;
                    }
                    break;
                }
            }

            if (newlineIndex !== -1) {
                // Found a line
                const lineLength = newlineIndex - this.bufferOffset;
                const lineBytes = new Uint8Array(this.lineBuffer.buffer, this.lineBuffer.byteOffset + this.bufferOffset, lineLength);
                const line = this.decoder.decode(lineBytes);

                const lineStartByteOffset = this.bufferStartByteOffset + this.bufferOffset;

                await lineCallback(line, lineStartByteOffset);

                // Move past this line and newline
                this.bufferOffset += (lineLength + nlLength);
            } else {
                // No more newlines, stop processing this chunk
                break;
            }
        }
    }

    /**
     * Flush any remaining data as a final line
     * @param {Function} lineCallback 
     */
    async flush(lineCallback) {
        if (this.bufferOffset < this.lineBuffer.length) {
            const remainingLength = this.lineBuffer.length - this.bufferOffset;
            const lineBytes = new Uint8Array(this.lineBuffer.buffer, this.lineBuffer.byteOffset + this.bufferOffset, remainingLength);
            const line = this.decoder.decode(lineBytes);

            const lineStartByteOffset = this.bufferStartByteOffset + this.bufferOffset;

            await lineCallback(line, lineStartByteOffset);

            this.bufferOffset += remainingLength;
        }
    }
}
