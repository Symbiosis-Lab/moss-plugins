/**
 * Plugin configuration management.
 */

import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";
import type { LinkedInPluginConfig } from "./types";

const CONFIG_FILE = "config.json";

const DEFAULTS: LinkedInPluginConfig = {
  profile_url: "",
  auto_publish: false,
  sync_on_build: true,
};

export async function getConfig(): Promise<LinkedInPluginConfig> {
  if (await pluginFileExists(CONFIG_FILE)) {
    const raw = await readPluginFile(CONFIG_FILE);
    return { ...DEFAULTS, ...JSON.parse(raw) };
  }
  return { ...DEFAULTS };
}

export async function saveConfig(config: LinkedInPluginConfig): Promise<void> {
  await writePluginFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}
