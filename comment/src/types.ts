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
// Matters Social Data Types (from .moss/social/matters.json)
// ============================================================================

export interface SocialUser {
  id: string;
  userName: string;
  displayName: string;
  avatar?: string;
}

export interface MattersComment {
  id: string;
  content: string;
  createdAt: string;
  state: "active" | "archived" | "banned" | "collapsed";
  upvotes: number;
  author: SocialUser;
  replyToId?: string;
  replyToAuthor?: string;
}

export interface ArticleSocialData {
  comments: MattersComment[];
  donations: unknown[];
  appreciations: unknown[];
}

export interface MattersSocialData {
  schemaVersion: string;
  updatedAt: string;
  articles: Record<string, ArticleSocialData>;
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
