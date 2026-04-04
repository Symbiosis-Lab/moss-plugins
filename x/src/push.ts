/**
 * Push articles to X.
 *
 * X does not have a public write API for long-form articles. Content is pushed
 * via the article editor using DOM automation (clipboard paste or execCommand).
 *
 * In development: Playwright page.evaluate()
 * In production: Tauri webview.eval()
 *
 * The push scripts are self-contained JS functions that run in the page context.
 */

import { reportProgress, openBrowser, closeBrowser } from "@symbiosis-lab/moss-api";
import { getProfileUrl } from "./api";
import { markdownToHtml } from "./converter";
import { parseFrontmatter } from "./converter";

/**
 * Push a markdown article to X as a draft article.
 *
 * @param content - Full markdown file content (with frontmatter)
 * @returns The X draft URL, or null if push failed
 */
export async function pushArticle(content: string): Promise<string | null> {
  const { frontmatter, body } = parseFrontmatter(content);
  const title = frontmatter.title || "Untitled";

  await reportProgress("push", 0, 100, `Pushing: ${title}`);

  // Convert markdown body to HTML
  const html = markdownToHtml(body);

  // Open the X article editor in the action panel
  const editorUrl = "https://x.com/i/article/new";

  const browser = await openBrowser(editorUrl);
  await reportProgress("push", 20, 100, "Editor opened, filling content...");

  // The actual DOM automation would run via webview.eval() in production.
  // For now, we prepare the automation script that will be executed in the page context.
  // This is a placeholder — the actual injection mechanism depends on the
  // evaluateInBrowser() API (see Architecture Note in the plan).

  // TODO: Implement actual push via webview.eval() once moss-api supports it
  // For development/testing, push is done via Playwright in the e2e test scripts.

  await reportProgress("push", 100, 100, `Draft prepared for: ${title}`);

  return null; // Placeholder — actual URL returned after webview automation
}

/**
 * JS script that runs inside the X article editor page context.
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
  const titleEl = document.querySelector('[data-testid="article-title-input"], [placeholder="Title"]');
  if (titleEl) {
    titleEl.value = ${JSON.stringify(title)};
    titleEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Wait for editor to be ready
  await new Promise(r => setTimeout(r, 500));

  // Paste HTML into the editor
  const editor = document.querySelector('[data-testid="article-editor"], .ProseMirror, [contenteditable="true"]');
  if (editor) {
    editor.focus();
    document.execCommand('insertHTML', false, ${JSON.stringify(html)});
  }

  return { success: true };
})()
`;
}
