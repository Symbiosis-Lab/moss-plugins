/**
 * Types for the Comment plugin
 */

// ============================================================================
// Comment Types
// ============================================================================

export interface NormalizedComment {
  id: string;
  source: string; // "matters", "nostr", "webmention", "waline"
  author: { name: string; avatar?: string; url?: string };
  content_html: string;
  date: string; // ISO 8601
  replyToId?: string;
}

export interface CommentProvider {
  name: string;
  getFormAction(serverUrl: string): string;
  buildSubmitScript(serverUrl: string, pagePath: string): string;
  buildFetchScript(serverUrl: string, pagePath: string): string;
}

// ============================================================================
// Generic Social Data Types (from .moss/social/*.json files)
// ============================================================================

/** Generic comment from any social source (loose schema for normalization) */
export interface GenericSocialComment {
  id: string;
  content: string;
  createdAt: string;
  author: { displayName?: string; userName?: string; name?: string; avatar?: string };
  state?: string;
  replyToId?: string;
  upvotes?: number;
}

/** Generic social data file structure (all .moss/social/*.json files follow this) */
export interface GenericSocialFile {
  schemaVersion?: string;
  updatedAt?: string;
  articles: Record<string, { comments?: GenericSocialComment[]; [key: string]: unknown }>;
}

// ============================================================================
// Hook Context Types
// ============================================================================

export interface EnhanceContext {
  project_path: string;
  moss_dir: string;
  output_dir: string;
  project_info: { total_files: number; homepage_file: string | null };
  config: Record<string, any>;
  interactions: any[];
}

export interface HookResult {
  success: boolean;
  message?: string;
  interactions?: any[];
}
