/**
 * Comment Plugin for moss
 *
 * Main entry point. Provides:
 *
 * process hook (pre-build):
 *   Fetches comments from configured server (Waline or Artalk)
 *   and writes them to .moss/social/comment.json keyed by content uid.
 *
 * getSlotContent (slot content):
 *   Declares CSS and per-page comment section HTML for template injection.
 */

import { readFile, readPluginFile, type SlotContext, type SlotResult, type SlotContent } from "@symbiosis-lab/moss-api";
import { loadAllComments } from "./social-reader";
import { renderCommentSection } from "./render";
import { getSubmitScriptBuilder } from "./providers";
import { fetchWalineComments, fetchAllArtalkComments, detectProvider } from "./fetcher";
import { parseLang, type Lang } from "./i18n";
import {
  loadCommentSocialData,
  saveCommentSocialData,
  mergeCommentSocialData,
} from "./social-writer";
import type {
  ProcessContext,
  HookResult,
  NormalizedComment,
  ArticleMap,
} from "./types";

const COMMENTS_CSS_FILENAME = "moss-comments.css";

// ============================================================================
// Process Hook
// ============================================================================

/**
 * Process hook - fetch comments from server before build.
 *
 * Reads article-map.json from the previous build to get content uids,
 * then fetches comments from the configured server for each page.
 * Results are written to .moss/social/comment.json keyed by uid.
 *
 * On first build (no article-map.json), gracefully skips.
 */
export async function process(ctx: ProcessContext): Promise<HookResult> {
  console.log("[info] Comment: Starting process hook...");

  const config = ctx.config || {};
  const serverUrl = (config.server_url as string) || "";
  const siteName = (config.site_name as string) || ctx.project_info.site_name || "";

  // 1. If no server_url, skip (nothing to fetch)
  if (!serverUrl) {
    console.log(
      "[info] Comment: No server_url configured, skipping comment fetch"
    );
    return {
      success: true,
      message: "No server_url configured, skipping comment fetch",
    };
  }

  // 2. Read article-map.json from previous build
  let articleMap: ArticleMap;
  try {
    const content = await readFile(".moss/article-map.json");
    articleMap = JSON.parse(content) as ArticleMap;
  } catch {
    console.log(
      "[info] Comment: No article map found (first build?), skipping comment fetch"
    );
    return {
      success: true,
      message: "No article map found (first build?), skipping comment fetch",
    };
  }

  if (!articleMap.articles) {
    console.log("[info] Comment: Article map has no articles, skipping");
    return {
      success: true,
      message: "No article map found (first build?), skipping comment fetch",
    };
  }

  // 3. Collect pages with uids
  const pagesWithUids: Array<{ urlPath: string; uid: string }> = [];
  for (const [_key, entry] of Object.entries(articleMap.articles)) {
    if (entry.uid) {
      pagesWithUids.push({ urlPath: entry.url_path, uid: entry.uid });
    }
  }

  if (pagesWithUids.length === 0) {
    console.log("[info] Comment: No pages with uids found, skipping");
    return {
      success: true,
      message: "Fetched comments for 0 pages (no uids)",
    };
  }

  // 3b. Auto-detect provider from server
  const providerName = await detectProvider(serverUrl);

  console.log(
    `[info] Comment: Fetching comments for ${pagesWithUids.length} pages from ${providerName} at ${serverUrl}`
  );

  // 4. Load existing social data
  const socialData = await loadCommentSocialData();

  // 5. Fetch comments and merge
  let totalComments = 0;

  if (providerName === "artalk") {
    // Artalk: batch fetch all comments via stats endpoint
    console.log(`[info] Comment: Fetching all comments for site "${siteName}"...`);
    const allComments = await fetchAllArtalkComments(serverUrl, siteName);

    for (const { uid } of pagesWithUids) {
      const comments = allComments.get(uid) || [];
      if (comments.length > 0) {
        mergeCommentSocialData(socialData, uid, comments);
        totalComments += comments.length;
      }
    }
  } else {
    // Waline: fetch per page (no batch API)
    for (const { uid } of pagesWithUids) {
      try {
        const comments = await fetchWalineComments(serverUrl, uid);
        if (comments.length > 0) {
          mergeCommentSocialData(socialData, uid, comments);
          totalComments += comments.length;
        }
      } catch (error) {
        console.log(
          `[warn] Comment: Failed to fetch comments for uid=${uid}: ${error}`
        );
      }
    }
  }

  // 6. Write social data (even if no new comments, to update timestamp)
  try {
    await saveCommentSocialData(socialData);
    console.log(
      `[info] Comment: Saved ${totalComments} comments for ${pagesWithUids.length} pages`
    );
  } catch (error) {
    console.log(`[warn] Comment: Failed to save social data: ${error}`);
    return {
      success: false,
      message: `Failed to save comment data: ${error}`,
    };
  }

  return {
    success: true,
    message: `Fetched comments for ${pagesWithUids.length} pages (${totalComments} comments)`,
  };
}

// ============================================================================
// Content Slots
// ============================================================================

/**
 * getSlotContent - Declare content for template slots.
 *
 * Returns:
 * - "head-end": static CSS for comment sections
 * - "before-article-end": per-page comment section HTML keyed by URL path
 */
export async function getSlotContent(ctx: SlotContext): Promise<SlotResult> {
  const config = ctx.config || {};
  const serverUrl = (config.server_url as string) || "";
  const siteName = (config.site_name as string) || ctx.project_info.site_name || "";
  const defaultComments = config.default_comments !== false;
  const providerName = serverUrl ? await detectProvider(serverUrl) : "waline";
  const buildScript = getSubmitScriptBuilder(providerName);

  const slots: Record<string, SlotContent> = {};

  // 1. Read CSS
  let commentsCss = "";
  try {
    commentsCss = await readPluginFile(COMMENTS_CSS_FILENAME);
  } catch {
    // CSS file not found
  }

  if (commentsCss) {
    slots["head-end"] = { type: "static", html: `<style class="moss-comments-style">${commentsCss}</style>` };
  }

  // 2. Load comments from .moss/social/*.json
  const commentsByKey = await loadAllComments(["comment"]);

  // 3. Build uid/path mappings from article_map in context
  const articleMap = ctx.article_map as { articles?: Record<string, { source_path?: string; url_path: string; uid?: string }> } | undefined;
  const articles = articleMap?.articles || {};

  const uidToUrl = new Map<string, string>();
  const urlToUid = new Map<string, string>();
  const sourceToUrl = new Map<string, string>();

  // Get project_path for source path stripping
  const win = globalThis.window || globalThis;
  const projectPath: string | undefined = (win as any).__MOSS_INTERNAL_CONTEXT__?.project_path;
  let prefix = projectPath || "";
  if (prefix && !prefix.endsWith("/")) prefix += "/";

  for (const [_key, entry] of Object.entries(articles)) {
    if (entry.uid && entry.url_path) {
      uidToUrl.set(entry.uid, entry.url_path);
      urlToUid.set(entry.url_path, entry.uid);
    }
    if (entry.source_path && entry.url_path) {
      let relativePath = entry.source_path;
      if (prefix && relativePath.startsWith(prefix)) {
        relativePath = relativePath.slice(prefix.length);
      } else {
        relativePath = relativePath.replace(/^\//, "");
      }
      sourceToUrl.set(relativePath, entry.url_path);
    }
  }

  // 4. Resolve comments by page URL
  const commentsByPage = new Map<string, NormalizedComment[]>();
  for (const [key, comments] of commentsByKey) {
    const urlPath = uidToUrl.get(key) || sourceToUrl.get(key);
    if (urlPath) {
      const existing = commentsByPage.get(urlPath) || [];
      existing.push(...comments);
      commentsByPage.set(urlPath, existing);
    }
  }

  // 5. Build set of pages that should have comment forms
  const pagesWithForms = new Set<string>();
  if (serverUrl) {
    for (const v of uidToUrl.values()) pagesWithForms.add(v);
    for (const v of sourceToUrl.values()) pagesWithForms.add(v);
  }

  // 6. Build per-page comment section HTML
  const pages: Record<string, string> = {};

  for (const urlPath of new Set([...commentsByPage.keys(), ...pagesWithForms])) {
    const comments = commentsByPage.get(urlPath) || [];
    const uid = urlToUid.get(urlPath) || "";

    // Respect default_comments setting
    if (!defaultComments && comments.length === 0 && !pagesWithForms.has(urlPath)) continue;

    // Detect lang from project_info
    const lang = parseLang(`<html lang="${ctx.project_info.lang || "en"}">`);

    const submitScript = (buildScript && serverUrl)
      ? buildScript(serverUrl, "/" + urlPath, uid, siteName, lang)
      : "";

    const commentHtml = renderCommentSection(
      comments,
      urlPath,
      serverUrl,
      submitScript,
      providerName,
      lang,
    );

    if (commentHtml) {
      pages[urlPath] = commentHtml;
    }
  }

  if (Object.keys(pages).length > 0) {
    slots["before-article-end"] = { type: "per-page", pages };
  }

  return { success: true, slots };
}

