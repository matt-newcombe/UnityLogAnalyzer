/**
 * Template Functions Module
 * Reusable HTML template generators for consistent UI components
 */

// ============================================================================
// LAYOUT TEMPLATES
// ============================================================================

/**
 * Create a chart card container
 * @param {Object} options - Card options
 * @param {string} options.title - Card title
 * @param {string} options.subtitle - Optional subtitle/description
 * @param {string} options.content - Inner HTML content
 * @param {number} options.colspan - Grid column span (default: 1, use 'full' for 1/-1)
 * @param {string} options.minHeight - Minimum height (default: auto)
 * @param {boolean} options.clickable - Whether card is clickable
 * @param {string} options.onClick - onclick handler string
 * @param {string} options.id - Optional ID for the card
 */
export function chartCard({ title, subtitle, content, colspan = 1, minHeight, clickable, onClick, id }) {
    const colspanStyle = colspan === 'full' ? 'grid-column: 1 / -1;' : 
                         colspan > 1 ? `grid-column: span ${colspan};` : '';
    const heightStyle = minHeight ? `min-height: ${minHeight};` : '';
    const clickClass = clickable ? 'clickable' : '';
    const clickAttr = onClick ? `onclick="${onClick}"` : '';
    const cursorStyle = clickable ? 'cursor: pointer;' : '';
    const titleAttr = clickable ? 'title="Click for details"' : '';
    const idAttr = id ? `id="${id}"` : '';
    
    const titleHtml = title ? `<h2>${title}</h2>` : '';
    const subtitleHtml = subtitle ? `<p class="chart-subtitle">${subtitle}</p>` : '';
    
    return `
        <div class="chart-card ${clickClass}" ${idAttr} style="${colspanStyle}${heightStyle}${cursorStyle}" ${clickAttr} ${titleAttr}>
            ${titleHtml}
            ${subtitleHtml}
            ${content}
        </div>
    `;
}

/**
 * Create a table container with optional stats grid
 * @param {Object} options - Container options
 * @param {string} options.title - Table title
 * @param {Array} options.stats - Array of stat objects [{label, value, id?}]
 * @param {string} options.hint - Hint text (💡 prefix added automatically)
 * @param {string} options.content - Inner HTML content (usually table)
 * @param {string} options.footer - Optional footer HTML
 * @param {string} options.backButton - Optional back button config {text, onClick}
 */
export function tableContainer({ title, stats, hint, content, footer, backButton }) {
    const backButtonHtml = backButton ? `
        <div class="table-back-button-container">
            <button onclick="${backButton.onClick}" class="table-back-button">
                ← ${backButton.text}
            </button>
        </div>
    ` : '';
    
    const statsHtml = stats && stats.length > 0 ? `
        <div class="table-stats-grid">
            ${stats.map(stat => statCard({ label: stat.label, value: stat.value, id: stat.id })).join('')}
        </div>
    ` : '';
    
    const hintHtml = hint ? `<p class="table-hint">💡 ${hint}</p>` : '';
    const footerHtml = footer ? `<div class="table-footer">${footer}</div>` : '';
    
    return `
        <div class="table-container">
            ${backButtonHtml}
            <h2>${title}</h2>
            ${statsHtml}
            ${hintHtml}
            ${content}
            ${footerHtml}
        </div>
    `;
}

// ============================================================================
// STAT CARD TEMPLATES
// ============================================================================

/**
 * Create a stat card
 * @param {Object} options - Stat options
 * @param {string} options.label - Stat label
 * @param {string|number} options.value - Stat value
 * @param {string} options.id - Optional ID for the value element
 * @param {boolean} options.clickable - Whether card is clickable
 * @param {string} options.onClick - onclick handler string
 * @param {string} options.title - Tooltip title
 */
export function statCard({ label, value, id, clickable, onClick, title }) {
    const clickClass = clickable ? 'clickable' : '';
    const clickAttr = onClick ? `onclick="${onClick}"` : '';
    const cursorStyle = clickable ? 'cursor: pointer;' : '';
    const titleAttr = title ? `title="${title}"` : '';
    const idAttr = id ? `id="${id}"` : '';
    
    return `
        <div class="stat-card ${clickClass}" style="margin: 0;${cursorStyle}" ${clickAttr} ${titleAttr}>
            <div class="stat-label">${label}</div>
            <div class="stat-value" ${idAttr}>${value}</div>
        </div>
    `;
}

/**
 * Create a stats grid
 * @param {Array} stats - Array of stat objects
 */
export function statsGrid(stats) {
    return `
        <div class="table-stats-grid">
            ${stats.map(stat => statCard(stat)).join('')}
        </div>
    `;
}

// ============================================================================
// EMPTY/LOADING STATE TEMPLATES
// ============================================================================

/**
 * Create an empty state display
 * @param {Object} options - Empty state options
 * @param {string} options.title - Main message
 * @param {string} options.message - Optional secondary message
 * @param {string} options.buttonText - Optional button text
 * @param {string} options.buttonAction - Optional button onclick handler
 * @param {string} options.icon - Optional icon (default: none)
 */
export function emptyState({ title, message, buttonText, buttonAction, icon }) {
    const iconHtml = icon ? `<span class="empty-state-icon">${icon}</span>` : '';
    const messageHtml = message ? `<p class="empty-state-message">${message}</p>` : '';
    const buttonHtml = buttonText && buttonAction ? `
        <button onclick="${buttonAction}" class="empty-state-button">
            ${buttonText}
        </button>
    ` : '';
    
    return `
        <div class="empty-state">
            ${iconHtml}
            <h2 class="empty-state-title">${title}</h2>
            ${messageHtml}
            ${buttonHtml}
        </div>
    `;
}

/**
 * Create a loading spinner
 * @param {string} message - Loading message
 */
export function loadingSpinner(message = 'Loading...') {
    return `
        <div class="element-spinner">
            <span class="loading-spinner"></span>
            <span>${message}</span>
        </div>
    `;
}

/**
 * Create a loading indicator for tables
 * @param {number} colspan - Number of columns to span
 * @param {string} message - Loading message
 */
export function tableLoadingRow(colspan, message = 'Loading...') {
    return `
        <tr>
            <td colspan="${colspan}" class="table-loading-cell">
                ${loadingSpinner(message)}
            </td>
        </tr>
    `;
}

/**
 * Create an error message row for tables
 * @param {number} colspan - Number of columns to span
 * @param {string} message - Error message
 */
export function tableErrorRow(colspan, message) {
    return `
        <tr>
            <td colspan="${colspan}" class="table-error-cell">
                ${message}
            </td>
        </tr>
    `;
}

/**
 * Create an empty message row for tables
 * @param {number} colspan - Number of columns to span
 * @param {string} message - Empty message
 */
export function tableEmptyRow(colspan, message = 'No data found') {
    return `
        <tr>
            <td colspan="${colspan}" class="table-empty-cell">
                ${message}
            </td>
        </tr>
    `;
}

// ============================================================================
// TABLE TEMPLATES
// ============================================================================

/**
 * Create a scrollable table wrapper
 * @param {Object} options - Table options
 * @param {string} options.id - Scroll container ID
 * @param {string} options.maxHeight - Max height (default: 600px)
 * @param {string} options.content - Table HTML content
 */
export function scrollableTable({ id, maxHeight = '600px', content }) {
    const idAttr = id ? `id="${id}"` : '';
    return `
        <div class="table-scroll-container" ${idAttr} style="max-height: ${maxHeight};">
            ${content}
        </div>
    `;
}

/**
 * Create a table with header and body
 * @param {Object} options - Table options
 * @param {Array} options.headers - Array of header objects [{text, width?, align?}]
 * @param {string} options.bodyId - ID for tbody element
 * @param {string} options.bodyContent - Initial tbody content
 */
export function table({ headers, bodyId, bodyContent = '' }) {
    const headerCells = headers.map(h => {
        const widthStyle = h.width ? `width: ${h.width};` : h.minWidth ? `min-width: ${h.minWidth};` : '';
        const alignStyle = h.align ? `text-align: ${h.align};` : '';
        return `<th style="${widthStyle}${alignStyle}">${h.text}</th>`;
    }).join('');
    
    const bodyIdAttr = bodyId ? `id="${bodyId}"` : '';
    
    return `
        <table>
            <thead class="table-sticky-header">
                <tr>${headerCells}</tr>
            </thead>
            <tbody ${bodyIdAttr}>
                ${bodyContent}
            </tbody>
        </table>
    `;
}

// ============================================================================
// TABLE ROW TEMPLATES
// ============================================================================

/**
 * Create a clickable table row
 * @param {Object} options - Row options
 * @param {string} options.onClick - onclick handler
 * @param {string} options.cells - Cell HTML content
 * @param {Object} options.data - Data attributes {line, path, etc}
 */
export function clickableRow({ onClick, cells, data = {} }) {
    const dataAttrs = Object.entries(data)
        .map(([key, value]) => `data-${key}="${String(value).replace(/"/g, '&quot;')}"`)
        .join(' ');
    
    return `
        <tr class="clickable-row" onclick="${onClick}" ${dataAttrs}>
            ${cells}
        </tr>
    `;
}

/**
 * Create a line number cell with link
 * @param {number} lineNumber - Line number
 */
export function lineNumberCell(lineNumber) {
    return `
        <td class="line-number-cell">
            <a href="javascript:void(0)" 
               class="line-number-link"
               onclick="event.stopPropagation(); openLogViewer(${lineNumber});"
               title="Jump to line ${lineNumber} in log">
                ${lineNumber}
            </a>
        </td>
    `;
}

/**
 * Create a badge cell
 * @param {string} text - Badge text
 * @param {string} variant - Badge variant (default, warning, success)
 */
export function badgeCell(text, variant = 'default') {
    const className = variant === 'warning' ? 'badge-warning' : 
                      variant === 'success' ? 'badge-success' : 'badge';
    return `<td><span class="${className}">${text}</span></td>`;
}

/**
 * Create a time badge cell
 * @param {number} timeSeconds - Time in seconds
 * @param {Object} options - Options
 * @param {number} options.warnThreshold - Seconds above which to show warning (default: 1)
 * @param {number} options.successThreshold - Seconds below which to show success (default: 0.1)
 * @param {string} options.formattedTime - Pre-formatted time string
 */
export function timeBadgeCell(timeSeconds, { warnThreshold = 1, successThreshold = 0.1, formattedTime } = {}) {
    const variant = timeSeconds > warnThreshold ? 'warning' : 
                    timeSeconds < successThreshold ? 'success' : 'default';
    const className = variant === 'warning' ? 'badge-warning' : 
                      variant === 'success' ? 'badge-success' : 'badge';
    const displayTime = formattedTime || `${timeSeconds.toFixed(2)}s`;
    
    return `
        <td style="text-align: right;">
            <span class="${className}" style="font-weight: 600;">${displayTime}</span>
        </td>
    `;
}

/**
 * Create a mono text cell
 * @param {string} text - Text content
 * @param {string} align - Text alignment
 */
export function monoCell(text, align = 'left') {
    return `<td style="text-align: ${align};"><span class="mono">${text}</span></td>`;
}

/**
 * Create a truncated text cell
 * @param {string} text - Text content
 * @param {string} title - Full text for tooltip
 * @param {boolean} long - Use long truncation style
 */
export function truncatedCell(text, title, long = false) {
    const className = long ? 'text-truncate-long' : 'text-truncate';
    const titleAttr = title ? `title="${title.replace(/"/g, '&quot;')}"` : '';
    return `
        <td>
            <span class="${className}" ${titleAttr} style="font-size: 0.9em; color: #666;">
                ${text}
            </span>
        </td>
    `;
}

/**
 * Create a rank cell (for numbered lists)
 * @param {number} rank - Rank number
 */
export function rankCell(rank) {
    return `<td class="rank-cell">${rank}</td>`;
}

// ============================================================================
// CHART CONTENT TEMPLATES
// ============================================================================

/**
 * Create a chart container with canvas
 * @param {string} canvasId - Canvas element ID
 * @param {string} loadingMessage - Loading message
 */
export function chartContainer(canvasId, loadingMessage = 'Loading chart...') {
    return `
        <div class="chart-container">
            ${loadingSpinner(loadingMessage)}
            <canvas id="${canvasId}" style="display: none;"></canvas>
        </div>
    `;
}

/**
 * Create a timeline container
 * @param {string} id - Container ID
 * @param {string} loadingMessage - Loading message
 */
export function timelineContainer(id = 'timeline-container', loadingMessage = 'Loading timeline...') {
    return `
        <div id="${id}" class="timeline-container">
            ${loadingSpinner(loadingMessage)}
        </div>
    `;
}

// ============================================================================
// STATUS BANNER TEMPLATES
// ============================================================================

/**
 * Create a success status banner
 * @param {string} message - Status message
 * @param {string} icon - Icon (default: ✓)
 */
export function successBanner(message, icon = '✓') {
    return `
        <div class="status-banner status-banner-success">
            <span class="status-banner-icon">${icon}</span>
            <span class="status-banner-text">${message}</span>
        </div>
    `;
}

/**
 * Create a warning status banner
 * @param {string} message - Status message
 * @param {string} onClick - Optional click handler
 * @param {string} icon - Icon (default: ⚠️)
 */
export function warningBanner(message, onClick, icon = '⚠️') {
    const clickAttr = onClick ? `onclick="${onClick}"` : '';
    const clickClass = onClick ? 'clickable' : '';
    
    return `
        <div class="status-banner status-banner-warning ${clickClass}" ${clickAttr}>
            <span class="status-banner-icon">${icon}</span>
            <span class="status-banner-text">${message}</span>
        </div>
    `;
}

// ============================================================================
// DIALOG TEMPLATES
// ============================================================================

/**
 * Create a modal dialog overlay
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.icon - Optional icon
 * @param {string} options.content - Dialog body content
 * @param {string} options.buttonText - Close button text
 */
export function dialogOverlay({ title, icon, content, buttonText = 'Got it' }) {
    const iconHtml = icon ? `<span>${icon}</span>` : '';
    
    return `
        <div class="dialog-overlay" data-dialog="true">
            <div class="dialog-content">
                <h3 class="dialog-title">
                    ${iconHtml}
                    ${title}
                </h3>
                <div class="dialog-body">
                    ${content}
                    <button onclick="this.closest('[data-dialog]').remove()" class="dialog-close-button">
                        ${buttonText}
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ============================================================================
// LOAD INDICATOR TEMPLATES
// ============================================================================

/**
 * Create a load progress indicator
 * @param {string} id - Element ID
 * @param {string} message - Initial message
 */
export function loadIndicator(id, message = 'Loading...') {
    return `
        <div id="${id}" class="load-indicator" style="display: none;">
            ${message}
        </div>
    `;
}

/**
 * Create an info text element
 * @param {string} id - Element ID
 * @param {string} message - Initial message
 */
export function infoText(id, message = '') {
    return `
        <div id="${id}" class="info-text">
            ${message}
        </div>
    `;
}

