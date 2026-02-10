/**
 * Comment Plugin for Moss
 *
 * Main entry point. Provides an enhance hook that:
 * 1. Reads comments from all JSON files in .moss/social/
 * 2. Reads .moss/article-map.json for source->output path mapping
 * 3. Renders a comment section with existing comments + submission form
 * 4. Injects the section before </article> in each page
 * 5. Copies CSS to the output directory
 */

import { readFile, writeFile, readPluginFile, log } from "@symbiosis-lab/moss-api";
import { loadAllComments, buildSourceToUrlMap } from "./social-reader";
import { renderCommentSection } from "./render";
import { findInsertionPoint, injectCommentSection, injectCssLink } from "./inject";
import { getProvider } from "./providers";
import type { EnhanceContext, HookResult, NormalizedComment } from "./types";

const COMMENTS_CSS_FILENAME = "moss-comments.css";

/**
 * Convert an HTML file path to a pretty URL for comment lookup.
 */
function toPrettyUrl(htmlPath: string): string {
  if (htmlPath.endsWith("/index.html")) {
    return htmlPath.slice(0, -"index.html".length); // "posts/foo/index.html" -> "posts/foo/"
  }
  if (htmlPath.endsWith(".html")) {
    return htmlPath.slice(0, -".html".length); // "posts/foo.html" -> "posts/foo"
  }
  return htmlPath;
}

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

/**
 * Enhance hook - inject comment sections into generated HTML pages.
 */
export async function enhance(ctx: EnhanceContext): Promise<HookResult> {
  log("[info] Comment: Starting enhance hook...");

  const config = ctx.config || {};
  const providerName = (config.provider as string) || "waline";
  const serverUrl = (config.server_url as string) || "";
  const provider = getProvider(providerName);

  if (provider && serverUrl) {
    log(`[info] Comment: Using provider "${providerName}" at ${serverUrl}`);
  } else if (!serverUrl) {
    log("[info] Comment: No server_url configured, static comments only");
  }

  // 1. Load existing comments from .moss/social/*.json files
  const commentsByMdPath = await loadAllComments();
  log(`[info] Comment: Loaded comments for ${commentsByMdPath.size} articles`);

  // 2. Build authoritative source->output mapping from Moss's article-map.json
  const sourceToUrl = await buildSourceToUrlMap();
  log(`[info] Comment: Article map has ${sourceToUrl.size} entries`);

  // 3. Resolve: source .md path -> output URL path
  const commentsByPage = new Map<string, NormalizedComment[]>();
  for (const [mdPath, comments] of commentsByMdPath) {
    const urlPath = sourceToUrl.get(mdPath);
    if (urlPath) {
      commentsByPage.set(urlPath, comments);
    }
  }
  log(`[info] Comment: Resolved ${commentsByPage.size} pages with comments`);

  // 4. Derive output prefix for project-relative paths
  const outputPrefix = getOutputPrefix(ctx);

  // 5. Collect all article URL paths from the article map for HTML injection
  //    (includes pages with AND without comments — all get a comment section)
  const allUrlPaths: string[] = [];
  for (const v of sourceToUrl.values()) {
    if (!allUrlPaths.includes(v)) allUrlPaths.push(v);
  }
  // Also add any pages that have comments but weren't in the article map
  for (const urlPath of commentsByPage.keys()) {
    if (!allUrlPaths.includes(urlPath)) allUrlPaths.push(urlPath);
  }
  let injectedCount = 0;

  for (const urlPath of allUrlPaths) {
    // Construct the project-relative HTML file path
    // url_path like "posts/foo/" -> ".moss/site/posts/foo/index.html"
    // url_path like "posts/foo"  -> ".moss/site/posts/foo.html" or ".moss/site/posts/foo/index.html"
    const htmlRelPath = urlPath.endsWith("/")
      ? `${outputPrefix}/${urlPath}index.html`
      : `${outputPrefix}/${urlPath}/index.html`;

    const comments = commentsByPage.get(urlPath) || [];

    try {
      const result = await processHtmlFile(
        htmlRelPath,
        urlPath,
        comments,
        provider,
        serverUrl
      );
      if (result) injectedCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[warn] Comment: Error processing ${urlPath}: ${msg}`);
    }
  }

  // 6. Copy CSS to output directory
  await copyCss(outputPrefix);

  log(`[info] Comment: Injected comments into ${injectedCount} pages`);
  return {
    success: true,
    message: `Injected comment sections into ${injectedCount} pages`,
  };
}

/**
 * Process a single HTML file: read it, inject comments, write it back.
 * htmlRelPath is project-relative (e.g., ".moss/site/posts/foo/index.html").
 * urlPath is for display/lookup (e.g., "posts/foo/").
 */
async function processHtmlFile(
  htmlRelPath: string,
  urlPath: string,
  comments: NormalizedComment[],
  provider: ReturnType<typeof getProvider>,
  serverUrl: string
): Promise<boolean> {
  try {
    let html = await readFile(htmlRelPath);

    // Check for data-comments="false" opt-out
    if (html.includes('data-comments="false"')) {
      return false;
    }

    // Skip if already injected (idempotent on re-compile)
    if (html.includes('class="moss-comments"')) {
      return false;
    }

    // Check if this page has an article structure
    if (findInsertionPoint(html) === -1) {
      return false;
    }

    // Render the comment section
    const commentHtml = renderCommentSection(
      comments,
      urlPath,
      provider,
      serverUrl
    );

    // Inject before </article>
    const injected = injectCommentSection(html, commentHtml);
    if (!injected) return false;

    // Inject CSS link in <head> (only if not already present)
    if (!injected.includes(COMMENTS_CSS_FILENAME)) {
      html = injectCssLink(injected, `/${COMMENTS_CSS_FILENAME}`);
    } else {
      html = injected;
    }

    await writeFile(htmlRelPath, html);
    log(`[info] Comment: Injected into ${urlPath} (${comments.length} comments)`);
    return true;
  } catch {
    // File not found in output dir or other error -- skip silently
    return false;
  }
}

/**
 * Copy the comment CSS to the output directory.
 * Reads from plugin's bundled assets via readPluginFile.
 */
async function copyCss(outputPrefix: string): Promise<void> {
  try {
    const css = await readPluginFile(COMMENTS_CSS_FILENAME);
    await writeFile(`${outputPrefix}/${COMMENTS_CSS_FILENAME}`, css);
  } catch (e) {
    log(`[warn] Comment: Failed to copy CSS: ${e}`);
  }
}
