/**
 * LiveMonitor Module
 * Exports LiveMonitor and exposes it globally for backward compatibility
 */
import { LiveMonitor } from './live-monitor.js';
import { LiveMonitorUI } from './ui.js';

// Create singleton instance
const liveMonitorInstance = new LiveMonitor();

// Register with AppContext
if (window.appContext) {
    window.appContext.register('liveMonitor', liveMonitorInstance);
    window.appContext.register('LiveMonitor', LiveMonitor);
}

// Expose globally for backward compatibility
window.LiveMonitor = LiveMonitor;
window.liveMonitor = liveMonitorInstance;

export { LiveMonitor, LiveMonitorUI };
