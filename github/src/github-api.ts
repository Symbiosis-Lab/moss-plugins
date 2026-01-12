/**
 * GitHub API Module
 *
 * Provides functions for interacting with GitHub's REST API.
 * Used for repository creation and availability checking.
 */

import { log } from "./utils";

// ============================================================================
// Types
// ============================================================================

/**
 * GitHub user information
 */
export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  name?: string;
}

/**
 * Repository information returned after creation
 */
export interface CreatedRepository {
  /** Repository name */
  name: string;
  /** Full name (owner/repo) */
  fullName: string;
  /** HTML URL (https://github.com/owner/repo) */
  htmlUrl: string;
  /** SSH URL (git@github.com:owner/repo.git) */
  sshUrl: string;
  /** HTTPS clone URL */
  cloneUrl: string;
}

/**
 * Result of repository availability check
 */
export interface RepoAvailabilityResult {
  /** Whether the name is available */
  available: boolean;
  /** If not available, why */
  reason?: "exists" | "invalid" | "error";
  /** Error message if any */
  message?: string;
}

/**
 * GitHub Pages deployment status
 * Feature 21: Used to check if a deployed site is live
 */
export interface PagesStatus {
  /** Deployment status: built, building, errored, or unknown */
  status: "built" | "building" | "errored" | "unknown";
  /** The GitHub Pages URL for this repository */
  url: string;
}

// ============================================================================
// API Constants
// ============================================================================

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "Moss-GitHub-Deployer",
};

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get the authenticated user's information
 *
 * @param token - GitHub OAuth access token
 * @returns User information
 * @throws Error if request fails or token is invalid
 */
export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      ...GITHUB_API_HEADERS,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Invalid or expired token");
    }
    throw new Error(`Failed to get user: ${response.status}`);
  }

  return response.json();
}

/**
 * Check if a repository name is available for the authenticated user
 *
 * @param name - Repository name to check
 * @param token - GitHub OAuth access token
 * @returns Availability result
 */
export async function checkRepoNameAvailable(
  name: string,
  token: string
): Promise<RepoAvailabilityResult> {
  // Validate name format first
  if (!isValidRepoName(name)) {
    return {
      available: false,
      reason: "invalid",
      message: "Repository name can only contain letters, numbers, hyphens, underscores, and periods",
    };
  }

  try {
    // Get the authenticated user to check their repos
    const user = await getAuthenticatedUser(token);

    // Check if repo exists
    const response = await fetch(`${GITHUB_API_BASE}/repos/${user.login}/${name}`, {
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 404) {
      // Repo doesn't exist - name is available
      return { available: true };
    }

    if (response.ok) {
      // Repo exists
      return {
        available: false,
        reason: "exists",
        message: `Repository '${name}' already exists`,
      };
    }

    // Other error
    return {
      available: false,
      reason: "error",
      message: `Failed to check availability: ${response.status}`,
    };
  } catch (error) {
    return {
      available: false,
      reason: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create a new public repository for the authenticated user
 *
 * @param name - Repository name
 * @param token - GitHub OAuth access token
 * @param description - Optional repository description
 * @returns Created repository information
 * @throws Error if creation fails
 */
export async function createRepository(
  name: string,
  token: string,
  description?: string
): Promise<CreatedRepository> {
  await log("log", `Creating repository: ${name}`);

  const response = await fetch(`${GITHUB_API_BASE}/user/repos`, {
    method: "POST",
    headers: {
      ...GITHUB_API_HEADERS,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      description: description ?? "Created with Moss",
      private: false, // Always public for GitHub Pages
      auto_init: false, // We'll push our own content
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.message || `Failed to create repository: ${response.status}`;
    throw new Error(message);
  }

  const repo = await response.json();

  await log("log", `Repository created: ${repo.html_url}`);

  return {
    name: repo.name,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    sshUrl: repo.ssh_url,
    cloneUrl: repo.clone_url,
  };
}

/**
 * Check if a repository exists for a given owner
 *
 * Feature 20: Used to check if {username}.github.io already exists
 * before auto-creating it.
 *
 * @param owner - Repository owner (username or org)
 * @param name - Repository name
 * @param token - GitHub OAuth access token
 * @returns true if repo exists, false otherwise (including errors)
 */
export async function checkRepoExists(
  owner: string,
  name: string,
  token: string
): Promise<boolean> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}`, {
      headers: {
        ...GITHUB_API_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    });

    return response.ok;
  } catch {
    // Network errors or other failures - treat as "doesn't exist"
    return false;
  }
}

/**
 * Check GitHub Pages deployment status
 *
 * Feature 21: Used to verify if a deployed site is live.
 * Uses GET /repos/{owner}/{repo}/pages/builds/latest
 *
 * @see https://docs.github.com/en/rest/pages/pages
 *
 * @param owner - Repository owner (username or org)
 * @param repo - Repository name
 * @param token - GitHub OAuth access token
 * @returns Pages status with deployment state and URL
 */
export async function checkPagesStatus(
  owner: string,
  repo: string,
  token: string
): Promise<PagesStatus> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pages/builds/latest`,
      {
        headers: {
          ...GITHUB_API_HEADERS,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      return { status: "unknown", url: "" };
    }

    const data = await response.json();

    // Generate the GitHub Pages URL
    // Root repo ({username}.github.io) → https://{username}.github.io/
    // Project repo → https://{username}.github.io/{repo}
    const isRootRepo = repo === `${owner}.github.io`;
    const url = isRootRepo
      ? `https://${owner}.github.io/`
      : `https://${owner}.github.io/${repo}`;

    // Map API status to our status type
    const status = data.status as "built" | "building" | "errored" | undefined;

    return {
      status: status || "unknown",
      url,
    };
  } catch {
    return { status: "unknown", url: "" };
  }
}

/**
 * Add a remote to the local git repository
 *
 * @param remoteName - Name for the remote (usually "origin")
 * @param url - Remote URL (SSH or HTTPS)
 */
export async function addGitRemote(remoteName: string, url: string): Promise<void> {
  // Import executeBinary dynamically to avoid circular dependencies
  const { executeBinary } = await import("@symbiosis-lab/moss-api");

  const result = await executeBinary({
    binaryPath: "git",
    args: ["remote", "add", remoteName, url],
  });

  if (!result.success) {
    throw new Error(`Failed to add remote: ${result.stderr}`);
  }
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if a repository name is valid
 *
 * GitHub repo names can contain:
 * - Letters (a-z, A-Z)
 * - Numbers (0-9)
 * - Hyphens (-)
 * - Underscores (_)
 * - Periods (.)
 *
 * Cannot start with a period or be empty.
 */
export function isValidRepoName(name: string): boolean {
  if (!name || name.length === 0) {
    return false;
  }

  if (name.startsWith(".")) {
    return false;
  }

  // GitHub has a max length of 100 characters
  if (name.length > 100) {
    return false;
  }

  // Only allowed characters
  return /^[a-zA-Z0-9._-]+$/.test(name);
}
