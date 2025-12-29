/**
 * Nostr Plugin for Moss
 *
 * Provides social interactions via the Nostr protocol:
 * - process: Fetch interactions (comments, zaps) from Nostr relays
 * - enhance: Render all interactions into HTML pages
 * - syndicate: Publish articles to Nostr as long-form content (NIP-23)
 */

import { readFile, writeFile, log } from "@symbiosis-lab/moss-api";

// Types
interface Interaction {
  id: string;
  source: string;
  interaction_type: string;
  author: {
    name?: string;
    avatar?: string;
    profile_url?: string;
    identifier?: string;
  };
  content?: string;
  content_html?: string;
  published_at?: string;
  source_url?: string;
  target_url: string;
  meta?: Record<string, unknown>;
}

interface ProcessContext {
  project_path: string;
  moss_dir: string;
  project_info: {
    content_folders: string[];
    total_files: number;
    homepage_file?: string;
  };
  config: Record<string, unknown>;
}

interface EnhanceContext {
  project_path: string;
  moss_dir: string;
  output_dir: string;
  project_info: {
    content_folders: string[];
    total_files: number;
    homepage_file?: string;
  };
  config: Record<string, unknown>;
  interactions: Interaction[];
}

interface SyndicateContext {
  project_path: string;
  moss_dir: string;
  output_dir: string;
  site_url: string;
  articles: Array<{
    title: string;
    url_path: string;
    content?: string;
    tags?: string[];
  }>;
  config: Record<string, unknown>;
}

interface HookResult {
  success: boolean;
  message?: string;
  interactions?: Interaction[];
}

// Plugin implementation
class NostrPluginImpl {
  /**
   * Process hook - fetch interactions from Nostr relays
   */
  async process(ctx: ProcessContext): Promise<HookResult> {
    log("info", "Nostr: Fetching interactions from relays...");

    const interactions: Interaction[] = [];

    // TODO: Implement Nostr relay fetching
    // - Connect to configured relays
    // - Query for kind:1 (notes) that reference article URLs
    // - Query for kind:9735 (zaps) for articles
    // - Convert to Interaction format

    log("info", `Nostr: Found ${interactions.length} interactions`);

    return {
      success: true,
      message: `Fetched ${interactions.length} interactions`,
      interactions,
    };
  }

  /**
   * Enhance hook - render all interactions into HTML pages
   *
   * This plugin is responsible for rendering ALL interactions (from Nostr,
   * Matters, webmentions, etc.) into the generated HTML.
   */
  async enhance(ctx: EnhanceContext): Promise<HookResult> {
    log("info", `Nostr: Rendering ${ctx.interactions.length} interactions...`);

    if (ctx.interactions.length === 0) {
      log("info", "Nostr: No interactions to render");
      return { success: true };
    }

    // Group interactions by target URL
    const byTarget = new Map<string, Interaction[]>();
    for (const interaction of ctx.interactions) {
      const list = byTarget.get(interaction.target_url) || [];
      list.push(interaction);
      byTarget.set(interaction.target_url, list);
    }

    // For each article with interactions, inject the social section
    for (const [targetUrl, interactions] of byTarget) {
      const htmlPath = `${ctx.output_dir}/${targetUrl}`;

      try {
        const html = await readFile(htmlPath);
        const enriched = this.injectInteractionIsland(html, interactions);
        await writeFile(htmlPath, enriched);
        log("info", `Nostr: Injected ${interactions.length} interactions into ${targetUrl}`);
      } catch (e) {
        log("warn", `Nostr: Failed to process ${targetUrl}: ${e}`);
      }
    }

    // Copy browser JS/CSS to output
    await this.copyBrowserAssets(ctx.output_dir);

    return { success: true };
  }

  /**
   * Syndicate hook - publish articles to Nostr
   */
  async syndicate(ctx: SyndicateContext): Promise<HookResult> {
    log("info", "Nostr: Publishing articles to Nostr relays...");

    // TODO: Implement Nostr publishing
    // - Create kind:30023 long-form content events (NIP-23)
    // - Sign with user's private key (from config or NIP-07)
    // - Publish to configured relays

    return { success: true };
  }

  /**
   * Inject interaction island into HTML
   */
  private injectInteractionIsland(html: string, interactions: Interaction[]): string {
    // Find </article> and inject before it
    const articleEnd = html.lastIndexOf("</article>");
    if (articleEnd === -1) {
      return html; // No article tag, skip
    }

    const interactionsJson = JSON.stringify({
      interactions,
      config: {
        // Add any config needed by browser JS
      },
    });

    const island = `
<section id="nostr-interactions" class="social-interactions">
  <script type="application/json" id="interactions-data">
    ${interactionsJson}
  </script>
  <noscript>
    <div class="interactions-static">
      <h3>Responses (${interactions.length})</h3>
      ${this.renderStaticInteractions(interactions)}
    </div>
  </noscript>
</section>
`;

    const loader = `
<script>
(function() {
  if (!document.getElementById('nostr-interactions')) return;
  var s = document.createElement('script');
  s.src = '/js/nostr-social.js';
  s.async = true;
  document.body.appendChild(s);
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/nostr-social.css';
  document.head.appendChild(l);
})();
</script>
`;

    // Inject island before </article>
    let result = html.slice(0, articleEnd) + island + html.slice(articleEnd);

    // Inject loader before </body>
    const bodyEnd = result.lastIndexOf("</body>");
    if (bodyEnd !== -1) {
      result = result.slice(0, bodyEnd) + loader + result.slice(bodyEnd);
    }

    return result;
  }

  /**
   * Render static HTML for no-JS fallback
   */
  private renderStaticInteractions(interactions: Interaction[]): string {
    const comments = interactions.filter((i) => i.interaction_type === "comment");
    const likes = interactions.filter((i) => i.interaction_type === "like");

    let html = "";

    if (likes.length > 0) {
      html += `<p>👏 ${likes.length} ${likes.length === 1 ? "like" : "likes"}</p>`;
    }

    if (comments.length > 0) {
      html += "<ul class='comments-list'>";
      for (const comment of comments.slice(0, 10)) {
        html += `
<li class="comment">
  <strong>${this.escapeHtml(comment.author.name || "Anonymous")}</strong>
  <span class="source">(${comment.source})</span>
  <p>${this.escapeHtml(comment.content || "")}</p>
</li>`;
      }
      html += "</ul>";
    }

    return html || "<p>No responses yet.</p>";
  }

  /**
   * Copy browser JS/CSS assets to output
   */
  private async copyBrowserAssets(outputDir: string): Promise<void> {
    // The browser assets are bundled with the plugin
    // They need to be copied to the output directory
    // For now, we'll create placeholder files
    // In a real implementation, these would be read from the plugin's dist folder

    const jsDir = `${outputDir}/js`;
    const cssDir = `${outputDir}/css`;

    // Create directories (will be created by writeFile if needed)
    const placeholderJs = `// Nostr social interactions - placeholder
console.log('Nostr social interactions loaded');
`;
    const placeholderCss = `/* Nostr social interactions - placeholder */
.social-interactions { margin-top: 2rem; }
`;

    try {
      await writeFile(`${jsDir}/nostr-social.js`, placeholderJs);
      await writeFile(`${cssDir}/nostr-social.css`, placeholderCss);
    } catch (e) {
      log("warn", `Failed to copy browser assets: ${e}`);
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

// Export plugin instance
const plugin = new NostrPluginImpl();

export const process = (ctx: ProcessContext) => plugin.process(ctx);
export const enhance = (ctx: EnhanceContext) => plugin.enhance(ctx);
export const syndicate = (ctx: SyndicateContext) => plugin.syndicate(ctx);
