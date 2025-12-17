/**
 * Plugin-specific type definitions for the Matters Syndicator Plugin
 *
 * Common types (BeforeBuildContext, AfterDeployContext, HookResult, etc.) are
 * imported from moss-plugin-sdk.
 */

// Re-export SDK types for convenience
export type {
  BeforeBuildContext,
  AfterDeployContext,
  HookResult,
  DeploymentInfo,
  ProjectInfo,
  ArticleInfo,
  PluginMessage,
} from "moss-api";

// ============================================================================
// Matters API Types
// ============================================================================

export interface PageInfo {
  endCursor: string;
  hasNextPage: boolean;
}

export interface MattersTag {
  id: string;
  content: string;
}

export interface MattersArticle {
  id: string;
  title: string;
  slug: string;
  shortHash: string;
  content: string; // HTML content
  summary: string;
  createdAt: string;
  revisedAt?: string;
  tags: MattersTag[];
  cover?: string;
}

export interface MattersDraft {
  id: string;
  title: string;
  content: string; // HTML content
  summary?: string;
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
  cover?: string;
}

export interface MattersCollectionArticle {
  id: string;
  shortHash: string;
  title: string;
  slug: string;
}

export interface MattersCollection {
  id: string;
  title: string;
  description?: string;
  cover?: string;
  articles: MattersCollectionArticle[];
}

export interface MattersUserProfile {
  userName: string;
  displayName: string;
  description?: string;
  avatar?: string;
  profileCover?: string;
  language?: string; // e.g., "zh_hans", "zh_hant", "en"
}

// ============================================================================
// Internal Types
// ============================================================================

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/**
 * Extended sync result that includes the article path map for link rewriting.
 * The articlePathMap maps Matters URLs and shortHashes to local file paths.
 */
export interface SyncResultWithMap {
  result: SyncResult;
  articlePathMap: Map<string, string>;
}

export interface MediaDownloadResult {
  filesProcessed: number;
  imagesDownloaded: number;
  imagesSkipped: number;
  errors: string[];
}

export interface DownloadAndRewriteResult {
  content: string;
  downloadedCount: number;
  errors: string[];
}

export interface ExtractedMedia {
  url: string;
  localFilename: string;
}

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

// ============================================================================
// GraphQL Response Types
// ============================================================================

export interface ViewerArticlesResponse {
  viewer: {
    id: string;
    userName: string;
    articles: {
      totalCount: number;
      pageInfo: PageInfo;
      edges: Array<{
        node: MattersArticle;
      }>;
    };
  };
}

export interface ViewerDraftsResponse {
  viewer: {
    id: string;
    drafts: {
      pageInfo: PageInfo;
      edges: Array<{
        node: MattersDraft;
      }>;
    };
  };
}

export interface ViewerCollectionsResponse {
  viewer: {
    id: string;
    collections: {
      totalCount: number;
      pageInfo: PageInfo;
      edges: Array<{
        node: {
          id: string;
          title: string;
          description?: string;
          cover?: string;
          articles: {
            edges: Array<{
              node: MattersCollectionArticle;
            }>;
          };
        };
      }>;
    };
  };
}

export interface ViewerProfileResponse {
  viewer: {
    id: string;
    userName: string;
    displayName: string;
    info: {
      description?: string;
      profileCover?: string;
    };
    avatar?: string;
    settings: {
      language?: string;
    };
  };
}

// ============================================================================
// Frontmatter Data Types
// ============================================================================

export interface FrontmatterData {
  title: string;
  date?: string;
  updated?: string;
  tags?: string[];
  cover?: string;
  syndicated?: string[];
  is_collection?: boolean;
  description?: string;
  collections?: Record<string, number> | string[];
  order?: string[]; // For collections: ordered list of article filenames
}
