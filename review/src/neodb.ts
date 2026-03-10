/**
 * NeoDB API client
 *
 * Fetches item metadata from any NeoDB instance URL, normalizes across
 * categories (book, movie, tv, album, game, podcast) into a unified schema.
 */

import { fetchUrl } from "@symbiosis-lab/moss-api";
import type { NeoDBItem } from "./types";

/** Parsed NeoDB URL components */
interface ParsedNeoDBUrl {
  base: string;
  apiPath: string;
}

/**
 * Parse a NeoDB item URL into base URL and API path.
 * e.g. "https://neodb.social/book/abc" -> { base: "https://neodb.social", apiPath: "/api/book/abc" }
 */
export function parseNeoDBUrl(url: string): ParsedNeoDBUrl | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    // Must have at least /category/uuid
    if (!path || path === "/") return null;
    return {
      base: parsed.origin,
      apiPath: `/api${path}`,
    };
  } catch {
    return null;
  }
}

/**
 * Extract external URLs from NeoDB external_resources by domain matching.
 */
function extractExternalUrls(
  resources: Array<{ url: string }> | undefined,
  neodbUrl: string
): NeoDBItem["external_urls"] {
  const urls: NeoDBItem["external_urls"] = { neodb: neodbUrl };
  if (!resources) return urls;

  for (const r of resources) {
    try {
      const host = new URL(r.url).hostname;
      if (host.includes("douban.com")) urls.douban = r.url;
      else if (host.includes("goodreads.com")) urls.goodreads = r.url;
      else if (host.includes("openlibrary.org")) urls.openlibrary = r.url;
      else if (host.includes("imdb.com")) urls.imdb = r.url;
      else if (host.includes("themoviedb.org")) urls.tmdb = r.url;
    } catch {
      // skip invalid URLs
    }
  }
  return urls;
}

/**
 * Normalize a raw NeoDB API response into a unified NeoDBItem.
 */
function normalize(raw: any, base: string, originalUrl: string): NeoDBItem {
  // Resolve cover URL
  let coverUrl = raw.cover_image_url || null;
  if (coverUrl && !coverUrl.startsWith("http")) {
    coverUrl = coverUrl.startsWith("//") ? "https:" + coverUrl : base + coverUrl;
  }

  // Normalize creator: author (books), director (movies/tv), artist (music)
  const creator: string[] =
    raw.author || raw.director || raw.artist || [];

  // Normalize year: pub_year (books), year (movies/tv), release_year (games)
  const year: number | null =
    raw.pub_year ?? raw.year ?? raw.release_year ?? null;

  return {
    id: raw.id || "",
    uuid: raw.uuid || "",
    category: raw.category || "",
    title: raw.display_title || raw.title || "",
    cover_image_url: coverUrl,
    creator,
    year,
    publisher: raw.pub_house || raw.label || null,
    pages: raw.pages || null,
    isbn: raw.isbn || null,
    rating: raw.rating ?? null,
    rating_count: raw.rating_count ?? 0,
    external_urls: extractExternalUrls(raw.external_resources, originalUrl),
  };
}

/**
 * Fetch and normalize an item from NeoDB.
 * Returns null on any error (404, network, parse).
 */
export async function fetchNeoDBItem(url: string): Promise<NeoDBItem | null> {
  const parsed = parseNeoDBUrl(url);
  if (!parsed) return null;

  try {
    const response = await fetchUrl(parsed.base + parsed.apiPath);
    if (!response.ok) return null;

    const data = JSON.parse(await response.text());
    return normalize(data, parsed.base, url);
  } catch {
    return null;
  }
}
