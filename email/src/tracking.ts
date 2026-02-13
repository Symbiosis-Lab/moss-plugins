/**
 * Syndication tracking module
 *
 * Tracks which articles have been syndicated to avoid duplicate emails.
 * Data is stored in .moss/plugins/email/syndicated.json
 */

import {
  readPluginFile,
  writePluginFile,
  pluginFileExists,
} from "@symbiosis-lab/moss-api";
import type { SyndicationData, SyndicatedEntry } from "./types";

const TRACKING_FILE = "syndicated.json";

/**
 * Load syndication tracking data
 */
export async function loadSyndicationData(): Promise<SyndicationData> {
  try {
    if (await pluginFileExists(TRACKING_FILE)) {
      const content = await readPluginFile(TRACKING_FILE);
      return JSON.parse(content) as SyndicationData;
    }
  } catch (error) {
    console.warn(`Failed to load syndication data: ${error}`);
  }

  return { articles: {} };
}

/**
 * Save syndication tracking data
 */
export async function saveSyndicationData(data: SyndicationData): Promise<void> {
  await writePluginFile(TRACKING_FILE, JSON.stringify(data, null, 2));
}

/**
 * Check if an article has already been syndicated
 */
export function isAlreadySyndicated(
  data: SyndicationData,
  urlPath: string
): boolean {
  return urlPath in data.articles;
}

/**
 * Record a successful syndication
 */
export function recordSyndication(
  data: SyndicationData,
  entry: SyndicatedEntry
): void {
  data.articles[entry.url_path] = entry;
}
