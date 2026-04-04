/**
 * Push articles to LinkedIn.
 *
 * LinkedIn doesn't have a public write API for articles. Content is pushed
 * via the article editor using DOM automation (clipboard paste or execCommand).
 *
 * In development: Playwright page.evaluate()
 * In production: Tauri webview.eval()
 *
 * The push scripts are self-contained JS functions that run in the page context.
 */

import { reportProgress, openBrowser, closeBrowser } from "@symbiosis-lab/moss-api";
import { markdownToHtml } from "./converter";
import { parseFrontmatter } from "./converter";

/**
 * Push a markdown article to LinkedIn as a draft article.
 *
 * @param content - Full markdown file content (with frontmatter)
 * @returns The LinkedIn article URL, or null if push failed
 */
export async function pushArticle(content: string): Promise<string | null> {
  const { frontmatter, body } = parseFrontmatter(content);
  const title = frontmatter.title || "Untitled";

  await reportProgress("push", 0, 100, `Pushing: ${title}`);

  // Convert markdown body to HTML
  const html = markdownToHtml(body);

  // Open the LinkedIn article editor
  const editorUrl = "https://www.linkedin.com/article/new/";

  const browser = await openBrowser(editorUrl);
  await reportProgress("push", 20, 100, "Editor opened, filling content...");

  // The actual DOM automation would run via webview.eval() in production.
  // For now, we prepare the automation script that will be executed in the page context.
  // This is a placeholder -- the actual injection mechanism depends on the
  // evaluateInBrowser() API.

  // TODO: Implement actual push via webview.eval() once moss-api supports it
  // For development/testing, push is done via Playwright in the e2e test scripts.

  await reportProgress("push", 100, 100, `Draft prepared for: ${title}`);

  return null; // Placeholder -- actual URL returned after webview automation
}

/**
 * JS script that runs inside the LinkedIn article editor page context.
 * This is the same script whether injected via Playwright or Tauri.
 *
 * @param title - Article title
 * @param html - HTML content to paste into the editor
 */
export function editorAutomationScript(
  title: string,
  html: string
): string {
  return `
(async () => {
  // Fill title
  const titleEl = document.querySelector('[data-placeholder="Title"]') ||
    document.querySelector('.article-editor__title [contenteditable]') ||
    document.querySelector('h1[contenteditable]');
  if (titleEl) {
    titleEl.innerHTML = ${JSON.stringify(title)};
    titleEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Wait for editor to be ready
  await new Promise(r => setTimeout(r, 500));

  // Paste HTML into the article body editor
  const bodyEl = document.querySelector('.article-editor__content [contenteditable]') ||
    document.querySelector('[data-placeholder="Write here"]') ||
    document.querySelector('.ql-editor');
  if (bodyEl) {
    bodyEl.focus();
    document.execCommand('insertHTML', false, ${JSON.stringify(html)});
  }

  return { success: true };
})()
`;
}
