/**
 * Sync state tracking.
 *
 * Tracks which LinkedIn articles have been synced locally and their last sync time.
 * Stored in .moss/plugins/linkedin/sync.json
 */

import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";
import type { SyncMap, SyncEntry } from "./types";

const SYNC_FILE = "sync.json";

export async function loadSyncMap(): Promise<SyncMap> {
  if (await pluginFileExists(SYNC_FILE)) {
    const raw = await readPluginFile(SYNC_FILE);
    return JSON.parse(raw);
  }
  return {};
}

export async function saveSyncMap(map: SyncMap): Promise<void> {
  await writePluginFile(SYNC_FILE, JSON.stringify(map, null, 2));
}

/**
 * Check if an article needs syncing (new or updated since last sync).
 */
export function needsSync(
  syncMap: SyncMap,
  slug: string,
  articleDate: string
): boolean {
  const entry = syncMap[slug];
  if (!entry) return true;
  if (!articleDate) return true;
  return new Date(articleDate) > new Date(entry.lastSynced);
}

/**
 * Mark an article as synced.
 */
export function markSynced(
  syncMap: SyncMap,
  slug: string,
  localPath: string,
  linkedinUrl: string
): void {
  syncMap[slug] = {
    slug,
    localPath,
    lastSynced: new Date().toISOString(),
    linkedinUrl,
  };
}
