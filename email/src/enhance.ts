/**
 * Enhance hook for Email Newsletter plugin
 *
 * Injects subscribe forms into HTML footer sections
 */

import {
  readFile,
  writeFile,
  listFiles,
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

  // List HTML files and inject form
  const files = await listFiles();
  const htmlFiles = files.filter((f) => f.endsWith(".html"));

  for (const filePath of htmlFiles) {
    try {
      const html = await readFile(filePath);
      const modified = injectSubscribeForm(html, username);
      if (modified !== html) {
        await writeFile(filePath, modified);
      }
    } catch (e) {
      console.warn(`Failed to process ${filePath}: ${e}`);
    }
  }

  return { success: true };
}

/**
 * Inject subscribe form into HTML footer
 */
function injectSubscribeForm(html: string, username: string): string {
  const footerContentRegex = /<div class="footer-content">([\s\S]*?)<\/div>/;
  const match = html.match(footerContentRegex);
  if (!match) return html;

  const formHtml = `<div class="footer-content">
    <a href="/feed.xml" class="footer-link" data-external>RSS</a>
    <form action="https://buttondown.com/api/emails/embed-subscribe/${username}" method="post" class="footer-subscribe-form">
        <input type="email" name="email" placeholder="your@email.com" required />
        <input type="hidden" value="1" name="embed" />
        <button type="submit">Subscribe</button>
    </form>
</div>`;

  return html.replace(footerContentRegex, formHtml);
}
