/**
 * GitHub REST API Deployment Module
 *
 * Replaces the git CLI worktree+push deployment with GitHub's Git Data API.
 * This gives per-file upload progress, eliminates git CLI as a runtime
 * dependency for the deploy phase, and avoids stale worktree bugs.
 *
 * Uses the Git Data API endpoints:
 * - GET/POST /repos/{owner}/{repo}/git/refs
 * - GET /repos/{owner}/{repo}/git/commits/{sha}
 * - GET /repos/{owner}/{repo}/git/trees/{sha}
 * - POST /repos/{owner}/{repo}/git/blobs
 * - POST /repos/{owner}/{repo}/git/trees
 * - POST /repos/{owner}/{repo}/git/commits
 *
 * @module github-deploy
 */

import type { Fingerprint } from "./git";
import { GITHUB_API_BASE, GITHUB_API_HEADERS } from "./github-api";
import { executeBinary, type ExecuteResult } from "@symbiosis-lab/moss-api";

/** Maximum concurrent blob uploads to avoid rate limiting */
const UPLOAD_CONCURRENCY = 5;

// ============================================================================
// Types
// ============================================================================

/**
 * State of a branch on GitHub.
 * Either exists with commit/tree SHAs, or does not exist.
 */
export type BranchState =
  | { exists: true; commitSha: string; treeSha: string }
  | { exists: false };

/**
 * Backward-compatible alias for BranchState.
 * @deprecated Use BranchState instead.
 */
export type GhPagesState = BranchState;

/**
 * A remote tree entry: file SHA and mode from GitHub's tree API.
 */
export interface RemoteTreeEntry {
  sha: string;
  mode: string;
}

/**
 * Result of diffing local files against remote tree.
 */
export interface DiffResult {
  /** Files that are new or modified (need upload) */
  changed: Array<{ path: string; localHash: string }>;
  /** Files that are identical in local and remote */
  unchanged: Array<{ path: string; sha: string; mode: string }>;
  /** Files that exist in remote but not locally (need deletion) */
  deleted: string[];
}

/**
 * A tree entry for the GitHub Create Tree API.
 */
export interface TreeEntry {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob" | "tree" | "commit";
  sha: string | null;
}

/**
 * Progress callback signature.
 */
export type OnProgress = (current: number, total: number, message: string) => void;

/**
 * Options for pushing source files to the main branch.
 */
export interface PushSourceOptions {
  owner: string;
  repo: string;
  token: string;
  uploadFn: UploadFn;
  sourceFingerprint: Fingerprint;
  onProgress: OnProgress;
}

/**
 * Function that uploads a file by relative path and returns the blob SHA.
 * Caller constructs this to route uploads through Rust or JS as appropriate.
 */
export type UploadFn = (relativePath: string) => Promise<string>;

/**
 * Options for the main deployViaAPI entry point.
 */
export interface DeployViaAPIOptions {
  owner: string;
  repo: string;
  token: string;
  uploadFn: UploadFn;
  changed: Array<{ path: string; localHash: string }>;
  deleted: string[];
  ghPagesState: GhPagesState;
  onProgress: OnProgress;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Build authorization headers for GitHub API requests.
 */
function authHeaders(token: string): Record<string, string> {
  return {
    ...GITHUB_API_HEADERS,
    Authorization: `Bearer ${token}`,
  };
}

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
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
    { headers: authHeaders(token) }
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

/**
 * Check the state of a branch on GitHub.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param branch - Branch name (e.g., "gh-pages", "main")
 * @param token - GitHub access token
 * @returns BranchState indicating whether the branch exists and its SHAs
 */
export async function getBranchState(
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<BranchState> {
  // Step 1: Check if branch ref exists
  const refResponse = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    { headers: authHeaders(token) }
  );

  if (refResponse.status === 404 || refResponse.status === 409) {
    return { exists: false };
  }

  if (!refResponse.ok) {
    const msg = await parseErrorMessage(refResponse);
    throw new Error(msg);
  }

  const refData = await refResponse.json();
  const commitSha: string = refData.object.sha;

  // Step 2: Get the commit to find its tree SHA
  const commitResponse = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${commitSha}`,
    { headers: authHeaders(token) }
  );

  if (!commitResponse.ok) {
    const msg = await parseErrorMessage(commitResponse);
    throw new Error(msg);
  }

  const commitData = await commitResponse.json();
  const treeSha: string = commitData.tree.sha;

  return { exists: true, commitSha, treeSha };
}

/**
 * Check the state of the gh-pages branch on GitHub.
 *
 * Convenience wrapper around getBranchState for the gh-pages branch.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub access token
 * @returns GhPagesState indicating whether the branch exists and its SHAs
 */
export async function getGhPagesState(
  owner: string,
  repo: string,
  token: string
): Promise<GhPagesState> {
  return getBranchState(owner, repo, "gh-pages", token);
}

/**
 * Fetch the full recursive tree from GitHub.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param treeSha - The tree SHA to fetch
 * @param token - GitHub access token
 * @returns Map of file path to {sha, mode}
 */
export async function getRemoteTree(
  owner: string,
  repo: string,
  treeSha: string,
  token: string
): Promise<Map<string, RemoteTreeEntry>> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    { headers: authHeaders(token) }
  );

  if (!response.ok) {
    const msg = await parseErrorMessage(response);
    throw new Error(msg);
  }

  const data = await response.json();

  if (data.truncated) {
    console.warn(
      `GitHub tree response was truncated for ${owner}/${repo}. ` +
      `Some files may not be detected for diff. Proceeding with partial tree.`
    );
  }

  const tree = new Map<string, RemoteTreeEntry>();

  for (const entry of data.tree) {
    // Only include blobs (files), skip tree entries (directories)
    if (entry.type === "blob") {
      tree.set(entry.path, { sha: entry.sha, mode: entry.mode });
    }
  }

  return tree;
}

/**
 * Compare local files against remote tree to determine what changed.
 *
 * Pure function -- no I/O.
 *
 * @param local - Map of file path to git blob hash (from getLocalSiteFingerprint)
 * @param remote - Map of file path to {sha, mode} from getRemoteTree, or null for first deploy
 * @returns DiffResult with changed, unchanged, and deleted file lists
 */
export function diffFiles(
  local: Fingerprint,
  remote: Map<string, RemoteTreeEntry> | null
): DiffResult {
  const changed: Array<{ path: string; localHash: string }> = [];
  const unchanged: Array<{ path: string; sha: string; mode: string }> = [];
  const deleted: string[] = [];

  if (remote === null) {
    // First deploy: all local files are "changed" (need upload)
    for (const [path, localHash] of local) {
      changed.push({ path, localHash });
    }
    return { changed, unchanged, deleted };
  }

  // Track which remote paths we've seen so we can find deletions
  const unseenRemotePaths = new Set(remote.keys());

  for (const [path, localHash] of local) {
    const remoteEntry = remote.get(path);

    if (!remoteEntry) {
      // File is new (not in remote)
      changed.push({ path, localHash });
    } else if (localHash !== remoteEntry.sha) {
      // File is modified (hash differs)
      changed.push({ path, localHash });
      unseenRemotePaths.delete(path);
    } else {
      // File is unchanged
      unchanged.push({ path, sha: remoteEntry.sha, mode: remoteEntry.mode });
      unseenRemotePaths.delete(path);
    }
  }

  // Remaining remote paths are deleted (exist in remote but not locally)
  for (const path of unseenRemotePaths) {
    deleted.push(path);
  }

  return { changed, unchanged, deleted };
}

/**
 * Upload changed files as blobs with concurrency limiting.
 *
 * All uploads go through the caller-provided `uploadFn`, which handles
 * the actual HTTP POST (typically via Rust `http_post_site_file`).
 * Reports progress before and after each upload to prevent timeout.
 *
 * @param files - Array of changed files with path and local hash
 * @param uploadFn - Function that uploads a file and returns its blob SHA
 * @param onProgress - Progress callback
 * @returns Map of file path to blob SHA
 */
export async function uploadChangedFiles(
  files: Array<{ path: string; localHash: string }>,
  uploadFn: UploadFn,
  onProgress: OnProgress,
): Promise<Map<string, string>> {
  const blobShas = new Map<string, string>();

  if (files.length === 0) {
    return blobShas;
  }

  let completed = 0;
  const total = files.length;

  const uploadResults = await uploadWithConcurrency(
    files,
    async (file) => {
      onProgress(completed, total, `Uploading ${file.path}...`);
      const blobSha = await uploadFn(file.path);
      completed++;
      onProgress(completed, total, `Uploaded ${file.path}`);
      return { path: file.path, blobSha };
    },
    UPLOAD_CONCURRENCY
  );

  for (const { path, blobSha } of uploadResults) {
    blobShas.set(path, blobSha);
  }

  return blobShas;
}

/**
 * Create a tree on GitHub.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param entries - Tree entries (changed files, deleted files)
 * @param baseTreeSha - Base tree SHA for incremental update, or null for full tree
 * @param token - GitHub access token
 * @returns The new tree SHA
 */
export async function createTree(
  owner: string,
  repo: string,
  entries: TreeEntry[],
  baseTreeSha: string | null,
  token: string
): Promise<string> {
  const body: Record<string, unknown> = { tree: entries };

  if (baseTreeSha) {
    body.base_tree = baseTreeSha;
  }

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const msg = await parseErrorMessage(response);
    throw new Error(msg);
  }

  const data = await response.json();
  return data.sha;
}

/**
 * Create a commit on GitHub.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param message - Commit message
 * @param treeSha - Tree SHA for this commit
 * @param parents - Parent commit SHAs (empty for orphan commit)
 * @param token - GitHub access token
 * @returns The new commit SHA
 */
export async function createCommit(
  owner: string,
  repo: string,
  message: string,
  treeSha: string,
  parents: string[],
  token: string
): Promise<string> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, tree: treeSha, parents }),
    }
  );

  if (!response.ok) {
    const msg = await parseErrorMessage(response);
    throw new Error(msg);
  }

  const data = await response.json();
  return data.sha;
}

/**
 * Update or create a git ref on GitHub.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param ref - Branch name (e.g., "gh-pages")
 * @param sha - Commit SHA to point the ref to
 * @param exists - Whether the ref already exists (PATCH vs POST)
 * @param token - GitHub access token
 */
export async function updateRef(
  owner: string,
  repo: string,
  ref: string,
  sha: string,
  exists: boolean,
  token: string
): Promise<void> {
  let response: Response;

  if (exists) {
    // Update existing ref
    response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${ref}`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sha, force: true }),
      }
    );
  } else {
    // Create new ref
    response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: `refs/heads/${ref}`, sha }),
      }
    );
  }

  if (!response.ok) {
    const msg = await parseErrorMessage(response);
    throw new Error(msg);
  }
}

/**
 * Run async tasks with a concurrency limit.
 *
 * Simple promise pool implementation -- no external dependency needed.
 *
 * @param items - Items to process
 * @param fn - Async function to run on each item
 * @param concurrency - Maximum concurrent tasks
 * @returns Array of results in the same order as items
 */
export async function uploadWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let hasError = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (nextIndex < items.length && !hasError) {
      const index = nextIndex++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
        return;
      }
    }
  }

  // Start up to `concurrency` workers
  const workerCount = Math.min(concurrency, items.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  if (hasError) {
    throw firstError;
  }

  return results;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Deploy site content to GitHub Pages via the REST API.
 *
 * Orchestrates the full deploy flow:
 * 1. Upload changed files as blobs (via uploadFn)
 * 2. Create a tree with changed/deleted entries
 * 3. Create a commit pointing to the new tree
 * 4. Update (or create) the gh-pages ref
 *
 * Reports progress at each phase to prevent inactivity timeout.
 *
 * @param options - Deploy options
 * @returns The new commit SHA, or empty string if nothing to deploy
 */
export async function deployViaAPI(options: DeployViaAPIOptions): Promise<string> {
  const {
    owner,
    repo,
    token,
    uploadFn,
    changed,
    deleted,
    ghPagesState,
    onProgress,
  } = options;

  // Nothing to deploy
  if (changed.length === 0 && deleted.length === 0) {
    return "";
  }

  // Step 1: Upload changed files as blobs
  const blobShas = await uploadChangedFiles(changed, uploadFn, onProgress);

  // Step 2: Build tree entries
  const treeEntries: TreeEntry[] = [];

  // Changed/added files
  for (const file of changed) {
    const blobSha = blobShas.get(file.path);
    if (blobSha) {
      treeEntries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobSha,
      });
    }
  }

  // Deleted files (sha: null tells GitHub to remove them from the tree)
  for (const path of deleted) {
    treeEntries.push({
      path,
      mode: "100644",
      type: "blob",
      sha: null,
    });
  }

  // Determine base tree (null for first deploy, existing tree SHA for updates)
  const baseTreeSha = ghPagesState.exists ? ghPagesState.treeSha : null;

  onProgress(changed.length, changed.length, "Creating file tree...");
  const treeSha = await createTree(owner, repo, treeEntries, baseTreeSha, token);

  // Step 3: Create commit
  const parents = ghPagesState.exists ? [ghPagesState.commitSha] : [];
  const commitMessage = "Deploy site\n\nGenerated by Moss";
  onProgress(changed.length, changed.length, "Creating commit...");
  const commitSha = await createCommit(
    owner, repo, commitMessage, treeSha, parents, token
  );

  // Step 4: Update or create ref
  onProgress(changed.length, changed.length, "Updating branch...");
  await updateRef(owner, repo, "gh-pages", commitSha, ghPagesState.exists, token);

  return commitSha;
}

/**
 * Push source files to the main branch for backup.
 *
 * Updates the existing main branch (created by auto_init) with source files
 * (markdown, config, assets) so the user's raw content is preserved alongside
 * the compiled gh-pages deployment.
 *
 * Skips if main does not exist (shouldn't happen with auto_init: true).
 *
 * @param options - Push source options
 * @returns The commit SHA on success, or empty string if skipped
 */
export async function pushSourceToMain(options: PushSourceOptions): Promise<string> {
  const { owner, repo, token, uploadFn, sourceFingerprint, onProgress } = options;

  // 1. Check if main branch exists — skip if it doesn't (shouldn't happen with auto_init)
  const mainState = await getBranchState(owner, repo, "main", token);
  if (!mainState.exists) {
    return "";
  }

  // 2. All source files
  const files = [...sourceFingerprint.entries()].map(([path, hash]) => ({
    path,
    localHash: hash,
  }));

  if (files.length === 0) {
    return "";
  }

  // 3. Upload blobs via uploadFn
  const blobShas = await uploadChangedFiles(files, uploadFn, onProgress);

  // 4. Create tree entries
  const treeEntries: TreeEntry[] = [];
  for (const file of files) {
    const blobSha = blobShas.get(file.path);
    if (blobSha) {
      treeEntries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: blobSha,
      });
    }
  }

  // 5. Create tree WITH base_tree (incremental update on existing main)
  const treeSha = await createTree(owner, repo, treeEntries, mainState.treeSha, token);

  // 6. Create commit WITH parent (child of existing main HEAD)
  const commitSha = await createCommit(
    owner, repo,
    "Add source files\n\nSource files uploaded by Moss",
    treeSha,
    [mainState.commitSha],
    token
  );

  // 7. Update existing main ref (PATCH, not POST)
  await updateRef(owner, repo, "main", commitSha, true, token);

  return commitSha;
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
 * Deploy site content via `git push --force` to the gh-pages branch.
 *
 * Uses the git CLI (via `executeBinary`) to init a repo in `.moss/site/`,
 * stage all files, commit, and force-push to gh-pages. This replaces the
 * REST API blob-by-blob approach which times out on large files (95 MB videos).
 *
 * Reuses `.moss/site/.git/` between deploys so subsequent pushes only
 * transfer deltas.
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
      workingDir: ".moss/site",
      timeoutMs: 300_000,  // 5 min for push
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
  }

  // 1. Init git repo if needed (reuse between deploys for efficiency)
  onProgress(0, 5, "Preparing deploy...");
  const check = await git(["rev-parse", "--git-dir"]);
  if (!check.success) {
    await git(["init"]);
    await git(["config", "user.email", "moss@symbiosis-lab.com"]);
    await git(["config", "user.name", "Moss"]);
  }

  // 2. Stage all files
  onProgress(1, 5, "Staging files...");
  await git(["add", "--all"]);

  // 3. Check for changes
  const diff = await git(["diff", "--cached", "--quiet"]);
  if (diff.success) return "";  // exit code 0 = nothing to commit

  // 4. Commit
  onProgress(2, 5, "Creating commit...");
  const commit = await git(["commit", "-m", "Deploy site\n\nGenerated by Moss"]);
  if (!commit.success) throw new Error(`git commit failed: ${sanitize(commit.stderr, token)}`);
  const sha = commit.stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/)?.[1] ?? "";

  // 5. Force push to gh-pages
  onProgress(3, 5, "Pushing to GitHub...");
  const push = await git(["push", "--force", pushUrl, "HEAD:gh-pages"]);
  if (!push.success) throw new Error(`git push failed: ${sanitize(push.stderr, token)}`);

  onProgress(5, 5, "Deployed!");
  return sha;
}
