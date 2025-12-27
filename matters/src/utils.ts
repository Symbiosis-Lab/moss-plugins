/**
 * Utility functions for the Matters Syndicator Plugin
 *
 * This module wraps SDK utilities with plugin-specific functionality
 * and provides Matters-specific helper functions.
 */

import {
  setMessageContext,
  sendMessage as sdkSendMessage,
  reportProgress as sdkReportProgress,
  reportError as sdkReportError,
  fetchUrl,
  downloadAsset as sdkDownloadAsset,
  type PluginMessage,
} from "@symbiosis-lab/moss-api";

// ============================================================================
// Plugin Configuration
// ============================================================================

const PLUGIN_NAME = "matters";

// Initialize message context on load
setMessageContext(PLUGIN_NAME, "");

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
 * Get the current hook name (for compatibility)
 */
let _currentHookName = "";
export function getCurrentHookName(): string {
  return _currentHookName;
}

// Override setCurrentHookName to also track locally
const originalSetCurrentHookName = setCurrentHookName;
export { originalSetCurrentHookName };

/**
 * Send a message to moss (logs, progress, errors)
 */
export async function sendMessage(message: PluginMessage): Promise<void> {
  await sdkSendMessage(message);
}

/**
 * Log a message to both console and moss terminal
 * Non-blocking: fires message to Rust without waiting for response
 */
export function log(
  level: "log" | "error" | "warn" | "info",
  message: string
): void {
  console[level](message);
  // Map 'info' to 'log' for SDK compatibility
  const sdkLevel = level === "info" ? "log" : level;
  // Fire-and-forget: don't await to avoid blocking worker pool
  sdkSendMessage({ type: "log", level: sdkLevel, message }).catch(() => {});
}

/**
 * Report progress to moss during long-running operations
 * Non-blocking: fires progress update without waiting for response
 */
export function reportProgress(
  phase: string,
  current: number,
  total: number,
  message?: string
): void {
  // Fire-and-forget: don't await to avoid blocking worker pool
  sdkReportProgress(phase, current, total, message).catch(() => {});
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

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Generate a URL-safe slug from text
 * Preserves Unicode characters (CJK, Cyrillic, Arabic, etc.)
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/**
 * Simple hash function for generating filenames
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// ============================================================================
// Filename Utilities
// ============================================================================

/**
 * Generate a local filename from a URL
 */
export function generateLocalFilename(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const cleanPath = pathname.replace(/\/public$/, "");
    const segments = cleanPath.split("/").filter((s) => s.length > 0);

    // Find a segment with an extension
    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];
      const extMatch = segment.match(/\.(\w+)$/);
      if (extMatch) {
        const ext = extMatch[1].toLowerCase();
        if (i > 0 && /^[a-f0-9-]{36}$/i.test(segments[i - 1])) {
          return `${segments[i - 1]}.${ext}`;
        }
        return segment;
      }
    }

    // No extension found, try to find a UUID
    for (const segment of segments) {
      if (/^[a-f0-9-]{36}$/i.test(segment)) {
        return segment;
      }
    }

    // Fallback: hash the URL
    return simpleHash(url);
  } catch {
    return null;
  }
}

/**
 * Get file extension from Content-Type header
 */
export function getExtensionFromContentType(contentType: string): string | null {
  const mapping: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };

  for (const [type, ext] of Object.entries(mapping)) {
    if (contentType.includes(type)) {
      return ext;
    }
  }
  return null;
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

// ============================================================================
// HTTP Utilities (using moss-api)
// ============================================================================

/**
 * Result from downloadAsset function
 */
export interface DownloadAssetResult {
  status: number;
  ok: boolean;
  content_type: string | null;
  bytes_written: number;
  actual_path: string;
}

/**
 * Fetch a URL using moss-api (bypasses WebKit CORS).
 *
 * Returns a Response-like object for compatibility with existing code.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs = 30000
): Promise<Response> {
  const result = await fetchUrl(url, { timeoutMs });

  // Create Response-like object
  const headers = new Headers();
  if (result.contentType) {
    headers.set("content-type", result.contentType);
  }

  return new Response(result.body.buffer as ArrayBuffer, {
    status: result.status,
    headers,
  });
}

/**
 * Download a URL and save directly to disk using moss-api.
 *
 * This function downloads a file and writes it directly to disk without
 * passing the binary data through JavaScript. This avoids event loop blocking
 * that occurs with large files when using base64 encoding/decoding.
 *
 * Moss handles filename derivation from the URL and adds file extension from
 * Content-Type if the URL has no extension.
 *
 * @param url - URL to download
 * @param targetDir - Target directory within project (e.g., "assets")
 * @param timeoutMs - Optional timeout in milliseconds (defaults to 30 seconds)
 * @returns Result with status, content-type, bytes written, and actual_path
 */
export async function downloadAsset(
  url: string,
  targetDir: string,
  timeoutMs = 30000
): Promise<DownloadAssetResult> {
  const result = await sdkDownloadAsset(url, targetDir, { timeoutMs });

  // Map moss-api result to existing interface for backward compatibility
  return {
    status: result.status,
    ok: result.ok,
    content_type: result.contentType,
    bytes_written: result.bytesWritten,
    actual_path: result.actualPath,
  };
}

// ============================================================================
// Binary Utilities
// ============================================================================

/**
 * Convert Uint8Array to base64 string in chunks to avoid stack overflow
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}
