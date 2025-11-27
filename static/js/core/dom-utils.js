/**
 * DOM Utilities Module
 * Common DOM manipulation and HTML generation helpers
 */

import { escapeHtml, formatTime } from './formatters.js';

/**
 * Create a stat card HTML
 * @param {string} label - Card label
 * @param {string|number} value - Card value
 * @param {Object} options - Optional configuration
 * @returns {string} HTML string
 */
export function createStatCard(label, value, options = {}) {
    const clickable = options.clickable ? ' clickable' : '';
    const onclick = options.onclick ? ` onclick="${options.onclick}"` : '';
    const style = options.style ? ` style="${options.style}"` : '';
    const title = options.title ? ` title="${escapeHtml(options.title)}"` : '';
    const id = options.id ? ` id="${options.id}"` : '';

    return `
        <div class="stat-card${clickable}"${onclick}${style}${title}${id}>
            <div class="stat-label">${escapeHtml(label)}</div>
            <div class="stat-value">${value}</div>
        </div>
    `;
}

/**
 * Create a loading spinner HTML
 * @param {string} text - Loading text
 * @returns {string} HTML string
 */
export function createLoadingSpinner(text = 'Loading...') {
    return `
        <div class="element-spinner">
            <span class="loading-spinner"></span>
            <span>${escapeHtml(text)}</span>
        </div>
    `;
}

/**
 * Create table header HTML
 * @param {Array} columns - Column definitions
 * @returns {string} HTML string
 */
export function createTableHeader(columns) {
    const headerCells = columns.map(col => {
        const style = col.width ? `width: ${col.width};` : '';
        const align = col.align || 'left';
        return `<th style="text-align: ${align}; ${style}">${escapeHtml(col.label)}</th>`;
    }).join('');
    return `<thead style="position: sticky; top: 0; background: white; z-index: 10;"><tr>${headerCells}</tr></thead>`;
}

/**
 * Create table row HTML
 * @param {Array} cells - Cell contents
 * @param {Object} options - Optional configuration
 * @returns {string} HTML string
 */
export function createTableRow(cells, options = {}) {
    const onclick = options.onclick ? ` onclick="${options.onclick}"` : '';
    const style = options.style || '';
    const className = options.className || '';
    const dataAttrs = options.dataAttrs ? Object.entries(options.dataAttrs)
        .map(([key, value]) => ` data-${key}="${escapeHtml(String(value))}"`)
        .join('') : '';

    const cellsHtml = cells.map((cell, index) => {
        const cellAlign = options.alignments ? options.alignments[index] : 'left';
        const cellStyle = options.cellStyles ? options.cellStyles[index] : '';
        return `<td style="text-align: ${cellAlign}; ${cellStyle}">${cell}</td>`;
    }).join('');

    return `<tr${onclick}${style ? ` style="${style}"` : ''}${className ? ` class="${className}"` : ''}${dataAttrs}>${cellsHtml}</tr>`;
}

/**
 * Set element visibility
 * @param {string} elementId - Element ID
 * @param {boolean} visible - Visibility state
 * @param {string} displayType - Display type when visible
 */
export function setVisible(elementId, visible, displayType = 'block') {
    const el = document.getElementById(elementId);
    if (el) {
        el.style.display = visible ? displayType : 'none';
    }
}

/**
 * Set element innerHTML safely
 * @param {string} elementId - Element ID
 * @param {string} html - HTML content
 */
export function setHTML(elementId, html) {
    const el = document.getElementById(elementId);
    if (el) {
        el.innerHTML = html;
    }
}

/**
 * Get element by ID (shorthand)
 * @param {string} id - Element ID
 * @returns {HTMLElement|null} Element or null
 */
export function $(id) {
    return document.getElementById(id);
}

/**
 * Scroll element into view smoothly
 * @param {HTMLElement|string} element - Element or element ID
 * @param {string} block - Scroll alignment
 */
export function scrollToElement(element, block = 'start') {
    const el = typeof element === 'string' ? document.getElementById(element) : element;
    if (el) {
        setTimeout(() => {
            el.scrollIntoView({ behavior: 'smooth', block });
        }, 100);
    }
}

/**
 * Show toast notification
 * @param {string} message - Message to show
 * @param {string} type - Toast type ('info', 'success', 'warning', 'error')
 * @param {number} duration - Duration in ms
 */
export function showToast(message, type = 'info', duration = 4000) {
    const colors = {
        error: '#f44336',
        success: '#4CAF50',
        warning: '#ff9800',
        info: '#2196F3'
    };

    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type] || colors.info};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.2);
        z-index: 10000;
        font-weight: 600;
        max-width: 400px;
        word-wrap: break-word;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;

    // Add animation styles if not already present
    if (!document.getElementById('toast-animations')) {
        const style = document.createElement('style');
        style.id = 'toast-animations';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Export DOMUtils object for backward compatibility
export const DOMUtils = {
    escapeHtml,
    formatTime,
    createStatCard,
    createLoadingSpinner,
    createTableHeader,
    createTableRow,
    setVisible,
    setHTML,
    $,
    scrollToElement,
    showToast
};

