/**
 * GitHub Deployment Module
 *
 * Deploys site content to GitHub Pages via git push and backs up
 * source files to the main branch.
 *
 * @module github-deploy
 */

import { GITHUB_API_BASE, GITHUB_API_HEADERS } from "./github-api";
import { executeBinary, type ExecuteResult } from "@symbiosis-lab/moss-api";

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
 * Deploy site to GitHub Pages via a single git repo.
 *
 * Uses one git repo at the project root. Commits source + .moss/site/,
 * pushes to main, then extracts the .moss/site/ tree as an orphan commit
 * and pushes it to gh-pages. This gives GitHub Pages the site content at
 * the branch root while keeping source on main.
 *
 * @param options - Deploy options
 * @returns The short commit SHA on success, or empty string if nothing changed
 */
export async function deployViaGitPush(options: DeployViaGitPushOptions): Promise<string> {
  const { owner, repo, token, onProgress } = options;
  const pushUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

  async function git(args: string[]): Promise<ExecuteResult> {
    return executeBinary({
      binaryPath: "git",
      args,
      workingDir: ".",
      timeoutMs: 300_000,  // 5 min for push
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
  }

  // 1. Init git repo if needed (reuse between deploys for efficiency)
  onProgress(0, "Preparing deploy...");
  const check = await git(["rev-parse", "--git-dir"]);
  if (!check.success) {
    await git(["init"]);
    await git(["config", "user.email", "moss@symbiosis-lab.com"]);
    await git(["config", "user.name", "Moss"]);
  }

  // Ensure .gitignore: exclude .moss/* except .moss/site/, plus runtime artifacts
  await executeBinary({
    binaryPath: "sh",
    args: ["-c", 'printf "node_modules/\\n.DS_Store\\n.moss/*\\n!.moss/site/\\n" > .gitignore'],
    workingDir: ".",
    timeoutMs: 5_000,
    env: {},
  });

  // 2. Stage everything (source + .moss/site/)
  onProgress(5, "Staging files...");
  await git(["add", "--all"]);

  // 3. Check for changes
  const diff = await git(["diff", "--cached", "--quiet"]);
  if (diff.success) return "";  // exit code 0 = nothing to commit

  // 4. Commit
  onProgress(15, "Creating commit...");
  const commit = await git(["commit", "-m", "Deploy site\n\nGenerated by Moss"]);
  if (!commit.success) throw new Error(`git commit failed: ${sanitize(commit.stderr, token)}`);
  const sha = commit.stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/)?.[1] ?? "";

  // 5. Push full repo to main (source backup)
  onProgress(20, "Pushing source to main...");
  const pushMain = await git(["push", "--force", pushUrl, "HEAD:main"]);
  if (!pushMain.success) throw new Error(`git push main failed: ${sanitize(pushMain.stderr, token)}`);

  // 6. Extract .moss/site/ tree and push orphan commit to gh-pages
  onProgress(40, "Pushing site to gh-pages...");
  const tree = await git(["rev-parse", "HEAD:.moss/site"]);
  if (!tree.success) throw new Error(`Failed to resolve .moss/site tree: ${sanitize(tree.stderr, token)}`);

  const orphan = await git(["commit-tree", tree.stdout.trim(), "-m", "Deploy site\n\nGenerated by Moss"]);
  if (!orphan.success) throw new Error(`Failed to create gh-pages commit: ${sanitize(orphan.stderr, token)}`);

  const pushPages = await git(["push", "--force", pushUrl, `${orphan.stdout.trim()}:gh-pages`]);
  if (!pushPages.success) throw new Error(`git push gh-pages failed: ${sanitize(pushPages.stderr, token)}`);

  onProgress(100, "Deployed!");
  return sha;
}
