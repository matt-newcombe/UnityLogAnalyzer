/**
 * Context Menu Component
 * Unified context menu for right-click copy functionality
 */

let activeContextMenu = null;

/**
 * Show context menu at mouse position
 * @param {MouseEvent} event - Mouse event
 * @param {string} path - Path to copy
 */
export function showContextMenu(event, path) {
    event.preventDefault();
    event.stopPropagation();

    // Remove existing menu
    hideContextMenu();

    // Create menu element
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `
        position: fixed;
        left: ${event.clientX}px;
        top: ${event.clientY}px;
        display: block;
        visibility: visible;
        opacity: 1;
        z-index: 1000000;
        background-color: white;
        border: 1px solid #ddd;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        padding: 4px 0;
        min-width: 150px;
        pointer-events: auto;
    `;

    // Create menu item
    const menuItem = document.createElement('div');
    menuItem.className = 'context-menu-item';
    menuItem.textContent = 'Copy Path';
    menuItem.style.cssText = `
        padding: 8px 16px;
        cursor: pointer;
        font-size: 13px;
        color: #333;
    `;

    menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(path);
        hideContextMenu();
    });

    menuItem.addEventListener('mouseenter', () => {
        menuItem.style.backgroundColor = '#f5f5f5';
    });

    menuItem.addEventListener('mouseleave', () => {
        menuItem.style.backgroundColor = 'transparent';
    });

    menu.appendChild(menuItem);
    document.body.appendChild(menu);
    activeContextMenu = menu;

    // Adjust position if menu goes off screen
    requestAnimationFrame(() => {
        if (!menu.parentNode) return;

        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (event.clientY - rect.height - 10) + 'px';
        }
    });

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick, { once: true });
    }, 10);
}

/**
 * Hide the active context menu
 */
export function hideContextMenu() {
    if (activeContextMenu) {
        activeContextMenu.remove();
        activeContextMenu = null;
    }
}

/**
 * Handle click outside context menu
 * @param {MouseEvent} event - Click event
 */
function handleOutsideClick(event) {
    if (activeContextMenu && !activeContextMenu.contains(event.target)) {
        hideContextMenu();
    }
}

/**
 * Copy text to clipboard with visual feedback
 * @param {string} text - Text to copy
 */
export function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showCopyFeedback();
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

/**
 * Show copy success feedback
 */
function showCopyFeedback() {
    const feedback = document.createElement('div');
    feedback.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 10001;
        font-weight: 500;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    feedback.textContent = '✓ Path copied to clipboard';
    document.body.appendChild(feedback);
    setTimeout(() => feedback.remove(), 2000);
}

/**
 * Setup context menus for table rows with data-path attribute
 * @param {HTMLElement} container - Container element with rows
 * @param {string} pathAttribute - Data attribute name for path (default: 'data-path')
 */
export function setupTableContextMenus(container, pathAttribute = 'data-path') {
    if (!container) return;

    const rows = container.querySelectorAll(`tr[${pathAttribute}]`);
    rows.forEach(row => {
        const path = row.getAttribute(pathAttribute);
        if (!path) return;

        const decodedPath = path.replace(/&quot;/g, '"');
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e, decodedPath);
        });
    });
}

