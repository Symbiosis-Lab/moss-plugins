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

import { executeBinary } from "@symbiosis-lab/moss-api";
import type { Fingerprint } from "./git";

// ============================================================================
// Constants
// ============================================================================

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "Moss-GitHub-Deployer",
};

/** Maximum concurrent blob uploads to avoid rate limiting */
const UPLOAD_CONCURRENCY = 5;

// ============================================================================
// Types
// ============================================================================

/**
 * State of the gh-pages branch on GitHub.
 * Either exists with commit/tree SHAs, or does not exist.
 */
export type GhPagesState =
  | { exists: true; commitSha: string; treeSha: string }
  | { exists: false };

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
 * Options for the main deployViaAPI entry point.
 */
export interface DeployViaAPIOptions {
  owner: string;
  repo: string;
  token: string;
  siteDir: string;
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
 * Check the state of the gh-pages branch on GitHub.
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
  // Step 1: Check if gh-pages ref exists
  const refResponse = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/gh-pages`,
    { headers: authHeaders(token) }
  );

  if (refResponse.status === 404) {
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
 * Read a file and encode it as base64 for GitHub blob upload.
 *
 * Uses the `base64` CLI command (macOS-only for now).
 *
 * @param filePath - Absolute path to the file
 * @returns Object with base64 content and encoding type
 */
export async function readFileForUpload(
  filePath: string
): Promise<{ content: string; encoding: "base64" }> {
  const result = await executeBinary({
    binaryPath: "base64",
    args: [filePath],
    timeoutMs: 30000,
  });

  if (!result.success) {
    const error = result.stderr || `Failed to read file: ${filePath}`;
    throw new Error(error);
  }

  // Strip trailing whitespace/newlines from base64 output
  const content = result.stdout.trim();

  return { content, encoding: "base64" };
}

/**
 * Upload a single blob to GitHub.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param content - File content (base64 encoded)
 * @param encoding - Encoding type ("base64")
 * @param token - GitHub access token
 * @returns The blob SHA
 */
export async function uploadBlob(
  owner: string,
  repo: string,
  content: string,
  encoding: string,
  token: string
): Promise<string> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, encoding }),
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
 * Upload changed files to GitHub as blobs with concurrency limiting.
 *
 * @param files - Array of changed files with path and local hash
 * @param siteDir - Path to the site directory
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub access token
 * @param onProgress - Progress callback
 * @returns Map of file path to uploaded blob SHA
 */
export async function uploadChangedFiles(
  files: Array<{ path: string; localHash: string }>,
  siteDir: string,
  owner: string,
  repo: string,
  token: string,
  onProgress: OnProgress
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (files.length === 0) {
    return result;
  }

  let completed = 0;
  const total = files.length;

  const uploadResults = await uploadWithConcurrency(
    files,
    async (file) => {
      // Read and encode the file
      const filePath = `${siteDir}/${file.path}`;
      const { content, encoding } = await readFileForUpload(filePath);

      // Upload as blob
      const blobSha = await uploadBlob(owner, repo, content, encoding, token);

      // Report progress
      completed++;
      onProgress(completed, total, `Uploaded ${file.path}`);

      return { path: file.path, blobSha };
    },
    UPLOAD_CONCURRENCY
  );

  for (const { path, blobSha } of uploadResults) {
    result.set(path, blobSha);
  }

  return result;
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
 * 1. Upload changed files as blobs
 * 2. Create a tree with changed/deleted entries
 * 3. Create a commit pointing to the new tree
 * 4. Update (or create) the gh-pages ref
 *
 * @param options - Deploy options
 * @returns The new commit SHA, or empty string if nothing to deploy
 */
export async function deployViaAPI(options: DeployViaAPIOptions): Promise<string> {
  const {
    owner,
    repo,
    token,
    siteDir,
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
  const blobShas = await uploadChangedFiles(
    changed, siteDir, owner, repo, token, onProgress
  );

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

  const treeSha = await createTree(owner, repo, treeEntries, baseTreeSha, token);

  // Step 3: Create commit
  const parents = ghPagesState.exists ? [ghPagesState.commitSha] : [];
  const commitMessage = "Deploy site\n\nGenerated by Moss";
  const commitSha = await createCommit(
    owner, repo, commitMessage, treeSha, parents, token
  );

  // Step 4: Update or create ref
  await updateRef(owner, repo, "gh-pages", commitSha, ghPagesState.exists, token);

  return commitSha;
}
