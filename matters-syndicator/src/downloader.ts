/**
 * Asset download functionality with incremental file updates
 *
 * DESIGN PRINCIPLE: Write files incrementally, not in a batch at the end.
 *
 * This ensures:
 * 1. If interrupted, completed files are already saved
 * 2. Running again skips already-updated files (self-correcting)
 * 3. No "Phase 3" batch write that can silently fail
 */

import {
  log,
  reportProgress,
  downloadAsset as downloadAssetRust,
  sleep,
} from "./utils";
import { extractRemoteImageUrls, extractMarkdownLinks } from "./converter";
import { listFiles, readFile, writeFile } from "@symbiosis-lab/moss-api";

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRIES = 3;
const CONCURRENCY = 5;

// ============================================================================
// Pure Helper Functions (exported for testing)
// ============================================================================

/**
 * Extract UUID from a URL (Matters asset IDs are UUIDs)
 * Handles URLs from both assets.matters.news and imagedelivery.net
 */
export function extractAssetUuid(url: string): string | null {
  const match = url.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  return match ? match[1] : null;
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a regex pattern that matches any URL containing the given asset ID
 * Used for updating references when the same asset has multiple CDN URLs
 */
export function buildAssetUrlPattern(assetId: string): RegExp {
  return new RegExp(
    `https?://[^)\\s"]*${escapeRegex(assetId)}[^)\\s"]*`,
    'g'
  );
}

/**
 * Replace all URLs containing the asset ID with a local path
 * Returns the modified content and whether any replacements were made
 */
export function replaceAssetUrls(
  content: string,
  assetId: string,
  localPath: string
): { content: string; replaced: boolean } {
  const pattern = buildAssetUrlPattern(assetId);
  const hasMatch = pattern.test(content);

  if (!hasMatch) {
    return { content, replaced: false };
  }

  // Reset regex lastIndex after test() call
  pattern.lastIndex = 0;
  const newContent = content.replace(pattern, localPath);
  return { content: newContent, replaced: true };
}

// ============================================================================
// Timeout Utilities
// ============================================================================

/** Timeout constants */
const RUST_TIMEOUT = 30000;  // Rust-side timeout
const JS_SAFETY_TIMEOUT = 35000;  // JS-side safety margin (5s extra)

/**
 * Wrap a promise with a timeout
 * If the promise doesn't resolve within the timeout, reject with a timeout error
 *
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param errorMsg - Error message for timeout
 * @returns Promise that resolves with the original value or rejects on timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMsg: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMsg)), ms)
    ),
  ]);
}

// ============================================================================
// Fibonacci Backoff
// ============================================================================

/**
 * Get delay for retry attempt using Fibonacci sequence
 * Returns delay in milliseconds: 1000, 1000, 2000, 3000, 5000, 8000, 13000, 21000...
 */
function getFibonacciDelay(attempt: number): number {
  if (attempt <= 2) return 1000;
  let a = 1, b = 1;
  for (let i = 2; i < attempt; i++) {
    [a, b] = [b, a + b];
  }
  return b * 1000;
}

/**
 * Check if an HTTP status code is retryable (transient error)
 * 408 = Request Timeout, 429 = Too Many Requests, 5xx = Server errors
 */
function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

// ============================================================================
// Asset Download
// ============================================================================

/** Error with HTTP status for retry classification */
class DownloadError extends Error {
  constructor(message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = "DownloadError";
  }

  /** Check if this error is retryable (transient) */
  isRetryable(): boolean {
    // Network errors (no status) are retryable
    if (this.httpStatus === undefined) return true;
    return isRetryableHttpStatus(this.httpStatus);
  }
}

/**
 * Download a single asset with retry logic and comprehensive logging.
 * Uses Rust to download and save directly to disk (avoids JS base64 blocking).
 * Moss handles filename derivation and extension from content-type.
 *
 * Logging:
 * - [↓] Attempt N/M: Starting download attempt
 * - [✓] Downloaded: Successful download
 * - [!] HTTP {status}: HTTP error (retryable or final)
 * - [✗] TIMEOUT: JS-level timeout (safety net)
 * - [✗] ERROR: Other errors (network, etc.)
 * - [↻] Retrying: Retry announcement with delay
 * - [✗] FAILED: Final failure after all retries
 */
async function downloadAssetWithRetry(
  url: string,
  projectPath: string
): Promise<{ actualPath: string; success: boolean; error?: string }> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log("log", `   [↓] Attempt ${attempt}/${MAX_RETRIES}: ${url}`);

      // Wrap the Rust download with JS-level timeout as safety net
      const result = await withTimeout(
        downloadAssetRust(url, projectPath, "assets", RUST_TIMEOUT),
        JS_SAFETY_TIMEOUT,
        `JS timeout after ${JS_SAFETY_TIMEOUT}ms`
      );

      if (!result.ok) {
        const err = new DownloadError(`HTTP ${result.status}`, result.status);
        log("warn", `   [!] HTTP ${result.status} for ${url}`);

        if (!err.isRetryable() || attempt === MAX_RETRIES) {
          log("error", `   [✗] FAILED after ${attempt} attempts: ${url} - HTTP ${result.status}`);
          return { actualPath: "", success: false, error: `HTTP ${result.status}` };
        }

        const delay = getFibonacciDelay(attempt);
        log("warn", `   [↻] Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }

      log("log", `   [✓] Downloaded: ${result.actual_path}`);
      return { actualPath: result.actual_path, success: true };

    } catch (fetchError: unknown) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      const isTimeout = message.toLowerCase().includes("timeout");

      // Log the error type
      if (isTimeout) {
        log("error", `   [✗] TIMEOUT: ${url} - ${message}`);
      } else {
        log("error", `   [✗] ERROR: ${url} - ${message}`);
      }

      if (attempt === MAX_RETRIES) {
        log("error", `   [✗] FAILED after ${MAX_RETRIES} attempts: ${url}`);
        return { actualPath: "", success: false, error: message };
      }

      const delay = getFibonacciDelay(attempt);
      log("warn", `   [↻] Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delay);
    }
  }

  log("error", `   [✗] FAILED after ${MAX_RETRIES} attempts: ${url}`);
  return { actualPath: "", success: false, error: "Max retries exceeded" };
}

// ============================================================================
// Types
// ============================================================================

/** Media URL found in a file */
interface MediaUrl {
  url: string;
  uuid: string | null;
  inBody: boolean;
  inCover: boolean;
}

/** File state for processing */
interface FileState {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  mediaUrls: MediaUrl[];
}

// ============================================================================
// Main Function: downloadMediaAndUpdate
// ============================================================================

/**
 * Download all media for all markdown files in a project and update references.
 *
 * DESIGN: Process file-by-file, writing each file immediately after all its
 * images are downloaded/resolved. This ensures:
 *
 * 1. **Incremental progress**: If interrupted at file 10/50, files 1-9 are saved
 * 2. **Self-correcting**: Running again skips files with no remote URLs
 * 3. **No batch write phase**: Each file is written as soon as it's ready
 *
 * Flow for each file:
 * 1. Check which images need downloading (by UUID lookup in existing assets)
 * 2. Download missing images (with retry logic)
 * 3. Update all references in-memory
 * 4. Write file to disk immediately
 * 5. Move to next file
 */
export async function downloadMediaAndUpdate(projectPath: string): Promise<{
  filesProcessed: number;
  imagesDownloaded: number;
  imagesSkipped: number;
  errors: string[];
}> {
  const result = {
    filesProcessed: 0,
    imagesDownloaded: 0,
    imagesSkipped: 0,
    errors: [] as string[],
  };

  log("log", "📸 Downloading media assets and updating references...");

  // Get all project files once
  let allProjectFiles: string[];
  try {
    allProjectFiles = await listFiles(projectPath);
  } catch (err) {
    log("error", `Failed to list project files: ${err}`);
    result.errors.push(`Failed to list files: ${err}`);
    return result;
  }

  const allMdFiles = allProjectFiles.filter(f => f.endsWith(".md"));
  log("log", `   Found ${allMdFiles.length} markdown files`);

  // Build UUID→asset path mapping for existing assets
  // This allows us to skip downloads when assets already exist
  const existingAssetsByUuid = new Map<string, string>();
  for (const assetPath of allProjectFiles.filter(f => f.startsWith("assets/"))) {
    const uuid = extractAssetUuid(assetPath);
    if (uuid) {
      existingAssetsByUuid.set(uuid, assetPath);
    }
  }
  log("log", `   Found ${existingAssetsByUuid.size} existing assets`);

  const { parseFrontmatter, regenerateFrontmatter } = await import("./converter");

  // ========================================================================
  // Phase 1: Scan files to find those with remote media
  // ========================================================================

  const filesToProcess: FileState[] = [];

  for (const filePath of allMdFiles) {
    try {
      const content = await readFile(projectPath, filePath);
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;

      const mediaUrls: MediaUrl[] = [];

      // Extract body media
      const bodyMedia = extractRemoteImageUrls(parsed.body);
      for (const media of bodyMedia) {
        mediaUrls.push({
          url: media.url,
          uuid: extractAssetUuid(media.url),
          inBody: true,
          inCover: false,
        });
      }

      // Extract cover media
      const cover = parsed.frontmatter.cover;
      if (typeof cover === "string" && (cover.startsWith("http://") || cover.startsWith("https://"))) {
        mediaUrls.push({
          url: cover,
          uuid: extractAssetUuid(cover),
          inBody: false,
          inCover: true,
        });
      }

      // Skip files with no remote media
      if (mediaUrls.length === 0) continue;

      filesToProcess.push({
        path: filePath,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        mediaUrls,
      });
    } catch {
      // Skip files that can't be read
    }
  }

  log("log", `   Found ${filesToProcess.length} files with remote media`);

  if (filesToProcess.length === 0) {
    return result;
  }

  // Count total unique URLs (for progress reporting)
  const allUuids = new Set<string>();
  let totalUrls = 0;
  for (const file of filesToProcess) {
    for (const media of file.mediaUrls) {
      if (media.uuid) {
        if (!allUuids.has(media.uuid)) {
          allUuids.add(media.uuid);
          totalUrls++;
        }
      } else {
        totalUrls++;
      }
    }
  }
  log("log", `   Total unique media URLs: ${totalUrls}`);

  // ========================================================================
  // Phase 2: Process each file - download images and write immediately
  // ========================================================================

  let processedUrls = 0;
  const downloadedUuids = new Map<string, string>(); // uuid → localPath (for dedup across files)

  for (let fileIndex = 0; fileIndex < filesToProcess.length; fileIndex++) {
    const file = filesToProcess[fileIndex];
    let modified = false;
    let { frontmatter, body } = file;

    log("log", `   [${fileIndex + 1}/${filesToProcess.length}] Processing: ${file.path}`);

    // Deduplicate URLs within this file by UUID, merging inBody/inCover flags
    const mediaByKey = new Map<string, MediaUrl>();
    for (const media of file.mediaUrls) {
      const key = media.uuid || media.url;
      const existing = mediaByKey.get(key);
      if (existing) {
        // Merge flags - if any reference is in body or cover, mark both
        existing.inBody = existing.inBody || media.inBody;
        existing.inCover = existing.inCover || media.inCover;
      } else {
        // Clone to avoid mutating original
        mediaByKey.set(key, { ...media });
      }
    }
    const uniqueMedia = Array.from(mediaByKey.values());

    // Process each unique media URL
    for (const media of uniqueMedia) {
      let localPath: string | null = null;

      // Check if we already have this asset (by UUID)
      if (media.uuid) {
        // First check if we downloaded it earlier in this run
        localPath = downloadedUuids.get(media.uuid) || null;

        // Then check if it existed before this run
        if (!localPath) {
          localPath = existingAssetsByUuid.get(media.uuid) || null;
        }

        if (localPath) {
          log("log", `   [~] Already exists: ${localPath}`);
          result.imagesSkipped++;
        }
      }

      // Download if we don't have it
      if (!localPath) {
        log("log", `   [↓] Downloading: ${media.url}`);
        const downloadResult = await downloadAssetWithRetry(media.url, projectPath);

        if (downloadResult.success) {
          localPath = downloadResult.actualPath;
          log("log", `   [✓] Downloaded: ${localPath}`);
          result.imagesDownloaded++;

          // Track for dedup
          if (media.uuid) {
            downloadedUuids.set(media.uuid, localPath);
            existingAssetsByUuid.set(media.uuid, localPath);
          }
        } else {
          log("error", `   [✗] Failed: ${media.url} - ${downloadResult.error}`);
          result.errors.push(`${media.url}: ${downloadResult.error}`);
        }

        processedUrls++;
        reportProgress(
          "downloading_media",
          processedUrls,
          totalUrls,
          `Processing media ${processedUrls}/${totalUrls}...`
        );
      }

      // Update references if we have a local path
      if (localPath && media.uuid) {
        const relativePath = calculateRelativePath(file.path, localPath);

        // Update body references
        if (media.inBody) {
          const { content: newBody, replaced } = replaceAssetUrls(body, media.uuid, relativePath);
          if (replaced) {
            body = newBody;
            modified = true;
          }
        }

        // Update cover reference
        if (media.inCover) {
          const coverStr = String(frontmatter.cover || '');
          if (coverStr.includes(media.uuid)) {
            frontmatter = { ...frontmatter, cover: relativePath };
            modified = true;
          }
        }
      }
    }

    // Write file immediately if modified
    if (modified) {
      try {
        const newContent = regenerateFrontmatter(frontmatter) + "\n" + body;
        await writeFile(projectPath, file.path, newContent);
        result.filesProcessed++;
        log("log", `   [📝] Wrote: ${file.path}`);
      } catch (err) {
        result.errors.push(`Failed to write ${file.path}: ${err}`);
        log("error", `   [✗] Failed to write: ${file.path} - ${err}`);
      }
    }
  }

  // Final report
  reportProgress(
    "downloading_media",
    totalUrls,
    totalUrls,
    `Downloaded ${result.imagesDownloaded} media, updated ${result.filesProcessed} files`
  );

  log("log", `   ✅ Downloaded ${result.imagesDownloaded}, skipped ${result.imagesSkipped}, updated ${result.filesProcessed} files`);

  return result;
}

// ============================================================================
// Internal Link Rewriting
// ============================================================================

/**
 * Check if a URL points to current user's Matters content
 */
function isInternalMattersLink(url: string, userName: string): boolean {
  const pattern = new RegExp(`^https?://matters\\.town/@${userName}/`);
  return pattern.test(url);
}

/**
 * Extract shortHash from Matters article URL
 * URL format: https://matters.town/@user/slug-shortHash
 */
function extractShortHash(url: string): string | null {
  const match = url.match(/\/([^/]+)$/);
  if (!match) return null;

  const slugWithHash = match[1];
  // shortHash is the last part after final hyphen
  const lastHyphen = slugWithHash.lastIndexOf("-");
  if (lastHyphen === -1) return null;

  return slugWithHash.substring(lastHyphen + 1);
}

/**
 * Rewrite internal Matters links to local paths in a single file's content
 */
function rewriteLinksInContent(
  content: string,
  articlePathMap: Map<string, string>,
  userName: string,
  currentFilePath: string
): { content: string; linksRewritten: number } {
  const links = extractMarkdownLinks(content);
  let modifiedContent = content;
  let linksRewritten = 0;

  for (const { url, fullMatch } of links) {
    if (!isInternalMattersLink(url, userName)) continue;

    // Try exact URL match first
    let localPath = articlePathMap.get(url);

    // If not found, try shortHash match
    if (!localPath) {
      const shortHash = extractShortHash(url);
      if (shortHash) {
        localPath = articlePathMap.get(shortHash);
      }
    }

    if (localPath) {
      // Calculate relative path from current file to target file
      const relativePath = calculateRelativePath(currentFilePath, localPath);
      const newLink = fullMatch.replace(url, relativePath);
      modifiedContent = modifiedContent.replace(fullMatch, newLink);
      linksRewritten++;
    }
  }

  return { content: modifiedContent, linksRewritten };
}

/**
 * Calculate relative path from one file to another
 * e.g., from "article/collection/post.md" to "article/other.md" → "../other.md"
 */
export function calculateRelativePath(fromPath: string, toPath: string): string {
  const fromParts = fromPath.split("/").slice(0, -1); // Remove filename, keep directory
  const toParts = toPath.split("/");

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length - 1 &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const upPath = "../".repeat(upCount);
  const downPath = toParts.slice(commonLength).join("/");

  return upPath + downPath || toPath;
}

/**
 * Rewrite internal Matters links to local paths across all markdown files
 * This is a fast operation (string manipulation only, no network I/O)
 *
 * Should be run AFTER downloadMediaAndUpdate() to avoid overwriting image refs.
 */
export async function rewriteAllInternalLinks(
  projectPath: string,
  articlePathMap: Map<string, string>,
  userName: string
): Promise<{
  filesProcessed: number;
  linksRewritten: number;
  errors: string[];
}> {
  const result = {
    filesProcessed: 0,
    linksRewritten: 0,
    errors: [] as string[],
  };

  if (articlePathMap.size === 0) {
    log("log", "🔗 No articles to rewrite links for");
    return result;
  }

  log("log", "🔗 Rewriting internal Matters links...");

  let allFiles: string[];
  try {
    const allProjectFiles = await listFiles(projectPath);
    allFiles = allProjectFiles.filter((f: string) => f.endsWith(".md"));
  } catch (err) {
    log("error", `Failed to list project files: ${err}`);
    result.errors.push(`Failed to list files: ${err}`);
    return result;
  }

  log("log", `   Scanning ${allFiles.length} markdown files for internal links...`);

  // Import parseFrontmatter dynamically to avoid circular dependency
  const { parseFrontmatter, regenerateFrontmatter } = await import("./converter");

  for (const file of allFiles) {
    try {
      const content = await readFile(projectPath, file);

      const parsed = parseFrontmatter(content);
      if (!parsed) continue;

      const { content: modifiedBody, linksRewritten } = rewriteLinksInContent(
        parsed.body,
        articlePathMap,
        userName,
        file
      );

      if (linksRewritten > 0) {
        const newContent = regenerateFrontmatter(parsed.frontmatter) + "\n" + modifiedBody;

        await writeFile(projectPath, file, newContent);

        result.filesProcessed++;
        result.linksRewritten += linksRewritten;
      }
    } catch (err) {
      result.errors.push(`Failed to process ${file}: ${err}`);
    }
  }

  log("log", `   Rewrote ${result.linksRewritten} links in ${result.filesProcessed} files`);

  return result;
}
