/**
 * Social data reader
 *
 * Reads .moss/social/matters.json and converts comments
 * to NormalizedComment[] grouped by article shortHash.
 */

import { readFile } from "@symbiosis-lab/moss-api";
import type {
  MattersSocialData,
  MattersComment,
  NormalizedComment,
} from "./types";

/**
 * Read Matters social data and return normalized comments grouped by shortHash.
 *
 * Only includes comments with state "active".
 */
export async function loadComments(
  _projectPath: string
): Promise<Map<string, NormalizedComment[]>> {
  const result = new Map<string, NormalizedComment[]>();

  let data: MattersSocialData;
  try {
    // readFile() reads relative to the project root
    const content = await readFile(".moss/social/matters.json");
    data = JSON.parse(content) as MattersSocialData;
  } catch {
    // File doesn't exist or is invalid — return empty map
    return result;
  }

  if (!data.articles) {
    return result;
  }

  for (const [shortHash, articleData] of Object.entries(data.articles)) {
    if (!articleData.comments || articleData.comments.length === 0) {
      continue;
    }

    const normalized = articleData.comments
      .filter((c: MattersComment) => c.state === "active")
      .map((c: MattersComment): NormalizedComment => ({
        id: c.id,
        source: "matters",
        author: {
          name: c.author.displayName || c.author.userName,
          avatar: c.author.avatar || undefined,
          url: `https://matters.town/@${c.author.userName}`,
        },
        content_html: c.content,
        date: c.createdAt,
        replyToId: c.replyToId,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (normalized.length > 0) {
      result.set(shortHash, normalized);
    }
  }

  return result;
}
