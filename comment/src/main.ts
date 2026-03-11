/**
 * Comment Plugin for moss
 *
 * Main entry point. Provides:
 *
 * process hook (pre-build):
 *   Fetches comments from configured server (Waline or Artalk)
 *   and writes them to .moss/social/comment.json keyed by content uid.
 *
 * enhance hook (post-build):
 *   1. Reads comments from all JSON files in .moss/social/
 *   2. Reads .moss/article-map.json for source->output path mapping
 *   3. Renders a minimal comment section (author, date, text)
 *   4. Injects the section before </article> in each page
 *   5. Inlines CSS via <style> in each page's <head>
 */

import { readFile, readPluginFile, type SlotContext, type SlotResult, type SlotContent } from "@symbiosis-lab/moss-api";
import { loadAllComments, buildSourceToUrlMap, buildUidToUrlMap } from "./social-reader";
import { renderCommentSection } from "./render";
import { findInsertionPoint, injectCommentSection, injectCssStyle } from "./inject";
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
  EnhanceContext,
  HookResult,
  EnhanceResult,
  ModifiedFile,
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
// Enhance Hook
// ============================================================================

/**
 * Convert a site-relative file path to a URL path.
 *
 * "articles/foo/index.html"   → "articles/foo/"
 * "articles/foo/index-2.html" → "articles/foo/index-2"
 * "index.html"                → ""
 */
export function filePathToUrlPath(filePath: string): string {
  // Remove .html extension
  let p = filePath.replace(/\.html$/, "");
  // If ends with /index or is exactly "index", it's a directory index → trailing slash
  if (p.endsWith("/index") || p === "index") {
    p = p.replace(/\/?index$/, "");
    return p ? p + "/" : "";
  }
  // Otherwise it's a non-index page (like index-2)
  return p;
}

/**
 * Transform a single HTML string: inject comments if applicable.
 * Pure function — no I/O.
 *
 * Returns the modified HTML string, or null if no changes were made.
 */
function transformHtml(
  html: string,
  urlPath: string,
  comments: NormalizedComment[],
  serverUrl: string,
  buildScript: ((serverUrl: string, pagePath: string, uid: string, siteName?: string, lang?: Lang) => string) | null,
  providerName: string,
  siteName: string,
  uid: string,
  defaultComments: boolean,
  css: string
): string | null {
  // Check explicit opt-in/opt-out attributes
  const hasExplicitTrue = html.includes('data-comments="true"');
  const hasExplicitFalse = html.includes('data-comments="false"');

  // Explicit opt-out always wins
  if (hasExplicitFalse) return null;

  // If default is off and no explicit opt-in, skip
  if (!defaultComments && !hasExplicitTrue) return null;

  // Skip if already injected (idempotent on re-compile)
  if (html.includes('class="moss-comments"')) {
    return null;
  }

  // Check if this page has an article structure
  if (findInsertionPoint(html) === -1) {
    return null;
  }

  // Detect language from the HTML file for i18n
  const lang = parseLang(html);

  // Build the submit script if we have a server
  // Pass uid so the client-side form uses it as the page key
  // Pass lang so the client-side JS uses i18n strings
  const submitScript = (buildScript && serverUrl)
    ? buildScript(serverUrl, "/" + urlPath, uid, siteName, lang)
    : "";

  // Render the comment section
  const commentHtml = renderCommentSection(
    comments,
    urlPath,
    serverUrl,
    submitScript,
    providerName,
    lang
  );

  // renderCommentSection returns "" if nothing to render
  if (!commentHtml) return null;

  // Inject before </article>
  const injected = injectCommentSection(html, commentHtml);
  if (!injected) return null;

  // Inject inline CSS in <head>
  const result = css ? injectCssStyle(injected, css) : injected;

  return result;
}

/**
 * Enhance hook - inject comment sections into generated HTML pages.
 *
 * Pure transformer: operates on ctx.files, returns modified HTML.
 * No file I/O for site HTML — the pipeline handles reading/writing.
 */
export async function enhance(ctx: EnhanceContext): Promise<EnhanceResult> {
  console.log("[info] Comment: Starting enhance hook...");

  const config = ctx.config || {};
  const serverUrl = (config.server_url as string) || "";
  const siteName = (config.site_name as string) || ctx.project_info.site_name || "";
  const defaultComments = config.default_comments !== false; // default true for backward compat
  const providerName = serverUrl ? await detectProvider(serverUrl) : "waline";
  const buildScript = getSubmitScriptBuilder(providerName);

  if (buildScript && serverUrl) {
    console.log(`[info] Comment: Using provider "${providerName}" at ${serverUrl}`);
    if (providerName === "artalk" && !siteName) {
      console.log("[warn] Comment: Artalk provider requires site_name to be configured");
    }
  } else if (!serverUrl) {
    console.log("[info] Comment: No server_url configured, static comments only");
  }

  // 1. Read CSS for inline injection into each page's <head>
  let commentsCss = "";
  try {
    commentsCss = await readPluginFile(COMMENTS_CSS_FILENAME);
  } catch {
    console.log("[warn] Comment: Could not read CSS file, comments will be unstyled");
  }

  // 2. Load existing comments from .moss/social/*.json files
  //    Keys may be uids (new format) or source .md paths (legacy format)
  //    Include "comment" source since the process hook writes to comment.json
  const commentsByKey = await loadAllComments(["comment"]);
  console.log(`[info] Comment: Loaded comments for ${commentsByKey.size} articles`);

  // 3. Build both uid-based and path-based mappings from article-map.json
  const uidToUrl = await buildUidToUrlMap();
  const sourceToUrl = await buildSourceToUrlMap();
  console.log(`[info] Comment: Article map has ${sourceToUrl.size} source entries, ${uidToUrl.size} uid entries`);

  // 4. Build reverse map: urlPath -> uid (for passing uid to client-side forms)
  const urlToUid = new Map<string, string>();
  for (const [uid, urlPath] of uidToUrl) {
    urlToUid.set(urlPath, uid);
  }

  // 5. Resolve comment keys (uid or path) -> output URL path
  //    Try uid-based lookup first, then fall back to path-based
  const commentsByPage = new Map<string, NormalizedComment[]>();
  for (const [key, comments] of commentsByKey) {
    const urlPath = uidToUrl.get(key) || sourceToUrl.get(key);
    if (urlPath) {
      // Merge with any existing comments for this page (from different social sources)
      const existing = commentsByPage.get(urlPath) || [];
      existing.push(...comments);
      commentsByPage.set(urlPath, existing);
    }
  }
  console.log(`[info] Comment: Resolved ${commentsByPage.size} pages with comments`);

  // 6. Build set of urlPaths that should receive comment sections
  //    (when serverUrl is set, all known article pages get sections)
  const pagesWithForms = new Set<string>();
  if (serverUrl) {
    for (const v of uidToUrl.values()) pagesWithForms.add(v);
    for (const v of sourceToUrl.values()) pagesWithForms.add(v);
  }

  // 7. Iterate ctx.files and transform
  const modified: ModifiedFile[] = [];

  for (const file of ctx.files) {
    const urlPath = filePathToUrlPath(file.path);

    const comments = commentsByPage.get(urlPath) || [];
    const uid = urlToUid.get(urlPath) || "";

    // Skip if no comments AND this page isn't in the set of pages that need forms
    if (comments.length === 0 && !pagesWithForms.has(urlPath)) continue;

    const result = transformHtml(
      file.html,
      urlPath,
      comments,
      serverUrl,
      buildScript,
      providerName,
      siteName,
      uid,
      defaultComments,
      commentsCss
    );

    if (result) {
      modified.push({ path: file.path, html: result });
    }
  }

  console.log(`[info] Comment: Injected comments into ${modified.length} pages`);
  return {
    success: true,
    message: `Injected comment sections into ${modified.length} pages`,
    modified,
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

