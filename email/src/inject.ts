/**
 * HTML injection utilities for email plugin
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
 * Inject CSS as an inline <style> tag into the <head> of the HTML.
 *
 * Uses a class attribute for idempotency detection — if the style tag
 * is already present, the HTML is returned unchanged.
 */
export function injectInlineStyle(html: string, css: string): string {
  if (!css) return html;
  if (html.includes("moss-email-style")) return html;

  const headEnd = lastIndexOfTag(html, "</head>");
  if (headEnd === -1) return html;

  const styleTag = `<style class="moss-email-style">${css}</style>`;
  return html.slice(0, headEnd) + styleTag + "\n" + html.slice(headEnd);
}
