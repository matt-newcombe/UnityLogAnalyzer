/**
 * Chart Tooltips Module
 * Custom tooltip handlers for Chart.js
 */

/**
 * Get or create tooltip element for a chart
 * @param {Chart} chart - Chart.js instance
 * @returns {HTMLElement} Tooltip element
 */
export function getOrCreateTooltip(chart) {
    let tooltipEl = chart.canvas.parentNode.querySelector('div.chartjs-tooltip');

    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'chartjs-tooltip';
        tooltipEl.style.cssText = `
            position: absolute;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 0.9em;
            pointer-events: none;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.2s;
            max-width: 300px;
        `;
        chart.canvas.parentNode.appendChild(tooltipEl);
    }

    return tooltipEl;
}

/**
 * External tooltip handler for Chart.js (matches timeline tooltip styling)
 * @param {Object} context - Chart.js tooltip context
 */
export function externalTooltipHandler(context) {
    const { chart, tooltip } = context;
    const tooltipEl = getOrCreateTooltip(chart);

    // Hide if no tooltip
    if (tooltip.opacity === 0) {
        tooltipEl.style.opacity = 0;
        return;
    }

    // Set HTML content
    if (tooltip.body) {
        const titleLines = tooltip.title || [];
        const bodyLines = tooltip.body.map(b => b.lines);
        const colors = tooltip.labelColors[0];

        let innerHtml = '';

        // Title with color indicator
        if (titleLines.length > 0) {
            const color = colors.backgroundColor;
            innerHtml += `
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                    <div style="width: 12px; height: 12px; background: ${color}; border-radius: 2px; flex-shrink: 0;"></div>
                    <span style="font-weight: 600;">${titleLines[0]}</span>
                </div>
            `;
        }

        // Body lines
        bodyLines.forEach((body) => {
            const lines = Array.isArray(body) ? body : [body];
            lines.forEach((line, j) => {
                const color = j === 0 ? '#ccc' : '#aaa';
                const fontSize = j === 0 ? '1em' : '0.9em';
                innerHtml += `<div style="color: ${color}; font-size: ${fontSize}; margin-bottom: ${j === lines.length - 1 ? '0' : '4px'};">${line}</div>`;
            });
        });

        tooltipEl.innerHTML = innerHtml;
    }

    const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;

    tooltipEl.style.opacity = 1;
    tooltipEl.style.left = positionX + tooltip.caretX + 10 + 'px';
    tooltipEl.style.top = positionY + tooltip.caretY - 40 + 'px';
}

// Export to window for backward compatibility
window.getOrCreateTooltip = getOrCreateTooltip;
window.externalTooltipHandler = externalTooltipHandler;

