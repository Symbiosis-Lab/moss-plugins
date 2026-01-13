/**
 * Nostr Plugin for Moss
 *
 * This is the main entry point for the Nostr plugin. It provides three hooks
 * that integrate with the Moss build pipeline:
 *
 * 1. **process** - Fetches social interactions from Nostr relays during build
 * 2. **enhance** - Renders all interactions into generated HTML pages
 * 3. **syndicate** - Publishes articles to Nostr as NIP-23 long-form content
 *
 * ## Architecture
 *
 * ```
 * process hook     → Fetch from Nostr relays → Interaction[]
 *        ↓
 * (core aggregates interactions from all plugins)
 *        ↓
 * enhance hook     → EnhanceContext.interactions → Inject into HTML
 *        ↓
 * syndicate hook   → Publish articles → Nostr relays
 * ```
 *
 * ## Usage
 *
 * Configure in moss.yaml:
 * ```yaml
 * plugins:
 *   nostr:
 *     relays:
 *       - wss://relay.damus.io
 *       - wss://nos.lol
 *     nsec: nsec1...  # For publishing (optional)
 * ```
 *
 * @module main
 * @see README.md for full documentation
 */

import { readFile, writeFile, log } from "@symbiosis-lab/moss-api";
import {
  fetchInteractionsFromRelays,
  publishEvent,
  createLongFormEvent,
  urlToIdentifier,
  decodeNsec,
  getPublicKeyFromPrivate,
  signEvent,
} from "./relay";
import { findInsertionPoint, injectWidget, detectSSG } from "./widget/inject";
import type {
  Interaction,
  ProcessContext,
  EnhanceContext,
  SyndicateContext,
  HookResult,
  PluginConfig,
} from "./types";

// ============================================================================
// Plugin Implementation
// ============================================================================

/**
 * Nostr Plugin Implementation
 *
 * Encapsulates all plugin functionality in a class for better organization.
 * The exported functions delegate to methods on a singleton instance.
 *
 * @internal
 */
class NostrPluginImpl {
  // --------------------------------------------------------------------------
  // Process Hook
  // --------------------------------------------------------------------------

  /**
   * Process Hook - Fetch interactions from Nostr relays
   *
   * This hook runs early in the build pipeline and is responsible for
   * fetching social interactions (comments, likes, zaps) from Nostr relays.
   *
   * The returned interactions are aggregated with those from other plugins
   * and passed to the enhance hook for rendering.
   *
   * ## Behavior
   *
   * 1. Reads relay URLs from plugin config
   * 2. Connects to each relay in parallel
   * 3. Queries for events referencing the site URL
   * 4. Converts Nostr events to universal Interaction format
   * 5. Returns interactions (or empty array on failure)
   *
   * ## Error Handling
   *
   * Failures are handled gracefully to not block the build:
   * - Individual relay failures are logged but don't stop processing
   * - Returns `success: true` even on complete failure (with empty interactions)
   * - Error details are included in the `message` field
   *
   * @param ctx - Process context with project info and config
   * @returns HookResult with fetched interactions
   */
  async process(ctx: ProcessContext): Promise<HookResult> {
    log("[info] Nostr: Fetching interactions from relays...");

    const config = ctx.config as PluginConfig;
    const relays = config.relays ?? [];

    // Early return if no relays configured
    if (relays.length === 0) {
      log("[info] Nostr: No relays configured, skipping fetch");
      return {
        success: true,
        message: "No relays configured",
        interactions: [],
      };
    }

    // Build list of article URLs to query for
    // TODO: In production, this should come from project_info or generated paths
    const siteUrl = (config.site_url as string) || "https://example.com";
    const articleUrls: string[] = [];

    // Query all configured relays for interactions
    try {
      // If no specific URLs configured, query for general site interactions
      const interactions = await fetchInteractionsFromRelays(
        relays,
        articleUrls.length > 0 ? articleUrls : [siteUrl]
      );

      log(`[info] Nostr: Found ${interactions.length} interactions`);

      return {
        success: true,
        message: `Fetched ${interactions.length} interactions from ${relays.length} relay(s)`,
        interactions,
      };
    } catch (error) {
      // Log error but don't fail the build
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`[warn] Nostr: Error fetching interactions: ${errorMessage}`);

      return {
        success: true, // Return success to not block the build
        message: `Fetch failed: ${errorMessage}`,
        interactions: [],
      };
    }
  }

  // --------------------------------------------------------------------------
  // Enhance Hook
  // --------------------------------------------------------------------------

  /**
   * Enhance Hook - Render all interactions into HTML pages
   *
   * This hook runs after HTML generation and receives aggregated interactions
   * from ALL plugins' process hooks (not just Nostr). It's responsible for
   * injecting the interaction UI into generated HTML pages.
   *
   * ## Behavior
   *
   * 1. Groups interactions by target URL
   * 2. For each HTML file with interactions:
   *    - Reads the file
   *    - Injects interaction island before `</article>`
   *    - Injects async loader script before `</body>`
   *    - Writes the modified file
   * 3. Copies browser assets (JS/CSS) to output directory
   *
   * ## Injected HTML Structure
   *
   * ```html
   * <!-- Before </article> -->
   * <section id="nostr-interactions" class="social-interactions">
   *   <script type="application/json" id="interactions-data">
   *     {"interactions": [...], "config": {...}}
   *   </script>
   *   <noscript>
   *     <!-- Static fallback for no-JS browsers -->
   *   </noscript>
   * </section>
   *
   * <!-- Before </body> -->
   * <script>
   *   // Async loader for browser JS/CSS
   * </script>
   * ```
   *
   * ## Progressive Enhancement
   *
   * - Works without JavaScript (static fallback in `<noscript>`)
   * - Browser JS/CSS loaded asynchronously (doesn't block render)
   * - Hydrates with interactive features when JS loads
   *
   * @param ctx - Enhance context with aggregated interactions
   * @returns HookResult indicating success/failure
   */
  async enhance(ctx: EnhanceContext): Promise<HookResult> {
    log(`[info] Nostr: Rendering ${ctx.interactions.length} interactions...`);

    // Early return if no interactions to render
    if (ctx.interactions.length === 0) {
      log("[info] Nostr: No interactions to render");
      return { success: true };
    }

    // Group interactions by target URL for efficient processing
    const byTarget = new Map<string, Interaction[]>();
    for (const interaction of ctx.interactions) {
      const list = byTarget.get(interaction.target_url) || [];
      list.push(interaction);
      byTarget.set(interaction.target_url, list);
    }

    // Inject interactions into each HTML file
    for (const [targetUrl, interactions] of byTarget) {
      const htmlPath = `${ctx.output_dir}/${targetUrl}`;

      try {
        const html = await readFile(htmlPath);
        const enriched = this.injectInteractionIsland(html, interactions);
        await writeFile(htmlPath, enriched);
        log(`[info] Nostr: Injected ${interactions.length} interactions into ${targetUrl}`);
      } catch (e) {
        // Log error but continue with other files
        log(`[warn] Nostr: Failed to process ${targetUrl}: ${e}`);
      }
    }

    // Copy browser JS/CSS to output directory
    await this.copyBrowserAssets(ctx.output_dir);

    return { success: true };
  }

  // --------------------------------------------------------------------------
  // Syndicate Hook
  // --------------------------------------------------------------------------

  /**
   * Syndicate Hook - Publish articles to Nostr relays
   *
   * This hook runs after the build completes and publishes articles to Nostr
   * as NIP-23 long-form content events (kind:30023).
   *
   * ## Requirements
   *
   * - `nsec` must be configured (NIP-19 format private key)
   * - At least one relay must be configured
   * - At least one article must be in the context
   *
   * ## Behavior
   *
   * 1. Validates configuration (nsec, relays)
   * 2. Decodes nsec to get private key
   * 3. Derives public key for signing
   * 4. For each article:
   *    - Creates NIP-23 long-form event
   *    - Signs event with private key
   *    - Publishes to all configured relays
   * 5. Reports success/failure counts
   *
   * ## NIP-23 Event Structure
   *
   * ```json
   * {
   *   "kind": 30023,
   *   "pubkey": "<derived from nsec>",
   *   "content": "<article content>",
   *   "tags": [
   *     ["d", "<slug>"],
   *     ["title", "<title>"],
   *     ["published_at", "<timestamp>"],
   *     ["t", "<tag1>"],
   *     ["t", "<tag2>"]
   *   ]
   * }
   * ```
   *
   * @param ctx - Syndicate context with articles to publish
   * @returns HookResult with publish status
   *
   * @see https://github.com/nostr-protocol/nips/blob/master/23.md
   */
  async syndicate(ctx: SyndicateContext): Promise<HookResult> {
    log("[info] Nostr: Publishing articles to Nostr relays...");

    const config = ctx.config as PluginConfig;
    const relays = config.relays ?? [];
    const nsec = config.nsec;

    // Validate: nsec required for publishing
    if (!nsec) {
      log("[info] Nostr: No private key configured, skipping publish");
      return {
        success: true,
        message: "No signing key configured - articles not published to Nostr",
      };
    }

    // Validate: relays required
    if (relays.length === 0) {
      log("[info] Nostr: No relays configured, skipping publish");
      return {
        success: true,
        message: "No relays configured",
      };
    }

    // Validate: articles required
    if (ctx.articles.length === 0) {
      log("[info] Nostr: No articles to publish");
      return {
        success: true,
        message: "No articles to publish",
      };
    }

    // Decode nsec to get private key bytes
    const privateKey = decodeNsec(nsec);
    if (!privateKey) {
      log("[warn] Nostr: Invalid nsec key format");
      return {
        success: false,
        message: "Invalid nsec key format - unable to decode private key",
      };
    }

    // Derive public key from private key
    const pubkey = getPublicKeyFromPrivate(privateKey);
    log(`[info] Nostr: Publishing as ${pubkey.slice(0, 12)}...`);

    let publishedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Publish each article
    for (const article of ctx.articles) {
      try {
        // Generate slug/identifier from URL path
        const slug = urlToIdentifier(article.url_path);

        // Create unsigned NIP-23 event
        const unsignedEvent = createLongFormEvent(
          {
            title: article.title,
            content: article.content || "",
            slug,
            tags: article.tags,
          },
          pubkey
        );

        // Sign the event
        const signedEvent = signEvent(unsignedEvent, privateKey);

        // Publish to all configured relays
        const result = await publishEvent(relays, signedEvent);

        if (result.success) {
          publishedCount++;
          log(`[info] Nostr: Published "${article.title}" to ${result.published.length} relay(s)`);
        } else {
          failedCount++;
          errors.push(`"${article.title}": Failed to publish to any relay`);
        }

        // Log partial failures (some relays succeeded, some failed)
        if (result.failed.length > 0) {
          log(`[warn] Nostr: Failed to publish to: ${result.failed.join(", ")}`);
        }
      } catch (error) {
        failedCount++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`"${article.title}": ${errorMsg}`);
        log(`[warn] Nostr: Error publishing article "${article.title}": ${errorMsg}`);
      }
    }

    // Build result message
    const success = failedCount === 0;
    let message = `Published ${publishedCount}/${ctx.articles.length} articles to Nostr`;
    if (errors.length > 0) {
      message += `. Errors: ${errors.join("; ")}`;
    }

    return { success, message };
  }

  // --------------------------------------------------------------------------
  // HTML Injection
  // --------------------------------------------------------------------------

  /**
   * Inject an interaction island into HTML content.
   *
   * Uses SSG-aware injection to find the best insertion point across
   * different static site generators (Hugo, Hexo, Astro, Jekyll, etc.)
   *
   * @param html - Original HTML content
   * @param interactions - Interactions to embed
   * @returns Modified HTML with injected interaction island
   *
   * @internal
   */
  private injectInteractionIsland(html: string, interactions: Interaction[]): string {
    // Detect SSG for logging
    const ssg = detectSSG(html);
    log(`[info] Nostr: Detected SSG: ${ssg}`);

    // Find the best insertion point (SSG-aware)
    const insertionPoint = findInsertionPoint(html);
    if (insertionPoint === html.length) {
      // No suitable insertion point found
      log("[warn] Nostr: No suitable insertion point found, skipping injection");
      return html;
    }

    // Serialize interactions as JSON for browser hydration
    const interactionsJson = JSON.stringify({
      interactions,
      config: {
        // Add any config needed by browser JS
      },
    });

    // Build the interaction island HTML
    const island = `<section id="moss-comments" class="social-interactions">
  <script type="application/json" id="moss-comments-data">
    ${interactionsJson}
  </script>
  <noscript>
    <div class="interactions-static">
      <h3>Comments (${interactions.length})</h3>
      ${this.renderStaticInteractions(interactions)}
    </div>
  </noscript>
</section>`;

    // Build the async loader script
    const loader = `
<script>
(function() {
  if (!document.getElementById('moss-comments')) return;
  var s = document.createElement('script');
  s.src = '/js/moss-comments.js';
  s.async = true;
  document.body.appendChild(s);
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/moss-comments.css';
  document.head.appendChild(l);
})();
</script>`;

    // Use the widget injection utility
    return injectWidget(html, island, loader);
  }

  /**
   * Render static HTML for the no-JavaScript fallback.
   *
   * This content appears in the `<noscript>` section for users without
   * JavaScript. It shows a summary of likes and a list of comments.
   *
   * @param interactions - Interactions to render
   * @returns Static HTML string
   *
   * @internal
   */
  private renderStaticInteractions(interactions: Interaction[]): string {
    // Separate by type
    const comments = interactions.filter((i) => i.interaction_type === "comment");
    const likes = interactions.filter((i) => i.interaction_type === "like");

    let html = "";

    // Show like count
    if (likes.length > 0) {
      html += `<p>👏 ${likes.length} ${likes.length === 1 ? "like" : "likes"}</p>`;
    }

    // Show comments (limited to 10)
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
   * Copy browser assets (JS/CSS) to the output directory.
   *
   * In production, this would copy the actual bundled assets from the plugin's
   * dist folder. For now, it creates placeholder files.
   *
   * @param outputDir - Absolute path to the output directory
   *
   * @internal
   */
  private async copyBrowserAssets(outputDir: string): Promise<void> {
    const jsDir = `${outputDir}/js`;
    const cssDir = `${outputDir}/css`;

    // TODO: In production, read actual bundled assets from plugin dist folder
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
      log(`[warn] Failed to copy browser assets: ${e}`);
    }
  }

  /**
   * Escape HTML special characters to prevent XSS.
   *
   * @param text - Text to escape
   * @returns HTML-safe string
   *
   * @internal
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Plugin singleton instance.
 *
 * @internal
 */
const plugin = new NostrPluginImpl();

/**
 * Process hook export.
 *
 * Called during the build to fetch social interactions from Nostr relays.
 *
 * @param ctx - Process context from Moss
 * @returns HookResult with fetched interactions
 */
export const process = (ctx: ProcessContext) => plugin.process(ctx);

/**
 * Enhance hook export.
 *
 * Called after HTML generation to inject interaction UI into pages.
 *
 * @param ctx - Enhance context with aggregated interactions
 * @returns HookResult indicating success
 */
export const enhance = (ctx: EnhanceContext) => plugin.enhance(ctx);

/**
 * Syndicate hook export.
 *
 * Called after build to publish articles to Nostr relays.
 *
 * @param ctx - Syndicate context with articles to publish
 * @returns HookResult with publish status
 */
export const syndicate = (ctx: SyndicateContext) => plugin.syndicate(ctx);
