/**
 * Push notes to Xiaohongshu.
 *
 * Xiaohongshu requires uploading images first, then adding text and tags.
 * There is no public write API — publishing requires DOM automation via
 * the creator center (creator.xiaohongshu.com).
 *
 * This is a placeholder implementation. Actual push requires:
 * 1. Upload images to Xiaohongshu's CDN via the creator center
 * 2. Fill in note title and text
 * 3. Add tags/hashtags
 * 4. Submit the note
 *
 * In development: Playwright page.evaluate()
 * In production: Tauri webview.eval()
 */

import { reportProgress, openBrowser, closeBrowser } from "@symbiosis-lab/moss-api";
import { parseFrontmatter } from "./converter";

/**
 * Push a markdown note to Xiaohongshu as a draft.
 *
 * @param content - Full markdown file content (with frontmatter)
 * @returns The Xiaohongshu note URL, or null if push failed
 */
export async function pushNote(content: string): Promise<string | null> {
  const { frontmatter, body } = parseFrontmatter(content);
  const title = frontmatter.title || "Untitled";

  await reportProgress("push", 0, 100, `Pushing: ${title}`);

  // Open the Xiaohongshu creator center
  const editorUrl = "https://creator.xiaohongshu.com/publish/publish";

  const browser = await openBrowser(editorUrl);
  await reportProgress("push", 20, 100, "Creator center opened...");

  // TODO: Implement actual push via webview.eval() once moss-api supports it.
  //
  // The push flow for Xiaohongshu:
  // 1. Upload images (drag-and-drop or file input)
  // 2. Fill title field
  // 3. Fill description/text field
  // 4. Add hashtags
  // 5. Click publish
  //
  // This requires the evaluateInBrowser() API.

  await reportProgress("push", 100, 100, `Draft prepared for: ${title}`);

  return null; // Placeholder — actual URL returned after webview automation
}

/**
 * JS script that runs inside the Xiaohongshu creator center page context.
 * This is the same script whether injected via Playwright or Tauri.
 *
 * @param title - Note title
 * @param text - Note text content
 * @param tags - Hashtags to add
 */
export function editorAutomationScript(
  title: string,
  text: string,
  tags: string[]
): string {
  return `
(async () => {
  // Wait for editor to load
  await new Promise(r => setTimeout(r, 1000));

  // Fill title
  const titleEl = document.querySelector('[placeholder*="title" i], .title-input, #title');
  if (titleEl) {
    titleEl.value = ${JSON.stringify(title)};
    titleEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Fill description/text
  const descEl = document.querySelector('[placeholder*="description" i], .desc-input, .ql-editor, [contenteditable="true"]');
  if (descEl) {
    if (descEl.getAttribute('contenteditable') === 'true') {
      descEl.innerHTML = ${JSON.stringify(text)};
    } else {
      descEl.value = ${JSON.stringify(text)};
    }
    descEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Add hashtags
  const tagsText = ${JSON.stringify(tags)}.map(t => '#' + t + ' ').join('');
  if (descEl && tagsText) {
    const current = descEl.getAttribute('contenteditable') === 'true'
      ? descEl.innerHTML
      : descEl.value;
    const withTags = current + '\\n' + tagsText;
    if (descEl.getAttribute('contenteditable') === 'true') {
      descEl.innerHTML = withTags;
    } else {
      descEl.value = withTags;
    }
    descEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  return { success: true };
})()
`;
}
