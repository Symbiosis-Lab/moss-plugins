/**
 * Git utility functions for the GitHub Pages Publisher Plugin
 *
 * Pure functions for URL parsing, fingerprinting, and comparison.
 * No git CLI or filesystem access — all I/O is injected via parameters.
 */

import { gitBlobHash } from "./hash";

/**
 * Extract GitHub owner and repo from remote URL
 */
export function parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
  // Parse HTTPS URLs: https://github.com/user/repo.git
  // Allows dots in repo name (e.g., username.github.io) but not slashes
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // Parse SSH URLs: git@github.com:user/repo.git
  // Allows dots in repo name (e.g., username.github.io) but not slashes
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
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
  // User/org site repos (e.g., "username.github.io") serve at root
  if (parsed.repo.toLowerCase() === `${parsed.owner.toLowerCase()}.github.io`) {
    return `https://${parsed.owner}.github.io`;
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
 * Uses gitBlobHash (Web Crypto SHA-1) to compute hashes identical to
 * `git hash-object`, eliminating the git CLI dependency.
 *
 * @param siteFiles - List of relative file paths (from context.site_files)
 * @param readFn - Function to read a file's content as base64 (readSiteFile)
 * @returns Fingerprint map, or null on error
 */
export async function getLocalSiteFingerprint(
  siteFiles: string[],
  readFn: (path: string) => Promise<string>
): Promise<Fingerprint | null> {
  try {
    if (siteFiles.length === 0) {
      return new Map();
    }

    const fingerprint: Fingerprint = new Map();

    for (const file of siteFiles) {
      const base64Content = await readFn(file);
      const hash = await gitBlobHash(base64Content);
      fingerprint.set(file, hash);
    }

    return fingerprint;
  } catch {
    return null; // Return null on error
  }
}

/**
 * Patterns to exclude when fingerprinting source files.
 * These are build artifacts, VCS metadata, and OS files that should not
 * be included in the source fingerprint.
 */
export const SOURCE_EXCLUDE_PATTERNS = [
  "*/.moss/*",
  "*/.git/*",
  "*/node_modules/*",
  "*/.DS_Store",
];

/**
 * Get content fingerprint of local source directory.
 * Returns a Map of filename -> git blob hash.
 *
 * Uses gitBlobHash (Web Crypto SHA-1) to compute hashes identical to
 * `git hash-object`, eliminating the git CLI dependency.
 *
 * Caller is responsible for pre-filtering excluded paths
 * (build artifacts, .git, node_modules, .DS_Store).
 *
 * @param sourceFiles - List of relative file paths (pre-filtered by caller)
 * @param readFn - Function to read a file's content as base64 (readProjectFileBase64)
 * @returns Fingerprint map, or null on error
 */
export async function getLocalSourceFingerprint(
  sourceFiles: string[],
  readFn: (path: string) => Promise<string>
): Promise<Fingerprint | null> {
  try {
    if (sourceFiles.length === 0) {
      return new Map();
    }

    const fingerprint: Fingerprint = new Map();

    for (const file of sourceFiles) {
      const base64Content = await readFn(file);
      const hash = await gitBlobHash(base64Content);
      fingerprint.set(file, hash);
    }

    return fingerprint;
  } catch {
    return null; // Return null on error
  }
}
