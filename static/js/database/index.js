/**
 * Database Module Index
 * Re-exports database functionality for ES module consumers.
 */

// Database classes are loaded via script tags and available on window
export const UnityLogDatabase = window.UnityLogDatabase;
export const createNewDatabase = window.createNewDatabase;
export const getCurrentDatabase = window.getCurrentDatabase;
export const TimelineBuilder = window.TimelineBuilder;
export const LogLinesQuery = window.LogLinesQuery;
