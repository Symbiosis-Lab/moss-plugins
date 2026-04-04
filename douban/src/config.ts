import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";
import type { DoubanPluginConfig } from "./types";

const CONFIG_FILE = "config.json";

const DEFAULTS: DoubanPluginConfig = {
  user_id: "",
  sync_books: true,
  sync_movies: true,
  sync_on_build: true,
};

export async function getConfig(): Promise<DoubanPluginConfig> {
  if (await pluginFileExists(CONFIG_FILE)) {
    const raw = await readPluginFile(CONFIG_FILE);
    return { ...DEFAULTS, ...JSON.parse(raw) };
  }
  return { ...DEFAULTS };
}

export async function saveConfig(config: DoubanPluginConfig): Promise<void> {
  await writePluginFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}
