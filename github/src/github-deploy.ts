/**
 * GitHub Deployment Module
 *
 * Deploys site content to GitHub Pages via git push and backs up
 * source files to the main branch.
 *
 * @module github-deploy
 */

import { GITHUB_API_BASE, GITHUB_API_HEADERS } from "./github-api";
import { executeBinary, listSiteFilesWithSizes, type ExecuteResult } from "@symbiosis-lab/moss-api";
import { showToast } from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Progress callback: (percent 0-100, message).
 * Percent reflects weighted phase position, not linear file count.
 */
export type OnProgress = (percent: number, message: string) => void;

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Parse an error response body for a human-readable message.
 */
async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.message || `GitHub API error: ${response.status}`;
  } catch {
    return `GitHub API error: ${response.status}`;
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Verify that a repository exists on GitHub.
 *
 * Call this early in the deploy flow to fail fast with a clear error message
 * instead of getting a cryptic "Not Found" from blob/tree/commit endpoints.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub access token
 * @throws Error if the repository does not exist or is inaccessible
 */
export async function verifyRepoExists(
  owner: string,
  repo: string,
  token: string
): Promise<void> {
  const headers = {
    ...GITHUB_API_HEADERS,
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
    { headers }
  );

  if (response.status === 404) {
    // Disambiguate: check if the owner exists (unauthenticated, works for public profiles)
    const ownerResp = await fetch(`${GITHUB_API_BASE}/users/${owner}`, {
      headers: { ...GITHUB_API_HEADERS },
    });

    if (ownerResp.status === 404) {
      throw new Error(
        `GitHub user or organization "${owner}" not found. ` +
        `Check for typos in the repository owner name.`
      );
    }

    throw new Error(
      `Repository "${owner}/${repo}" not found on GitHub. ` +
      `The repository may not exist, or your token may not have access to it.`
    );
  }

  if (response.status === 401) {
    throw new Error(
      `GitHub token is invalid or expired. Please re-authenticate.`
    );
  }

  if (response.status === 403) {
    throw new Error(
      `Access denied to "${owner}/${repo}". ` +
      `Your token may lack the required "repo" scope.`
    );
  }

  if (!response.ok) {
    const msg = await parseErrorMessage(response);
    throw new Error(msg);
  }
}

// ============================================================================
// Constants
// ============================================================================

/** GitHub's per-file size limit: 100 MB */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// ============================================================================
// Git Push Deploy
// ============================================================================

/**
 * Options for deploying via git push.
 */
export interface DeployViaGitPushOptions {
  owner: string;
  repo: string;
  token: string;
  onProgress: OnProgress;
}

/**
 * Replace all occurrences of the token in text with "***".
 * Prevents leaking credentials in error messages.
 */
function sanitize(text: string, token: string): string {
  return text.replaceAll(token, "***");
}

/**
 * Format a byte count as a human-readable string (e.g., "105.3 MB").
 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * Parse git push progress from stderr and map to a progress range.
 *
 * Git push outputs lines like:
 *   "Writing objects:  79% (234/295), 1.84 MiB | 1.20 MiB/s"
 *
 * @param line - stderr line from git push
 * @param rangeStart - Start of the progress range (e.g., 20)
 * @param rangeEnd - End of the progress range (e.g., 40)
 * @param onProgress - Callback to report progress
 * @param token - Token to sanitize from output
 */
function parsePushProgress(
  line: string,
  rangeStart: number,
  rangeEnd: number,
  onProgress: OnProgress,
  token: string,
): void {
  const match = line.match(/Writing objects:\s+(\d+)%/);
  if (match) {
    const gitPercent = parseInt(match[1], 10);
    const mapped = Math.round(rangeStart + (gitPercent / 100) * (rangeEnd - rangeStart));
    onProgress(mapped, sanitize(line.trim(), token));
  }
}

/**
 * Deploy site to GitHub Pages via a single git repo.
 *
 * Uses one git repo at the project root. Commits source + .moss/site/,
 * pushes to main, then extracts the .moss/site/ tree as an orphan commit
 * and pushes it to gh-pages. This gives GitHub Pages the site content at
 * the branch root while keeping source on main.
 *
 * Enforces GitHub's 100MB per-file limit:
 * - Site files (.moss/site/): ABORT if any exceed 100MB
 * - Source files (project root): SKIP >100MB files with a warning toast
 *
 * @param options - Deploy options
 * @returns The short commit SHA on success, or empty string if nothing changed
 */
export async function deployViaGitPush(options: DeployViaGitPushOptions): Promise<string> {
  const { owner, repo, token, onProgress } = options;
  const pushUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

  async function git(
    args: string[],
    onStderr?: (line: string) => void,
  ): Promise<ExecuteResult> {
    return executeBinary({
      binaryPath: "git",
      args,
      workingDir: ".",
      timeoutMs: 600_000,  // 10 min — first push of large repos can be slow
      env: { GIT_TERMINAL_PROMPT: "0" },
      onStderr,
    });
  }

  // ── Pre-flight: Check site files for 100MB limit ──────────────────────
  onProgress(0, "Preparing deploy...");

  const siteFiles = await listSiteFilesWithSizes();
  const oversizedSiteFiles = siteFiles.filter((f) => f.size > MAX_FILE_SIZE);
  if (oversizedSiteFiles.length > 0) {
    const fileList = oversizedSiteFiles
      .map((f) => `  ${f.path} (${formatSize(f.size)})`)
      .join("\n");
    throw new Error(
      `Site files exceed GitHub's 100 MB per-file limit:\n${fileList}\n\n` +
      `Remove or reduce these files before deploying.`
    );
  }

  // ── 1. Init git repo if needed (reuse between deploys for efficiency) ─
  const check = await git(["rev-parse", "--git-dir"]);
  if (!check.success) {
    await git(["init"]);
    await git(["config", "user.email", "moss@symbiosis-lab.com"]);
    await git(["config", "user.name", "Moss"]);
  }

  // ── Ensure .gitignore: exclude .moss/* except .moss/site/ ─────────────
  onProgress(1, "Writing .gitignore...");
  await executeBinary({
    binaryPath: "sh",
    args: ["-c", 'printf "node_modules/\\n.DS_Store\\n.moss/*\\n!.moss/site/\\n" > .gitignore'],
    workingDir: ".",
    timeoutMs: 5_000,
    env: {},
  });

  // ── Check for source files >100MB and append to .gitignore ────────────
  onProgress(2, "Checking file sizes...");
  const findResult = await executeBinary({
    binaryPath: "find",
    args: [
      ".", "-not", "-path", "./.moss/*", "-not", "-path", "./.git/*",
      "-type", "f", "-size", "+100M",
    ],
    workingDir: ".",
    timeoutMs: 30_000,
    env: {},
  });

  const largeSourceFiles = findResult.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // Strip leading "./" from find output
    .map((l) => l.startsWith("./") ? l.slice(2) : l);

  if (largeSourceFiles.length > 0) {
    // Append large files to .gitignore so git add skips them
    const escapedFiles = largeSourceFiles.map((f) => f.replace(/'/g, "'\\''")).join("\\n");
    await executeBinary({
      binaryPath: "sh",
      args: ["-c", `printf "\\n${escapedFiles}\\n" >> .gitignore`],
      workingDir: ".",
      timeoutMs: 5_000,
      env: {},
    });

    // Show warning toast
    const fileList = largeSourceFiles.join(", ");
    await showToast({
      variant: "warning",
      message: `Skipped ${largeSourceFiles.length} file(s) exceeding 100 MB: ${fileList}`,
      duration: 10_000,
    });
  }

  onProgress(3, "Checking file sizes...");

  // ── 2. Stage everything (source + .moss/site/) ───────────────────────
  onProgress(5, "Staging files...");
  await git(["add", "--all", "-v"], (line) => {
    // git add -v outputs "add '<filename>'" lines to stderr
    const match = line.match(/add '(.+)'/);
    if (match) {
      onProgress(5, `Staging ${match[1]}`);
    }
  });

  // ── 3. Check for changes ──────────────────────────────────────────────
  const diff = await git(["diff", "--cached", "--quiet"]);
  if (diff.success) return "";  // exit code 0 = nothing to commit

  // ── 4. Commit ─────────────────────────────────────────────────────────
  onProgress(15, "Creating commit...");
  const commit = await git(["commit", "-m", "Deploy site\n\nGenerated by Moss"]);
  if (!commit.success) throw new Error(`git commit failed: ${sanitize(commit.stderr, token)}`);
  const sha = commit.stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/)?.[1] ?? "";

  // ── 5. Push full repo to main (source backup) ────────────────────────
  onProgress(20, "Pushing source to main...");
  const pushMain = await git(
    ["push", "--force", "--progress", pushUrl, "HEAD:main"],
    (line) => parsePushProgress(line, 20, 40, onProgress, token),
  );
  if (!pushMain.success) throw new Error(`git push main failed: ${sanitize(pushMain.stderr, token)}`);

  // ── 6. Extract .moss/site/ tree and push orphan commit to gh-pages ───
  onProgress(40, "Pushing site to gh-pages...");
  const tree = await git(["rev-parse", "HEAD:.moss/site"]);
  if (!tree.success) throw new Error(`Failed to resolve .moss/site tree: ${sanitize(tree.stderr, token)}`);

  onProgress(45, "Creating gh-pages commit...");
  const orphan = await git(["commit-tree", tree.stdout.trim(), "-m", "Deploy site\n\nGenerated by Moss"]);
  if (!orphan.success) throw new Error(`Failed to create gh-pages commit: ${sanitize(orphan.stderr, token)}`);

  onProgress(50, "Pushing site to gh-pages...");
  const pushPages = await git(
    ["push", "--force", "--progress", pushUrl, `${orphan.stdout.trim()}:gh-pages`],
    (line) => parsePushProgress(line, 50, 95, onProgress, token),
  );
  if (!pushPages.success) throw new Error(`git push gh-pages failed: ${sanitize(pushPages.stderr, token)}`);

  onProgress(100, "Deployed!");
  return sha;
}
