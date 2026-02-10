/**
 * Comment Plugin for Moss
 *
 * Main entry point. Provides an enhance hook that:
 * 1. Reads existing comments from .moss/social/matters.json
 * 2. Maps them to output HTML pages via syndicated frontmatter
 * 3. Renders a comment section with existing comments + submission form
 * 4. Injects the section before </article> in each page
 * 5. Copies CSS to the output directory
 */

import { readFile, writeFile, listFiles, log } from "@symbiosis-lab/moss-api";
import { loadComments } from "./social-reader";
import { buildArticleMap } from "./article-mapper";
import { renderCommentSection } from "./render";
import { findInsertionPoint, injectCommentSection, injectCssLink } from "./inject";
import { getProvider } from "./providers";
import type { EnhanceContext, HookResult, NormalizedComment } from "./types";

const COMMENTS_CSS_FILENAME = "moss-comments.css";

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

  // 1. Load existing comments from .moss/social/matters.json
  const commentsByHash = await loadComments(ctx.project_path);
  log(`[info] Comment: Loaded comments for ${commentsByHash.size} articles`);

  // 2. Discover .md files and build article map (shortHash -> output HTML path)
  const allFiles = await listFiles();
  const mdFiles = allFiles.filter((f) => f.endsWith(".md"));
  const articleMap = await buildArticleMap(ctx.project_path, mdFiles);
  log(`[info] Comment: Mapped ${articleMap.size} articles with syndicated URLs`);

  // 3. Build lookup: output HTML path -> NormalizedComment[]
  const commentsByPage = new Map<string, NormalizedComment[]>();
  for (const [shortHash, comments] of commentsByHash) {
    const htmlPath = articleMap.get(shortHash);
    if (htmlPath) {
      commentsByPage.set(htmlPath, comments);
    }
  }

  // 4. Find all HTML files in output to inject comment sections
  //    - Pages with existing comments get the full section
  //    - Other article pages get an empty comment section (form only if server_url set)
  const htmlFiles = allFiles.filter((f) => f.endsWith(".html"));

  let injectedCount = 0;

  for (const htmlRelPath of htmlFiles) {
    const htmlFullPath = `${ctx.output_dir}/${htmlRelPath}`;
    const comments = commentsByPage.get(htmlRelPath) || [];

    const result = await processHtmlFile(
      htmlFullPath,
      htmlRelPath,
      comments,
      provider,
      serverUrl
    );
    if (result) injectedCount++;
  }

  // 5. Copy CSS to output directory
  await copyCss(ctx.output_dir);

  log(`[info] Comment: Injected comments into ${injectedCount} pages`);
  return {
    success: true,
    message: `Injected comment sections into ${injectedCount} pages`,
  };
}

/**
 * Process a single HTML file: read it, inject comments, write it back.
 */
async function processHtmlFile(
  htmlFullPath: string,
  htmlRelPath: string,
  comments: NormalizedComment[],
  provider: ReturnType<typeof getProvider>,
  serverUrl: string
): Promise<boolean> {
  try {
    let html = await readFile(htmlFullPath);

    // Check for data-comments="false" opt-out
    if (html.includes('data-comments="false"')) {
      return false;
    }

    // Check if this page has an article structure
    if (findInsertionPoint(html) === -1) {
      return false;
    }

    // Render the comment section
    const commentHtml = renderCommentSection(
      comments,
      htmlRelPath,
      provider,
      serverUrl
    );

    // Inject before </article>
    const injected = injectCommentSection(html, commentHtml);
    if (!injected) return false;

    // Inject CSS link in <head>
    html = injectCssLink(injected, `/${COMMENTS_CSS_FILENAME}`);

    await writeFile(htmlFullPath, html);
    log(`[info] Comment: Injected into ${htmlRelPath} (${comments.length} comments)`);
    return true;
  } catch {
    // File not found in output dir or other error — skip silently
    return false;
  }
}

/**
 * Copy the comment CSS to the output directory.
 */
async function copyCss(outputDir: string): Promise<void> {
  try {
    const css = await readFile("moss-comments.css");
    await writeFile(`${outputDir}/${COMMENTS_CSS_FILENAME}`, css);
  } catch (e) {
    log(`[warn] Comment: Failed to copy CSS: ${e}`);
  }
}
