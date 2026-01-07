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
    // Step 0: Remove stale worktree if exists (shouldn't happen with unique paths, but be safe)
    await log("log", "   Preparing gh-pages worktree...");
    try {
      await runGit(["worktree", "remove", worktreePath, "--force"]);
    } catch {
      // Worktree doesn't exist, that's fine
    }

    // Also clean up the directory if it exists
    try {
      await runShell(["rm", "-rf", worktreePath]);
    } catch {
      // Directory doesn't exist, that's fine
    }

    // Step 1: Create or add gh-pages worktree
    await log("log", "   Creating gh-pages worktree...");
    const ghPagesExists = await branchExists("gh-pages");

    if (!ghPagesExists) {
      // Create orphan branch in worktree
      await runGit(["worktree", "add", "--orphan", "-B", "gh-pages", worktreePath]);
    } else {
      // Use existing gh-pages branch
      await runGit(["worktree", "add", worktreePath, "gh-pages"]);
    }

    // Step 2: Clean worktree (remove all files except .git)
    await log("log", "   Cleaning worktree...");
    await runShell(["sh", "-c", `find ${worktreePath} -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +`]);

    // Step 3: Copy site files to worktree
    await log("log", "   Copying site files to gh-pages...");
    await runShell(["cp", "-r", `${siteDir}/.`, worktreePath]);

    // Step 4: Commit in worktree (uses git -C to run in different directory)
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
    await log("log", "   Pushing gh-pages to GitHub...");
    await runGit(["-C", worktreePath, "push", "--force", "origin", "gh-pages"]);

    return sha.trim();
  } finally {
    // Step 6: Cleanup worktree
    await log("log", "   Cleaning up worktree...");
    try {
      await runGit(["worktree", "remove", worktreePath, "--force"]);
    } catch {
      // Best effort cleanup
    }
    // Also try to remove the temp directory directly
    try {
      await runShell(["rm", "-rf", worktreePath]);
    } catch {
      // Best effort cleanup
    }
  }
}
