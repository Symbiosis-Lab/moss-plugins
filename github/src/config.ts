/**
 * Plugin Config Module
 *
 * Stores and retrieves the GitHub repository binding for this project.
 * Uses the plugin storage API (.moss/plugins/github/config.json).
 *
 * On first deploy, the repo info is saved here. On subsequent deploys,
 * it's read back — no git CLI or .git directory needed.
 */

import {
  readPluginFile,
  writePluginFile,
  pluginFileExists,
} from "@symbiosis-lab/moss-api";

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
 * @returns Repository config, or null if not configured
 */
export async function getRepoConfig(): Promise<GitHubRepoConfig | null> {
  try {
    if (await pluginFileExists(CONFIG_FILE)) {
      const json = await readPluginFile(CONFIG_FILE);
      const config = JSON.parse(json) as GitHubRepoConfig;
      if (config.owner && config.repo) {
        return config;
      }
    }
  } catch {
    // Config read failed or invalid JSON
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
 * Clear the stored repository config.
 *
 * Used when preflight validation detects stale config
 * (e.g., repo no longer exists or token lacks access).
 * After clearing, the next deploy will re-run the setup flow.
 */
export async function clearRepoConfig(): Promise<void> {
  try {
    await writePluginFile(CONFIG_FILE, "");
  } catch {
    // Best-effort clear
  }
}
