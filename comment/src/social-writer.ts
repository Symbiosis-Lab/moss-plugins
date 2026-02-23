/**
 * Social data writer for the Comment plugin
 *
 * Manages .moss/social/comment.json — the comment plugin's social data file.
 * Follows the same pattern as the Matters plugin's social.ts:
 * - Load existing data (or create empty structure)
 * - Merge with upsert semantics (by comment ID)
 * - Save back to disk
 *
 * Data is keyed by content uid (from frontmatter), not by file path.
 */

import { readFile, writeFile } from "@symbiosis-lab/moss-api";
import type { GenericSocialComment, GenericSocialFile } from "./types";

// ============================================================================
// Constants
// ============================================================================

const SOCIAL_FILE_PATH = ".moss/social/comment.json";
const SCHEMA_VERSION = "1.0.0";

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create an empty social data structure
 */
function createEmptySocialData(): GenericSocialFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    articles: {},
  };
}

/**
 * Load comment social data from .moss/social/comment.json
 *
 * Returns empty data structure if file doesn't exist or is invalid.
 */
export async function loadCommentSocialData(): Promise<GenericSocialFile> {
  try {
    const content = await readFile(SOCIAL_FILE_PATH);
    const data = JSON.parse(content) as GenericSocialFile;

    // Validate basic structure
    if (!data.articles) {
      console.log(
        "[warn] Comment: Invalid social data file, creating new one"
      );
      return createEmptySocialData();
    }

    return data;
  } catch {
    // File doesn't exist or is invalid JSON
    return createEmptySocialData();
  }
}

/**
 * Save comment social data to .moss/social/comment.json
 *
 * Updates the timestamp before writing.
 *
 * @throws Error if the file cannot be written
 */
export async function saveCommentSocialData(
  data: GenericSocialFile
): Promise<void> {
  data.updatedAt = new Date().toISOString();
  const content = JSON.stringify(data, null, 2);
  await writeFile(SOCIAL_FILE_PATH, content);
}

// ============================================================================
// Merge Functions
// ============================================================================

/**
 * Merge incoming comments into existing social data for a specific uid.
 *
 * Uses upsert semantics: adds new comments, updates existing (by ID),
 * never removes. Preserves any non-comment fields on the article entry.
 *
 * @param data - Existing social data structure (mutated in place)
 * @param uid - Content identifier to key comments by
 * @param incoming - New comments to merge
 * @returns The mutated data object
 */
export function mergeCommentSocialData(
  data: GenericSocialFile,
  uid: string,
  incoming: GenericSocialComment[]
): GenericSocialFile {
  // Get or create article entry
  const existing = data.articles[uid] || { comments: [] };
  const existingComments = existing.comments || [];

  // Build map for upsert
  const commentMap = new Map<string, GenericSocialComment>();

  for (const comment of existingComments) {
    commentMap.set(comment.id, comment);
  }

  for (const comment of incoming) {
    commentMap.set(comment.id, comment);
  }

  // Update the entry, preserving non-comment fields
  data.articles[uid] = {
    ...existing,
    comments: Array.from(commentMap.values()),
  };

  return data;
}
