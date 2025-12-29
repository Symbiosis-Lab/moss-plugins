/**
 * GitHub API Module
 *
 * Provides functions for interacting with GitHub's REST API.
 * Used for repository creation and availability checking.
 */
import { log } from "./utils";
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
export async function getAuthenticatedUser(token) {
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
export async function checkRepoNameAvailable(name, token) {
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
    }
    catch (error) {
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
export async function createRepository(name, token, description) {
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
 * Add a remote to the local git repository
 *
 * @param remoteName - Name for the remote (usually "origin")
 * @param url - Remote URL (SSH or HTTPS)
 */
export async function addGitRemote(remoteName, url) {
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
export function isValidRepoName(name) {
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
