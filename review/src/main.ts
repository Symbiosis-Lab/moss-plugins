/**
 * Review Plugin for moss
 *
 * process hook (pre-build):
 *   Reads article-map.json, finds pages with neodb: frontmatter,
 *   fetches metadata from NeoDB, downloads covers, writes .moss/social/review.json.
 *
 * enhance hook (post-build):
 *   Reads review.json, injects book header after <h1> and colophon before </article>.
 */

import { readFile, writeFile, readPluginFile, type SlotContext, type SlotResult, type SlotContent } from "@symbiosis-lab/moss-api";
import { fetchNeoDBItem } from "./neodb";
import { loadReviewSocialData, saveReviewSocialData, upsertReviewEntry } from "./social-writer";
import { renderHeader, renderColophon } from "./render";
import { injectAfterH1, injectBeforeArticleEnd, injectCssInHead } from "./inject";
import type {
  ProcessContext,
  EnhanceContext,
  HookResult,
  EnhanceResult,
  ModifiedFile,
  ArticleMap,
  ReviewSocialEntry,
} from "./types";

const REVIEW_CSS_FILENAME = "review.css";

// 24-hour cache TTL in milliseconds
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Frontmatter parsing (minimal — just extract neodb + rating)
// ============================================================================

interface ParsedFrontmatter {
  neodb?: string;
  rating?: number;
  cover?: string;
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: ParsedFrontmatter = {};

  const neodbMatch = yaml.match(/^neodb:\s*(.+)$/m);
  if (neodbMatch) result.neodb = neodbMatch[1].trim().replace(/^["']|["']$/g, "");

  const ratingMatch = yaml.match(/^rating:\s*(.+)$/m);
  if (ratingMatch) result.rating = parseFloat(ratingMatch[1].trim());

  const coverMatch = yaml.match(/^cover:\s*(.+)$/m);
  if (coverMatch) result.cover = coverMatch[1].trim().replace(/^["']|["']$/g, "");

  return result;
}

// ============================================================================
// Source path derivation
// ============================================================================

/**
 * Returns source_path if non-empty, otherwise derives from url_path.
 * e.g. "文字/书评/seeing-like-a-state/" → "文字/书评/seeing-like-a-state.md"
 */
function deriveSourcePath(sourcePath: string, urlPath: string): string | null {
  if (sourcePath) return sourcePath;
  if (!urlPath) return null;
  // Strip trailing slash, append .md
  const trimmed = urlPath.replace(/\/+$/, "");
  if (!trimmed) return null;
  return trimmed + ".md";
}

// ============================================================================
// Process Hook
// ============================================================================

export async function process(ctx: ProcessContext): Promise<HookResult> {
  console.log("[info] Review: Starting process hook...");

  // 1. Read article-map.json
  let articleMap: ArticleMap;
  try {
    const content = await readFile(".moss/article-map.json");
    articleMap = JSON.parse(content) as ArticleMap;
  } catch {
    console.log("[info] Review: No article map found (first build?), skipping");
    return { success: true, message: "No article map found, skipping" };
  }

  if (!articleMap.articles) {
    return { success: true, message: "No article map found, skipping" };
  }

  // 2. Load existing social data
  const socialData = await loadReviewSocialData();

  // 3. For each article, check if it has neodb frontmatter
  let fetchCount = 0;

  for (const [_key, entry] of Object.entries(articleMap.articles)) {
    if (!entry.uid) continue;

    const sourcePath = deriveSourcePath(entry.source_path, entry.url_path);
    if (!sourcePath) continue;

    let markdown: string;
    try {
      markdown = await readFile(sourcePath);
    } catch {
      continue;
    }

    const fm = parseFrontmatter(markdown);
    if (!fm.neodb) continue;

    const uid = entry.uid;
    const existingEntry = socialData.articles[uid];

    // Check cache: skip if URL unchanged and fetched within TTL
    if (existingEntry && existingEntry.neodb_url === fm.neodb && existingEntry.fetched_at) {
      const age = Date.now() - new Date(existingEntry.fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        // Still update writer_rating if changed
        if (fm.rating !== undefined && existingEntry.writer_rating !== fm.rating) {
          existingEntry.writer_rating = fm.rating;
        }
        continue;
      }
    }

    // 4. Fetch from NeoDB
    const item = await fetchNeoDBItem(fm.neodb);
    if (!item) {
      // Network error — use cached data if available
      if (existingEntry) {
        if (fm.rating !== undefined) existingEntry.writer_rating = fm.rating;
        continue;
      }
      console.log(`[warn] Review: Failed to fetch ${fm.neodb}, no cache available`);
      continue;
    }

    // 5. Build social entry
    const reviewEntry: ReviewSocialEntry = {
      neodb_url: fm.neodb,
      category: item.category,
      title: item.title,
      creator: item.creator,
      year: item.year,
      publisher: item.publisher,
      pages: item.pages,
      isbn: item.isbn,
      community_rating: item.rating,
      community_rating_count: item.rating_count,
      cover_url: item.cover_image_url,
      external_urls: item.external_urls,
      writer_rating: fm.rating ?? null,
      fetched_at: new Date().toISOString(),
    };

    upsertReviewEntry(socialData, uid, reviewEntry);
    fetchCount++;
  }

  // 7. Save
  try {
    await saveReviewSocialData(socialData);
    console.log(`[info] Review: Processed ${fetchCount} review(s)`);
  } catch (error) {
    return { success: false, message: `Failed to save review data: ${error}` };
  }

  return { success: true, message: `Processed ${fetchCount} review(s)` };
}

// ============================================================================
// Enhance Hook
// ============================================================================

/** Convert file path to URL path (same logic as comment plugin) */
function filePathToUrlPath(filePath: string): string {
  let p = filePath.replace(/\.html$/, "");
  if (p.endsWith("/index") || p === "index") {
    p = p.replace(/\/?index$/, "");
    return p ? p + "/" : "";
  }
  return p;
}

export async function enhance(ctx: EnhanceContext): Promise<EnhanceResult> {
  console.log("[info] Review: Starting enhance hook...");

  // 1. Read CSS
  let reviewCss = "";
  try {
    reviewCss = await readPluginFile(REVIEW_CSS_FILENAME);
  } catch {
    console.log("[warn] Review: Could not read CSS file");
  }

  // 2. Load social data
  let socialData;
  try {
    socialData = await loadReviewSocialData();
  } catch {
    return { success: true, message: "No review data found", modified: [] };
  }

  // 3. Build uid→urlPath map from article-map
  const uidToUrl = new Map<string, string>();
  const urlToUid = new Map<string, string>();
  try {
    const mapContent = await readFile(".moss/article-map.json");
    const articleMap = JSON.parse(mapContent) as ArticleMap;
    if (articleMap.articles) {
      for (const [_key, entry] of Object.entries(articleMap.articles)) {
        if (entry.uid) {
          uidToUrl.set(entry.uid, entry.url_path);
          urlToUid.set(entry.url_path, entry.uid);
        }
      }
    }
  } catch {
    return { success: true, message: "No article map, skipping enhance", modified: [] };
  }

  // 4. Transform files
  const modified: ModifiedFile[] = [];

  for (const file of ctx.files) {
    const urlPath = filePathToUrlPath(file.path);
    const uid = urlToUid.get(urlPath);
    if (!uid) continue;

    const entry = socialData.articles[uid];
    if (!entry) continue;

    // Skip if already injected (idempotent)
    if (file.html.includes('class="review-header"') || file.html.includes('class="review-colophon"')) {
      continue;
    }

    let html = file.html;

    // Inject header after <h1>
    const headerHtml = renderHeader(entry);
    if (headerHtml) {
      const injected = injectAfterH1(html, headerHtml);
      if (injected) html = injected;
    }

    // Inject colophon before </article>
    const colophonHtml = renderColophon(entry);
    if (colophonHtml) {
      const injected = injectBeforeArticleEnd(html, colophonHtml);
      if (injected) html = injected;
    }

    // Inject CSS
    if (reviewCss && html !== file.html) {
      html = injectCssInHead(html, reviewCss);
    }

    if (html !== file.html) {
      modified.push({ path: file.path, html });
    }
  }

  console.log(`[info] Review: Enhanced ${modified.length} page(s)`);
  return { success: true, message: `Enhanced ${modified.length} page(s)`, modified };
}

// ============================================================================
// Content Slots
// ============================================================================

/**
 * getSlotContent - Declare content for template slots.
 *
 * Returns:
 * - "head-end": static CSS for review header/colophon
 * - "after-title": per-page review headers (cover + creator + year)
 * - "before-article-end": per-page review colophons (rating, biblio, links)
 */
export async function getSlotContent(ctx: SlotContext): Promise<SlotResult> {
  const slots: Record<string, SlotContent> = {};

  // 1. Read CSS
  let reviewCss = "";
  try {
    reviewCss = await readPluginFile(REVIEW_CSS_FILENAME);
  } catch {
    // CSS file not found
  }

  if (reviewCss) {
    slots["head-end"] = { type: "static", html: `<style class="moss-review-style">${reviewCss}</style>` };
  }

  // 2. Load social data
  let socialData;
  try {
    socialData = await loadReviewSocialData();
  } catch {
    return { success: true, slots };
  }

  // 3. Build uid->urlPath map from article_map in context
  const articleMap = ctx.article_map as { articles?: Record<string, { url_path: string; uid?: string }> } | undefined;
  const articles = articleMap?.articles || {};

  const uidToUrl = new Map<string, string>();
  for (const [_key, entry] of Object.entries(articles)) {
    if (entry.uid && entry.url_path) {
      uidToUrl.set(entry.uid, entry.url_path);
    }
  }

  // 4. Build per-page header and colophon HTML
  const headerPages: Record<string, string> = {};
  const colophonPages: Record<string, string> = {};

  for (const [uid, entry] of Object.entries(socialData.articles)) {
    const urlPath = uidToUrl.get(uid);
    if (!urlPath) continue;

    const headerHtml = renderHeader(entry);
    if (headerHtml) {
      headerPages[urlPath] = headerHtml;
    }

    const colophonHtml = renderColophon(entry);
    if (colophonHtml) {
      colophonPages[urlPath] = colophonHtml;
    }
  }

  if (Object.keys(headerPages).length > 0) {
    slots["after-title"] = { type: "per-page", pages: headerPages };
  }

  if (Object.keys(colophonPages).length > 0) {
    slots["before-article-end"] = { type: "per-page", pages: colophonPages };
  }

  return { success: true, slots };
}
