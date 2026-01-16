/**
 * Git command helpers for the GitHub Pages Publisher Plugin
 *
 * Executes git commands via moss-api's executeBinary.
 */

import { executeBinary } from "@symbiosis-lab/moss-api";
import { log, reportProgress, reportError } from "./utils";

/**
 * Run a git command and return the output
 */
async function runGit(args: string[]): Promise<string> {
  await log("log", `   git ${args.join(" ")}`);

  const result = await executeBinary({
    binaryPath: "git",
    args,
    timeoutMs: 60000,
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
 * Detect the default branch (main or master)
 */
export async function detectBranch(): Promise<string> {
  try {
    // Try to get current branch first
    const branch = await runGit(["branch", "--show-current"]);
    if (branch) {
      return branch;
    }
  } catch {
    // Ignore - will try fallbacks
  }

  // Fallback: check if main exists
  try {
    await runGit(["rev-parse", "--verify", "main"]);
    return "main";
  } catch {
    // Ignore - will try master
  }

  // Fallback: check if master exists
  try {
    await runGit(["rev-parse", "--verify", "master"]);
    return "master";
  } catch {
    // Default to main
    return "main";
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

// ============================================================================
// Bug 15: Site Change Detection and Push
// ============================================================================

/**
 * Check if there are uncommitted changes in the site directory
 */
export async function hasSiteChanges(): Promise<boolean> {
  try {
    const status = await runGit(["status", "--porcelain", ".moss/site/"]);
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if local branch is ahead of remote
 */
export async function isAheadOfRemote(): Promise<boolean> {
  try {
    const status = await runGit(["status", "--porcelain", "-b"]);
    return status.includes("[ahead");
  } catch {
    return false;
  }
}

/**
 * Commit and push site changes (for subsequent deploys)
 * Returns commit SHA if changes were pushed, null if no changes
 */
export async function commitAndPushSiteChanges(): Promise<string | null> {
  const hasChanges = await hasSiteChanges();

  if (!hasChanges) {
    // Check if we're ahead of remote (have local commits to push)
    const aheadOfRemote = await isAheadOfRemote();
    if (!aheadOfRemote) {
      await log("log", "   No site changes to deploy");
      return null;
    }
    // We have local commits to push but no new changes
    await log("log", "   Pushing existing commits...");
  } else {
    await log("log", "   Staging site changes...");
    await stageFiles([".moss/site/"]);

    await log("log", "   Creating commit...");
    await commit("Update site\n\nGenerated by Moss");
  }

  const branch = await detectBranch();
  await log("log", "   Pushing to GitHub...");

  const hasUpstreamSet = await hasUpstream();
  await pushWithRetry(branch, hasUpstreamSet);

  return await runGit(["rev-parse", "HEAD"]);
}

/**
 * Stage, commit, and push workflow files
 * Handles first-time push (no upstream) and retry on network errors
 */
export async function commitAndPushWorkflow(): Promise<string> {
  const branch = await detectBranch();

  // Check if we have any commits yet
  const hasCommits = await hasLocalCommits();
  if (!hasCommits) {
    await log("log", "   Repository has no commits yet, this will be the initial commit...");
  }

  await log("log", "   Staging workflow and gitignore...");
  await stageFiles([".github/workflows/moss-deploy.yml", ".gitignore"]);

  await log("log", "   Creating commit...");
  const sha = await commit("Add GitHub Pages deployment workflow\n\nGenerated by Moss");

  await log("log", "   Pushing to remote...");

  // Smart push: use -u if no upstream set, with retry for network errors
  const hasUpstreamSet = await hasUpstream();
  await pushWithRetry(branch, hasUpstreamSet);

  return sha;
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

/**
 * Parse the stale worktree path from a git worktree add error message.
 *
 * Bug 24 fix: Different Git versions use different error messages:
 * - Older: "fatal: 'gh-pages' is already checked out at '/path/to/stale'"
 * - Newer (2.42+): "fatal: 'gh-pages' is already used by worktree at '/path/to/stale'"
 *
 * @param errorMsg - The error message from git worktree add
 * @returns The stale worktree path, or null if this is not a stale worktree error
 */
export function parseStaleWorktreePath(errorMsg: string): string | null {
  // Match both error message formats:
  // - "already checked out at '/path'"
  // - "already used by worktree at '/path'"
  const match = errorMsg.match(/already (?:checked out|used by worktree) at '([^']+)'/);
  return match ? match[1] : null;
}

// ============================================================================
// Early Change Detection
// Compare site content with gh-pages without creating worktree
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
 * Get content fingerprint of gh-pages branch.
 * Returns a Map of filename -> git blob hash.
 *
 * Using Map instead of string comparison solves the sort order issue
 * where git ls-tree and find|sort produce different orderings for
 * Chinese filenames due to locale differences.
 */
export async function getGhPagesFingerprint(): Promise<Fingerprint | null> {
  try {
    // Get list of files and their blob hashes from gh-pages
    const result = await runGit(["ls-tree", "-r", "gh-pages"]);

    // Format: <mode> <type> <hash>\t<filename>
    // The filename is separated by a TAB, not space
    const lines = result.split("\n").filter(Boolean);
    const fingerprint: Fingerprint = new Map();

    for (const line of lines) {
      // Split on tab to separate metadata from filename
      const tabIndex = line.indexOf("\t");
      if (tabIndex === -1) continue;

      const metadata = line.substring(0, tabIndex);
      const filename = line.substring(tabIndex + 1);

      // metadata is "<mode> <type> <hash>"
      const parts = metadata.split(" ");
      const hash = parts[2];

      fingerprint.set(filename, hash);
    }

    return fingerprint;
  } catch {
    return null; // Return null on error
  }
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

/**
 * Quick check if site content has changed from gh-pages.
 * This is an optimization to skip expensive worktree operations when there are no changes.
 *
 * Uses git's native comparison by creating a temporary tree object from the local
 * site directory and comparing it to gh-pages using `git diff-tree`.
 *
 * @param siteDir - Path to site directory (e.g., ".moss/site")
 * @returns Object with hasChanges boolean and optionally the reason
 */
export async function checkForChanges(siteDir: string = ".moss/site"): Promise<{
  hasChanges: boolean;
  reason?: string;
}> {
  try {
    console.log("   Checking for changes against gh-pages...");

    // Get gh-pages file hashes using git ls-tree
    // Use -c core.quotepath=false to get unescaped non-ASCII filenames (e.g., Chinese)
    const lsTreeResult = await executeBinary({
      binaryPath: "git",
      args: ["-c", "core.quotepath=false", "ls-tree", "-r", "gh-pages"],
      timeoutMs: 30000,
    });

    if (!lsTreeResult.success) {
      console.log("   Could not read gh-pages tree, assuming changes");
      return { hasChanges: true, reason: "Failed to read gh-pages" };
    }

    // Parse gh-pages tree using pure function
    const ghPagesFiles = parseLsTreeOutput(lsTreeResult.stdout);
    console.log(`   gh-pages: ${ghPagesFiles.size} files`);

    // Get local site files using find
    const findResult = await executeBinary({
      binaryPath: "find",
      args: [siteDir, "-type", "f"],
      timeoutMs: 30000,
    });

    if (!findResult.success) {
      console.log("   Could not list local files, assuming changes");
      return { hasChanges: true, reason: "Failed to list local files" };
    }

    const localFilePaths = findResult.stdout.trim().split("\n").filter(f => f);
    console.log(`   Local site: ${localFilePaths.length} files`);

    // Build local file fingerprint by computing git hashes
    const siteDirPrefix = siteDir.endsWith("/") ? siteDir : siteDir + "/";
    const localFiles = new Map<string, string>();

    for (const fullPath of localFilePaths) {
      // Get relative path (strip siteDir prefix)
      const relativePath = fullPath.startsWith(siteDirPrefix)
        ? fullPath.substring(siteDirPrefix.length)
        : fullPath;

      // Compute git blob hash for local file
      const hashResult = await executeBinary({
        binaryPath: "git",
        args: ["hash-object", fullPath],
        timeoutMs: 5000,
      });

      if (hashResult.success) {
        localFiles.set(relativePath, hashResult.stdout.trim());
      } else {
        // Can't hash file - mark with empty hash to force "changed"
        localFiles.set(relativePath, "");
      }
    }

    // Compare using pure function
    const comparison = compareFingerprints(localFiles, ghPagesFiles);

    // Log changes (up to 3 of each type)
    for (const file of comparison.addedFiles.slice(0, 3)) {
      console.log(`   + ${file} (new file)`);
    }
    for (const file of comparison.modifiedFiles.slice(0, 3)) {
      console.log(`   ~ ${file} (modified)`);
    }
    for (const file of comparison.deletedFiles.slice(0, 3)) {
      console.log(`   - ${file} (deleted)`);
    }

    if (comparison.hasChanges) {
      console.log(`   Changes: ${comparison.modified} modified, ${comparison.added} added, ${comparison.deleted} deleted`);
    } else {
      console.log("   No changes detected (skipping worktree)");
    }

    return { hasChanges: comparison.hasChanges };
  } catch (error) {
    console.warn(`   Early change detection failed: ${error}`);
    return { hasChanges: true, reason: "Detection error" };
  }
}

// ============================================================================
// Bug 16: Zero-Config gh-pages Deployment
// Deploy to gh-pages branch using git worktree approach
// CRITICAL: Must NOT switch current branch (triggers file watchers)
// ============================================================================

/**
 * Run a shell command via executeBinary
 * Used for file operations (cp, rm, find) that aren't available in moss-api
 */
async function runShell(args: string[]): Promise<string> {
  const [binary, ...cmdArgs] = args;
  await log("log", `   ${binary} ${cmdArgs.join(" ")}`);

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
 * Check if a branch exists locally or remotely
 */
export async function branchExists(branch: string): Promise<boolean> {
  // Check local branch
  try {
    await runGit(["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    // Not found locally, check remote
  }

  // Check remote branch
  try {
    await runGit(["rev-parse", "--verify", `refs/remotes/origin/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a worktree with recovery for stale worktree errors
 * Bug 24 fix: If worktree add fails because the branch is already checked out
 * in a stale worktree (from a crashed previous deployment), parse the stale path
 * from the error message, remove it, and retry.
 */
async function addWorktreeWithRecovery(worktreePath: string, branch: string): Promise<void> {
  try {
    await runGit(["worktree", "add", worktreePath, branch]);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Check if this is a stale worktree error (handles both Git version formats)
    const stalePath = parseStaleWorktreePath(errorMsg);

    if (stalePath) {
      await log("log", `   Found stale worktree at ${stalePath}, cleaning up...`);
      // Report recovery status to toast so user knows what's happening
      await reportError("Recovering from stale worktree...", "deploy", false);

      // Try to remove the stale worktree
      try {
        await runGit(["worktree", "remove", stalePath, "--force"]);
      } catch {
        // If git worktree remove fails, try direct directory removal
        await log("log", "   Worktree remove failed, trying direct cleanup...");
      }

      // Also remove the directory if it still exists
      try {
        await runShell(["rm", "-rf", stalePath]);
      } catch {
        // Directory might not exist, that's fine
      }

      // Prune again to clean up any remaining references
      try {
        await runGit(["worktree", "prune"]);
      } catch {
        // Prune failed, continue anyway
      }

      // Retry the worktree add
      await log("log", "   Retrying worktree creation...");
      await runGit(["worktree", "add", worktreePath, branch]);
    } else {
      // Not a stale worktree error, rethrow
      throw error;
    }
  }
}

/**
 * Generate a unique temp directory path for worktree
 * Uses system temp directory to avoid issues with .moss being in git
 */
function getWorktreePath(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `/tmp/moss-gh-pages-${timestamp}-${random}`;
}

/**
 * Result from deployToGhPages including cleanup callback
 */
export interface DeployResult {
  /** Commit SHA if changes were deployed, empty string if no changes */
  commitSha: string;
  /** Cleanup function to call after completion signal is sent to moss */
  cleanup: () => Promise<void>;
}

/**
 * Deploy site content to gh-pages branch without switching current branch
 * Uses git worktree to avoid triggering file watchers
 *
 * ## Design: Explicit Completion with Deferred Cleanup
 *
 * Returns a cleanup function that should be called AFTER signaling completion
 * to moss via reportComplete(). This ensures:
 * - Moss receives the result immediately (toast shown right away)
 * - Cleanup can take as long as needed without blocking the UI
 * - No race condition between completion signal and cleanup timeout
 *
 * @param siteDir - Relative path to the site directory (e.g., ".moss/site")
 * @returns DeployResult with commitSha and cleanup callback
 */
export async function deployToGhPages(siteDir: string = ".moss/site"): Promise<DeployResult> {
  const worktreePath = getWorktreePath();
  console.log(`   Worktree path will be: ${worktreePath}`);

  try {
    // Step 0: Clean up stale worktrees from previous crashed deployments
    // Bug 24 fix: If a previous deployment crashed, a stale worktree entry may still
    // reference gh-pages, causing "already checked out" errors. Prune removes entries
    // for worktrees whose directories no longer exist.
    await reportProgress("deploying", 1, 5, "Preparing worktree...");
    console.log("   Step 0: Cleaning up stale worktrees...");

    // First, list existing worktrees for diagnostics
    try {
      const worktreeList = await runGit(["worktree", "list"]);
      console.log("   Current worktrees:\n" + worktreeList);
    } catch (e) {
      console.warn("   Could not list worktrees:", e instanceof Error ? e.message : String(e));
    }

    try {
      console.log("   Running: git worktree prune");
      await runGit(["worktree", "prune"]);
      console.log("   Prune completed");
    } catch (e) {
      console.warn("   Prune failed (continuing anyway):", e instanceof Error ? e.message : String(e));
    }

    // Also try to remove the specific worktree path if it exists
    try {
      console.log(`   Running: git worktree remove ${worktreePath} --force`);
      await runGit(["worktree", "remove", worktreePath, "--force"]);
      console.log("   Worktree removed");
    } catch (e) {
      console.log("   Worktree remove skipped (not found or error):", e instanceof Error ? e.message : String(e));
    }

    // Clean up the directory if it exists
    try {
      console.log(`   Running: rm -rf ${worktreePath}`);
      await runShell(["rm", "-rf", worktreePath]);
      console.log("   Directory cleanup completed");
    } catch (e) {
      console.log("   Directory cleanup skipped:", e instanceof Error ? e.message : String(e));
    }

    // Step 1: Create or add gh-pages worktree
    await reportProgress("deploying", 2, 5, "Creating worktree...");
    await log("log", "   Creating gh-pages worktree...");
    const ghPagesExists = await branchExists("gh-pages");

    if (!ghPagesExists) {
      // Create orphan branch using git plumbing (Git 1.5.0+ compatible)
      // Bug 18 fix: --orphan flag requires Git 2.42+, use plumbing instead

      // Step 1: Use known empty tree hash (deterministic, same in all git repos)
      // This is the SHA-1 of an empty tree object: "tree 0\0"
      const emptyTreeHash = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

      // Step 2: Create orphan commit with empty tree
      await log("log", "   Creating orphan commit for gh-pages...");
      const commitHash = await runGit(["commit-tree", emptyTreeHash, "-m", "Initialize gh-pages branch"]);

      // Step 3: Create branch reference (without switching current branch)
      await runGit(["update-ref", "refs/heads/gh-pages", commitHash.trim()]);

      // Step 4: Add worktree for the new branch (with recovery for edge cases)
      await addWorktreeWithRecovery(worktreePath, "gh-pages");
    } else {
      // Use existing gh-pages branch with recovery for stale worktrees
      await addWorktreeWithRecovery(worktreePath, "gh-pages");
    }

    // Step 2: Clean worktree (remove all files except .git)
    await log("log", "   Cleaning worktree...");
    await runShell(["sh", "-c", `find ${worktreePath} -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +`]);

    // Step 3: Copy site files to worktree
    await reportProgress("deploying", 3, 5, "Copying site files...");
    await log("log", "   Copying site files to gh-pages...");
    await runShell(["cp", "-r", `${siteDir}/.`, worktreePath]);

    // Step 4: Commit in worktree (uses git -C to run in different directory)
    await reportProgress("deploying", 4, 5, "Committing changes...");
    await log("log", "   Committing to gh-pages...");
    await runGit(["-C", worktreePath, "add", "-A"]);

    // Check if there are changes to commit
    let status = "";
    try {
      status = await runGit(["-C", worktreePath, "status", "--porcelain"]);
    } catch {
      status = "";
    }

    if (!status.trim()) {
      await log("log", "   No changes to deploy");
      // No changes - still need to cleanup the worktree
      return {
        commitSha: "",
        cleanup: () => cleanupWorktree(worktreePath),
      };
    }

    await runGit(["-C", worktreePath, "commit", "-m", "Deploy site\n\nGenerated by Moss"]);
    const sha = await runGit(["-C", worktreePath, "rev-parse", "HEAD"]);

    // Step 5: Push gh-pages
    await reportProgress("deploying", 5, 5, "Pushing to GitHub...");
    await log("log", "   Pushing gh-pages to GitHub...");
    await runGit(["-C", worktreePath, "push", "--force", "origin", "gh-pages"]);

    // Return commit SHA and cleanup callback
    // Caller should call cleanup() AFTER signaling completion to moss
    const commitSha = sha.trim();

    return {
      commitSha,
      cleanup: () => cleanupWorktree(worktreePath),
    };
  } catch (error) {
    // On error, still cleanup but in background (don't block throw)
    cleanupWorktree(worktreePath).catch(() => {});
    throw error;
  }
}

/**
 * Non-blocking worktree cleanup with short timeout
 * Bug 19 fix: Prevents hanging after successful deployment
 */
async function cleanupWorktree(worktreePath: string): Promise<void> {
  console.log(`   Cleaning up worktree at ${worktreePath}...`);

  // Use 30 second timeout for cleanup (was 5 seconds, too short)
  // Bug fix: 5 seconds was causing stale worktrees on every deploy
  const cleanupTimeout = 30000;

  try {
    // Try git worktree remove with timeout
    console.log("   Running: git worktree remove --force");
    await Promise.race([
      runGit(["worktree", "remove", worktreePath, "--force"]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Cleanup timeout")), cleanupTimeout)
      ),
    ]);
    console.log("   Worktree removed successfully via git");
  } catch (error) {
    console.warn("   git worktree remove failed:", error instanceof Error ? error.message : String(error));
    // Fallback: force remove directory directly
    try {
      console.log("   Fallback: rm -rf worktree directory");
      await Promise.race([
        runShell(["rm", "-rf", worktreePath]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("rm timeout")), cleanupTimeout)
        ),
      ]);
      console.log("   Directory removed successfully via rm -rf");
    } catch (rmError) {
      console.error("   rm -rf also failed:", rmError instanceof Error ? rmError.message : String(rmError));
      // Best effort - don't block, temp directory will be cleaned up eventually
    }
  }

  // Also prune any stale worktree entries from git
  try {
    console.log("   Running: git worktree prune");
    await runGit(["worktree", "prune"]);
    console.log("   Worktree prune completed");
  } catch (pruneError) {
    console.warn("   git worktree prune failed:", pruneError instanceof Error ? pruneError.message : String(pruneError));
  }
}
