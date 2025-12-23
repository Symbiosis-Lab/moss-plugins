/**
 * Plugin configuration management
 *
 * Handles reading and writing plugin-specific configuration stored in:
 * {projectPath}/.moss/plugins/matters-syndicator/config.json
 */

import { readFile, writeFile, fileExists } from "@symbiosis-lab/moss-api";

// ============================================================================
// Types
// ============================================================================

/**
 * Plugin configuration stored in config.json
 */
export interface MattersPluginConfig {
  /** Matters.town username (allows unauthenticated mode when cookie unavailable) */
  userName?: string;
  /** User's language preference (e.g., "zh_hans", "zh_hant", "en") */
  language?: string;
}

// ============================================================================
// Constants
// ============================================================================

const CONFIG_PATH = ".moss/plugins/matters-syndicator/config.json";

// ============================================================================
// Functions
// ============================================================================

/**
 * Get the config file path (relative to project root)
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Read plugin configuration from disk
 *
 * @param projectPath - Absolute path to the project directory
 * @returns Plugin configuration object (empty object if not found or invalid)
 */
export async function getConfig(projectPath: string): Promise<MattersPluginConfig> {
  try {
    const exists = await fileExists(projectPath, CONFIG_PATH);
    if (!exists) {
      return {};
    }

    const content = await readFile(projectPath, CONFIG_PATH);
    return JSON.parse(content) as MattersPluginConfig;
  } catch {
    // Return empty config on any error (file not found, parse error, etc.)
    return {};
  }
}

/**
 * Save plugin configuration to disk
 *
 * @param projectPath - Absolute path to the project directory
 * @param config - Configuration object to save
 * @throws Error if write fails
 */
export async function saveConfig(
  projectPath: string,
  config: MattersPluginConfig
): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  await writeFile(projectPath, CONFIG_PATH, content);
}
