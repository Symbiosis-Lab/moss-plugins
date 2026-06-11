/**
 * Sync state tracking.
 *
 * Tracks which Xiaohongshu notes have been synced locally and their last sync time.
 * Stored in .moss/plugins/xiaohongshu/sync.json
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
 * Check if a note needs syncing (new or updated since last sync).
 */
export function needsSync(
  syncMap: SyncMap,
  noteId: string,
  publishDate: string
): boolean {
  const entry = syncMap[noteId];
  if (!entry) return true;
  if (!publishDate) return true;
  return new Date(publishDate) > new Date(entry.lastSynced);
}

/**
 * Mark a note as synced.
 */
export function markSynced(
  syncMap: SyncMap,
  noteId: string,
  localPath: string,
  xiaohongshuUrl: string
): void {
  syncMap[noteId] = {
    noteId,
    localPath,
    lastSynced: new Date().toISOString(),
    xiaohongshuUrl,
  };
}
