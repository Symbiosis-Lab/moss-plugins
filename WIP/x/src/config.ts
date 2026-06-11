/**
 * Plugin configuration management.
 */

import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";
import type { XPluginConfig } from "./types";

const CONFIG_FILE = "config.json";

const DEFAULTS: XPluginConfig = {
  profile_url: "",
  auto_publish: false,
  sync_on_build: true,
};

export async function getConfig(): Promise<XPluginConfig> {
  if (await pluginFileExists(CONFIG_FILE)) {
    const raw = await readPluginFile(CONFIG_FILE);
    return { ...DEFAULTS, ...JSON.parse(raw) };
  }
  return { ...DEFAULTS };
}

export async function saveConfig(config: XPluginConfig): Promise<void> {
  await writePluginFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}
