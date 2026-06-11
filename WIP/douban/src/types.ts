/**
 * Types for the Douban plugin.
 */

export type {
  ProcessContext,
  SyndicateContext,
  HookResult,
  ArticleInfo,
} from "@symbiosis-lab/moss-api";

/**
 * A Douban collection item (book or movie that the user has read/watched/rated).
 */
export interface DoubanItem {
  /** Douban subject URL, e.g. "https://book.douban.com/subject/1084336/" */
  url: string;
  /** Douban subject ID extracted from URL */
  subjectId: string;
  /** Book/movie title */
  title: string;
  /** Media type */
  mediaType: "book" | "movie";
  /** User's star rating (1-5 stars, or 0 if not rated) */
  rating: number;
  /** Date the user marked it (YYYY-MM-DD) */
  date: string;
  /** Status: read/watched, reading/watching, want to read/watch */
  status: "done" | "doing" | "wish";
  /** User's short comment/review */
  comment: string;
  /** Tags the user applied */
  tags: string[];
}

/**
 * Detailed info from a Douban subject page.
 */
export interface DoubanSubjectDetail {
  title: string;
  originalTitle?: string;
  author?: string;
  translator?: string;
  publisher?: string;
  publishDate?: string;
  isbn?: string;
  pages?: number;
  rating: string;
  ratingCount: string;
  coverImage?: string;
  intro: string;
  /** For movies */
  director?: string;
  actors?: string[];
  genre?: string[];
  runtime?: string;
}

export interface DoubanPluginConfig {
  /** Douban user ID (from profile URL) */
  user_id: string;
  sync_books: boolean;
  sync_movies: boolean;
  sync_on_build: boolean;
}

export interface SyncEntry {
  subjectId: string;
  localPath: string;
  lastSynced: string;
  doubanUrl: string;
}

export type SyncMap = Record<string, SyncEntry>;
