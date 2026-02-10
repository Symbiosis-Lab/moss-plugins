/**
 * Article mapper
 *
 * Scans markdown files in the project directory for `syndicated:` frontmatter
 * containing Matters URLs. Extracts the shortHash and maps it to the
 * corresponding output HTML path.
 */

import { readFile, log } from "@symbiosis-lab/moss-api";

/**
 * Extract shortHash from a Matters URL.
 *
 * URL format: https://matters.town/@userName/slug-shortHash
 * The shortHash is the last segment after the final hyphen.
 */
export function extractShortHash(mattersUrl: string): string | null {
  try {
    const url = new URL(mattersUrl);
    const path = url.pathname;
    const lastSegment = path.split("/").pop();
    if (!lastSegment) return null;
    const parts = lastSegment.split("-");
    if (parts.length < 2) return null;
    return parts[parts.length - 1];
  } catch {
    return null;
  }
}

/**
 * Convert a source markdown path to an output HTML path.
 *
 * Examples:
 *   posts/foo.md -> posts/foo.html
 *   blog/my-post.md -> blog/my-post.html
 */
function mdPathToHtmlPath(mdPath: string): string {
  return mdPath.replace(/\.md$/, ".html");
}

/**
 * Scan all HTML files in the output directory and extract syndicated Matters
 * URLs from their corresponding markdown source files.
 *
 * Returns a map of shortHash -> output HTML relative path.
 */
export async function buildArticleMap(
  projectPath: string,
  mdFiles: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  for (const mdFile of mdFiles) {
    try {
      const content = await readFile(mdFile);

      // Extract frontmatter between --- delimiters
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const frontmatter = fmMatch[1];

      // Find syndicated URLs using regex
      const syndicatedMatch = frontmatter.match(
        /syndicated:\s*\n((?:\s*-\s*"[^"]*"\s*\n?)*)/
      );
      if (!syndicatedMatch) continue;

      // Extract each URL from the list
      const urlMatches = syndicatedMatch[1].matchAll(/-\s*"([^"]+)"/g);
      for (const urlMatch of urlMatches) {
        const url = urlMatch[1];
        if (!url.includes("matters.town")) continue;

        const shortHash = extractShortHash(url);
        if (!shortHash) continue;

        // Derive the relative path from projectPath
        const relativeMdPath = mdFile.startsWith(projectPath)
          ? mdFile.slice(projectPath.length).replace(/^\//, "")
          : mdFile;

        const htmlPath = mdPathToHtmlPath(relativeMdPath);
        result.set(shortHash, htmlPath);
        log(`[info] Comment: Mapped ${shortHash} -> ${htmlPath}`);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return result;
}
