/**
 * Types for the X plugin.
 */

// Re-export moss-api types
export type {
  ProcessContext,
  SyndicateContext,
  HookResult,
  ArticleInfo,
} from "@symbiosis-lab/moss-api";

/**
 * X article scraped from the profile page.
 */
export interface XArticle {
  title: string;
  url: string;
  date: string;
  author: string;
  body_html?: string;
}

/**
 * X plugin configuration.
 */
export interface XPluginConfig {
  /** The profile URL, e.g., "https://x.com/username" */
  profile_url: string;
  /** Whether to auto-publish pushed articles */
  auto_publish: boolean;
  /** Whether to sync on build (process hook) */
  sync_on_build: boolean;
}

/**
 * Sync state for tracking pulled/pushed articles.
 */
export interface SyncEntry {
  slug: string;
  localPath: string;
  lastSynced: string;
  xUrl: string;
}

export type SyncMap = Record<string, SyncEntry>;

/**
 * Frontmatter fields added by the X plugin.
 */
export interface XFrontmatter {
  title: string;
  date?: string;
  x_url?: string;
  author?: string;
}
