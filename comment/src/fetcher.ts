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

    const text = response.text();
    if (!text) return [];

    const body = JSON.parse(text);
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
  page_key?: string;
  is_collapsed?: boolean;
  is_pending?: boolean;
}

/**
 * Normalize a single Artalk comment to GenericSocialComment format.
 */
function normalizeArtalkComment(c: ArtalkComment): GenericSocialComment {
  return {
    id: String(c.id),
    content: c.content,
    createdAt: c.date,
    author: {
      displayName: c.nick,
      name: c.nick,
    },
    // Artalk uses rid=0 for top-level comments
    replyToId: c.rid > 0 ? String(c.rid) : undefined,
  };
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

    const text = response.text();
    if (!text) return [];

    const body = JSON.parse(text);
    const comments: ArtalkComment[] = body.comments ?? body.data?.comments;

    if (!comments || !Array.isArray(comments)) {
      return [];
    }

    return comments.map(normalizeArtalkComment);
  } catch (error) {
    console.log(
      `[warn] Comment: Failed to fetch Artalk comments for ${uid}: ${error}`
    );
    return [];
  }
}

/**
 * Fetch ALL comments for a site from Artalk in paginated batches.
 *
 * Uses flat_mode=true to get all comments (including replies) in a flat list.
 * Groups results by page_key so callers can look up comments per page.
 *
 * @param serverUrl - Base URL of the Artalk server
 * @param siteName - The Artalk site name
 * @returns Map of page_key → normalized comments
 */
export async function fetchAllArtalkComments(
  serverUrl: string,
  siteName: string
): Promise<Map<string, GenericSocialComment[]>> {
  const LIMIT = 100;
  const result = new Map<string, GenericSocialComment[]>();

  try {
    const encodedSiteName = encodeURIComponent(siteName);
    let offset = 0;

    while (true) {
      const url = `${serverUrl}/api/v2/comments?site_name=${encodedSiteName}&limit=${LIMIT}&offset=${offset}&flat_mode=true`;
      const response = await httpGet(url);

      if (!response.ok) {
        console.log(
          `[warn] Comment: Artalk batch fetch failed: HTTP ${response.status}`
        );
        break;
      }

      const text = response.text();
      if (!text) break;

      const body = JSON.parse(text);
      const comments: ArtalkComment[] = body.comments ?? body.data?.comments;

      if (!comments || !Array.isArray(comments)) break;

      for (const c of comments) {
        const pageKey = c.page_key ?? "";
        const existing = result.get(pageKey) ?? [];
        existing.push(normalizeArtalkComment(c));
        result.set(pageKey, existing);
      }

      // If we got fewer than LIMIT, we've fetched everything
      const count = body.count ?? body.data?.count ?? comments.length;
      if (count < LIMIT) break;

      offset += LIMIT;
    }
  } catch (error) {
    console.log(
      `[warn] Comment: Failed to fetch all Artalk comments: ${error}`
    );
  }

  return result;
}
