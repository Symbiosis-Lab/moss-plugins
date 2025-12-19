/**
 * Asset download functionality with worker pool and retry logic
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
const CONCURRENCY = 5;
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes total for all downloads
const PROGRESS_LOG_INTERVAL_MS = 10 * 1000; // Log progress every 10 seconds when slow

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
// Worker Pool
// ============================================================================

/** Options for the worker pool */
interface WorkerPoolOptions<T> {
  timeoutMs?: number;
  progressIntervalMs?: number;
  onProgress?: (completed: number, total: number, inProgress: T[]) => void;
}

/** Result from running the worker pool */
interface WorkerPoolResult {
  completed: number;
  aborted: boolean;
}

/**
 * Run tasks with a fixed number of concurrent workers.
 * Workers pull from a shared queue. If worker returns { retry: true },
 * the task is re-queued to the back.
 *
 * Supports:
 * - Overall timeout to prevent infinite hangs
 * - Progress callback for visibility when downloads are slow
 * - Abort signal for graceful cancellation
 */
async function runWorkerPool<T>(
  tasks: T[],
  worker: (task: T, signal: { aborted: boolean }) => Promise<{ retry: boolean } | void>,
  concurrency: number,
  options: WorkerPoolOptions<T> = {}
): Promise<WorkerPoolResult> {
  const queue = [...tasks];
  const totalTasks = tasks.length;
  let completedCount = 0;
  const signal = { aborted: false };
  const inProgressTasks = new Map<number, T>(); // workerId -> current task
  let nextWorkerId = 0;

  const { timeoutMs = 0, progressIntervalMs = 10000, onProgress } = options;

  // Set up overall timeout
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      signal.aborted = true;
      log("warn", `[Worker Pool] Overall timeout (${Math.round(timeoutMs / 1000)}s) reached, aborting remaining tasks`);
    }, timeoutMs);
  }

  // Set up progress logging interval
  let progressId: ReturnType<typeof setInterval> | null = null;
  if (onProgress && progressIntervalMs > 0) {
    progressId = setInterval(() => {
      if (inProgressTasks.size > 0) {
        const inProgressList = Array.from(inProgressTasks.values());
        onProgress(completedCount, totalTasks, inProgressList);
      }
    }, progressIntervalMs);
  }

  async function runWorker(): Promise<void> {
    const workerId = nextWorkerId++;

    while (queue.length > 0 && !signal.aborted) {
      const task = queue.shift()!;
      inProgressTasks.set(workerId, task);

      try {
        const result = await worker(task, signal);
        if (result?.retry && !signal.aborted) {
          queue.push(task); // Re-queue to back
        } else {
          completedCount++;
        }
      } catch (err) {
        // Log unhandled errors but continue processing
        log("error", `[Worker ${workerId}] Unhandled error: ${err}`);
        completedCount++; // Count as done even on error
      }

      inProgressTasks.delete(workerId);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, tasks.length) }, () => runWorker())
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (progressId) clearInterval(progressId);
  }

  return { completed: completedCount, aborted: signal.aborted };
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
 * Download a single asset (single attempt, no retry).
 * Uses Rust to download and save directly to disk (avoids JS base64 blocking).
 * Moss handles filename derivation and extension from content-type.
 * Throws DownloadError on failure with retry classification.
 */
async function downloadAsset(
  url: string,
  projectPath: string,
  existingAssets?: Set<string>
): Promise<{ actualPath: string; skipped: boolean }> {
  let result;
  try {
    // Pass just the target directory - Moss handles filename and extension
    result = await downloadAssetRust(url, projectPath, "assets", 30000);
  } catch (fetchError: unknown) {
    // Network error - retryable (Rust error already includes URL for timeouts)
    const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
    throw new DownloadError(message);
  }

  if (!result.ok) {
    throw new DownloadError(`HTTP ${result.status} from ${url}`, result.status);
  }

  const actualPath = result.actual_path;

  // Check if file already existed (we still download but can mark as skipped for stats)
  const wasExisting = existingAssets?.has(actualPath) ?? false;

  return { actualPath, skipped: wasExisting };
}

// ============================================================================
// Types for Option B: Worker Pool + In-Memory File State
// ============================================================================

/** In-memory file state (mutable during processing) */
interface FileState {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  modified: boolean;
}

/** Media task for worker pool */
interface MediaTask {
  url: string;
}

/** Reference from URL to files */
interface UrlReference {
  filePath: string;
  inBody: boolean;
  inCover: boolean;
}

/**
 * Download all media for all markdown files in a project and update references.
 * Uses worker pool for concurrent downloads + in-memory file state for atomic updates.
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

  log("log", "📸 Phase 2: Downloading media assets...");

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

  // Build set of existing assets (mutable - updated as we download)
  const existingAssets = new Set(allProjectFiles.filter(f => f.startsWith("assets/")));
  log("log", `   Found ${existingAssets.size} existing assets`);

  // Build UUID→asset path mapping for existing assets
  // This allows us to skip downloads and still update references
  const existingAssetsByUuid = new Map<string, string>();
  for (const assetPath of existingAssets) {
    const uuid = extractAssetUuid(assetPath);
    if (uuid) {
      existingAssetsByUuid.set(uuid, assetPath);
    }
  }

  const { parseFrontmatter, regenerateFrontmatter } = await import("./converter");

  // ========================================================================
  // Phase 1: Scan files, build URL→files mapping, create in-memory file state
  // ========================================================================

  const fileStates = new Map<string, FileState>(); // filePath → FileState
  const urlToFiles = new Map<string, UrlReference[]>(); // url → files that reference it
  const mediaTasks: MediaTask[] = []; // unique URLs to download (one per UUID)
  const seenUuids = new Set<string>(); // Track UUIDs to avoid duplicate downloads
  const uuidToUrls = new Map<string, string[]>(); // uuid → all URLs that reference this asset

  log("log", "   Scanning files for remote media...");

  for (const filePath of allMdFiles) {
    try {
      const content = await readFile(projectPath, filePath);

      const parsed = parseFrontmatter(content);
      if (!parsed) continue;

      const bodyMedia = extractRemoteImageUrls(parsed.body);
      const cover = parsed.frontmatter.cover;
      const hasCoverMedia = typeof cover === "string" &&
        (cover.startsWith("http://") || cover.startsWith("https://"));

      // Skip files with no remote media
      if (bodyMedia.length === 0 && !hasCoverMedia) continue;

      // Create file state
      fileStates.set(filePath, {
        path: filePath,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        modified: false,
      });

      // Process body media
      for (const media of bodyMedia) {
        const uuid = extractAssetUuid(media.url);
        // Use UUID for dedup if available, otherwise fall back to URL
        const dedupKey = uuid || media.url;

        // Add to URL→files mapping
        if (!urlToFiles.has(media.url)) {
          urlToFiles.set(media.url, []);
        }
        urlToFiles.get(media.url)!.push({ filePath, inBody: true, inCover: false });

        // Track UUID→URLs for later reference updates
        if (uuid) {
          if (!uuidToUrls.has(uuid)) {
            uuidToUrls.set(uuid, []);
          }
          uuidToUrls.get(uuid)!.push(media.url);
        }

        // Add to download tasks only if not seen (dedup by UUID if available, else by URL)
        if (!seenUuids.has(dedupKey)) {
          seenUuids.add(dedupKey);
          mediaTasks.push(media);
        }
      }

      // Process cover media
      if (hasCoverMedia) {
        const coverUrl = cover as string;
        const uuid = extractAssetUuid(coverUrl);
        // Use UUID for dedup if available, otherwise fall back to URL
        const dedupKey = uuid || coverUrl;

        if (!urlToFiles.has(coverUrl)) {
          urlToFiles.set(coverUrl, []);
        }
        urlToFiles.get(coverUrl)!.push({ filePath, inBody: false, inCover: true });

        // Track UUID→URLs for later reference updates
        if (uuid) {
          if (!uuidToUrls.has(uuid)) {
            uuidToUrls.set(uuid, []);
          }
          uuidToUrls.get(uuid)!.push(coverUrl);
        }

        // Add to download tasks only if not seen (dedup by UUID if available, else by URL)
        if (!seenUuids.has(dedupKey)) {
          seenUuids.add(dedupKey);
          mediaTasks.push({ url: coverUrl });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  log("log", `   Found ${fileStates.size} files with remote media`);
  log("log", `   Total unique URLs to process: ${mediaTasks.length}`);

  if (mediaTasks.length === 0) {
    return result;
  }

  // ========================================================================
  // Phase 2: Download URLs with worker pool, update file states immediately
  // ========================================================================

  const retryCount = new Map<string, number>();
  const permanentlyFailed = new Set<string>(); // Track URLs that exceeded retries
  let completedCount = 0;

  log("log", `   Starting download with ${CONCURRENCY} workers (timeout: ${OVERALL_TIMEOUT_MS / 1000}s)...`);

  const { completed, aborted } = await runWorkerPool(
    mediaTasks,
    async (media, signal) => {
      // Skip if aborted or already failed permanently
      if (signal.aborted || permanentlyFailed.has(media.url)) {
        return; // Don't retry, count as done
      }

      const attempts = retryCount.get(media.url) ?? 0;

      // Check max retries BEFORE attempting download
      if (attempts >= MAX_RETRIES) {
        log("error", `   [✗] Max retries exceeded: ${media.url}`);
        result.errors.push(`${media.url}: Max retries exceeded`);
        result.imagesSkipped++;
        permanentlyFailed.add(media.url);
        completedCount++;
        reportProgress(
          "downloading_media",
          completedCount,
          mediaTasks.length,
          `Downloaded ${completedCount}/${mediaTasks.length} media files...`
        );
        return; // Don't retry
      }

      const assetId = extractAssetUuid(media.url);
      let actualPath: string | null = null;
      let wasSkipped = false;

      // Check if asset already exists locally (by UUID)
      if (assetId) {
        const existingPath = existingAssetsByUuid.get(assetId);
        if (existingPath) {
          actualPath = existingPath;
          wasSkipped = true;
          log("log", `   [~] Skipped (exists): ${existingPath}`);
        }
      }

      // Download if not already exists
      if (!actualPath) {
        log("log", `   [${attempts + 1}/${MAX_RETRIES}] Downloading: ${media.url}`);

        try {
          const downloadResult = await downloadAsset(
            media.url,
            projectPath,
            existingAssets
          );

          actualPath = downloadResult.actualPath;
          log("log", `   [✓] Downloaded: ${actualPath}`);
          result.imagesDownloaded++;
          existingAssets.add(actualPath); // Track for future checks

          // Update UUID→path mapping so other URLs with same UUID can skip
          if (assetId) {
            existingAssetsByUuid.set(assetId, actualPath);
          }
        } catch (err) {
          // Check if aborted during download
          if (signal.aborted) {
            return; // Don't retry
          }

          const isRetryable = err instanceof DownloadError && err.isRetryable();
          const errorMsg = err instanceof Error ? err.message : String(err);

          if (isRetryable && attempts < MAX_RETRIES - 1) {
            const delay = getFibonacciDelay(attempts + 1);
            log("warn", `   [!] ${media.url}: ${errorMsg}, retrying in ${delay}ms (attempt ${attempts + 1}/${MAX_RETRIES})`);
            retryCount.set(media.url, attempts + 1);
            await sleep(delay);
            return { retry: true };
          }

          // Permanent failure
          log("error", `   [✗] Failed: ${media.url} - ${errorMsg}`);
          result.errors.push(`${media.url}: ${errorMsg}`);
          result.imagesSkipped++;
          permanentlyFailed.add(media.url);
          completedCount++;

          reportProgress(
            "downloading_media",
            completedCount,
            mediaTasks.length,
            `Downloaded ${completedCount}/${mediaTasks.length} media files...`
          );

          return; // Don't retry
        }
      }

      // Immediately update all file states that reference this UUID
      // This handles different CDN URLs for the same asset (e.g., imagedelivery.net vs assets.matters.news)
      // Get all URLs that reference this asset's UUID
      const allUrlsForUuid = assetId ? (uuidToUrls.get(assetId) || []) : [media.url];

      for (const url of allUrlsForUuid) {
        const refs = urlToFiles.get(url) || [];

        for (const ref of refs) {
          const fileState = fileStates.get(ref.filePath);
          if (!fileState) continue;

          // Calculate relative path from markdown file to asset
          const relativePath = calculateRelativePath(ref.filePath, actualPath!);

          if (ref.inBody && assetId) {
            // Use UUID-based replacement to handle different CDN URLs
            const { content: newBody, replaced } = replaceAssetUrls(
              fileState.body,
              assetId,
              relativePath
            );
            if (replaced) {
              fileState.body = newBody;
              fileState.modified = true;
              log("log", `   [→] Updated reference in body: ${ref.filePath}`);
            }
          }

          if (ref.inCover && assetId) {
            // Check if cover URL contains the same asset ID (handles different CDN URLs)
            const coverStr = String(fileState.frontmatter.cover || '');
            if (coverStr.includes(assetId)) {
              fileState.frontmatter = { ...fileState.frontmatter, cover: relativePath };
              fileState.modified = true;
              log("log", `   [→] Updated cover reference: ${ref.filePath}`);
            }
          }
        }
      }

      completedCount++;
      reportProgress(
        "downloading_media",
        completedCount,
        mediaTasks.length,
        `Downloaded ${completedCount}/${mediaTasks.length} media files...`
      );

      return; // Don't retry
    },
    CONCURRENCY,
    {
      timeoutMs: OVERALL_TIMEOUT_MS,
      progressIntervalMs: PROGRESS_LOG_INTERVAL_MS,
      onProgress: (done, total, inProgress) => {
        const inProgressUrls = inProgress.map(m => m.url).join(", ");
        log("warn", `   [⏳ Progress] ${done}/${total} done. Currently downloading: ${inProgressUrls}`);
      },
    }
  );

  // Log Phase 2 completion for debugging
  log("log", `   Phase 2 complete: completed=${completed}, aborted=${aborted}`);

  // Log if aborted due to timeout
  if (aborted) {
    const remaining = mediaTasks.length - completed;
    log("warn", `   ⚠️ Download aborted due to timeout. ${remaining} images skipped.`);
    result.imagesSkipped += remaining;
    result.errors.push(`Timeout: ${remaining} images not downloaded`);
  }

  // ========================================================================
  // Phase 3: Write modified files
  // ========================================================================

  const modifiedCount = [...fileStates.values()].filter(f => f.modified).length;
  log("log", `   Phase 3 starting: ${fileStates.size} files scanned, ${modifiedCount} modified`);

  try {
    log("log", "   Writing updated files...");
    let writeErrors = 0;

    for (const [filePath, fileState] of fileStates) {
      if (!fileState.modified) continue;

      try {
        const newContent = regenerateFrontmatter(fileState.frontmatter) + "\n" + fileState.body;
        await writeFile(projectPath, filePath, newContent);
        result.filesProcessed++;
        log("log", `   [📝] Wrote: ${filePath}`);
      } catch (err) {
        writeErrors++;
        result.errors.push(`Failed to write ${filePath}: ${err}`);
        log("error", `   [✗] Failed to write: ${filePath} - ${err}`);
      }
    }

    if (writeErrors > 0) {
      log("warn", `   ⚠️ ${writeErrors} file(s) failed to write`);
    }

    log("log", `   Phase 3 complete: ${result.filesProcessed} files written`);
  } catch (err) {
    log("error", `   Phase 3 FAILED with unexpected error: ${err}`);
    result.errors.push(`Phase 3 failed: ${err}`);
  }

  // Final report
  reportProgress(
    "downloading_media",
    mediaTasks.length,
    mediaTasks.length,
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
 * Should be run IN PARALLEL with downloadMediaAndUpdate() for performance.
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
