/**
 * LiveMonitor Bridge
 * Imports the new modular LiveMonitor and exposes it globally for backward compatibility
 */
import { LiveMonitor } from './live-monitor/index.js';

// Expose globally
window.LiveMonitor = LiveMonitor;
window.liveMonitor = new LiveMonitor();

export { LiveMonitor };
