/**
 * Utility functions for the GitHub Deployer Plugin
 *
 * This module wraps SDK utilities with plugin-specific functionality.
 */
import { type PluginMessage } from "@symbiosis-lab/moss-api";
/**
 * Set the current hook name for message routing
 */
export declare function setCurrentHookName(name: string): void;
/**
 * Send a message to moss (logs, progress, errors)
 */
export declare function sendMessage(message: PluginMessage): Promise<void>;
/**
 * Log a message to both console and moss terminal
 */
export declare function log(level: "log" | "error" | "warn" | "info", message: string): Promise<void>;
/**
 * Report progress to moss during long-running operations
 */
export declare function reportProgress(phase: string, current: number, total: number, message?: string): Promise<void>;
/**
 * Report an error to moss during hook execution
 */
export declare function reportError(error: string, context?: string, fatal?: boolean): Promise<void>;
/**
 * Sleep for specified milliseconds
 */
export declare function sleep(ms: number): Promise<void>;
//# sourceMappingURL=utils.d.ts.map