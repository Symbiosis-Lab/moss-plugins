/**
 * HTML injection utilities
 *
 * Finds insertion points in generated HTML and injects the comment section.
 * Based on the pattern from the nostr plugin's widget/inject.ts.
 */

/**
 * Find the last index of a tag (case-insensitive).
 */
function lastIndexOfTag(html: string, tag: string): number {
  const lowerIndex = html.lastIndexOf(tag);
  if (lowerIndex !== -1) return lowerIndex;
  const upperIndex = html.lastIndexOf(tag.toUpperCase());
  if (upperIndex !== -1) return upperIndex;
  return -1;
}

/**
 * Compute a relative path prefix from a URL path back to the site root.
 *
 * E.g., "posts/hello/" has depth 2, so prefix is "../../".
 * Root-level pages (depth 0) return "".
 */
export function rootRelativePrefix(urlPath: string): string {
  // Count path segments (each "/" except trailing adds depth)
  const trimmed = urlPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "";
  const depth = trimmed.split("/").length;
  return "../".repeat(depth);
}

/**
 * Find the best insertion point for the comment section.
 *
 * Priority:
 * 1. Before </article>
 * 2. Before </main>
 * 3. Before </body>
 * 4. End of string (no injection)
 */
export function findInsertionPoint(html: string): number {
  const articleEnd = lastIndexOfTag(html, "</article>");
  if (articleEnd !== -1) return articleEnd;

  const mainEnd = lastIndexOfTag(html, "</main>");
  if (mainEnd !== -1) return mainEnd;

  const bodyEnd = lastIndexOfTag(html, "</body>");
  if (bodyEnd !== -1) return bodyEnd;

  return -1;
}

/**
 * Inject the comment section HTML before the insertion point.
 *
 * @param html - Original HTML content
 * @param commentHtml - Comment section HTML to inject
 * @returns Modified HTML, or null if no suitable insertion point
 */
export function injectCommentSection(
  html: string,
  commentHtml: string
): string | null {
  const insertionPoint = findInsertionPoint(html);
  if (insertionPoint === -1) {
    return null;
  }

  return html.slice(0, insertionPoint) + "\n" + commentHtml + "\n" + html.slice(insertionPoint);
}

/**
 * Inject a CSS <link> tag into the <head> of the HTML.
 *
 * @param html - HTML content
 * @param cssPath - Relative path to the CSS file
 * @returns Modified HTML with CSS link injected
 */
export function injectCssLink(html: string, cssPath: string): string {
  const headEnd = lastIndexOfTag(html, "</head>");
  if (headEnd === -1) return html;

  const link = `<link rel="stylesheet" href="${cssPath}">`;
  return html.slice(0, headEnd) + link + "\n" + html.slice(headEnd);
}

/**
 * Inject CSS as an inline <style> tag into the <head> of the HTML.
 *
 * Uses a class attribute for idempotency detection — if the style tag
 * is already present, the HTML is returned unchanged.
 *
 * @param html - HTML content
 * @param css - CSS content to inline
 * @returns Modified HTML with inline style, or original if already present or css is empty
 */
export function injectInlineStyle(html: string, css: string): string {
  if (!css) return html;
  if (html.includes('moss-comments-style')) return html;

  const headEnd = lastIndexOfTag(html, "</head>");
  if (headEnd === -1) return html;

  const styleTag = `<style class="moss-comments-style">${css}</style>`;
  return html.slice(0, headEnd) + styleTag + "\n" + html.slice(headEnd);
}
