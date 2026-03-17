/**
 * Review Plugin for moss
 *
 * process hook (pre-build):
 *   Reads article-map.json, finds pages with review_of: frontmatter,
 *   fetches metadata from NeoDB/Douban/TMDB/Goodreads, downloads covers,
 *   writes .moss/social/review.json.
 *
 * enhance (slot content):
 *   Declares CSS and per-page review colophons for template injection.
 */

import { readFile, writeFile, readPluginFile, downloadAsset, type EnhanceContext, type EnhanceResult, type EnhanceContent } from "@symbiosis-lab/moss-api";
import { fetchReviewItem } from "./fetch";
import { detectSource } from "./sources";
import { loadReviewSocialData, saveReviewSocialData, upsertReviewEntry } from "./social-writer";
import { renderColophon } from "./render";
import type {
  ProcessContext,
  HookResult,
  ArticleMap,
  ReviewSocialEntry,
} from "./types";

const REVIEW_CSS_FILENAME = "review.css";

// 24-hour cache TTL in milliseconds
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Frontmatter parsing (minimal — just extract review_of + rating)
// ============================================================================

interface ParsedFrontmatter {
  review_of?: string;
  rating?: number;
  cover?: string;
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: ParsedFrontmatter = {};

  const reviewOfMatch = yaml.match(/^review_of:\s*(.+)$/m);
  if (reviewOfMatch) {
    result.review_of = reviewOfMatch[1].trim().replace(/^["']|["']$/g, "");
  }

  const ratingMatch = yaml.match(/^rating:\s*(.+)$/m);
  if (ratingMatch) result.rating = parseFloat(ratingMatch[1].trim());

  const coverMatch = yaml.match(/^cover:\s*(.+)$/m);
  if (coverMatch) result.cover = coverMatch[1].trim().replace(/^["']|["']$/g, "");

  return result;
}

// ============================================================================
// Frontmatter update (boundary-aware)
// ============================================================================

/**
 * Update or insert a `cover:` field in the markdown frontmatter.
 * Uses boundary-aware replacement: finds `---` delimiters, modifies only
 * the frontmatter section, leaves the body untouched byte-for-byte.
 *
 * Returns the updated markdown, or null if no frontmatter block was found.
 */
export function updateFrontmatterCover(markdown: string, coverPath: string): string | null {
  const fmMatch = markdown.match(/^(---\n)([\s\S]*?\n)(---)/);
  if (!fmMatch) return null;

  const opening = fmMatch[1]; // "---\n"
  const yaml = fmMatch[2];    // frontmatter content (ends with \n)
  const closing = fmMatch[3]; // "---"
  const body = markdown.slice(fmMatch[0].length); // everything after closing ---

  let updatedYaml: string;
  if (/^cover:\s/m.test(yaml)) {
    // Replace existing cover line
    updatedYaml = yaml.replace(/^cover:\s.*$/m, `cover: ${coverPath}`);
  } else {
    // Insert cover after opening --- (prepend to yaml block)
    updatedYaml = `cover: ${coverPath}\n${yaml}`;
  }

  return opening + updatedYaml + closing + body;
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
// Adaptive cover directory detection
// ============================================================================

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"]);

/**
 * Scan the article-map to find the most common image directory used for covers.
 * Falls back to "assets/covers" if no pattern is found.
 *
 * This lets the plugin download covers to the same directory the user already
 * uses for their images, rather than creating a new directory convention.
 */
export function detectCoverDirectory(articleMap: { articles: Record<string, any> }): string {
  const dirCounts: Record<string, number> = {};

  for (const entry of Object.values(articleMap.articles)) {
    const cover: string | undefined = entry.frontmatter?.cover;
    if (!cover || cover.startsWith("http://") || cover.startsWith("https://")) continue;

    const ext = cover.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXTS.has(ext)) continue;

    const dir = cover.includes("/") ? cover.substring(0, cover.lastIndexOf("/")) : ".";
    dirCounts[dir] = (dirCounts[dir] || 0) + 1;
  }

  let bestDir = "assets/covers";
  let bestCount = 0;
  for (const [dir, count] of Object.entries(dirCounts)) {
    if (count > bestCount) {
      bestDir = dir;
      bestCount = count;
    }
  }

  return bestDir;
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

  // 2. Detect where the user stores cover images
  const coverDir = detectCoverDirectory(articleMap as any);

  // 3. Load existing social data
  const socialData = await loadReviewSocialData();

  // 3. For each article, check if it has review_of frontmatter
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
    if (!fm.review_of) continue;

    const uid = entry.uid;
    const existingEntry = socialData.articles[uid];

    // Check cache: skip if URL unchanged and fetched within TTL
    if (existingEntry && existingEntry.source_url === fm.review_of && existingEntry.fetched_at) {
      const age = Date.now() - new Date(existingEntry.fetched_at).getTime();
      if (age < CACHE_TTL_MS) {
        // Still update writer_rating if changed
        if (fm.rating !== undefined && existingEntry.writer_rating !== fm.rating) {
          existingEntry.writer_rating = fm.rating;
        }
        continue;
      }
    }

    // 4. Fetch from detected source
    const item = await fetchReviewItem(fm.review_of, ctx.config);
    if (!item) {
      // Network error — use cached data if available
      if (existingEntry) {
        if (fm.rating !== undefined) existingEntry.writer_rating = fm.rating;
        continue;
      }
      console.log(`[warn] Review: Failed to fetch ${fm.review_of}, no cache available`);
      continue;
    }

    // 5. Build social entry
    const reviewEntry: ReviewSocialEntry = {
      source_url: fm.review_of,
      source: item.source,
      category: item.category,
      title: item.title,
      subtitle: item.subtitle,
      creator: item.creator,
      year: item.year,
      publisher: item.publisher,
      pages: item.pages,
      isbn: item.isbn,
      community_rating: item.rating,
      community_rating_count: item.rating_count,
      external_urls: item.external_urls,
      writer_rating: fm.rating ?? null,
      fetched_at: new Date().toISOString(),
    };

    // 6. Download cover image and update frontmatter
    if (item.cover_image_url && !fm.cover) {
      try {
        const dlResult = await downloadAsset(item.cover_image_url, coverDir);
        if (dlResult.ok && dlResult.actualPath) {
          // Update frontmatter with local cover path
          const updated = updateFrontmatterCover(markdown, dlResult.actualPath);
          if (updated) {
            await writeFile(sourcePath, updated);
          }
        }
      } catch (err) {
        console.log(`[warn] Review: Failed to download cover for "${item.title}": ${err}`);
        // Continue with remote URL — non-fatal
      }
    }

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
// Content Slots
// ============================================================================

/**
 * enhance - Declare content for template slots.
 *
 * Returns:
 * - "head-end": static CSS for review colophon
 * - "after-title": per-page review colophons (cover, rating, biblio, links)
 */
export async function enhance(ctx: EnhanceContext): Promise<EnhanceResult> {
  const slots: Record<string, EnhanceContent> = {};

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

  // 3. Build uid->urlPath and uid->cover maps from article_map in context
  const articleMap = ctx.article_map as { articles?: Record<string, { url_path: string; uid?: string; frontmatter?: Record<string, any> }> } | undefined;
  const articles = articleMap?.articles || {};

  const uidToUrl = new Map<string, string>();
  const uidToCover = new Map<string, string>();
  for (const [_key, entry] of Object.entries(articles)) {
    if (entry.uid && entry.url_path) {
      uidToUrl.set(entry.uid, entry.url_path);
    }
    if (entry.uid && entry.frontmatter?.cover) {
      const cover = entry.frontmatter.cover as string;
      if (!cover.startsWith("http://") && !cover.startsWith("https://")) {
        uidToCover.set(entry.uid, cover);
      }
    }
  }

  // 4. Build per-page colophon HTML
  const colophonPages: Record<string, string> = {};

  for (const [uid, entry] of Object.entries(socialData.articles)) {
    const urlPath = uidToUrl.get(uid);
    if (!urlPath) continue;

    const coverUrl = uidToCover.get(uid) ?? null;

    const colophonHtml = renderColophon(entry, coverUrl);
    if (colophonHtml) {
      colophonPages[urlPath] = colophonHtml;
    }
  }

  if (Object.keys(colophonPages).length > 0) {
    slots["after-title"] = { type: "per-page", pages: colophonPages };
  }

  return { success: true, slots };
}
