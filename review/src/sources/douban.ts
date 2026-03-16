/**
 * Douban source fetcher
 *
 * Douban shut down its public API in 2018. Strategy: search NeoDB's catalog
 * for items indexed from Douban. NeoDB indexes most popular Douban items and
 * stores the Douban URL in external_resources.
 *
 * Lookup flow:
 * 1. Call NeoDB catalog search with the Douban URL
 * 2. If found, use NeoDB's structured data (same normalization as direct NeoDB fetch)
 * 3. If not found, return null (item not indexed by NeoDB)
 */

import { fetchUrl } from "@symbiosis-lab/moss-api";
import type { ReviewItem } from "../types";

const NEODB_SEARCH_BASE = "https://neodb.social";

/**
 * Fetch item metadata by looking up a Douban URL through NeoDB's catalog.
 * Returns null if the item is not indexed by NeoDB.
 */
export async function fetchFromDouban(url: string): Promise<ReviewItem | null> {
  try {
    const searchUrl = `${NEODB_SEARCH_BASE}/api/catalog/search?query=${encodeURIComponent(url)}`;
    const response = await fetchUrl(searchUrl);
    if (!response.ok) return null;

    const data = JSON.parse(await response.text());
    const items = data?.data || data?.results || [];
    if (items.length === 0) return null;

    // Use the first match
    const raw = items[0];
    return normalizeNeoDBResult(raw, url);
  } catch {
    return null;
  }
}

function normalizeNeoDBResult(raw: any, originalDoubanUrl: string): ReviewItem {
  const creator: string[] = raw.author || raw.director || raw.artist || [];
  const year: number | null = raw.pub_year ?? raw.year ?? raw.release_year ?? null;

  let coverUrl = raw.cover_image_url || null;
  if (coverUrl && !coverUrl.startsWith("http")) {
    coverUrl = coverUrl.startsWith("//") ? "https:" + coverUrl : NEODB_SEARCH_BASE + coverUrl;
  }

  const externalUrls: ReviewItem["external_urls"] = { douban: originalDoubanUrl };
  if (raw.id) externalUrls.neodb = `${NEODB_SEARCH_BASE}${raw.url || ''}`;
  for (const r of raw.external_resources || []) {
    try {
      const host = new URL(r.url).hostname;
      if (host.includes("goodreads.com")) externalUrls.goodreads = r.url;
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
    source: 'douban',
    external_urls: externalUrls,
  };
}
