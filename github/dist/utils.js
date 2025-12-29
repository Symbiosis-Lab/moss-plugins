/**
 * Utility functions for the GitHub Deployer Plugin
 *
 * This module wraps SDK utilities with plugin-specific functionality.
 */
import { setMessageContext, sendMessage as sdkSendMessage, reportProgress as sdkReportProgress, reportError as sdkReportError, } from "@symbiosis-lab/moss-api";
// ============================================================================
// Plugin Configuration
// ============================================================================
const PLUGIN_NAME = "github";
// Initialize message context on load
setMessageContext(PLUGIN_NAME, "deploy");
// ============================================================================
// Re-exports from SDK (with plugin context)
// ============================================================================
/**
 * Set the current hook name for message routing
 */
export function setCurrentHookName(name) {
    setMessageContext(PLUGIN_NAME, name);
}
/**
 * Send a message to moss (logs, progress, errors)
 */
export async function sendMessage(message) {
    await sdkSendMessage(message);
}
/**
 * Log a message to both console and moss terminal
 */
export async function log(level, message) {
    console[level](message);
    // Map 'info' to 'log' for SDK compatibility
    const sdkLevel = level === "info" ? "log" : level;
    await sdkSendMessage({ type: "log", level: sdkLevel, message });
}
/**
 * Report progress to moss during long-running operations
 */
export async function reportProgress(phase, current, total, message) {
    await sdkReportProgress(phase, current, total, message);
}
/**
 * Report an error to moss during hook execution
 */
export async function reportError(error, context, fatal = false) {
    await sdkReportError(error, context, fatal);
}
// ============================================================================
// Async Utilities
// ============================================================================
/**
 * Sleep for specified milliseconds
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
