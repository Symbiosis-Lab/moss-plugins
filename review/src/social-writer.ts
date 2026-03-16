/**
 * Social data writer for the Review plugin
 *
 * Manages .moss/social/review.json — keyed by content uid.
 * Follows the same pattern as the comment plugin's social-writer.
 */

import { readFile, writeFile } from "@symbiosis-lab/moss-api";
import type { ReviewSocialFile, ReviewSocialEntry } from "./types";

const SOCIAL_FILE_PATH = ".moss/social/review.json";
const SCHEMA_VERSION = "2.0.0";

function createEmpty(): ReviewSocialFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    articles: {},
  };
}

export async function loadReviewSocialData(): Promise<ReviewSocialFile> {
  try {
    const content = await readFile(SOCIAL_FILE_PATH);
    const data = JSON.parse(content) as ReviewSocialFile;
    if (!data.articles) return createEmpty();

    // Migrate v1 → v2: rename neodb_url → source_url, add source field
    if (data.schemaVersion === "1.0.0") {
      for (const entry of Object.values(data.articles)) {
        const legacy = entry as any;
        if (legacy.neodb_url && !entry.source_url) {
          entry.source_url = legacy.neodb_url;
          delete legacy.neodb_url;
        }
        if (!entry.source) {
          entry.source = 'neodb';
        }
      }
      data.schemaVersion = SCHEMA_VERSION;
    }

    return data;
  } catch {
    return createEmpty();
  }
}

export async function saveReviewSocialData(data: ReviewSocialFile): Promise<void> {
  data.updatedAt = new Date().toISOString();
  await writeFile(SOCIAL_FILE_PATH, JSON.stringify(data, null, 2));
}

export function upsertReviewEntry(
  data: ReviewSocialFile,
  uid: string,
  entry: ReviewSocialEntry
): void {
  data.articles[uid] = entry;
}
