/**
 * Timeline Tooltip Module
 * Handles tooltip display for timeline segments
 */

let tooltipElement = null;

/**
 * Ensure tooltip element exists in the DOM
 * @returns {HTMLElement} Tooltip element
 */
function ensureTooltipExists() {
    if (!tooltipElement) {
        tooltipElement = document.getElementById('timeline-tooltip');
        if (!tooltipElement) {
            tooltipElement = document.createElement('div');
            tooltipElement.id = 'timeline-tooltip';
            tooltipElement.style.cssText = `
                position: fixed;
                background: rgba(0,0,0,0.9);
                color: white;
                padding: 10px 15px;
                border-radius: 5px;
                font-size: 0.9em;
                pointer-events: none;
                z-index: 10000;
                display: none;
                max-width: 300px;
            `;
            document.body.appendChild(tooltipElement);
        }
    }
    return tooltipElement;
}

/**
 * Show tooltip for timeline segment on hover
 * @param {MouseEvent} event - Mouse event
 * @param {HTMLElement} element - Timeline segment element
 */
export function showTimelineTooltip(event, element) {
    try {
        const tooltip = ensureTooltipExists();

        const description = element.getAttribute('data-description') || '';
        const category = element.getAttribute('data-category');
        const phase = element.getAttribute('data-phase');
        const workerId = element.getAttribute('data-worker-id');

        // Get segment color
        const visualElement = element.querySelector('.timeline-segment-visual');
        let segmentColor = '#999';
        if (visualElement) {
            segmentColor = window.getComputedStyle(visualElement).backgroundColor;
        } else if (element.classList.contains('timeline-phase-overlay')) {
            segmentColor = 'rgba(255, 152, 0, 0.6)';
        }

        // Parse time from description
        const timeMatch = description ? description.match(/\(([^)]+)\)$/) : null;
        const timeText = timeMatch ? timeMatch[1] : '';
        const descriptionWithoutTime = timeMatch && description 
            ? description.substring(0, timeMatch.index).trim() 
            : description;

        // Build tooltip HTML
        let tooltipHTML = '';

        // Category/Phase with color indicator
        const categoryLabel = category && category !== '' ? category : (phase || 'Other');
        tooltipHTML += `
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <div style="width: 12px; height: 12px; background: ${segmentColor}; border-radius: 2px; flex-shrink: 0;"></div>
                <span style="font-weight: 600;">${categoryLabel}</span>
            </div>
        `;

        // Time
        if (timeText) {
            tooltipHTML += `<div style="margin-bottom: 4px; color: #ccc;">${timeText}</div>`;
        }

        // Worker ID
        if (workerId !== null && workerId !== undefined && workerId !== '') {
            tooltipHTML += `<div style="margin-bottom: 4px; color: #999; font-size: 0.85em;">Worker Thread ${workerId}</div>`;
        }

        // Operation count
        const operationCount = element.getAttribute('data-operation-count');
        if (operationCount && parseInt(operationCount) > 1) {
            tooltipHTML += `<div style="margin-bottom: 4px; color: #aaa; font-size: 0.85em;">${operationCount} operations grouped</div>`;
        }

        // Description
        if (descriptionWithoutTime) {
            tooltipHTML += `<div style="color: #aaa; font-size: 0.9em;">${descriptionWithoutTime}</div>`;
        }

        tooltip.innerHTML = tooltipHTML;
        tooltip.style.display = 'block';
        tooltip.style.left = (event.clientX + 15) + 'px';
        tooltip.style.top = (event.clientY + 15) + 'px';

        // Lift the visual element
        if (visualElement) {
            visualElement.style.transform = 'translateY(-25%)';
        }
    } catch (error) {
        console.error('[Timeline] Error showing tooltip:', error);
    }
}

/**
 * Hide timeline tooltip
 */
export function hideTimelineTooltip() {
    const tooltip = document.getElementById('timeline-tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }

    // Reset all visual segments
    document.querySelectorAll('.timeline-segment-visual').forEach(seg => {
        seg.style.transform = 'translateY(0)';
    });
}

// Export to window for backward compatibility
window.showTimelineTooltip = showTimelineTooltip;
window.hideTimelineTooltip = hideTimelineTooltip;

