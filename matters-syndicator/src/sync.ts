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
import { slugify, reportProgress, reportError } from "./utils";
import { htmlToMarkdown, generateFrontmatter, parseFrontmatter } from "./converter";

// ============================================================================
// Tauri Interface
// ============================================================================

interface TauriCore {
  invoke: <T>(cmd: string, args: unknown) => Promise<T>;
}

function getTauriCore(): TauriCore {
  return (window as unknown as { __TAURI__: { core: TauriCore } }).__TAURI__.core;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get localized folder names based on user's Matters.town language preference.
 *
 * Language Detection:
 * - zh_hans (Simplified Chinese) or zh_hant (Traditional Chinese) → Chinese folder names
 * - All other values (en, null, undefined) → English folder names
 *
 * Folder Naming Conventions:
 * - article/文章: Main content folder containing all articles and collections
 * - _drafts/_草稿: Underscore prefix indicates hidden/unpublished content
 */
function getLocalizedFolderNames(language?: string): {
  article: string;
  drafts: string;
} {
  const isChinese = language === "zh_hans" || language === "zh_hant";
  return isChinese
    ? { article: "文章", drafts: "_草稿" }
    : { article: "article", drafts: "_drafts" };
}

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
 * Find an available filename by adding sequence numbers if needed
 */
async function findAvailableFilename(
  basePath: string,
  slug: string,
  projectPath: string
): Promise<string> {
  let filename = `${basePath}/${slug}.md`;
  let counter = 1;

  while (true) {
    try {
      await getTauriCore().invoke("read_project_file", {
        projectPath,
        relativePath: filename,
      });
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
  projectPath: string,
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

  // Get localized folder names based on user's language preference
  const folders = getLocalizedFolderNames(profile.language);

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

    await getTauriCore().invoke("write_project_file", {
      projectPath,
      relativePath: "index.md",
      data: homepageContent,
    });

    console.log(`   ✅ Created homepage: index.md`);
    result.created++;
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
        existingContent = await getTauriCore().invoke<string>("read_project_file", {
          projectPath,
          relativePath: collectionPath,
        });
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

      await getTauriCore().invoke("write_project_file", {
        projectPath,
        relativePath: collectionPath,
        data: fullContent,
      });

      if (existingContent) {
        console.log(`   ✏️  Updated collection: ${collectionPath}`);
        result.updated++;
      } else {
        console.log(`   ✅ Created collection: ${collectionPath}`);
        result.created++;
      }
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

      // Try to read existing file
      let existingContent: string | null = null;
      try {
        existingContent = await getTauriCore().invoke<string>("read_project_file", {
          projectPath,
          relativePath: filename,
        });
      } catch {
        // File doesn't exist
      }

      // Check if we should update
      if (existingContent) {
        const parsed = parseFrontmatter(existingContent);
        if (parsed) {
          const localUpdated = (parsed.frontmatter.updated || parsed.frontmatter.date) as string | undefined;
          const remoteUpdated = article.revisedAt || article.createdAt;

          if (!isRemoteNewer(localUpdated, remoteUpdated)) {
            console.log(`   ⏭️  Skipping (local is up to date): ${article.title}`);
            result.skipped++;
            continue;
          }
        }
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

      await getTauriCore().invoke("write_project_file", {
        projectPath,
        relativePath: filename,
        data: fullContent,
      });

      if (existingContent) {
        console.log(`   ✏️  Updated: ${filename}`);
        result.updated++;
      } else {
        console.log(`   ✅ Created: ${filename}`);
        result.created++;
      }
    } catch (error) {
      const errorMsg = `Failed to sync article "${article.title}": ${error}`;
      await reportError(errorMsg, "syncing_articles", false);
      console.error(`   ❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  // Process drafts
  const syncDrafts = config.sync_drafts ?? true;
  if (syncDrafts) {
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
        const filename = await findAvailableFilename(folders.drafts, slug, projectPath);

        let existingContent: string | null = null;
        try {
          existingContent = await getTauriCore().invoke<string>("read_project_file", {
            projectPath,
            relativePath: filename,
          });
        } catch {
          // File doesn't exist
        }

        if (existingContent) {
          const parsed = parseFrontmatter(existingContent);
          if (parsed) {
            const localUpdated = (parsed.frontmatter.updated || parsed.frontmatter.date) as string | undefined;
            const remoteUpdated = draft.updatedAt || draft.createdAt;

            if (!isRemoteNewer(localUpdated, remoteUpdated)) {
              console.log(`   ⏭️  Skipping draft (local is up to date): ${draft.title}`);
              result.skipped++;
              continue;
            }
          }
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

        await getTauriCore().invoke("write_project_file", {
          projectPath,
          relativePath: filename,
          data: fullContent,
        });

        if (existingContent) {
          console.log(`   ✏️  Updated draft: ${filename}`);
          result.updated++;
        } else {
          console.log(`   ✅ Created draft: ${filename}`);
          result.created++;
        }
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
