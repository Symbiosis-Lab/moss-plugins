/**
 * Types for the Xiaohongshu plugin.
 */

// Re-export moss-api types
export type {
  ProcessContext,
  SyndicateContext,
  HookResult,
  ArticleInfo,
} from "@symbiosis-lab/moss-api";

/**
 * Xiaohongshu note scraped from the creator dashboard or note page.
 * Xiaohongshu is image-first: images are the primary content, text accompanies them.
 */
export interface XhsNote {
  id: string;
  title: string;
  text: string;
  images: string[];
  tags: string[];
  url: string;
  publish_date: string;
  likes?: number;
  collects?: number;
  comments?: number;
  cover_image?: string;
}

/**
 * Xiaohongshu plugin configuration.
 */
export interface XhsPluginConfig {
  /** The creator profile URL, e.g., "https://www.xiaohongshu.com/user/profile/xxx" */
  profile_url: string;
  /** Whether to sync on build (process hook) */
  sync_on_build: boolean;
}

/**
 * Sync state for tracking pulled/pushed notes.
 */
export interface SyncEntry {
  noteId: string;
  localPath: string;
  lastSynced: string;
  xiaohongshuUrl: string;
}

export type SyncMap = Record<string, SyncEntry>;

/**
 * Frontmatter fields added by the Xiaohongshu plugin.
 */
export interface XhsFrontmatter {
  title: string;
  date?: string;
  tags?: string[];
  images?: string[];
  xiaohongshu_url?: string;
}
