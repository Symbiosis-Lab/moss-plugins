/**
 * Goodreads source fetcher
 *
 * Goodreads shut down its API in 2020. Strategy: search NeoDB's catalog
 * for items indexed from Goodreads, similar to the Douban approach.
 * NeoDB indexes items with Goodreads URLs in external_resources.
 *
 * Lookup flow:
 * 1. Call NeoDB catalog search with the Goodreads URL
 * 2. If found, use NeoDB's structured data
 * 3. If not found, return null
 */

import { fetchUrl } from "@symbiosis-lab/moss-api";
import type { ReviewItem } from "../types";

const NEODB_SEARCH_BASE = "https://neodb.social";

/**
 * Fetch item metadata by looking up a Goodreads URL through NeoDB's catalog.
 * Returns null if the item is not indexed by NeoDB.
 */
export async function fetchFromGoodreads(url: string): Promise<ReviewItem | null> {
  try {
    const searchUrl = `${NEODB_SEARCH_BASE}/api/catalog/search?query=${encodeURIComponent(url)}`;
    const response = await fetchUrl(searchUrl);
    if (!response.ok) return null;

    const data = JSON.parse(await response.text());
    const items = data?.data || data?.results || [];
    if (items.length === 0) return null;

    const raw = items[0];
    return normalizeNeoDBResult(raw, url);
  } catch {
    return null;
  }
}

function normalizeNeoDBResult(raw: any, originalGoodreadsUrl: string): ReviewItem {
  const creator: string[] = raw.author || raw.director || raw.artist || [];
  const year: number | null = raw.pub_year ?? raw.year ?? raw.release_year ?? null;

  let coverUrl = raw.cover_image_url || null;
  if (coverUrl && !coverUrl.startsWith("http")) {
    coverUrl = coverUrl.startsWith("//") ? "https:" + coverUrl : NEODB_SEARCH_BASE + coverUrl;
  }

  const externalUrls: ReviewItem["external_urls"] = { goodreads: originalGoodreadsUrl };
  if (raw.id) externalUrls.neodb = `${NEODB_SEARCH_BASE}${raw.url || ''}`;
  for (const r of raw.external_resources || []) {
    try {
      const host = new URL(r.url).hostname;
      if (host.includes("douban.com")) externalUrls.douban = r.url;
      else if (host.includes("openlibrary.org")) externalUrls.openlibrary = r.url;
      else if (host.includes("imdb.com")) externalUrls.imdb = r.url;
      else if (host.includes("themoviedb.org")) externalUrls.tmdb = r.url;
    } catch { /* skip invalid URLs */ }
  }

  return {
    id: raw.id || "",
    uuid: raw.uuid || "",
    category: raw.category || "",
    title: raw.display_title || raw.title || "",
    cover_image_url: coverUrl,
    creator,
    year,
    publisher: raw.pub_house || raw.label || null,
    pages: raw.pages ?? null,
    isbn: raw.isbn ?? null,
    rating: raw.rating ?? null,
    rating_count: raw.rating_count ?? 0,
    source: 'goodreads',
    external_urls: externalUrls,
  };
}
