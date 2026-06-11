/**
 * Types for the LinkedIn plugin.
 */

// Re-export moss-api types
export type {
  ProcessContext,
  SyndicateContext,
  HookResult,
  ArticleInfo,
} from "@symbiosis-lab/moss-api";

/**
 * LinkedIn article scraped from a profile page.
 * LinkedIn has no public API for articles — data comes from DOM scraping.
 */
export interface LinkedInArticle {
  title: string;
  url: string;
  author: string;
  date: string;
  body_html?: string;
  cover_image?: string;
  description?: string;
}

/**
 * LinkedIn plugin configuration.
 */
export interface LinkedInPluginConfig {
  /** The LinkedIn profile URL, e.g., "https://www.linkedin.com/in/username" */
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
  linkedinUrl: string;
}

export type SyncMap = Record<string, SyncEntry>;

/**
 * Frontmatter fields added by the LinkedIn plugin.
 */
export interface LinkedInFrontmatter {
  title: string;
  date?: string;
  linkedin_url?: string;
  author?: string;
}
