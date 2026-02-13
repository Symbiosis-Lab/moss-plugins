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
  sleep,
} from "./utils";
import { downloadAsset as downloadAssetRust } from "@symbiosis-lab/moss-api";
import { extractRemoteImageUrls, extractMarkdownLinks } from "./converter";
import { isInternalMattersLink as isDomainInternalLink } from "./domain";
import { listFiles, readFile, writeFile } from "@symbiosis-lab/moss-api";

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRIES = 3;
// Note: Concurrency is now handled by Rust-side Semaphore (DOWNLOAD_CONCURRENCY_LIMIT=5)
// Timeout is handled by Rust-side tokio::time::timeout (default 30s)

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
 * Timeout and concurrency are handled by Rust side:
 * - Semaphore limits concurrent downloads to 5
 * - tokio::time::timeout enforces 30s cumulative timeout
 *
 * Logging:
 * - [↓] Attempt N/M: Starting download attempt
 * - [✓] Downloaded: Successful download
 * - [!] HTTP {status}: HTTP error (retryable or final)
 * - [✗] TIMEOUT: Download timeout from Rust
 * - [✗] ERROR: Other errors (network, etc.)
 * - [↻] Retrying: Retry announcement with delay
 * - [✗] FAILED: Final failure after all retries
 */
async function downloadAssetWithRetry(
  url: string
): Promise<{ actualPath: string; success: boolean; error?: string }> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log("log", `   [↓] Attempt ${attempt}/${MAX_RETRIES}: ${url}`);

      // Rust handles timeout (30s) and concurrency (5 parallel)
      const result = await downloadAssetRust(url, "assets");

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

      log("log", `   [✓] Downloaded: ${result.actualPath}`);
      return { actualPath: result.actualPath, success: true };

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
 * DESIGN: Fire all downloads in parallel, let Rust handle concurrency.
 *
 * 1. **Parallel downloads**: All downloads start immediately via Promise.allSettled
 * 2. **Rust-side concurrency**: Semaphore limits to 5 concurrent downloads
 * 3. **Rust-side timeout**: tokio::time::timeout enforces 30s cumulative timeout
 * 4. **Self-correcting**: Running again skips already-downloaded assets (by UUID)
 *
 * Flow:
 * 1. Scan all files to collect unique media URLs needing download
 * 2. Fire all downloads in parallel (Rust handles concurrency/timeout)
 * 3. After all complete, update references in each file
 * 4. Write modified files to disk
 */
export async function downloadMediaAndUpdate(): Promise<{
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
    allProjectFiles = await listFiles();
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
      const content = await readFile(filePath);
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
  // Phase 2: Download all images in parallel (Rust handles concurrency)
  // ========================================================================

  // Collect all unique media that needs downloading (not already in existing assets)
  const mediaToDownload: { url: string; uuid: string | null }[] = [];
  const seenUuids = new Set<string>();

  for (const file of filesToProcess) {
    for (const media of file.mediaUrls) {
      // Skip if already downloaded in this batch
      if (media.uuid && seenUuids.has(media.uuid)) continue;

      // Skip if asset already exists
      if (media.uuid && existingAssetsByUuid.has(media.uuid)) {
        result.imagesSkipped++;
        continue;
      }

      mediaToDownload.push({ url: media.url, uuid: media.uuid });
      if (media.uuid) seenUuids.add(media.uuid);
    }
  }

  log("log", `   Downloading ${mediaToDownload.length} media files (${result.imagesSkipped} skipped)...`);

  // Fire all downloads in parallel - Rust Semaphore limits to 5 concurrent
  // Promise.allSettled ensures we get results for all, even if some fail
  const downloadPromises = mediaToDownload.map(async (media, index) => {
    const downloadResult = await downloadAssetWithRetry(media.url);

    // Report progress as each download completes
    reportProgress(
      "downloading_media",
      index + 1,
      mediaToDownload.length,
      `Downloading ${index + 1}/${mediaToDownload.length}...`
    );

    return { media, downloadResult };
  });

  const downloadResults = await Promise.allSettled(downloadPromises);

  // Build uuid → localPath map from successful downloads
  const downloadedUuids = new Map<string, string>();

  for (const settled of downloadResults) {
    if (settled.status === "fulfilled") {
      const { media, downloadResult } = settled.value;
      if (downloadResult.success) {
        result.imagesDownloaded++;
        // Track by UUID for dedup and reference updates
        if (media.uuid) {
          downloadedUuids.set(media.uuid, downloadResult.actualPath);
          existingAssetsByUuid.set(media.uuid, downloadResult.actualPath);
        }
      } else {
        result.errors.push(`${media.url}: ${downloadResult.error}`);
      }
    } else {
      // Promise rejected (shouldn't happen with our try/catch in downloadAssetWithRetry)
      result.errors.push(`Download failed: ${settled.reason}`);
    }
  }

  log("log", `   Downloaded ${result.imagesDownloaded}/${mediaToDownload.length} media files`);

  // ========================================================================
  // Phase 3: Update references in files
  // ========================================================================

  for (let fileIndex = 0; fileIndex < filesToProcess.length; fileIndex++) {
    const file = filesToProcess[fileIndex];
    let modified = false;
    let { frontmatter, body } = file;

    // Deduplicate URLs within this file by UUID, merging inBody/inCover flags
    const mediaByKey = new Map<string, MediaUrl>();
    for (const media of file.mediaUrls) {
      const key = media.uuid || media.url;
      const existing = mediaByKey.get(key);
      if (existing) {
        existing.inBody = existing.inBody || media.inBody;
        existing.inCover = existing.inCover || media.inCover;
      } else {
        mediaByKey.set(key, { ...media });
      }
    }
    const uniqueMedia = Array.from(mediaByKey.values());

    // Update references for each media
    for (const media of uniqueMedia) {
      if (!media.uuid) continue;

      // Get local path from downloaded or existing assets
      const localPath = downloadedUuids.get(media.uuid) || existingAssetsByUuid.get(media.uuid);
      if (!localPath) continue;

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

    // Write file if modified
    if (modified) {
      try {
        const newContent = regenerateFrontmatter(frontmatter) + "\n" + body;
        await writeFile(file.path, newContent);
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
  return isDomainInternalLink(url, userName);
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
    const allProjectFiles = await listFiles();
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
      const content = await readFile(file);

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

        await writeFile(file, newContent);

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
