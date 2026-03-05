/**
 * Types for the Comment plugin
 */

// ============================================================================
// Comment Types
// ============================================================================

export interface NormalizedComment {
  id: string;
  source: string; // "matters", "nostr", "webmention", "waline"
  author: { name: string; url?: string };
  content_html: string;
  date: string; // ISO 8601
  replyToId?: string;
}

// ============================================================================
// Generic Social Data Types (from .moss/social/*.json files)
// ============================================================================

/** Generic comment from any social source (loose schema for normalization) */
export interface GenericSocialComment {
  id: string;
  content: string;
  createdAt: string;
  author: { displayName?: string; userName?: string; name?: string; avatar?: string; url?: string };
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
// Article Map Types
// ============================================================================

/** Entry in .moss/article-map.json */
export interface ArticleMapEntry {
  source_path: string;
  url_path: string;
  uid?: string;
}

/** Structure of .moss/article-map.json */
export interface ArticleMap {
  articles: Record<string, ArticleMapEntry>;
}

// ============================================================================
// Hook Context Types
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

export interface EnhanceContext {
  project_path: string;
  moss_dir: string;
  output_dir: string;
  project_info: ProjectInfo;
  config: Record<string, any>;
  interactions: any[];
  files: EnhanceFile[];
}

export interface HookResult {
  success: boolean;
  message?: string;
  interactions?: any[];
}

// ============================================================================
// Enhance Pipeline Types
// ============================================================================

/** A file passed into the enhance hook by the pipeline. */
export interface EnhanceFile {
  path: string;
  html: string;
}

/** A file modified by the enhance hook, returned to the pipeline. */
export interface ModifiedFile {
  path: string;
  html: string;
}

/** Result returned from the enhance hook. Extends HookResult with modified files. */
export interface EnhanceResult extends HookResult {
  modified?: ModifiedFile[];
}
