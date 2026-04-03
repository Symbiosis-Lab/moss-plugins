/**
 * Sync state tracking.
 *
 * Tracks which Substack articles have been synced locally and their last sync time.
 * Stored in .moss/plugins/substack/sync.json
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
 * Check if a post needs syncing (new or updated since last sync).
 */
export function needsSync(
  syncMap: SyncMap,
  substackId: number,
  postDate: string
): boolean {
  const key = String(substackId);
  const entry = syncMap[key];
  if (!entry) return true;
  return new Date(postDate) > new Date(entry.lastSynced);
}

/**
 * Mark a post as synced.
 */
export function markSynced(
  syncMap: SyncMap,
  substackId: number,
  slug: string,
  localPath: string,
  substackUrl: string
): void {
  syncMap[String(substackId)] = {
    substackId,
    slug,
    localPath,
    lastSynced: new Date().toISOString(),
    substackUrl,
  };
}
