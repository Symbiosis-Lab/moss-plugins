/**
 * Type definitions for the Email Newsletter plugin
 */

// Re-export SDK types for convenience
export type {
  AfterDeployContext,
  HookResult,
  ArticleInfo,
} from "@symbiosis-lab/moss-api";

/**
 * Plugin configuration
 */
export interface PluginConfig {
  /** Buttondown API key */
  api_key?: string;
  /** If true, create drafts instead of sending immediately */
  send_as_draft?: boolean;
}

/**
 * Buttondown API response for creating an email
 */
export interface ButtondownEmailResponse {
  /** Email ID */
  id: string;
  /** Email subject */
  subject: string;
  /** Email status (draft, scheduled, sent) */
  status: "draft" | "scheduled" | "sent";
  /** Creation timestamp */
  creation_date: string;
  /** Publish date (if scheduled/sent) */
  publish_date?: string;
}

/**
 * Syndication tracking entry
 */
export interface SyndicatedEntry {
  /** Article URL path */
  url_path: string;
  /** When the article was syndicated */
  syndicated_at: string;
  /** Buttondown email ID */
  email_id: string;
  /** Email status at syndication time */
  status: "draft" | "sent";
}

/**
 * Syndication tracking data
 */
export interface SyndicationData {
  /** Map of article URL paths to syndication entries */
  articles: Record<string, SyndicatedEntry>;
}
