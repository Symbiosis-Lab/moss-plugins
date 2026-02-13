/**
 * Social data reader
 *
 * Reads .moss/social/*.json files and converts comments
 * to NormalizedComment[] grouped by article key (source .md path).
 *
 * Also reads .moss/article-map.json to build source→output URL mapping.
 *
 * NOTE: listFiles() from moss-api skips hidden directories (.moss/),
 * so we discover social files by trying known source names rather than listing.
 */

import { readFile, log } from "@symbiosis-lab/moss-api";
import type {
  NormalizedComment,
  GenericSocialFile,
  GenericSocialComment,
} from "./types";

/** Default social source names to try loading */
const DEFAULT_SOCIAL_SOURCES = ["matters", "nostr", "webmention", "activitypub"];

/**
 * Build a mapping from relative source .md path to output URL path
 * using the article-map.json written by Moss core.
 *
 * article-map.json structure:
 *   { articles: { [prettyUrl]: { source_path: string, url_path: string, ... } } }
 *
 * source_path is ABSOLUTE (e.g., /Users/.../posts/foo.md).
 * We strip the projectPath prefix to get a relative .md path.
 *
 * Returns Map: relative source .md path -> url_path
 *   e.g., "posts/foo.md" -> "posts/foo/"
 */
export async function buildSourceToUrlMap(): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  try {
    // Use project-relative path — readFile() resolves against project root
    const content = await readFile(".moss/article-map.json");
    const data = JSON.parse(content) as {
      articles: Record<string, { source_path: string; url_path: string }>;
    };

    if (!data.articles) {
      return result;
    }

    // Get project_path from the runtime's internal context
    // (ctx.project_path is sanitized away from the plugin-facing context)
    const win = globalThis.window || globalThis;
    const projectPath: string | undefined = (win as any).__MOSS_INTERNAL_CONTEXT__?.project_path;

    // Ensure prefix ends with "/" for consistent stripping
    let prefix = projectPath || "";
    if (prefix && !prefix.endsWith("/")) {
      prefix += "/";
    }

    for (const [_prettyUrl, entry] of Object.entries(data.articles)) {
      if (!entry.source_path || !entry.url_path) continue;

      // Strip projectPath prefix to get project-relative .md path
      let relativePath = entry.source_path;
      if (prefix && relativePath.startsWith(prefix)) {
        relativePath = relativePath.slice(prefix.length);
      } else {
        // Fallback: strip leading "/"
        relativePath = relativePath.replace(/^\//, "");
      }

      result.set(relativePath, entry.url_path);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`[warn] Comment: Could not read article-map.json: ${msg}`);
  }

  return result;
}

/**
 * Normalize generic social comments to NormalizedComment[].
 *
 * Filters out inactive comments (only includes if state is absent or "active").
 * Author URL is derived from userName for Matters-sourced comments.
 */
function normalizeComments(
  comments: GenericSocialComment[] | undefined,
  source: string
): NormalizedComment[] {
  if (!comments || comments.length === 0) return [];

  return comments
    .filter((c) => !c.state || c.state === "active")
    .map(
      (c): NormalizedComment => ({
        id: c.id,
        source,
        author: {
          name:
            c.author.displayName ||
            c.author.name ||
            c.author.userName ||
            "Anonymous",
          url: (source === "matters" && c.author.userName)
            ? `https://matters.town/@${c.author.userName}`
            : undefined,
        },
        content_html: c.content,
        date: c.createdAt,
        replyToId: c.replyToId,
      })
    );
}

/**
 * Load comments from .moss/social/*.json files.
 *
 * Since listFiles() skips hidden directories (.moss/), we discover
 * social files by trying known source names (DEFAULT_SOCIAL_SOURCES)
 * plus any additional sources passed as parameter.
 *
 * Returns a Map keyed by article key (source .md path) with
 * NormalizedComment[] sorted by date ascending.
 */
export async function loadAllComments(
  extraSources?: string[]
): Promise<Map<string, NormalizedComment[]>> {
  const result = new Map<string, NormalizedComment[]>();

  // Try each known social source
  const sources = [...DEFAULT_SOCIAL_SOURCES, ...(extraSources || [])];
  const tried = new Set<string>();

  for (const source of sources) {
    if (tried.has(source)) continue;
    tried.add(source);

    const filePath = `.moss/social/${source}.json`;
    let data: GenericSocialFile;
    try {
      const content = await readFile(filePath);
      data = JSON.parse(content) as GenericSocialFile;
    } catch {
      // File doesn't exist or isn't valid JSON — skip silently
      continue;
    }

    if (!data.articles) continue;
    log(`[info] Comment: Found social data from "${source}"`);

    for (const [articleKey, articleData] of Object.entries(data.articles)) {
      const normalized = normalizeComments(articleData.comments, source);
      if (normalized.length === 0) continue;

      // Merge with existing comments for this article key
      const existing = result.get(articleKey) || [];
      existing.push(...normalized);
      result.set(articleKey, existing);
    }
  }

  // Sort each page's comments by date ascending
  for (const [_key, comments] of result) {
    comments.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }

  return result;
}
