/**
 * Enhance hook for Email Newsletter plugin
 *
 * Injects subscribe forms into HTML footer sections.
 *
 * Pure transformer: operates on ctx.files, returns modified HTML.
 * No file I/O for site HTML — the pipeline handles reading/writing.
 */

import {
  readPluginFile,
  writePluginFile,
  pluginFileExists,
  type HookResult,
} from "@symbiosis-lab/moss-api";
import { getNewsletterInfo } from "./buttondown";
import { injectInlineStyle } from "./inject";
import type { PluginConfig } from "./types";

const CSS_FILENAME = "email-subscribe.css";

/**
 * A file passed into the enhance hook by the pipeline.
 */
export interface EnhanceFile {
  path: string;
  html: string;
}

/**
 * A file modified by the enhance hook, returned to the pipeline.
 */
export interface ModifiedFile {
  path: string;
  html: string;
}

/**
 * Result returned from the enhance hook.
 * Extends HookResult with an array of modified files.
 */
export interface EnhanceResult extends HookResult {
  modified?: ModifiedFile[];
}

/**
 * Context passed to enhance hook
 */
export interface EnhanceContext {
  project_path: string;
  moss_dir: string;
  output_dir: string;
  project_info: { project_path: string; moss_dir: string; output_dir: string };
  config: Record<string, unknown>;
  interactions: unknown[];
  files: EnhanceFile[];
}

/**
 * Enhance hook - injects subscribe forms into HTML files.
 *
 * Pure transformer: reads from ctx.files, returns modified files.
 * The pipeline is responsible for writing modified files back to disk.
 */
export async function enhance(ctx: EnhanceContext): Promise<EnhanceResult> {
  const config = ctx.config as PluginConfig;

  if (!config.api_key) {
    console.warn(
      "No Buttondown API key configured, skipping footer injection"
    );
    return { success: false, message: "No API key configured" };
  }

  // Get username (cached or from API)
  let username: string;
  try {
    if (await pluginFileExists("newsletter-info.json")) {
      const cached = JSON.parse(await readPluginFile("newsletter-info.json"));
      username = cached.username;
    } else {
      const info = await getNewsletterInfo(config.api_key);
      username = info.username;
      await writePluginFile(
        "newsletter-info.json",
        JSON.stringify({ username })
      );
    }
  } catch (e) {
    return { success: false, message: `Failed to get newsletter info: ${e}` };
  }

  // Read plugin CSS for inline injection
  let subscribeCss = "";
  try {
    subscribeCss = await readPluginFile(CSS_FILENAME);
  } catch {
    // CSS file not found — form will be unstyled
  }

  // Iterate ctx.files (all HTML from the pipeline) and transform
  const modified: ModifiedFile[] = [];

  for (const file of ctx.files) {
    try {
      const withForm = injectSubscribeForm(file.html, username);
      // Only inject CSS if the form was actually injected
      const result = withForm !== file.html
        ? injectInlineStyle(withForm, subscribeCss)
        : file.html;
      if (result !== file.html) {
        modified.push({ path: file.path, html: result });
      }
    } catch (e) {
      console.warn(`Failed to process ${file.path}: ${e}`);
    }
  }

  return { success: true, modified };
}

/**
 * Inject subscribe form into HTML footer
 */
function injectSubscribeForm(html: string, username: string): string {
  // Skip if form already injected (idempotency)
  if (html.includes('footer-subscribe-form')) return html;

  const footerContentRegex = /<div class="footer-content">([\s\S]*?)<\/div>/;
  const match = html.match(footerContentRegex);
  if (!match) return html;

  // Preserve existing content (RSS link) but remove description (button replaces it)
  const existingContent = match[1].trim();
  const cleanedContent = existingContent
    .replace(/<p class="footer-description">[\s\S]*?<\/p>/, '')
    .trim();

  // Detect language from HTML lang attribute
  const langMatch = html.match(/<html[^>]*\blang="([^"]+)"/);
  const lang = langMatch?.[1] || 'en';
  const isZh = lang.startsWith('zh');
  const placeholderText = isZh ? '邮箱' : 'email';
  const buttonText = isZh ? '订阅' : 'Subscribe';

  const formHtml = `<div class="footer-content">
    ${cleanedContent}
    <form action="https://buttondown.com/api/emails/embed-subscribe/${username}" method="post" class="footer-subscribe-form">
        <input type="email" name="email" class="moss-input" placeholder="${placeholderText}" required />
        <input type="hidden" value="1" name="embed" />
        <button type="submit" class="moss-btn">${buttonText}</button>
    </form>
</div>`;

  return html.replace(footerContentRegex, formHtml);
}
