/**
 * Requirement validation for GitHub Pages deployment
 */

import { listFiles } from "@symbiosis-lab/moss-api";
import { isGitRepository, hasGitRemote, getRemoteUrl } from "./git";
import { log } from "./utils";

// Re-export git utilities for convenience
export {
  isGitRepository,
  hasGitRemote as hasRemote,
  isGitAvailable,
  initGitRepository,
  addRemote,
  ensureRemote,
  hasUpstream,
  hasLocalCommits,
  remoteHasCommits,
  pushWithUpstream,
  pushWithRetry,
} from "./git";

/**
 * Check if a remote URL is using SSH protocol
 * SSH URLs look like: git@github.com:user/repo.git
 * HTTPS URLs look like: https://github.com/user/repo.git
 */
export function isSSHRemote(remoteUrl: string): boolean {
  return remoteUrl.startsWith("git@") || remoteUrl.startsWith("ssh://");
}

/**
 * Validate that the project is a git repository
 */
export async function validateGitRepository(): Promise<void> {
  const isRepo = await isGitRepository();

  if (!isRepo) {
    throw new Error(
      "This folder is not a git repository.\n\n" +
        "To publish to GitHub Pages, you need to:\n" +
        "1. Run: git init\n" +
        "2. Create a GitHub repository\n" +
        "3. Add it as remote: git remote add origin <url>"
    );
  }
}

/**
 * Validate that the site has been compiled
 * @param outputDir - Relative path to the output directory (e.g., ".moss/site")
 */
export async function validateSiteCompiled(outputDir: string): Promise<void> {
  try {
    // Check if the output directory exists and has files
    // listFiles returns all project files, filter to those in outputDir
    const allFiles = await listFiles();
    const siteFiles = allFiles.filter((f) => f.startsWith(outputDir));

    if (siteFiles.length === 0) {
      throw new Error("Site directory is empty. Please compile your site first.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("empty")) {
      throw error;
    }
    throw new Error("Site not found at .moss/site\n\nPlease compile your site first.");
  }
}

/**
 * Validate that a GitHub remote is configured
 * @param existingUrl - Optional URL already retrieved to avoid duplicate git calls
 */
export async function validateGitHubRemote(existingUrl?: string): Promise<string> {
  // Bug 17 fix: Use existing URL if provided to avoid duplicate git calls
  let remoteUrl = existingUrl;

  if (!remoteUrl) {
    const hasRemote = await hasGitRemote();

    if (!hasRemote) {
      throw new Error(
        "No git remote configured.\n\n" +
          "To publish, you need to:\n" +
          "1. Create a GitHub repository\n" +
          "2. Add it as remote: git remote add origin <url>"
      );
    }

    remoteUrl = await getRemoteUrl();
  }

  if (!remoteUrl.includes("github.com")) {
    throw new Error(
      `Remote '${remoteUrl}' is not a GitHub URL.\n\n` +
        "GitHub Pages deployment only works with GitHub repositories.\n" +
        "Please add a GitHub remote or use a different deployment method."
    );
  }

  return remoteUrl;
}

/**
 * Run all validations and return the remote URL
 *
 * Note: Site validation is now done early in main.ts using context.site_files
 * (Bug 13 fix). The plugin trusts moss to provide site_files instead of
 * calling listFiles() which doesn't include .moss/ directories.
 *
 * @param existingRemoteUrl - Optional URL already retrieved to avoid duplicate git calls (Bug 17 fix)
 */
export async function validateAll(existingRemoteUrl?: string): Promise<string> {
  await log("log", "   Validating git repository...");
  await validateGitRepository();

  // Site validation is done early in main.ts using context.site_files (Bug 13 fix)
  // Removed: await validateSiteCompiled(outputDir);

  await log("log", "   Validating GitHub remote...");
  // Bug 17 fix: Pass existing URL to avoid duplicate git calls
  const remoteUrl = await validateGitHubRemote(existingRemoteUrl);

  await log("log", "   All validations passed");
  return remoteUrl;
}
