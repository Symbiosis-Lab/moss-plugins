/**
 * Git command helpers for the GitHub Pages Publisher Plugin
 *
 * Executes git commands via moss-api's executeBinary.
 */

import { executeBinary } from "@symbiosis-lab/moss-api";
import { log } from "./utils";

/**
 * Run a git command and return the output
 */
async function runGit(args: string[], timeoutMs = 60000, env?: Record<string, string>): Promise<string> {
  await log("log", `   git ${args.join(" ")}`);

  const result = await executeBinary({
    binaryPath: "git",
    args,
    timeoutMs,
    env,
  });

  if (!result.success) {
    const error = result.stderr || `Git command failed with exit code ${result.exitCode}`;
    throw new Error(error);
  }

  return result.stdout.trim();
}

/**
 * Check if a path exists using git status (works without direct filesystem access)
 */
export async function checkPathExists(relativePath: string): Promise<boolean> {
  try {
    // Try to get status of the path - if it doesn't exist, git will error
    await runGit(["ls-files", "--error-unmatch", relativePath]);
    return true;
  } catch {
    // Path not tracked, check if it exists on disk via a different approach
    // For .git directory, we can check by running a git command that requires it
    if (relativePath === ".git") {
      try {
        await runGit(["rev-parse", "--git-dir"]);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/**
 * Get the origin remote URL
 */
export async function getRemoteUrl(): Promise<string> {
  return runGit(["remote", "get-url", "origin"]);
}

/**
 * Try to get the origin remote URL, returning null if not configured
 * This avoids duplicate git calls when checking if remote exists
 */
export async function tryGetRemoteUrl(): Promise<string | null> {
  try {
    return await runGit(["remote", "get-url", "origin"]);
  } catch {
    return null;
  }
}

/**
 * Check if git CLI is available on the system
 */
export async function isGitAvailable(): Promise<boolean> {
  try {
    const result = await executeBinary({
      binaryPath: "git",
      args: ["--version"],
      timeoutMs: 5000,
    });
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Initialize a new git repository
 */
export async function initGitRepository(): Promise<void> {
  await runGit(["init"]);
}

/**
 * Add a git remote
 */
export async function addRemote(name: string, url: string): Promise<void> {
  await runGit(["remote", "add", name, url]);
}

/**
 * Check if directory is a git repository
 */
export async function isGitRepository(): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if remote exists and get its URL
 */
export async function hasGitRemote(): Promise<boolean> {
  try {
    await getRemoteUrl();
    return true;
  } catch {
    return false;
  }
}

/**
 * Stage files for commit
 */
export async function stageFiles(files: string[]): Promise<void> {
  await runGit(["add", ...files]);
}

/**
 * Create a commit with a message
 */
export async function commit(message: string): Promise<string> {
  await runGit(["commit", "-m", message]);
  return runGit(["rev-parse", "HEAD"]);
}

/**
 * Push to remote
 */
export async function push(): Promise<void> {
  await runGit(["push"]);
}

/**
 * Check if current branch has upstream tracking configured
 */
export async function hasUpstream(): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if repository has any commits
 */
export async function hasLocalCommits(): Promise<boolean> {
  try {
    await runGit(["rev-parse", "HEAD"]);
    return true;
  } catch {
    return false; // No commits yet (fresh repo)
  }
}

/**
 * Check if remote repository has any commits/branches
 */
export async function remoteHasCommits(): Promise<boolean> {
  try {
    const result = await runGit(["ls-remote", "--heads", "origin"]);
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Push with upstream tracking (for first push)
 */
export async function pushWithUpstream(branch: string): Promise<void> {
  await runGit(["push", "-u", "origin", branch]);
}

/**
 * Ensure remote is configured correctly (idempotent)
 * - Adds remote if it doesn't exist
 * - Updates remote URL if it differs
 * - Does nothing if already correct
 */
export async function ensureRemote(name: string, url: string): Promise<void> {
  try {
    const existingUrl = await runGit(["remote", "get-url", name]);
    if (existingUrl.trim() === url) {
      await log("log", `   Remote '${name}' already configured`);
      return;
    }
    // Update existing remote to new URL
    await log("log", `   Updating remote '${name}' URL...`);
    await runGit(["remote", "set-url", name, url]);
  } catch {
    // Remote doesn't exist, add it
    await log("log", `   Adding remote '${name}'...`);
    await runGit(["remote", "add", name, url]);
  }
}

/**
 * Retry a git operation with exponential backoff
 * Only retries on network-related errors
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry on network-related errors
      const isNetworkError =
        lastError.message.includes("Could not resolve host") ||
        lastError.message.includes("Connection refused") ||
        lastError.message.includes("Connection timed out") ||
        lastError.message.includes("Failed to connect") ||
        lastError.message.includes("unable to access") ||
        lastError.message.includes("Could not read from remote");

      if (!isNetworkError || attempt === maxRetries) {
        throw lastError;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await log("warn", `   Network error, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Push with network retry and smart upstream handling
 */
export async function pushWithRetry(branch: string, hasUpstreamSet: boolean): Promise<void> {
  await withRetry(async () => {
    if (!hasUpstreamSet) {
      await log("log", `   Setting upstream to origin/${branch}...`);
      await runGit(["push", "-u", "origin", branch]);
    } else {
      await runGit(["push"]);
    }
  });
}

/**
 * Extract GitHub owner and repo from remote URL
 */
export function parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
  // Parse HTTPS URLs: https://github.com/user/repo.git
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // Parse SSH URLs: git@github.com:user/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

/**
 * Extract GitHub Pages URL from remote URL
 */
export function extractGitHubPagesUrl(remoteUrl: string): string {
  const parsed = parseGitHubUrl(remoteUrl);
  if (!parsed) {
    throw new Error("Could not parse GitHub URL from remote");
  }
  return `https://${parsed.owner}.github.io/${parsed.repo}`;
}

// ============================================================================
// Site Fingerprinting
// Compare local site content with remote for change detection
// ============================================================================

/**
 * Parse git ls-tree output into a Map of filename -> hash
 *
 * Git ls-tree format: "mode type hash\tfilename"
 * Example: "100644 blob abc123def456\tpath/to/file.txt"
 *
 * @param lsTreeOutput - Raw output from `git ls-tree -r <branch>`
 * @returns Map of relative file paths to their git blob hashes
 */
export function parseLsTreeOutput(lsTreeOutput: string): Map<string, string> {
  const files = new Map<string, string>();

  for (const line of lsTreeOutput.split("\n")) {
    if (!line.trim()) continue;

    // Format: "mode type hash\tfilename"
    // The tab separates metadata from filename
    const tabIndex = line.indexOf("\t");
    if (tabIndex === -1) continue;

    const metadata = line.substring(0, tabIndex);
    const filename = line.substring(tabIndex + 1);

    // metadata is "mode type hash" separated by spaces
    const parts = metadata.split(" ");
    if (parts.length < 3) continue;

    const hash = parts[2];
    files.set(filename, hash);
  }

  return files;
}

/**
 * Compare two file fingerprints (Map<filename, hash>) and return change details
 *
 * @param localFiles - Map of local file paths to their hashes
 * @param remoteFiles - Map of remote file paths to their hashes (will be mutated)
 * @returns Object with change counts and whether there are any changes
 */
export function compareFingerprints(
  localFiles: Map<string, string>,
  remoteFiles: Map<string, string>
): {
  hasChanges: boolean;
  modified: number;
  added: number;
  deleted: number;
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
} {
  let modified = 0;
  let added = 0;
  const addedFiles: string[] = [];
  const modifiedFiles: string[] = [];

  // Create a copy of remoteFiles to track deletions
  const remainingRemote = new Map(remoteFiles);

  for (const [filename, localHash] of localFiles) {
    const remoteHash = remainingRemote.get(filename);

    if (!remoteHash) {
      // File exists locally but not in remote = added
      added++;
      addedFiles.push(filename);
    } else if (localHash !== remoteHash) {
      // File exists in both but hash differs = modified
      modified++;
      modifiedFiles.push(filename);
      remainingRemote.delete(filename);
    } else {
      // File matches - remove from remaining
      remainingRemote.delete(filename);
    }
  }

  // Files remaining in remainingRemote are deleted (exist in remote but not locally)
  const deleted = remainingRemote.size;
  const deletedFiles = Array.from(remainingRemote.keys());

  const hasChanges = modified > 0 || added > 0 || deleted > 0;

  return { hasChanges, modified, added, deleted, addedFiles, modifiedFiles, deletedFiles };
}

/**
 * Run a shell command silently (no logging)
 * Used for file operations during early change detection
 */
async function runShellSilent(args: string[]): Promise<string> {
  const [binary, ...cmdArgs] = args;

  const result = await executeBinary({
    binaryPath: binary,
    args: cmdArgs,
    timeoutMs: 30000,
  });

  if (!result.success) {
    throw new Error(result.stderr || `Command failed: ${args.join(" ")}`);
  }

  return result.stdout.trim();
}

/**
 * Build the shell command to find files and strip the siteDir prefix.
 * Exported for testing to ensure the command is constructed correctly.
 *
 * Bug fix: The original command used single quotes around the sed pattern,
 * which prevented the siteDir variable from being expanded. Now we escape
 * special regex characters and use proper string interpolation.
 *
 * @param siteDir - The site directory path
 * @returns The shell command string
 */
export function buildFindFilesCommand(siteDir: string): string {
  // Escape special regex characters in the path for sed
  const escapedPath = siteDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `find "${siteDir}" -type f | sed "s|^${escapedPath}/||" | sort`;
}

/**
 * Type alias for fingerprint data structure.
 * Maps filename to its git blob hash.
 */
export type Fingerprint = Map<string, string>;

/**
 * Compare two fingerprints for equality.
 * Uses Map-based comparison which is sort-independent.
 *
 * This solves the problem where git ls-tree and find|sort produce
 * different orderings for Chinese filenames due to locale differences.
 *
 * @param local - Local site fingerprint (filename -> hash)
 * @param remote - Remote gh-pages fingerprint (filename -> hash)
 * @returns true if fingerprints match (same files with same hashes)
 */
export function fingerprintsMatch(local: Fingerprint, remote: Fingerprint): boolean {
  // Quick size check
  if (local.size !== remote.size) {
    return false;
  }

  // Check that every local file exists in remote with same hash
  for (const [file, hash] of local) {
    if (remote.get(file) !== hash) {
      return false;
    }
  }

  return true;
}

/**
 * Get content fingerprint of local site directory.
 * Returns a Map of filename -> git blob hash.
 *
 * Uses batch hashing via `git hash-object --stdin-paths` for efficiency.
 * This reduces 172+ process spawns to just 2 (find + hash-object).
 */
export async function getLocalSiteFingerprint(siteDir: string): Promise<Fingerprint | null> {
  try {
    // Get list of files in site directory
    const filesResult = await runShellSilent([
      "sh", "-c",
      buildFindFilesCommand(siteDir)
    ]);

    const files = filesResult.split("\n").filter(Boolean);
    if (files.length === 0) {
      return new Map();
    }

    // Build full paths for hash-object
    const fullPaths = files.map(f => `${siteDir}/${f}`);

    // Batch hash all files in one call using --stdin-paths
    const hashResult = await executeBinary({
      binaryPath: "git",
      args: ["hash-object", "--stdin-paths"],
      stdin: fullPaths.join("\n"),
      timeoutMs: 60000,
    });

    if (!hashResult.success) {
      return null;
    }

    // Parse hashes and build fingerprint map
    const hashes = hashResult.stdout.trim().split("\n");
    const fingerprint: Fingerprint = new Map();

    for (let i = 0; i < files.length; i++) {
      fingerprint.set(files[i], hashes[i]);
    }

    return fingerprint;
  } catch {
    return null; // Return null on error
  }
}

