/**
 * Types for the Substack plugin.
 */

// Re-export moss-api types
export type {
  ProcessContext,
  SyndicateContext,
  HookResult,
  ArticleInfo,
} from "@symbiosis-lab/moss-api";

/**
 * Substack post from the API (/api/v1/posts).
 */
export interface SubstackPost {
  id: number;
  title: string;
  subtitle: string;
  slug: string;
  post_date: string;
  canonical_url: string;
  type: string; // "newsletter"
  audience: string; // "everyone", "only_paid"
  body_html?: string;
  body_json?: unknown;
  cover_image?: string;
  description?: string;
  word_count?: number;
  reactions?: Record<string, number>;
}

/**
 * Substack plugin configuration.
 */
export interface SubstackPluginConfig {
  /** The publication URL, e.g., "https://mosstest.substack.com" */
  publication_url: string;
  /** Whether to auto-publish pushed articles */
  auto_publish: boolean;
  /** Whether to sync on build (process hook) */
  sync_on_build: boolean;
}

/**
 * Sync state for tracking pulled/pushed articles.
 */
export interface SyncEntry {
  substackId: number;
  slug: string;
  localPath: string;
  lastSynced: string;
  substackUrl: string;
}

export type SyncMap = Record<string, SyncEntry>;

/**
 * Frontmatter fields added by the Substack plugin.
 */
export interface SubstackFrontmatter {
  title: string;
  subtitle?: string;
  date?: string;
  tags?: string[];
  substack_url?: string;
  substack_id?: number;
  audience?: string;
}
