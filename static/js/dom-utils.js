/**
 * DOM Utilities for Unity Log Analyzer
 * Common DOM manipulation and HTML generation helpers
 */

const DOMUtils = {
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Format time in seconds to readable format
     * Always shows 2 decimal places for precision
     */
    formatTime(seconds) {
        if (seconds >= 3600) {
            const hours = Math.floor(seconds / 3600);
            const remainingSeconds = seconds % 3600;
            const mins = Math.floor(remainingSeconds / 60);
            const secs = (remainingSeconds % 60).toFixed(2);
            return `${hours}h ${mins}m ${secs}s`;
        } else if (seconds >= 60) {
            const minutes = Math.floor(seconds / 60);
            const secs = (seconds % 60).toFixed(2);
            return `${minutes}m ${secs}s`;
        }
        return seconds.toFixed(2) + 's';
    },

    /**
     * Create a stat card HTML
     */
    createStatCard(label, value, options = {}) {
        const clickable = options.clickable ? ' clickable' : '';
        const onclick = options.onclick ? ` onclick="${options.onclick}"` : '';
        const style = options.style || '';
        const title = options.title ? ` title="${this.escapeHtml(options.title)}"` : '';
        const id = options.id ? ` id="${options.id}"` : '';

        return `
            <div class="stat-card${clickable}"${onclick}${style}${title}${id}>
                <div class="stat-label">${this.escapeHtml(label)}</div>
                <div class="stat-value">${value}</div>
            </div>
        `;
    },

    /**
     * Create a loading spinner HTML
     */
    createLoadingSpinner(text = 'Loading...') {
        return `
            <span class="loading-spinner"></span>
            <span>${this.escapeHtml(text)}</span>
        `;
    },

    /**
     * Create table header HTML
     */
    createTableHeader(columns) {
        const headerCells = columns.map(col => 
            `<th style="text-align: ${col.align || 'left'};">${this.escapeHtml(col.label)}</th>`
        ).join('');
        return `<thead><tr>${headerCells}</tr></thead>`;
    },

    /**
     * Create table row HTML
     */
    createTableRow(cells, options = {}) {
        const onclick = options.onclick ? ` onclick="${options.onclick}"` : '';
        const style = options.style || '';
        const className = options.className || '';
        
        const cellsHtml = cells.map((cell, index) => {
            const cellAlign = options.alignments ? options.alignments[index] : 'left';
            return `<td style="text-align: ${cellAlign};">${cell}</td>`;
        }).join('');

        return `<tr${onclick}${style ? ` style="${style}"` : ''}${className ? ` class="${className}"` : ''}>${cellsHtml}</tr>`;
    },

    /**
     * Set element visibility
     */
    setVisible(elementId, visible) {
        const el = document.getElementById(elementId);
        if (el) {
            el.style.display = visible ? 'block' : 'none';
        }
    },

    /**
     * Set element innerHTML safely
     */
    setHTML(elementId, html) {
        const el = document.getElementById(elementId);
        if (el) {
            el.innerHTML = html;
        }
    },

    /**
     * Get element safely
     */
    $(id) {
        return document.getElementById(id);
    }
};

// Make available globally
window.DOMUtils = DOMUtils;

// Shorter aliases
window.escapeHtml = DOMUtils.escapeHtml.bind(DOMUtils);
window.formatTime = DOMUtils.formatTime.bind(DOMUtils);

