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
import { getConfig, type MattersPluginConfig } from "./config";
import { slugify, reportError } from "./utils";
import { overallProgress, type ProgressReporter } from "./progress";
import { generateFrontmatter, parseFrontmatter } from "./converter";
import { htmlToMarkdown, readFile, writeFile, listFiles, listProjectTree } from "@symbiosis-lab/moss-api";
import {
  isMattersUrl,
  articleUrl,
  collectionUrl,
  extractShortHash,
  extractCollectionId,
} from "./domain";

// Canonical home for extractShortHash is ./domain (it owns Matters URL knowledge).
// Re-exported here so existing `import { extractShortHash } from "../sync"` callers
// and tests keep resolving it.
export { extractShortHash } from "./domain";

// ============================================================================
// Exported Functions for Folder Detection
// ============================================================================

/**
 * Get default folder names. Only the drafts folder is fixed (`_drafts`); the
 * article folder is language-aware via `folderNameForLanguage` (see
 * `getArticleFolderName`).
 */
export function getDefaultFolderNames(): {
  article: string;
  drafts: string;
} {
  return { article: "articles", drafts: "_drafts" };
}

/**
 * Map a Matters language preference to the article folder name.
 * Chinese (`zh_hans` / `zh_hant`) → `文章`; everything else → `articles`.
 * Restores the language-aware naming that had regressed to a hardcoded
 * `articles` (it was disabled because it read the viewer-only
 * `settings.language`; we now also accept a public per-article language). (G)
 */
export function folderNameForLanguage(language?: string | null): string {
  return language === "zh_hans" || language === "zh_hant" ? "文章" : "articles";
}

/**
 * Resolve the site's language for folder naming. Prefers an explicit/authed
 * value, then the public per-article majority (the only language signal
 * available in unauthenticated/public-fetch mode, since `settings.language`
 * is viewer-only). Returns undefined if no signal — caller defaults to English.
 */
export function resolveContentLanguage(
  explicit: string | null | undefined,
  articleLanguages: Array<string | null | undefined>,
): string | undefined {
  if (explicit) return explicit;
  const counts = new Map<string, number>();
  for (const l of articleLanguages) {
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [l, n] of counts) {
    if (n > bestN) {
      best = l;
      bestN = n;
    }
  }
  return best;
}

/**
 * Whether to import (sync) draft articles from Matters.town locally.
 *
 * Removed as a user-facing toggle (2026-07-05, settings UI polish pass): the
 * `sync_drafts` setting was persisted to config.toml by the Settings UI, but
 * `get_plugin_config` preferred config.json wholesale the instant it existed
 * (created on first Matters login) — so for virtually every real user this
 * toggle silently stopped reaching `context.config` at hook time regardless
 * of what they'd set (see the discovery.rs config.json/config.toml merge fix
 * landed alongside this change). Hardcoded off, matching this function's
 * original default intent ("user must explicitly enable draft sync") and the
 * effective behavior almost everyone already experienced. Drafts are
 * typically unpublished/private-in-progress content; keeping this off avoids
 * surprise-importing them into a public site repo.
 */
export function shouldSyncDrafts(): boolean {
  return false;
}

/**
 * Scan project files for Matters syndication content.
 * Returns the top-level folder name and the Matters username if found.
 *
 * Shared helper used by both detectArticleFolder() and detectBoundUser().
 */
async function scanForMattersContent(): Promise<{ folder: string | null; userName: string | null }> {
  try {
    const allFiles = await listFiles();
    const mdFiles = allFiles.filter((f) => f.endsWith(".md"));

    for (const filePath of mdFiles) {
      const segments = filePath.split("/");
      if (segments.length < 2) continue; // Skip root-level files

      const topFolder = segments[0];

      // Skip hidden and underscore folders
      if (topFolder.startsWith(".") || topFolder.startsWith("_")) continue;

      try {
        const content = await readFile(filePath);
        const parsed = parseFrontmatter(content);

        if (
          parsed?.frontmatter?.syndicated &&
          Array.isArray(parsed.frontmatter.syndicated)
        ) {
          const mattersUrl = parsed.frontmatter.syndicated.find(
            (url: string) => isMattersUrl(url)
          );
          if (mattersUrl) {
            // Extract username from URL: https://matters.town/@username/slug-hash
            const match = mattersUrl.match(/\/@([^/]+)\//);
            const userName = match ? match[1] : null;
            return { folder: topFolder, userName };
          }
        }
      } catch {
        continue;
      }
    }

    return { folder: null, userName: null };
  } catch {
    return { folder: null, userName: null };
  }
}

/**
 * Detect the article folder by scanning for files with Matters syndication URLs.
 * Returns the folder name if found, or null if no existing articles.
 */
export async function detectArticleFolder(): Promise<string | null> {
  const { folder } = await scanForMattersContent();
  return folder;
}

/**
 * Detect the Matters username bound to this project by scanning syndication URLs.
 * Returns the username if found, or null if no Matters content exists.
 */
export async function detectBoundUser(): Promise<string | null> {
  const { userName } = await scanForMattersContent();
  return userName;
}

/**
 * Get the article folder name to use for syncing.
 *
 * Priority:
 * 1. Explicit config (articleFolder) - user override
 * 2. Auto-detected from existing content - finds folder with Matters-synced files
 * 3. Default "articles" - for new projects
 */
export async function getArticleFolderName(
  config: MattersPluginConfig,
  language?: string,
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

  // 3. Fall back to a language-derived default (Chinese → 文章, else articles)
  return folderNameForLanguage(language ?? config.language);
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
 * Scan local markdown files to find all synced Matters content, by identity:
 * - articles: files whose `syndicated:` carries a Matters ARTICLE URL,
 *   keyed by shortHash
 * - collections: files whose `syndicated:` carries a Matters COLLECTION URL
 *   (`/@user/collections/<id>`), as a collectionId → path map
 *
 * Identity lives in the files themselves, so both survive local rename/move.
 *
 * The uid comes from frontmatter and is used as the key for local social data
 * storage. When uid is null (file hasn't been built yet), callers should fall
 * back to path.
 */
export async function scanLocalContent(): Promise<{
  articles: Array<{ shortHash: string; path: string; title: string; uid: string | null }>;
  collections: Map<string, string>;
}> {
  const articles: Array<{ shortHash: string; path: string; title: string; uid: string | null }> = [];
  const collections = new Map<string, string>();

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
            (url: string) => typeof url === "string" && isMattersUrl(url)
          );

          if (mattersUrl) {
            // Collection identity marker — a collection page, not an article.
            // Must be recognized BEFORE shortHash extraction so it neither
            // triggers the shortHash warning nor enters the social-fetch list.
            const collectionId = extractCollectionId(mattersUrl);
            if (collectionId) {
              collections.set(collectionId, file);
              continue;
            }

            const shortHash = extractShortHash(mattersUrl);
            if (shortHash) {
              const uid = typeof parsed.frontmatter.uid === "string"
                ? parsed.frontmatter.uid
                : null;
              articles.push({
                shortHash,
                path: file,
                title: (parsed.frontmatter.title as string) || file,
                uid,
              });
            } else {
              // Visible signal rather than a silent drop: an article with a
              // valid Matters syndicated URL whose shortHash can't be parsed
              // will get no comments/social data, and the user would otherwise
              // have no way to know why.
              console.warn(
                `[matters] could not extract shortHash from syndicated URL "${mattersUrl}" (${file}) — skipping social fetch`
              );
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

  return { articles, collections };
}

/**
 * Scan local markdown files for synced Matters articles only.
 * Kept as the stable entry point for the social-data phase (comments are
 * fetched per-article; collection pages must never enter that list).
 */
export async function scanLocalArticles(): Promise<Array<{ shortHash: string; path: string; title: string; uid: string | null }>> {
  return (await scanLocalContent()).articles;
}

/**
 * Parent directory of a project-relative path ("" for root-level files).
 */
function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.substring(0, i);
}

/** Join a project-relative dir ("" = project root) with a filename. */
function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/**
 * The directory holding the plurality of the given paths, or null when the
 * list is empty or tied. Used to locate a previously-synced collection's
 * actual local folder from where its member articles live.
 */
export function majorityParentDir(paths: string[]): string | null {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const dir = parentDir(p);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  let tied = false;
  for (const [dir, n] of counts) {
    if (n > bestN) {
      best = dir;
      bestN = n;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return tied ? null : best;
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
  profile: MattersUserProfile,
  // moss tells us which file it detected as the homepage (e.g., "刘果.md", "index.md").
  // When set, we skip homepage generation — the user already has a home file and the
  // Matters plugin should not create a competing index.md. This uses the same detection
  // logic as moss-core's home::detect_home_file_in_folder(), which considers index stems,
  // self-named folder notes, and alphabetical fallback.
  homepageFile?: string | null,
  // The root folder's basename (e.g. "刘果"), from moss's project_info.folder_name.
  // When we DO generate a home, we name it self-named (`<folder>.md`) with a
  // `home: true` marker to match moss's folder-home convention. Falls back to
  // `index.md` when absent (older hosts that don't supply it).
  folderName?: string | null,
  // Reports per-item sync progress to the unified import task so the hairline
  // advances within the "syncing" band instead of jumping start→end. Optional:
  // direct callers (tests) omit it and the per-item reports no-op.
  onProgress?: ProgressReporter,
): Promise<SyncResultWithMap> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  // Map for internal link rewriting: Matters URL/shortHash → local file path
  const articlePathMap = new Map<string, string>();

  // Get folder names - auto-detect existing folder, else language-derived
  // (Chinese → 文章). Language: authed profile.language → stale config.language
  // → public per-article majority (the only signal in unauthenticated mode). (G)
  const contentLanguage = resolveContentLanguage(
    profile?.language ?? (config as MattersPluginConfig).language,
    articles.map((a) => a.language),
  );
  const articleFolder = await getArticleFolderName(
    config as MattersPluginConfig,
    contentLanguage,
  );
  const folders = {
    article: articleFolder,
    drafts: getDefaultFolderNames().drafts,
  };

  // Build dedup index: shortHash → local file path
  // Catches renamed files that still have a Matters syndicated URL in frontmatter
  const { articles: localArticles, collections: localCollectionFiles } =
    await scanLocalContent();
  const knownShortHashes = new Map<string, string>();
  for (const local of localArticles) {
    knownShortHashes.set(local.shortHash, local.path);
  }

  // Collection ids synced in a previous run (persisted to plugin config after
  // every successful sync). A known collection is NEVER re-created: if the
  // user renamed, moved, or deleted its folder, that local state is
  // authoritative — same "download new content only" model as articles.
  const knownCollectionIds = new Set(
    (await getConfig()).knownCollectionIds ?? [],
  );

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

  // Build article ID → collection memberships mapping.
  // articleCollections stays slug-keyed (slugs are what the `collections:`
  // frontmatter field carries); articleFirstCollection maps to the collection
  // ID so placement can go through the resolved local folder below.
  const articleCollections = new Map<string, Record<string, number>>();
  const articleFirstCollection = new Map<string, string>();
  const collectionSlugById = new Map<string, string>();
  const collectionDirById = new Map<string, string>();

  for (const collection of collections) {
    const collectionSlug = slugify(collection.title);
    collectionSlugById.set(collection.id, collectionSlug);

    // Resolve the collection's ACTUAL local folder: the identity marker wins
    // (exact match, survives any rename); for collections synced in a prior
    // run, fall back to the folder holding the plurality of its member
    // articles. Genuinely new collections always get the computed slug —
    // member location must not hijack them (their members may legitimately
    // live elsewhere, e.g. as standalone articles).
    const markerPath = localCollectionFiles.get(collection.id);
    let localDir: string | null = markerPath !== undefined ? parentDir(markerPath) : null;
    if (localDir === null && knownCollectionIds.has(collection.id)) {
      localDir = majorityParentDir(
        collection.articles
          .map((a) => knownShortHashes.get(a.shortHash))
          .filter((p): p is string => p !== undefined),
      );
    }
    collectionDirById.set(
      collection.id,
      localDir ?? `${folders.article}/${collectionSlug}`,
    );

    for (let i = 0; i < collection.articles.length; i++) {
      const article = collection.articles[i];
      const articleKey = article.shortHash;

      if (!articleCollections.has(articleKey)) {
        articleCollections.set(articleKey, {});
      }
      articleCollections.get(articleKey)![collectionSlug] = i;

      if (!articleFirstCollection.has(articleKey)) {
        articleFirstCollection.set(articleKey, collection.id);
      }
    }
  }

  // Build article shortHash → slug mapping for collection order field
  const articleSlugMap = new Map<string, string>();
  for (const article of articles) {
    const slug = article.slug || slugify(article.title);
    articleSlugMap.set(article.shortHash, slug);
  }

  // ============================================================================
  // Generate Homepage (index.md)
  // ============================================================================
  // Skip if moss already detected a home file (e.g., "刘果.md", "index.md", "readme.md").
  // The homepageFile comes from moss's home file detection (moss-core home.rs), which
  // considers index stems, self-named folder notes, and alphabetical fallback. When a
  // home file exists, the Matters plugin should not create a competing index.md.
  processedItems++;
  onProgress?.("syncing_homepage", overallProgress("syncing_homepage", processedItems, totalItems), 100, "Creating homepage...");

  if (homepageFile) {
    console.log(`   ⏭️  Skipping homepage (moss detected home file: ${homepageFile})`);
    result.skipped++;
  } else {
    try {
      // Self-named home (`<folder>.md`) + `home: true` marker, matching moss's
      // folder-home convention. Falls back to `index.md` when the host didn't
      // tell us the folder name.
      const homeFilename = folderName ? `${folderName}.md` : "index.md";
      const homepageFrontmatter = generateFrontmatter({
        title: folderName ?? profile.displayName,
        home: true,
      });

      let homepageBody = profile.description || "";

      if (profile.pinnedWorks && profile.pinnedWorks.length > 0) {
        const gridItems = profile.pinnedWorks.map((work) => {
          if (work.type === "collection") {
            const slug = slugify(work.title);
            // In file mode, collections are .md files; in folder mode, they
            // are directories. Both link through the RESOLVED local location
            // so a renamed collection folder/file keeps working.
            const markerPath = localCollectionFiles.get(work.id);
            const collectionPath = useFileMode
              ? `/${(markerPath ?? `${folders.article}/${slug}.md`).replace(/\.md$/, "")}`
              : `/${collectionDirById.get(work.id) ?? `${folders.article}/${slug}`}/`;
            return `[${work.title}](${collectionPath})`;
          } else {
            // Article — find its path (standalone or in collection)
            const slug = work.slug || slugify(work.title);
            const shortHash = work.shortHash ?? "";
            const firstCollectionId = articleFirstCollection.get(shortHash);
            const collectionDir = firstCollectionId
              ? collectionDirById.get(firstCollectionId)
              : undefined;
            const path = collectionDir !== undefined
              ? `/${joinPath(collectionDir, slug)}/`
              : `/${folders.article}/${slug}/`;
            return `[${work.title}](${path})`;
          }
        });

        // Cells are separated by moss's canonical `+++` divider; a lone `:::`
        // is the grid CLOSER, so using it between cells prematurely closes the
        // grid and corrupts the homepage (B1). The single trailing `:::` closes.
        homepageBody += "\n\n:::grid 3\n" + gridItems.join("\n+++\n") + "\n:::\n";
      }

      const homepageContent = homepageFrontmatter + "\n\n" + homepageBody;

      // Don't overwrite an existing home. moss's homepageFile check (above) already
      // covers homes it detected; this is the on-disk backstop for the self-named
      // target and a legacy index.md.
      let existingHomepage: string | null = null;
      let existingPath = "";
      for (const candidate of [homeFilename, "index.md"]) {
        try {
          existingHomepage = await readFile(candidate);
        } catch {
          existingHomepage = null;
        }
        if (existingHomepage !== null) {
          existingPath = candidate;
          break;
        }
      }

      if (existingHomepage !== null) {
        console.log(`   ⏭️  Skipping homepage (already exists): ${existingPath}`);
        result.skipped++;
      } else {
        await writeFile(homeFilename, homepageContent);
        console.log(`   ✅ Created homepage: ${homeFilename}`);
        result.created++;
      }
    } catch (error) {
      const errorMsg = `Failed to create homepage: ${error}`;
      await reportError(errorMsg, "syncing_homepage", false);
      console.error(`   ❌ ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  // Fetch project tree once for home-file detection in collection folders
  const projectTree = await listProjectTree();

  // Process collections
  for (const collection of collections) {
    processedItems++;
    onProgress?.(
      "syncing_collections",
      overallProgress("syncing_collections", processedItems, totalItems),
      100,
      `Syncing collection: ${collection.title}`
    );

    try {
      const collectionSlug = slugify(collection.title);

      // Identity gates — a collection that exists locally under ANY name
      // (identity marker in `syndicated:`) or that was synced in a previous
      // run (id persisted to plugin config) is never re-created. The user's
      // local rename/move/delete is authoritative; path-based existence
      // checks below can't see renames.
      const markerPath = localCollectionFiles.get(collection.id);
      if (markerPath !== undefined) {
        console.log(`   ⏭️  Skipping collection (exists locally as: ${markerPath})`);
        result.skipped++;
        continue;
      }
      if (knownCollectionIds.has(collection.id)) {
        console.log(`   ⏭️  Skipping collection (synced previously): ${collection.title}`);
        result.skipped++;
        continue;
      }

      // Determine path based on mode
      // All collections live under the article/ folder
      const collectionPath = useFileMode
        ? `${folders.article}/${collectionSlug}.md`  // File mode: collection as .md file
        : `${folders.article}/${collectionSlug}/${collectionSlug}.md`;  // Folder mode: self-named folder home

      // In folder mode, skip if the folder already has a home file (self-named note, etc.)
      if (!useFileMode) {
        const folderPrefix = `${folders.article}/${collectionSlug}/`;
        const homeInFolder = projectTree.find(
          (f) => f.path.startsWith(folderPrefix) && f.is_home
        );
        if (homeInFolder) {
          console.log(`   ⏭️  Skipping collection index (folder has home file: ${homeInFolder.path})`);
          result.skipped++;
          continue;
        }
      }

      let existingContent: string | null = null;
      try {
        existingContent = await readFile(collectionPath);
      } catch {
        // File doesn't exist
      }

      // Build order field for collections (list of article slugs/paths)
      let orderField: string[] | undefined;
      if (collection.articles.length > 0) {
        if (useFileMode) {
          // File mode: full paths relative to project root
          orderField = collection.articles
            .map((a) => {
              const slug = articleSlugMap.get(a.shortHash);
              return slug ? `${folders.article}/${slug}` : null;
            })
            .filter((s): s is string => s !== null);
        } else {
          // Folder mode: bare slugs (articles are inside the collection folder)
          orderField = collection.articles
            .map((a) => articleSlugMap.get(a.shortHash) ?? null)
            .filter((s): s is string => s !== null);
        }
      }

      const frontmatter = generateFrontmatter({
        title: collection.title,
        // A folder-mode collection's landing page IS that folder's home.
        // (File-mode collections are plain `.md` pages, not folder homes.)
        home: !useFileMode,
        description: collection.description,
        cover: collection.cover,  // Keep remote URL, will be downloaded in phase 2
        order: orderField,
        // Identity marker: lets future syncs recognize this collection under
        // any local name (mirrors the article `syndicated:` dedup mechanism).
        syndicated: [collectionUrl(userName, collection.id)],
      });

      const fullContent = `${frontmatter}\n\n${collection.description || ""}`;

      if (existingContent !== null) {
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
    onProgress?.(
      "syncing_articles",
      overallProgress("syncing_articles", processedItems, totalItems),
      100,
      `Syncing article: ${article.title}`
    );

    try {
      const articleSlug = article.slug || slugify(article.title);
      const mattersUrl = articleUrl(userName, article.slug, article.shortHash);

      // Determine file location based on mode and collection membership
      // All articles live under the article/ folder
      let filename: string;
      if (useFileMode) {
        // File mode: all articles directly under article/, collections via frontmatter
        filename = `${folders.article}/${articleSlug}.md`;
      } else {
        // Folder mode: articles in their first collection's RESOLVED local
        // folder (survives a locally-renamed collection folder)
        const firstCollectionId = articleFirstCollection.get(article.shortHash);
        const collectionDir = firstCollectionId
          ? collectionDirById.get(firstCollectionId)
          : undefined;
        if (collectionDir !== undefined) {
          filename = joinPath(collectionDir, `${articleSlug}.md`);
        } else {
          // Standalone articles (not in any collection) go directly under article/
          filename = `${folders.article}/${articleSlug}.md`;
        }
      }

      // Check if article already exists locally (even under a different filename)
      const existingLocalPath = knownShortHashes.get(article.shortHash);
      if (existingLocalPath) {
        // Article exists locally — use actual path for link rewriting
        articlePathMap.set(mattersUrl, existingLocalPath);
        articlePathMap.set(article.shortHash, existingLocalPath);
        console.log(`   ⏭️  Skipping (already synced): ${existingLocalPath}`);
        result.skipped++;
        continue;
      }

      // New article — map the computed filename for link rewriting
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
        const firstId = articleFirstCollection.get(article.shortHash);
        const firstCollectionSlug = firstId ? collectionSlugById.get(firstId) : undefined;
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

      // Convert HTML to Markdown via moss's shared htmd converter (keep remote
      // URLs; downloaded + rewritten to wikilinks in phase 2)
      const markdownContent = await htmlToMarkdown(article.content);

      const frontmatter = generateFrontmatter({
        title: article.title,
        description: article.summary,
        date: article.createdAt,
        updated: article.revisedAt,
        // Matters tag strings can carry leading/trailing whitespace (e.g.
        // `"React "`). Trim each and drop any that collapse to empty so the
        // frontmatter `tags:` list is clean (B10).
        tags: article.tags
          .map((t) => t.content.trim())
          .filter((t) => t.length > 0),
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

  // Process drafts (permanently disabled — see shouldSyncDrafts() doc comment)
  if (shouldSyncDrafts()) {
    for (const draft of drafts) {
      processedItems++;
      const draftTitle = draft.title || "Untitled";
      onProgress?.(
        "syncing_drafts",
        overallProgress("syncing_drafts", processedItems, totalItems),
        100,
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
        const markdownContent = await htmlToMarkdown(draft.content);

        const frontmatter = generateFrontmatter({
          title: draft.title || "Untitled Draft",
          date: draft.createdAt,
          updated: draft.updatedAt,
          // Trim + drop empties, same as the published-article path (B10).
          tags: (draft.tags || [])
            .map((t) => t.trim())
            .filter((t) => t.length > 0),
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
