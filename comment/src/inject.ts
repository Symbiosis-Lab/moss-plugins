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
