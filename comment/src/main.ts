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
 *   5. Inlines CSS as a <style> tag in each page's <head>
 */

import { readFile, writeFile, readPluginFile } from "@symbiosis-lab/moss-api";
import { loadAllComments, buildSourceToUrlMap, buildUidToUrlMap } from "./social-reader";
import { renderCommentSection } from "./render";
import { findInsertionPoint, injectCommentSection, injectInlineStyle } from "./inject";
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
  NormalizedComment,
  ArticleMap,
} from "./types";

const COMMENTS_CSS_FILENAME = "moss-comments.css";

/**
 * Derive the project-relative output directory prefix from context.
 * E.g., if output_dir is "/Users/.../guo-site/.moss/site"
 * and project_path is "/Users/.../guo-site",
 * returns ".moss/site"
 */
function getOutputPrefix(ctx: EnhanceContext): string {
  const outputDir = ctx.output_dir;
  const projectPath = ctx.project_path;

  if (outputDir && projectPath && outputDir.startsWith(projectPath)) {
    let rel = outputDir.slice(projectPath.length);
    rel = rel.replace(/^\//, "");
    return rel;
  }
  // Fallback: standard location
  return ".moss/site";
}

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
    // Artalk: batch fetch all comments for the site in one go
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
 * Enhance hook - inject comment sections into generated HTML pages.
 */
export async function enhance(ctx: EnhanceContext): Promise<HookResult> {
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

  // 1. Read CSS once for inline injection into each page
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

  // 6. Derive output prefix for project-relative paths
  const outputPrefix = getOutputPrefix(ctx);

  // 7. Collect pages that need injection:
  //    - Pages with comments always get a section
  //    - Pages without comments only get a section if there's a form (serverUrl set)
  const allUrlPaths: string[] = [];
  if (serverUrl) {
    // All articles get comment sections (with form)
    // Use uidToUrl (preferred) first, then sourceToUrl as fallback for legacy data
    for (const v of uidToUrl.values()) {
      if (!allUrlPaths.includes(v)) allUrlPaths.push(v);
    }
    for (const v of sourceToUrl.values()) {
      if (!allUrlPaths.includes(v)) allUrlPaths.push(v);
    }
  }
  // Always include pages that have comments
  for (const urlPath of commentsByPage.keys()) {
    if (!allUrlPaths.includes(urlPath)) allUrlPaths.push(urlPath);
  }

  console.log(`[info] Comment: Processing ${allUrlPaths.length} pages (serverUrl: ${serverUrl ? 'yes' : 'no'})`);

  let injectedCount = 0;

  for (const urlPath of allUrlPaths) {
    // Determine the HTML file path from the URL path:
    // - "articles/foo/" → ".moss/site/articles/foo/index.html"
    // - "articles/foo/index-2" → ".moss/site/articles/foo/index-2.html" (paginated)
    let htmlRelPath: string;
    if (urlPath.endsWith("/")) {
      htmlRelPath = `${outputPrefix}/${urlPath}index.html`;
    } else if (/\/index-\d+$/.test(urlPath)) {
      htmlRelPath = `${outputPrefix}/${urlPath}.html`;
    } else {
      htmlRelPath = `${outputPrefix}/${urlPath}/index.html`;
    }

    const comments = commentsByPage.get(urlPath) || [];
    // Look up uid for this page, fall back to urlPath if not available
    const uid = urlToUid.get(urlPath) || "";

    try {
      const result = await processHtmlFile(
        htmlRelPath,
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
      if (result) injectedCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[warn] Comment: Error processing ${urlPath}: ${msg}`);
    }
  }

  console.log(`[info] Comment: Injected comments into ${injectedCount} pages`);
  return {
    success: true,
    message: `Injected comment sections into ${injectedCount} pages`,
  };
}

/**
 * Process a single HTML file: read it, inject comments, write it back.
 *
 * @param uid - Content uid for the page, used as page key in client-side forms.
 *              Falls back to urlPath if empty.
 */
async function processHtmlFile(
  htmlRelPath: string,
  urlPath: string,
  comments: NormalizedComment[],
  serverUrl: string,
  buildScript: ((serverUrl: string, pagePath: string, uid: string, siteName?: string, lang?: Lang) => string) | null,
  providerName: string = "waline",
  siteName: string = "",
  uid: string = "",
  defaultComments: boolean = true,
  css: string = ""
): Promise<boolean> {
  try {
    let html = await readFile(htmlRelPath);

    // Check explicit opt-in/opt-out attributes
    const hasExplicitTrue = html.includes('data-comments="true"');
    const hasExplicitFalse = html.includes('data-comments="false"');

    // Explicit opt-out always wins
    if (hasExplicitFalse) return false;

    // If default is off and no explicit opt-in, skip
    if (!defaultComments && !hasExplicitTrue) return false;

    // Skip if already injected (idempotent on re-compile)
    if (html.includes('class="moss-comments"')) {
      return false;
    }

    // Check if this page has an article structure
    if (findInsertionPoint(html) === -1) {
      return false;
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
    if (!commentHtml) return false;

    // Inject before </article>
    const injected = injectCommentSection(html, commentHtml);
    if (!injected) return false;

    // Inject inline CSS in <head> (idempotent - skips if already present)
    html = injectInlineStyle(injected, css);

    await writeFile(htmlRelPath, html);
    console.log(`[info] Comment: Injected into ${urlPath} (${comments.length} comments)`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[warn] Comment: Failed to process ${urlPath}: ${msg}`);
    return false;
  }
}

