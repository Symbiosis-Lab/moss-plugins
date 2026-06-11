import { readPluginFile, writePluginFile, pluginFileExists } from "@symbiosis-lab/moss-api";
import type { SyncMap } from "./types";

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

export function needsSync(syncMap: SyncMap, subjectId: string, date: string): boolean {
  const entry = syncMap[subjectId];
  if (!entry) return true;
  return new Date(date) > new Date(entry.lastSynced);
}

export function markSynced(
  syncMap: SyncMap,
  subjectId: string,
  localPath: string,
  doubanUrl: string
): void {
  syncMap[subjectId] = {
    subjectId,
    localPath,
    lastSynced: new Date().toISOString(),
    doubanUrl,
  };
}
