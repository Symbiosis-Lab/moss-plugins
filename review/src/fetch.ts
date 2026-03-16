/**
 * Unified review item fetcher.
 *
 * Auto-detects the source from the URL hostname, then dispatches to the
 * appropriate source-specific fetcher. This is the single entry point for
 * all metadata fetching in the review plugin.
 */

import { detectSource } from "./sources";
import { fetchFromNeoDB } from "./sources/neodb";
import { fetchFromDouban } from "./sources/douban";
import { fetchFromTMDB } from "./sources/tmdb";
import { fetchFromGoodreads } from "./sources/goodreads";
import type { ReviewItem } from "./types";

/**
 * Fetch review item metadata from any supported source.
 * Auto-detects source from URL hostname, dispatches to source-specific fetcher.
 *
 * @param url - The review_of URL from frontmatter
 * @param config - Plugin configuration (may contain tmdb_api_key)
 * @returns ReviewItem or null if fetch fails or source is unrecognized
 */
export async function fetchReviewItem(
  url: string,
  config?: Record<string, any>
): Promise<ReviewItem | null> {
  const source = detectSource(url);
  if (!source) {
    console.log(`[warn] Review: Unrecognized URL source: ${url}`);
    return null;
  }

  switch (source) {
    case 'neodb':
      return fetchFromNeoDB(url);
    case 'douban':
      return fetchFromDouban(url);
    case 'tmdb':
      return fetchFromTMDB(url, config?.tmdb_api_key);
    case 'goodreads':
      return fetchFromGoodreads(url);
  }
}
