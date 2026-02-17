/**
 * Plugin Config Module
 *
 * Stores and retrieves the GitHub repository binding for this project.
 * Uses the plugin storage API (.moss/plugins/github/config.json).
 *
 * On first deploy, the repo info is saved here. On subsequent deploys,
 * it's read back — no git CLI or .git directory needed.
 *
 * For existing users who deployed before this change, a one-time migration
 * reads .git/config to extract the remote URL and saves it to config.json.
 */

import {
  readPluginFile,
  writePluginFile,
  pluginFileExists,
  readFile,
} from "@symbiosis-lab/moss-api";
import { parseGitHubUrl } from "./git";
import { log } from "./utils";

const CONFIG_FILE = "config.json";

/**
 * GitHub repository binding for this project
 */
export interface GitHubRepoConfig {
  owner: string;
  repo: string;
}

/**
 * Get the stored GitHub repository config.
 *
 * Checks plugin config first, then attempts one-time migration
 * from .git/config for existing users.
 *
 * @returns Repository config, or null if not configured
 */
export async function getRepoConfig(): Promise<GitHubRepoConfig | null> {
  // Try plugin config first
  try {
    if (await pluginFileExists(CONFIG_FILE)) {
      const json = await readPluginFile(CONFIG_FILE);
      const config = JSON.parse(json) as GitHubRepoConfig;
      if (config.owner && config.repo) {
        return config;
      }
    }
  } catch {
    // Config read failed, try migration
  }

  // One-time migration: read .git/config if it exists
  const migrated = await migrateFromGitConfig();
  if (migrated) {
    await saveRepoConfig(migrated);
    return migrated;
  }

  return null;
}

/**
 * Save the GitHub repository config.
 *
 * @param config - Repository owner and name to store
 */
export async function saveRepoConfig(
  config: GitHubRepoConfig
): Promise<void> {
  await writePluginFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Migrate from .git/config for existing users.
 *
 * Reads the .git/config file as text and extracts the remote origin URL.
 * This is a one-time migration — after saving to plugin config, .git is
 * no longer needed for deploy.
 *
 * @returns Migrated config, or null if .git/config doesn't exist or has no remote
 */
async function migrateFromGitConfig(): Promise<GitHubRepoConfig | null> {
  try {
    const gitConfig = await readFile(".git/config");

    // Parse [remote "origin"] url = ... from git config
    const remoteMatch = gitConfig.match(
      /\[remote\s+"origin"\][^[]*?url\s*=\s*(.+)/
    );
    if (!remoteMatch) {
      return null;
    }

    const remoteUrl = remoteMatch[1].trim();
    const parsed = parseGitHubUrl(remoteUrl);
    if (!parsed) {
      return null;
    }

    await log(
      "log",
      `   Migrated repo config from .git/config: ${parsed.owner}/${parsed.repo}`
    );
    return { owner: parsed.owner, repo: parsed.repo };
  } catch {
    // .git/config doesn't exist or can't be read — not an error
    return null;
  }
}
