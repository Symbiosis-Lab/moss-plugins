/**
 * Requirement validation for GitHub Pages deployment
 *
 * Validates deployment prerequisites without git CLI.
 * Repository identity comes from plugin config (config.ts), not .git directory.
 */

import { log } from "./utils";

/**
 * Check if a remote URL is using SSH protocol
 * SSH URLs look like: git@github.com:user/repo.git
 * HTTPS URLs look like: https://github.com/user/repo.git
 */
export function isSSHRemote(remoteUrl: string): boolean {
  return remoteUrl.startsWith("git@") || remoteUrl.startsWith("ssh://");
}

/**
 * Validate that a GitHub remote URL is a valid GitHub URL
 * @param existingUrl - URL already retrieved from plugin config
 */
export async function validateGitHubRemote(existingUrl?: string): Promise<string> {
  const remoteUrl = existingUrl;

  if (!remoteUrl) {
    throw new Error(
      "No GitHub repository configured.\n\n" +
        "To publish, you need to:\n" +
        "1. Create a GitHub repository\n" +
        "2. Configure it in the plugin settings"
    );
  }

  // Check if URL is a valid GitHub URL (must be github.com in the hostname)
  // Use URL parsing to ensure github.com is the actual host, not part of path/query
  try {
    const url = new URL(remoteUrl.replace(/^git@github\.com:/, 'https://github.com/'));
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
      throw new Error('Not a GitHub URL');
    }
  } catch {
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
 * @param existingRemoteUrl - URL already retrieved from plugin config
 */
export async function validateAll(existingRemoteUrl?: string): Promise<string> {
  // Site validation is done early in main.ts using context.site_files (Bug 13 fix)

  await log("log", "   Validating GitHub remote...");
  const remoteUrl = await validateGitHubRemote(existingRemoteUrl);

  await log("log", "   All validations passed");
  return remoteUrl;
}
