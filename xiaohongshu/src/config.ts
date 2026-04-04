/**
 * Plugin configuration management.
 */

import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";
import type { XhsPluginConfig } from "./types";

const CONFIG_FILE = "config.json";

const DEFAULTS: XhsPluginConfig = {
  profile_url: "",
  sync_on_build: true,
};

export async function getConfig(): Promise<XhsPluginConfig> {
  if (await pluginFileExists(CONFIG_FILE)) {
    const raw = await readPluginFile(CONFIG_FILE);
    return { ...DEFAULTS, ...JSON.parse(raw) };
  }
  return { ...DEFAULTS };
}

export async function saveConfig(config: XhsPluginConfig): Promise<void> {
  await writePluginFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}
