/**
 * Enhance hook for Email Newsletter plugin
 *
 * Injects subscribe forms into HTML footer sections
 */

import {
  readFile,
  writeFile,
  listSiteFilesWithSizes,
  readPluginFile,
  writePluginFile,
  pluginFileExists,
  type HookResult,
} from "@symbiosis-lab/moss-api";
import { getNewsletterInfo } from "./buttondown";
import type { PluginConfig } from "./types";

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
}

/**
 * Enhance hook - injects subscribe forms into HTML files
 */
export async function enhance(ctx: EnhanceContext): Promise<HookResult> {
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

  // List HTML files in the compiled site output and inject form
  const siteFiles = await listSiteFilesWithSizes();
  const htmlFiles = siteFiles
    .map((f) => f.path)
    .filter((f) => f.endsWith(".html"));

  for (const sitePath of htmlFiles) {
    // readFile/writeFile operate on the project root, so prefix with .moss/site/
    const projectPath = `.moss/site/${sitePath}`;
    try {
      const html = await readFile(projectPath);
      const modified = injectSubscribeForm(html, username);
      if (modified !== html) {
        await writeFile(projectPath, modified);
      }
    } catch (e) {
      console.warn(`Failed to process ${sitePath}: ${e}`);
    }
  }

  return { success: true };
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

  // Preserve existing content (RSS link, description) and append inline form
  const existingContent = match[1].trim();

  // Detect language from HTML lang attribute
  const langMatch = html.match(/<html[^>]*\blang="([^"]+)"/);
  const lang = langMatch?.[1] || 'en';
  const isZh = lang.startsWith('zh');
  const placeholderText = isZh ? '邮箱' : 'email';
  const buttonText = isZh ? '订阅' : 'Subscribe';

  const formHtml = `<div class="footer-content">
    ${existingContent}
    <form action="https://buttondown.com/api/emails/embed-subscribe/${username}" method="post" class="footer-subscribe-form">
        <input type="email" name="email" class="moss-input" placeholder="${placeholderText}" required />
        <input type="hidden" value="1" name="embed" />
        <button type="submit" class="moss-btn">${buttonText}</button>
    </form>
</div>`;

  return html.replace(footerContentRegex, formHtml);
}
