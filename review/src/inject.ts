/**
 * HTML injection utilities for the review plugin.
 *
 * Three injection points:
 * - After </h1>: book header (cover + creator + year)
 * - Before </article>: colophon (rating + biblio + links) — article metadata
 * - In <head>: inline CSS
 *
 * The colophon is article metadata (bibliographic info, rating, links) and
 * belongs inside <article> as a <footer>. Comments are injected by the
 * comment plugin after </article>, so there's no ordering concern.
 */

/**
 * Inject HTML after the first </h1> tag.
 */
export function injectAfterH1(html: string, content: string): string | null {
  const match = html.match(/<\/h1>/i);
  if (!match || match.index === undefined) return null;

  const insertAt = match.index + match[0].length;
  return html.slice(0, insertAt) + "\n" + content + html.slice(insertAt);
}

/**
 * Inject HTML before </article>. The colophon is article metadata and
 * belongs inside the article element.
 */
export function injectBeforeArticleEnd(html: string, content: string): string | null {
  const tag = "</article>";
  const idx = html.lastIndexOf(tag);
  if (idx === -1) {
    const upperIdx = html.lastIndexOf(tag.toUpperCase());
    if (upperIdx === -1) return null;
    return html.slice(0, upperIdx) + content + "\n" + html.slice(upperIdx);
  }
  return html.slice(0, idx) + content + "\n" + html.slice(idx);
}

/**
 * Inject CSS as inline <style> in <head>.
 */
export function injectCssInHead(html: string, css: string): string {
  if (!css) return html;
  return html.replace(/<\/head>/i, `<style>${css}</style>\n</head>`);
}
