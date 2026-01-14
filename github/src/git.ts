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
 * Returns list of files with their git blob hashes, sorted for comparison.
 */
export async function getGhPagesFingerprint(): Promise<string> {
  try {
    // Get list of files and their blob hashes from gh-pages
    const result = await runGit(["ls-tree", "-r", "gh-pages"]);

    // Format: <mode> <type> <hash>\t<filename>
    // Extract hash and filename, sort for consistent comparison
    const lines = result.split("\n").filter(Boolean);
    const fingerprint = lines
      .map(line => {
        const parts = line.split(/\s+/);
        const hash = parts[2];
        const filename = parts.slice(3).join(" "); // Handle filenames with spaces
        return `${hash}  ${filename}`;
      })
      .sort()
      .join("\n");

    return fingerprint || "empty";
  } catch {
    return ""; // Return empty on error
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
 * Get content fingerprint of local site directory.
 * Uses git hash-object to compute blob hashes for each file.
 */
export async function getLocalSiteFingerprint(siteDir: string): Promise<string> {
  try {
    // Get list of files in site directory
    const filesResult = await runShellSilent([
      "sh", "-c",
      buildFindFilesCommand(siteDir)
    ]);

    const files = filesResult.split("\n").filter(Boolean);
    if (files.length === 0) {
      return "empty";
    }

    // Compute git blob hash for each file
    const fingerprints: string[] = [];
    for (const file of files) {
      const filePath = `${siteDir}/${file}`;
      const hash = await runGit(["hash-object", filePath]);
      fingerprints.push(`${hash}  ${file}`);
    }

    return fingerprints.sort().join("\n");
  } catch {
    return ""; // Return empty on error
  }
}

/**
 * Quick check if site content has changed from gh-pages.
 * This is an optimization to skip expensive worktree operations when there are no changes.
 *
 * Uses git blob hashes for comparison (same as git would use internally).
 *
 * @param siteDir - Path to site directory (e.g., ".moss/site")
 * @returns Object with hasChanges boolean and optionally the URL
 */
export async function checkForChanges(siteDir: string = ".moss/site"): Promise<{
  hasChanges: boolean;
  reason?: string;
}> {
  try {
    await log("log", "   Checking for changes...");

    // Get fingerprint of gh-pages content
    const ghPagesFingerprint = await getGhPagesFingerprint();
    if (!ghPagesFingerprint) {
      return { hasChanges: true, reason: "Could not read gh-pages" };
    }

    // Get fingerprint of local site
    const localFingerprint = await getLocalSiteFingerprint(siteDir);
    if (!localFingerprint) {
      return { hasChanges: true, reason: "Could not read site directory" };
    }

    // Compare fingerprints
    const hasChanges = localFingerprint !== ghPagesFingerprint;
    if (!hasChanges) {
      await log("log", "   No changes detected (skipping worktree)");
    }

    return { hasChanges };
  } catch (error) {
    await log("warn", `   Early change detection failed: ${error}`);
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
 * Deploy site content to gh-pages branch without switching current branch
 * Uses git worktree to avoid triggering file watchers
 *
 * @param siteDir - Relative path to the site directory (e.g., ".moss/site")
 * @returns Commit SHA if changes were deployed, empty string if no changes
 */
export async function deployToGhPages(siteDir: string = ".moss/site"): Promise<string> {
  const worktreePath = getWorktreePath();

  try {
    // Step 0: Clean up stale worktrees from previous crashed deployments
    // Bug 24 fix: If a previous deployment crashed, a stale worktree entry may still
    // reference gh-pages, causing "already checked out" errors. Prune removes entries
    // for worktrees whose directories no longer exist.
    await reportProgress("deploying", 1, 5, "Preparing worktree...");
    await log("log", "   Preparing gh-pages worktree...");
    try {
      await runGit(["worktree", "prune"]);
    } catch {
      // Prune failed, continue anyway - might still work
    }

    // Also try to remove the specific worktree path if it exists
    try {
      await runGit(["worktree", "remove", worktreePath, "--force"]);
    } catch {
      // Worktree doesn't exist, that's fine
    }

    // Clean up the directory if it exists
    try {
      await runShell(["rm", "-rf", worktreePath]);
    } catch {
      // Directory doesn't exist, that's fine
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
      return "";
    }

    await runGit(["-C", worktreePath, "commit", "-m", "Deploy site\n\nGenerated by Moss"]);
    const sha = await runGit(["-C", worktreePath, "rev-parse", "HEAD"]);

    // Step 5: Push gh-pages
    await reportProgress("deploying", 5, 5, "Pushing to GitHub...");
    await log("log", "   Pushing gh-pages to GitHub...");
    await runGit(["-C", worktreePath, "push", "--force", "origin", "gh-pages"]);

    // Bug 19 fix: Capture SHA before cleanup to ensure we return immediately
    const commitSha = sha.trim();

    // Step 6: Cleanup worktree in background (don't block return)
    // This prevents hanging if cleanup takes too long due to file locks
    cleanupWorktree(worktreePath).catch(() => {
      // Silent cleanup failure is OK - temp directory will be cleaned up eventually
    });

    return commitSha;
  } catch (error) {
    // On error, still try to cleanup but don't block
    cleanupWorktree(worktreePath).catch(() => {});
    throw error;
  }
}

/**
 * Non-blocking worktree cleanup with short timeout
 * Bug 19 fix: Prevents hanging after successful deployment
 */
async function cleanupWorktree(worktreePath: string): Promise<void> {
  await log("log", "   Cleaning up worktree...");

  // Use shorter timeout for cleanup (5 seconds instead of 60)
  const cleanupTimeout = 5000;

  try {
    // Try git worktree remove with timeout
    await Promise.race([
      runGit(["worktree", "remove", worktreePath, "--force"]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Cleanup timeout")), cleanupTimeout)
      ),
    ]);
  } catch {
    // Fallback: force remove directory directly
    try {
      await Promise.race([
        runShell(["rm", "-rf", worktreePath]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("rm timeout")), cleanupTimeout)
        ),
      ]);
    } catch {
      // Best effort - don't block, temp directory will be cleaned up eventually
    }
  }
}
