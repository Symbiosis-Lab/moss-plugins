/**
 * Comment Fetcher
 *
 * Fetches comments from external comment servers (Waline or Artalk)
 * and normalizes them to GenericSocialComment format.
 *
 * Uses httpGet from moss-api for CORS-free HTTP requests.
 */

import { httpGet } from "@symbiosis-lab/moss-api";
import type { GenericSocialComment } from "./types";

// ============================================================================
// Provider Detection
// ============================================================================

/**
 * Cache of detected providers per server URL.
 * Avoids repeated probes during the same build.
 */
const detectionCache = new Map<string, "artalk" | "waline">();

/**
 * Auto-detect whether a comment server is Artalk or Waline by probing
 * Artalk's config endpoint.
 *
 * - Probes GET {serverUrl}/api/v2/conf (Artalk's config endpoint)
 * - If 200 response → "artalk"
 * - Otherwise (non-200 or network error) → "waline" (default fallback)
 *
 * Results are cached per serverUrl to avoid repeated probes.
 */
export async function detectProvider(
  serverUrl: string
): Promise<"artalk" | "waline"> {
  const cached = detectionCache.get(serverUrl);
  if (cached !== undefined) {
    return cached;
  }

  let result: "artalk" | "waline" = "waline";
  try {
    const response = await httpGet(`${serverUrl}/api/v2/conf`);
    if (response.ok) {
      result = "artalk";
    }
  } catch {
    // Network error — fall back to waline
  }

  detectionCache.set(serverUrl, result);
  return result;
}

/**
 * Clear the detection cache. Exposed for testing.
 */
export function clearDetectionCache(): void {
  detectionCache.clear();
}

// ============================================================================
// Waline
// ============================================================================

/**
 * Waline API comment shape (subset of fields we care about)
 */
interface WalineComment {
  objectId: string;
  comment: string;
  insertedAt: string;
  nick: string;
  link?: string;
  mail?: string;
  pid?: string | null;
  rid?: string | null;
  status?: string;
}

/**
 * Fetch comments from a Waline server for a given page uid.
 *
 * Waline API: GET {serverUrl}/api/comment?path={uid}&pageSize=100
 *
 * @param serverUrl - Base URL of the Waline server
 * @param uid - The content identifier (used as the page path in Waline)
 * @returns Normalized comments, or empty array on error
 */
export async function fetchWalineComments(
  serverUrl: string,
  uid: string
): Promise<GenericSocialComment[]> {
  try {
    const url = `${serverUrl}/api/comment?path=${uid}&pageSize=100`;
    const response = await httpGet(url);

    if (!response.ok) {
      console.log(
        `[warn] Comment: Waline fetch failed for ${uid}: HTTP ${response.status}`
      );
      return [];
    }

    const body = JSON.parse(response.text());
    const data: WalineComment[] = body.data;

    if (!data || !Array.isArray(data)) {
      return [];
    }

    return data.map(
      (c): GenericSocialComment => ({
        id: c.objectId,
        content: c.comment,
        createdAt: c.insertedAt,
        author: {
          displayName: c.nick,
          name: c.nick,
        },
        replyToId: c.pid || undefined,
      })
    );
  } catch (error) {
    console.log(
      `[warn] Comment: Failed to fetch Waline comments for ${uid}: ${error}`
    );
    return [];
  }
}

// ============================================================================
// Artalk
// ============================================================================

/**
 * Artalk API comment shape (subset of fields we care about)
 */
interface ArtalkComment {
  id: number;
  content: string;
  date: string;
  nick: string;
  email?: string;
  link?: string;
  rid: number;
  is_collapsed?: boolean;
  is_pending?: boolean;
}

/**
 * Fetch comments from an Artalk server for a given page uid.
 *
 * Artalk API: GET {serverUrl}/api/v2/comments?page_key={uid}&site_name={siteName}&limit=100
 *
 * @param serverUrl - Base URL of the Artalk server
 * @param uid - The content identifier (used as page_key in Artalk)
 * @param siteName - The Artalk site name
 * @returns Normalized comments, or empty array on error
 */
export async function fetchArtalkComments(
  serverUrl: string,
  uid: string,
  siteName: string
): Promise<GenericSocialComment[]> {
  try {
    const encodedSiteName = encodeURIComponent(siteName);
    const url = `${serverUrl}/api/v2/comments?page_key=${uid}&site_name=${encodedSiteName}&limit=100`;
    const response = await httpGet(url);

    if (!response.ok) {
      console.log(
        `[warn] Comment: Artalk fetch failed for ${uid}: HTTP ${response.status}`
      );
      return [];
    }

    const body = JSON.parse(response.text());
    const comments: ArtalkComment[] = body.data?.comments;

    if (!comments || !Array.isArray(comments)) {
      return [];
    }

    return comments.map(
      (c): GenericSocialComment => ({
        id: String(c.id),
        content: c.content,
        createdAt: c.date,
        author: {
          displayName: c.nick,
          name: c.nick,
        },
        // Artalk uses rid=0 for top-level comments
        replyToId: c.rid > 0 ? String(c.rid) : undefined,
      })
    );
  } catch (error) {
    console.log(
      `[warn] Comment: Failed to fetch Artalk comments for ${uid}: ${error}`
    );
    return [];
  }
}
