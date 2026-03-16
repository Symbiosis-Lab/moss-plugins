/**
 * TMDB source fetcher
 *
 * Uses TMDB API v3 (https://developer.themoviedb.org/docs).
 * Requires a free API key — configured via plugin config `tmdb_api_key`.
 * If no key is provided, logs a warning and returns null.
 *
 * Supported URL patterns:
 * - https://www.themoviedb.org/movie/{id}
 * - https://www.themoviedb.org/tv/{id}
 */

import { fetchUrl } from "@symbiosis-lab/moss-api";
import type { ReviewItem } from "../types";

const TMDB_API_BASE = "https://api.themoviedb.org/3";

/** Parse a TMDB URL into media type and ID. */
function parseTMDBUrl(url: string): { type: 'movie' | 'tv'; id: string } | null {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/^\/(movie|tv)\/(\d+)/);
    if (!match) return null;
    return { type: match[1] as 'movie' | 'tv', id: match[2] };
  } catch {
    return null;
  }
}

/**
 * Fetch item metadata from TMDB.
 * Returns null if no API key is provided or the item is not found.
 */
export async function fetchFromTMDB(url: string, apiKey?: string): Promise<ReviewItem | null> {
  if (!apiKey) {
    console.log("[warn] Review: TMDB URL detected but no tmdb_api_key configured, skipping");
    return null;
  }

  const parsed = parseTMDBUrl(url);
  if (!parsed) return null;

  try {
    const apiUrl = `${TMDB_API_BASE}/${parsed.type}/${parsed.id}?api_key=${apiKey}`;
    const response = await fetchUrl(apiUrl);
    if (!response.ok) return null;

    const raw = JSON.parse(await response.text());
    return normalize(raw, parsed.type, url);
  } catch {
    return null;
  }
}

function normalize(raw: any, mediaType: 'movie' | 'tv', originalUrl: string): ReviewItem {
  const title = raw.title || raw.name || "";
  const year = (raw.release_date || raw.first_air_date || "").slice(0, 4);
  const creator: string[] = [];
  // TMDB doesn't include director in the main response — would need /credits call
  // For v1, leave creator empty; users see it in the colophon links

  const coverUrl = raw.poster_path
    ? `https://image.tmdb.org/t/p/w300${raw.poster_path}`
    : null;

  return {
    id: String(raw.id || ""),
    uuid: "",
    category: mediaType,
    title,
    cover_image_url: coverUrl,
    creator,
    year: year ? parseInt(year) : null,
    publisher: null,
    pages: null,
    isbn: null,
    rating: raw.vote_average ?? null,
    rating_count: raw.vote_count ?? 0,
    source: 'tmdb',
    external_urls: {
      tmdb: originalUrl,
      imdb: raw.imdb_id ? `https://www.imdb.com/title/${raw.imdb_id}` : undefined,
    },
  };
}
