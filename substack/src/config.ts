/**
 * Plugin configuration management.
 */

import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";
import type { SubstackPluginConfig } from "./types";

const CONFIG_FILE = "config.json";

const DEFAULTS: SubstackPluginConfig = {
  publication_url: "",
  auto_publish: false,
  sync_on_build: true,
};

export async function getConfig(): Promise<SubstackPluginConfig> {
  if (await pluginFileExists(CONFIG_FILE)) {
    const raw = await readPluginFile(CONFIG_FILE);
    return { ...DEFAULTS, ...JSON.parse(raw) };
  }
  return { ...DEFAULTS };
}

export async function saveConfig(config: SubstackPluginConfig): Promise<void> {
  await writePluginFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}
