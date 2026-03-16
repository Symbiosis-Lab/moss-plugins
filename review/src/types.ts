/**
 * Types for the Review plugin
 */

import type { ReviewSource } from "./sources";

// ============================================================================
// Review Item (unified across sources)
// ============================================================================

/** Normalized item from any review source (NeoDB, Douban, TMDB, Goodreads) */
export interface ReviewItem {
  id: string;
  uuid: string;
  category: string;
  title: string;
  cover_image_url: string | null;
  creator: string[];        // normalized: author, director, or artist
  year: number | null;      // normalized from pub_year, year, release_year
  publisher: string | null; // pub_house for books, label for albums
  pages: number | null;
  isbn: string | null;
  rating: number | null;    // community rating, 1-10 scale
  rating_count: number;
  source: ReviewSource;
  external_urls: {
    neodb?: string;
    douban?: string;
    goodreads?: string;
    openlibrary?: string;
    imdb?: string;
    tmdb?: string;
  };
}

// ============================================================================
// Social Data Types
// ============================================================================

/** Entry in .moss/social/review.json, keyed by uid */
export interface ReviewSocialEntry {
  source_url: string;
  source: ReviewSource;
  category: string;
  title: string;
  creator: string[];
  year: number | null;
  publisher: string | null;
  pages: number | null;
  isbn: string | null;
  community_rating: number | null;
  community_rating_count: number;
  cover_url: string | null;
  external_urls: {
    neodb?: string;
    douban?: string;
    goodreads?: string;
    openlibrary?: string;
    imdb?: string;
    tmdb?: string;
  };
  writer_rating: number | null; // from frontmatter, 1-5 scale
  fetched_at: string;           // ISO 8601
}

/** Social data file for the review plugin */
export interface ReviewSocialFile {
  schemaVersion: string;
  updatedAt: string;
  articles: Record<string, ReviewSocialEntry>;
}

// ============================================================================
// Article Map Types (same as comment plugin)
// ============================================================================

export interface ArticleMapEntry {
  source_path: string;
  url_path: string;
  uid?: string;
}

export interface ArticleMap {
  articles: Record<string, ArticleMapEntry>;
}

// ============================================================================
// Hook Context Types (same as comment plugin)
// ============================================================================

export interface ProjectInfo {
  total_files: number;
  homepage_file: string | null;
  site_name?: string;
}

export interface ProcessContext {
  project_info: ProjectInfo;
  config: Record<string, any>;
}

export interface HookResult {
  success: boolean;
  message?: string;
}
