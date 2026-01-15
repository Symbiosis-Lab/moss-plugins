/**
 * Utility functions for the GitHub Deployer Plugin
 *
 * This module wraps SDK utilities with plugin-specific functionality.
 */

import {
  setMessageContext,
  sendMessage as sdkSendMessage,
  reportProgress as sdkReportProgress,
  reportError as sdkReportError,
  showToast as sdkShowToast,
  dismissToast as sdkDismissToast,
  type PluginMessage,
  type ToastOptions,
} from "@symbiosis-lab/moss-api";
import type { HookResult } from "./types";

// Re-export ToastOptions type for convenience
export type { ToastOptions };

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
export function setCurrentHookName(name: string): void {
  setMessageContext(PLUGIN_NAME, name);
}

/**
 * Send a message to moss (logs, progress, errors)
 */
export async function sendMessage(message: PluginMessage): Promise<void> {
  await sdkSendMessage(message);
}

/**
 * Log a message to both console and moss terminal
 */
export async function log(
  level: "log" | "error" | "warn" | "info",
  message: string
): Promise<void> {
  console[level](message);
  // Map 'info' to 'log' for SDK compatibility
  const sdkLevel = level === "info" ? "log" : level;
  await sdkSendMessage({ type: "log", level: sdkLevel, message });
}

/**
 * Report progress to moss during long-running operations
 */
export async function reportProgress(
  phase: string,
  current: number,
  total: number,
  message?: string
): Promise<void> {
  await sdkReportProgress(phase, current, total, message);
}

/**
 * Report an error to moss during hook execution
 */
export async function reportError(
  error: string,
  context?: string,
  fatal = false
): Promise<void> {
  await sdkReportError(error, context, fatal);
}

/**
 * Signal hook completion to moss with the result.
 *
 * ## Design: Explicit Completion Signaling (Option A)
 *
 * This function implements explicit completion signaling where the plugin
 * actively notifies moss when it's done, rather than relying on return values.
 *
 * **Why this design:**
 * - Completion is a deliberate action, not an implicit side effect of returning
 * - Plugin can signal completion, then perform cleanup (like worktree removal)
 * - No race condition between plugin returning and async cleanup timing out
 * - Moss shows toast immediately when completion is signaled
 *
 * **Usage pattern:**
 * ```typescript
 * async function deploy(context): Promise<void> {
 *   const result = await doDeployment();
 *
 *   // Signal completion FIRST - moss shows toast immediately
 *   await reportComplete(result);
 *
 *   // Then cleanup (non-blocking, can take as long as needed)
 *   await cleanupWorktree(worktreePath);
 *
 *   // Function returns void - moss already has the result
 * }
 * ```
 *
 * @param result - The HookResult to send to moss (contains success, toast, deployment info)
 */
export async function reportComplete(result: HookResult): Promise<void> {
  // Send complete message directly (SDK's reportComplete has wrong signature)
  // Rust expects: { type: "complete", success, error, result }
  await sdkSendMessage({
    type: "complete",
    success: result.success,
    error: result.success ? undefined : result.message,
    result,
  } as any); // Cast needed because PluginMessage type may be outdated
}

// ============================================================================
// Toast Utilities
// ============================================================================

/**
 * Show a toast notification in the main Moss UI
 *
 * @example
 * ```typescript
 * // Success toast with clickable action
 * await showToast({
 *   message: "Deployed!",
 *   variant: "success",
 *   actions: [{ label: "View site", url: "https://..." }],
 *   duration: 8000
 * });
 * ```
 */
export async function showToast(options: ToastOptions | string): Promise<void> {
  await sdkShowToast(options);
}

/**
 * Dismiss a toast by ID
 */
export async function dismissToast(id: string): Promise<void> {
  await sdkDismissToast(id);
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
