/**
 * Sync logic for articles, drafts, and collections
 *
 * FILE STRUCTURE DESIGN:
 * ----------------------
 * All content is organized under a single content folder:
 * - English: article/
 * - Chinese: 文章/
 *
 * The folder name is determined by the user's Matters.town language preference
 * (viewer.settings.language). Chinese is used for zh_hans or zh_hant.
 *
 * COLLECTION MODES:
 * -----------------
 * The plugin automatically detects the appropriate collection mode:
 *
 * 1. FOLDER MODE (default): Used when all articles belong to 0-1 collections
 *    - Collections are folders: article/{collection}/index.md
 *    - Articles in collections: article/{collection}/{article}.md
 *    - Standalone articles: article/{article}.md
 *
 * 2. FILE MODE: Used when any article belongs to 2+ collections
 *    - Collections are files: article/{collection}.md (with order: field)
 *    - All articles at: article/{article}.md (with collections: field)
 *
 * This automatic detection ensures no article duplication while maintaining
 * the simplest possible structure for the user's content.
 *
 * TWO-PHASE SYNC:
 * ---------------
 * Media download is NOT done during markdown sync. This function writes
 * markdown files with remote URLs intact. Call downloadMediaAndUpdate()
 * afterward to download and localize media assets.
 */

import type {
  MattersArticle,
  MattersDraft,
  MattersCollection,
  MattersUserProfile,
  SyncResult,
  SyncResultWithMap,
} from "./types";
import type { MattersPluginConfig } from "./config";
import { slugify, reportProgress, reportError } from "./utils";
import { htmlToMarkdown, generateFrontmatter, parseFrontmatter } from "./converter";
import { readFile, writeFile, listFiles } from "@symbiosis-lab/moss-api";

// ============================================================================
// Exported Functions for Folder Detection
// ============================================================================

/**
 * Get default folder names (no longer language-based).
 * Always returns "posts" for articles and "_drafts" for drafts.
 */
export function getDefaultFolderNames(): {
  article: string;
  drafts: string;
} {
  return { article: "posts", drafts: "_drafts" };
}

/**
 * Check if drafts should be synced based on config.
 * Default is FALSE - user must explicitly enable draft sync.
 */
export function shouldSyncDrafts(config: MattersPluginConfig): boolean {
  return config.sync_drafts ?? false;
}

/**
 * Detect the article folder by scanning for files with Matters syndication URLs.
 * Returns the folder name if found, or null if no existing articles.
 *
 * Scans all markdown files and looks for those with a `syndicated` field
 * containing a matters.town URL. Returns the top-level folder name.
 */
export async function detectArticleFolder(): Promise<string | null> {
  try {
    // Get all files in the project
    const allFiles = await listFiles();

    // Filter to markdown files and group by top-level folder
    const mdFiles = allFiles.filter((f) => f.endsWith(".md"));

    for (const filePath of mdFiles) {
      // Get top-level folder (first path segment)
      const segments = filePath.split("/");
      if (segments.length < 2) continue; // Skip root-level files

      const topFolder = segments[0];

      // Skip hidden and underscore folders
      if (topFolder.startsWith(".") || topFolder.startsWith("_")) continue;

      // Check if this file has Matters syndication
      try {
        const content = await readFile(filePath);
        const parsed = parseFrontmatter(content);

        if (
          parsed?.frontmatter?.syndicated &&
          Array.isArray(parsed.frontmatter.syndicated) &&
          parsed.frontmatter.syndicated.some((url: string) =>
            url.includes("matters.town")
          )
        ) {
          return topFolder;
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    return null;
  } catch {
    // On any error (e.g., listFiles not available), return null
    return null;
  }
}

/**
 * Get the article folder name to use for syncing.
 *
 * Priority:
 * 1. Explicit config (articleFolder) - user override
 * 2. Auto-detected from existing content - finds folder with Matters-synced files
 * 3. Default "posts" - for new projects
 */
export async function getArticleFolderName(
  config: MattersPluginConfig
): Promise<string> {
  // 1. Check if explicitly configured
  if (config.articleFolder) {
    return config.articleFolder;
  }

  // 2. Auto-detect from existing content
  const detected = await detectArticleFolder();
  if (detected) {
    return detected;
  }

  // 3. Fall back to default
  return "posts";
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if any article belongs to multiple collections
 * Returns true if file-mode (collections as .md files) should be used
 */
function hasMultiCollectionArticles(collections: MattersCollection[]): boolean {
  const articleCollectionCount = new Map<string, number>();

  for (const collection of collections) {
    for (const article of collection.articles) {
      const count = articleCollectionCount.get(article.shortHash) || 0;
      articleCollectionCount.set(article.shortHash, count + 1);
    }
  }

  for (const count of articleCollectionCount.values()) {
    if (count > 1) return true;
  }
  return false;
}

/**
 * Check if remote article is newer than local
 */
export function isRemoteNewer(
  localUpdated: string | undefined,
  remoteUpdated: string | undefined
): boolean {
  if (!localUpdated) return true;
  if (!remoteUpdated) return false;

  const localDate = new Date(localUpdated);
  const remoteDate = new Date(remoteUpdated);

  return remoteDate > localDate;
}

/**
 * Extract shortHash from a Matters URL
 * URL format: https://matters.town/@userName/slug-shortHash
 */
export function extractShortHash(mattersUrl: string): string | null {
  try {
    const url = new URL(mattersUrl);
    const path = url.pathname;
    // Path format: /@userName/slug-shortHash
    const lastSegment = path.split("/").pop();
    if (!lastSegment) return null;
    // shortHash is the last part after the final hyphen
    const parts = lastSegment.split("-");
    if (parts.length < 2) return null;
    return parts[parts.length - 1];
  } catch {
    return null;
  }
}

/**
 * Scan local markdown files to find all synced Matters articles
 * Returns array of { shortHash, path } for all articles with Matters syndicated URLs
 */
export async function scanLocalArticles(): Promise<Array<{ shortHash: string; path: string; title: string }>> {
  const articles: Array<{ shortHash: string; path: string; title: string }> = [];

  try {
    // List all files in the project
    const allFiles = await listFiles();

    // Filter to markdown files only
    const files = allFiles.filter((f) => f.endsWith(".md"));

    for (const file of files) {
      // Skip node_modules, .moss, and other non-content directories
      if (
        file.startsWith("node_modules/") ||
        file.startsWith(".moss/") ||
        file.startsWith("_drafts/") ||
        file.startsWith(".") ||
        file === "index.md" ||
        file === "README.md"
      ) {
        continue;
      }

      try {
        const content = await readFile(file);
        const parsed = parseFrontmatter(content);

        if (
          parsed?.frontmatter?.syndicated &&
          Array.isArray(parsed.frontmatter.syndicated)
        ) {
          // Find Matters URL in syndicated array
          const mattersUrl = parsed.frontmatter.syndicated.find(
            (url: string) => typeof url === "string" && url.includes("matters.town")
          );

          if (mattersUrl) {
            const shortHash = extractShortHash(mattersUrl);
            if (shortHash) {
              articles.push({
                shortHash,
                path: file,
                title: (parsed.frontmatter.title as string) || file,
              });
            }
          }
        }
      } catch {
        // Skip files that can't be read or parsed
      }
    }
  } catch (error) {
    console.warn(`Failed to scan local articles: ${error}`);
  }

  return articles;
}

/**
 * Find an available filename by adding sequence numbers if needed
 */
async function findAvailableFilename(
  basePath: string,
  slug: string
): Promise<string> {
  let filename = `${basePath}/${slug}.md`;
  let counter = 1;

  while (true) {
    try {
      await readFile(filename);
      counter++;
      filename = `${basePath}/${slug}-${counter}.md`;
    } catch {
      return filename;
    }
  }
}

// ============================================================================
// Main Sync Function
// ============================================================================

/**
 * Sync articles, drafts, and collections to local markdown files
 * Media is NOT downloaded here - use downloadMediaAndUpdate() after this
 *
 * Returns both the sync result and an articlePathMap for link rewriting.
 * The articlePathMap maps Matters URLs and shortHashes to local file paths,
 * enabling internal link rewriting in the post-sync phase.
 */
export async function syncToLocalFiles(
  articles: MattersArticle[],
  drafts: MattersDraft[],
  collections: MattersCollection[],
  userName: string,
  config: Record<string, unknown>,
  profile: MattersUserProfile
): Promise<SyncResultWithMap> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // Map for internal link rewriting: Matters URL/shortHash → local file path
  const articlePathMap = new Map<string, string>();

  // Get folder names - auto-detect existing folder or use defaults
  const articleFolder = await getArticleFolderName(config);
  const folders = {
    article: articleFolder,
    drafts: getDefaultFolderNames().drafts,
  };

  const totalItems = articles.length + drafts.length + collections.length + 1; // +1 for homepage
  let processedItems = 0;

  // Detect collection mode: folder-based or file-based
  const useFileMode = hasMultiCollectionArticles(collections);
  console.log(
    `📁 Syncing ${articles.length} articles, ${drafts.length} drafts, and ${collections.length} collections...`
  );
  console.log(`   Collection mode: ${useFileMode ? "file-based (multi-collection articles detected)" : "folder-based"}`);
  console.log(`   Content folder: ${folders.article}/`);
  console.log(`   Drafts folder: ${folders.drafts}/`);

  // ============================================================================
  // Generate Homepage (index.md)
  // ============================================================================
  // The homepage is created at the project root with only the user's display name
  // in frontmatter. Moss identifies it as the homepage by its location (root index.md).
  processedItems++;
  await reportProgress("syncing_homepage", processedItems, totalItems, "Creating homepage...");

  try {
    const homepageFrontmatter = generateFrontmatter({
      title: profile.displayName,
    });
    const homepageContent = homepageFrontmatter + "\n\n" + (profile.description || "");

    // Check if homepage already exists with same content
    let existingHomepage: string | null = null;
    try {
      existingHomepage = await readFile("index.md");
    } catch {
      // File doesn't exist
    }

    if (existingHomepage) {
      console.log(`   ⏭️  Skipping homepage (already exists): index.md`);
      result.skipped++;
    } else {
      await writeFile("index.md", homepageContent);
      console.log(`   ✅ Created homepage: index.md`);
      result.created++;
    }
  } catch (error) {
    const errorMsg = `Failed to create homepage: ${error}`;
    await reportError(errorMsg, "syncing_homepage", false);
    console.error(`   ❌ ${errorMsg}`);
    result.errors.push(errorMsg);
  }

  // Build article ID → collection memberships mapping
  const articleCollections = new Map<string, Record<string, number>>();
  const articleFirstCollection = new Map<string, string>();

  for (const collection of collections) {
    const collectionSlug = slugify(collection.title);
    for (let i = 0; i < collection.articles.length; i++) {
      const article = collection.articles[i];
      const articleKey = article.shortHash;

      if (!articleCollections.has(articleKey)) {
        articleCollections.set(articleKey, {});
      }
      articleCollections.get(articleKey)![collectionSlug] = i;

      if (!articleFirstCollection.has(articleKey)) {
        articleFirstCollection.set(articleKey, collectionSlug);
      }
    }
  }

  // Build article shortHash → slug mapping for collection order field
  const articleSlugMap = new Map<string, string>();
  for (const article of articles) {
    const slug = article.slug || slugify(article.title);
    articleSlugMap.set(article.shortHash, slug);
  }

  // Process collections
  for (const collection of collections) {
    processedItems++;
    await reportProgress(
      "syncing_collections",
      processedItems,
      totalItems,
      `Syncing collection: ${collection.title}`
    );

    try {
      const collectionSlug = slugify(collection.title);

      // Determine path based on mode
      // All collections live under the article/ folder
      const collectionPath = useFileMode
        ? `${folders.article}/${collectionSlug}.md`  // File mode: collection as .md file
        : `${folders.article}/${collectionSlug}/index.md`;  // Folder mode: collection as folder with index.md

      let existingContent: string | null = null;
      try {
        existingContent = await readFile(collectionPath);
      } catch {
        // File doesn't exist
      }

      // Build order field for file mode (list of article paths relative to project root)
      // In file mode, all articles are at article/{slug}.md, so we include the full path
      let orderField: string[] | undefined;
      if (useFileMode && collection.articles.length > 0) {
        orderField = collection.articles
          .map((a) => {
            const slug = articleSlugMap.get(a.shortHash);
            return slug ? `${folders.article}/${slug}.md` : null;
          })
          .filter((s): s is string => s !== null);
      }

      const frontmatter = generateFrontmatter({
        title: collection.title,
        is_collection: true,
        description: collection.description,
        cover: collection.cover,  // Keep remote URL, will be downloaded in phase 2
        order: orderField,
      });

      const fullContent = `${frontmatter}\n\n${collection.description || ""}`;

      if (existingContent) {
        console.log(`   ⏭️  Skipping collection (already exists): ${collectionPath}`);
        result.skipped++;
        continue;
      }

      await writeFile(collectionPath, fullContent);
      console.log(`   ✅ Created collection: ${collectionPath}`);
      result.created++;
    } catch (error) {
      const errorMsg = `Failed to sync collection "${collection.title}": ${error}`;
      await reportError(errorMsg, "syncing_collections", false);
      console.error(`   ❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  // Process published articles
  for (const article of articles) {
    processedItems++;
    await reportProgress(
      "syncing_articles",
      processedItems,
      totalItems,
      `Syncing article: ${article.title}`
    );

    try {
      const articleSlug = article.slug || slugify(article.title);
      const mattersUrl = `https://matters.town/@${userName}/${article.slug}-${article.shortHash}`;

      // Determine file location based on mode and collection membership
      // All articles live under the article/ folder
      let filename: string;
      if (useFileMode) {
        // File mode: all articles directly under article/, collections via frontmatter
        filename = `${folders.article}/${articleSlug}.md`;
      } else {
        // Folder mode: articles in their first collection's folder
        const firstCollectionSlug = articleFirstCollection.get(article.shortHash);
        if (firstCollectionSlug) {
          filename = `${folders.article}/${firstCollectionSlug}/${articleSlug}.md`;
        } else {
          // Standalone articles (not in any collection) go directly under article/
          filename = `${folders.article}/${articleSlug}.md`;
        }
      }

      // Add to articlePathMap for internal link rewriting
      // Map both the full Matters URL and the shortHash to the local path
      articlePathMap.set(mattersUrl, filename);
      articlePathMap.set(article.shortHash, filename);

      // Build collections field for frontmatter
      const allCollections = articleCollections.get(article.shortHash) || {};
      let collectionsField: Record<string, number> | string[] | undefined;

      if (useFileMode) {
        // File mode: list all collections
        if (Object.keys(allCollections).length > 0) {
          collectionsField = allCollections;
        }
      } else {
        // Folder mode: only additional collections (not the first one where article lives)
        const firstCollectionSlug = articleFirstCollection.get(article.shortHash);
        const additionalCollections: Record<string, number> = {};
        for (const [slug, order] of Object.entries(allCollections)) {
          if (slug !== firstCollectionSlug) {
            additionalCollections[slug] = order;
          }
        }
        if (Object.keys(additionalCollections).length > 0) {
          collectionsField = additionalCollections;
        }
      }

      // Check if file already exists - never overwrite existing files
      // This implements "download new content only" model
      let fileExists = false;
      try {
        await readFile(filename);
        fileExists = true;
      } catch {
        // File doesn't exist
      }

      if (fileExists) {
        // Never overwrite existing files - protects local edits
        console.log(`   ⏭️  Skipping (file exists): ${filename}`);
        result.skipped++;
        continue;
      }

      // Convert HTML to Markdown (keep remote URLs, will be downloaded in phase 2)
      const markdownContent = htmlToMarkdown(article.content);

      const frontmatter = generateFrontmatter({
        title: article.title,
        date: article.createdAt,
        updated: article.revisedAt,
        tags: article.tags.map((t) => t.content),
        cover: article.cover,  // Keep remote URL, will be downloaded in phase 2
        syndicated: [mattersUrl],
        collections: collectionsField,
      });

      const fullContent = `${frontmatter}\n\n${markdownContent}`;

      await writeFile(filename, fullContent);
      console.log(`   ✅ Created: ${filename}`);
      result.created++;
    } catch (error) {
      const errorMsg = `Failed to sync article "${article.title}": ${error}`;
      await reportError(errorMsg, "syncing_articles", false);
      console.error(`   ❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  // Process drafts (disabled by default - must be explicitly enabled)
  if (shouldSyncDrafts(config)) {
    for (const draft of drafts) {
      processedItems++;
      const draftTitle = draft.title || "Untitled";
      await reportProgress(
        "syncing_drafts",
        processedItems,
        totalItems,
        `Syncing draft: ${draftTitle}`
      );

      try {
        const slug = slugify(draft.title || "untitled");
        const filename = await findAvailableFilename(folders.drafts, slug);

        // Check if file already exists - never overwrite existing files
        let fileExists = false;
        try {
          await readFile(filename);
          fileExists = true;
        } catch {
          // File doesn't exist
        }

        if (fileExists) {
          // Never overwrite existing files - protects local edits
          console.log(`   ⏭️  Skipping draft (file exists): ${filename}`);
          result.skipped++;
          continue;
        }

        // Convert HTML to Markdown (keep remote URLs, will be downloaded in phase 2)
        const markdownContent = htmlToMarkdown(draft.content);

        const frontmatter = generateFrontmatter({
          title: draft.title || "Untitled Draft",
          date: draft.createdAt,
          updated: draft.updatedAt,
          tags: draft.tags || [],
          cover: draft.cover,  // Keep remote URL, will be downloaded in phase 2
          syndicated: [],
        });

        const fullContent = `${frontmatter}\n\n${markdownContent}`;

        await writeFile(filename, fullContent);
        console.log(`   ✅ Created draft: ${filename}`);
        result.created++;
      } catch (error) {
        const errorMsg = `Failed to sync draft "${draftTitle}": ${error}`;
        await reportError(errorMsg, "syncing_drafts", false);
        console.error(`   ❌ ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }
  }

  return { result, articlePathMap };
}
