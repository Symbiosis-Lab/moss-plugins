/**
 * Nostr Social Interactions - Browser Hydration Script
 *
 * This script runs in the browser to hydrate server-rendered interaction
 * islands with interactive functionality. It's loaded asynchronously after
 * the page renders to avoid blocking the initial page load.
 *
 * ## Features
 *
 * - **Hydration**: Parses embedded JSON data and renders interactive UI
 * - **NIP-07 Login**: Integrates with browser extensions (Alby, nos2x)
 * - **Reply Form**: Enables posting replies (when logged in)
 * - **Zap Button**: Placeholder for NIP-57 zap functionality
 * - **Auto-refresh**: Periodically fetches fresh interactions from relays
 * - **Dark Mode**: Supports CSS custom properties for theming
 *
 * ## Usage
 *
 * This script is automatically loaded by the async loader injected during
 * the enhance hook. It expects the following HTML structure:
 *
 * ```html
 * <section id="nostr-interactions">
 *   <script type="application/json" id="interactions-data">
 *     {"interactions": [...], "config": {...}}
 *   </script>
 * </section>
 * ```
 *
 * ## Styling
 *
 * The script adds a "loaded" class to the container when hydration completes.
 * Use this for CSS transitions:
 *
 * ```css
 * .social-interactions:not(.loaded) { opacity: 0; }
 * .social-interactions.loaded { opacity: 1; transition: opacity 0.3s; }
 * ```
 *
 * @module nostr-social
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Social interaction from any platform.
 *
 * Matches the Interaction type from the plugin's types.ts.
 */
interface Interaction {
  /** Unique identifier for this interaction */
  id: string;

  /** Source platform: "nostr", "matters", "webmention" */
  source: string;

  /** Type: "comment", "like", "repost", "zap" */
  interaction_type: string;

  /** Author information */
  author: {
    name?: string;
    avatar?: string;
    profile_url?: string;
    identifier?: string;
  };

  /** Text content (for comments) */
  content?: string;

  /** HTML content (if pre-rendered) */
  content_html?: string;

  /** ISO 8601 timestamp */
  published_at?: string;

  /** URL to view on source platform */
  source_url?: string;

  /** URL of the article this interaction is for */
  target_url: string;

  /** Platform-specific metadata (e.g., zap amount) */
  meta?: Record<string, unknown>;
}

/**
 * Data structure embedded in the page by the enhance hook.
 */
interface InteractionData {
  /** Array of interactions to display */
  interactions: Interaction[];

  /** Configuration from plugin settings */
  config: Record<string, unknown>;
}

/**
 * NIP-07 browser extension interface.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/07.md
 */
interface Nip07Extension {
  /** Get the user's public key */
  getPublicKey(): Promise<string>;

  /** Sign an event */
  signEvent(event: object): Promise<object>;

  /** Get relays (optional) */
  getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>;
}

// Window with NIP-07 extension (cast as needed)
type WindowWithNostr = Window & { nostr?: Nip07Extension };

// ============================================================================
// Main Class
// ============================================================================

/**
 * Manages social interaction UI in the browser.
 *
 * This class handles:
 * - Parsing embedded interaction data
 * - Rendering the interactive UI
 * - NIP-07 login flow
 * - Reply and zap functionality (placeholders)
 * - Periodic refresh from relays
 *
 * @example
 * ```typescript
 * // Automatic initialization on DOM ready
 * new NostrSocialManager();
 * ```
 */
class NostrSocialManager {
  /** Container element for the interaction UI */
  private container: HTMLElement | null;

  /** Parsed interaction data from embedded JSON */
  private data: InteractionData | null = null;

  /** Current user's public key (if logged in) */
  private userPubkey: string | null = null;

  /**
   * Create a new NostrSocialManager.
   *
   * Automatically initializes by finding the container element
   * and parsing embedded data.
   */
  constructor() {
    this.container = document.getElementById("nostr-interactions");
    this.init();
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the manager.
   *
   * 1. Finds the container element
   * 2. Parses embedded JSON data
   * 3. Renders the interactive UI
   * 4. Schedules periodic refresh
   *
   * @private
   */
  private init(): void {
    if (!this.container) {
      // No interaction section on this page
      return;
    }

    // Parse embedded data from the JSON script tag
    const dataEl = document.getElementById("interactions-data");
    if (dataEl) {
      try {
        this.data = JSON.parse(dataEl.textContent || "{}");
      } catch (e) {
        console.error("[Nostr Social] Failed to parse interaction data:", e);
        return;
      }
    }

    // Render the interactive UI
    this.render();

    // Schedule periodic refresh from relays
    this.scheduleRefresh();
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  /**
   * Render the complete interaction UI.
   *
   * Replaces the noscript fallback with interactive elements:
   * - Header with login button
   * - Stats (likes, zaps)
   * - Comments list
   * - Reply form (hidden until login)
   *
   * @private
   */
  private render(): void {
    if (!this.container || !this.data) return;

    const { interactions } = this.data;

    // Separate interactions by type
    const comments = interactions.filter((i) => i.interaction_type === "comment");
    const likes = interactions.filter((i) => i.interaction_type === "like");
    const zaps = interactions.filter((i) => i.interaction_type === "zap");

    // Build the UI
    this.container.innerHTML = `
      <div class="social-header">
        <h3>Responses</h3>
        <button id="nostr-login-btn" class="nostr-login">Login with Nostr</button>
      </div>

      ${this.renderStats(likes, zaps)}
      ${this.renderComments(comments)}
      ${this.renderReplyForm()}
    `;

    // Attach event listeners to buttons
    this.attachEventListeners();

    // Mark as loaded (triggers CSS transition)
    this.container.classList.add("loaded");
  }

  /**
   * Render stats section (likes and zaps).
   *
   * @param likes - Like interactions
   * @param zaps - Zap interactions
   * @returns HTML string for stats section
   *
   * @private
   */
  private renderStats(likes: Interaction[], zaps: Interaction[]): string {
    if (likes.length === 0 && zaps.length === 0) {
      return "";
    }

    // Calculate total zap amount if available
    const totalSats = zaps.reduce((sum, z) => {
      const amount = (z.meta?.amount as number) || 0;
      return sum + amount;
    }, 0);

    return `
      <div class="social-stats">
        ${likes.length > 0 ? `<span class="stat likes">👍 ${likes.length}</span>` : ""}
        ${zaps.length > 0 ? `<span class="stat zaps">⚡ ${zaps.length}${totalSats > 0 ? ` (${this.formatSats(totalSats)})` : ""}</span>` : ""}
      </div>
    `;
  }

  /**
   * Render the comments list.
   *
   * @param comments - Comment interactions
   * @returns HTML string for comments section
   *
   * @private
   */
  private renderComments(comments: Interaction[]): string {
    if (comments.length === 0) {
      return '<p class="no-comments">No comments yet. Be the first to respond!</p>';
    }

    const commentHtml = comments
      .map((c) => {
        // Avatar: use image if available, otherwise placeholder
        const avatar = c.author.avatar
          ? `<img src="${this.escapeHtml(c.author.avatar)}" alt="" class="avatar" loading="lazy">`
          : '<div class="avatar-placeholder"></div>';

        const name = c.author.name || "Anonymous";
        const date = c.published_at ? this.formatDate(c.published_at) : "";

        // Link to source if available
        const sourceLink = c.source_url
          ? `<a href="${this.escapeHtml(c.source_url)}" target="_blank" rel="noopener" class="source badge-${c.source}">${c.source}</a>`
          : `<span class="source badge-${c.source}">${c.source}</span>`;

        return `
        <div class="comment" data-id="${this.escapeHtml(c.id)}">
          <div class="comment-header">
            ${avatar}
            <span class="author">${this.escapeHtml(name)}</span>
            ${sourceLink}
            ${date ? `<span class="date">${date}</span>` : ""}
          </div>
          <div class="comment-content">
            ${c.content_html || this.escapeHtml(c.content || "")}
          </div>
        </div>
      `;
      })
      .join("");

    return `<div class="comments-list">${commentHtml}</div>`;
  }

  /**
   * Render the reply form (hidden until login).
   *
   * @returns HTML string for reply form
   *
   * @private
   */
  private renderReplyForm(): string {
    return `
      <div class="reply-form" id="nostr-reply-form" style="display: none;">
        <textarea
          placeholder="Write a reply..."
          id="nostr-reply-input"
          rows="3"
          maxlength="1000"
        ></textarea>
        <div class="reply-actions">
          <button id="nostr-submit-reply" class="btn-primary">Reply</button>
          <button id="nostr-zap-btn" class="btn-zap">⚡ Zap</button>
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // Event Handling
  // --------------------------------------------------------------------------

  /**
   * Attach event listeners to interactive elements.
   *
   * @private
   */
  private attachEventListeners(): void {
    // Login button
    const loginBtn = document.getElementById("nostr-login-btn");
    if (loginBtn) {
      loginBtn.addEventListener("click", () => this.handleLogin());
    }

    // Reply submit button
    const submitBtn = document.getElementById("nostr-submit-reply");
    if (submitBtn) {
      submitBtn.addEventListener("click", () => this.handleReply());
    }

    // Zap button
    const zapBtn = document.getElementById("nostr-zap-btn");
    if (zapBtn) {
      zapBtn.addEventListener("click", () => this.handleZap());
    }
  }

  /**
   * Handle login button click.
   *
   * Uses NIP-07 to get the user's public key from their browser extension.
   * Shows the reply form on successful login.
   *
   * @private
   */
  private async handleLogin(): Promise<void> {
    // Check for NIP-07 extension
    const win = window as WindowWithNostr;
    if (typeof window !== "undefined" && win.nostr) {
      try {
        // Request public key from extension
        const pubkey = await win.nostr.getPublicKey();
        this.userPubkey = pubkey;

        console.log("[Nostr Social] Logged in as:", pubkey);

        // Show reply form
        const form = document.getElementById("nostr-reply-form");
        if (form) {
          form.style.display = "block";
        }

        // Update login button to show logged-in state
        const btn = document.getElementById("nostr-login-btn");
        if (btn) {
          btn.textContent = `Logged in: ${pubkey.slice(0, 8)}...`;
          btn.classList.add("logged-in");
          btn.setAttribute("disabled", "true");
        }
      } catch (e) {
        console.error("[Nostr Social] Login failed:", e);
        alert("Login failed. Please try again.");
      }
    } else {
      // No extension found
      alert(
        "No Nostr extension found.\n\nPlease install a NIP-07 compatible extension like:\n- Alby (getalby.com)\n- nos2x\n- Flamingo"
      );
    }
  }

  /**
   * Handle reply form submission.
   *
   * TODO: Implement actual Nostr event creation and publishing.
   *
   * @private
   */
  private async handleReply(): Promise<void> {
    const input = document.getElementById("nostr-reply-input") as HTMLTextAreaElement;
    if (!input || !input.value.trim()) {
      return;
    }

    if (!this.userPubkey) {
      alert("Please login first to post a reply.");
      return;
    }

    // TODO: Implement reply posting
    // 1. Create kind:1 event with content
    // 2. Add "r" tag referencing the article URL
    // 3. Sign with NIP-07
    // 4. Publish to relays
    console.log("[Nostr Social] Posting reply:", input.value);
    alert("Reply posting coming soon!");
  }

  /**
   * Handle zap button click.
   *
   * TODO: Implement NIP-57 zap functionality.
   *
   * @private
   */
  private async handleZap(): Promise<void> {
    // TODO: Implement zapping
    // 1. Get article author's lightning address (lud16)
    // 2. Create zap request (kind:9734)
    // 3. Sign with NIP-07
    // 4. Send to LNURL endpoint
    console.log("[Nostr Social] Zapping...");
    alert("Zapping coming soon!");
  }

  // --------------------------------------------------------------------------
  // Refresh
  // --------------------------------------------------------------------------

  /**
   * Schedule periodic refresh of interactions.
   *
   * Refreshes every 5 minutes to show new interactions.
   *
   * @private
   */
  private scheduleRefresh(): void {
    // Refresh every 5 minutes
    setTimeout(() => this.refresh(), 5 * 60 * 1000);
  }

  /**
   * Fetch fresh interactions from Nostr relays.
   *
   * TODO: Implement actual relay fetching.
   *
   * @private
   */
  private async refresh(): Promise<void> {
    // TODO: Implement relay fetching
    // 1. Connect to relays from config
    // 2. Subscribe to events referencing this article
    // 3. Merge with existing interactions
    // 4. Re-render if new interactions found
    console.log("[Nostr Social] Refreshing interactions...");

    // Schedule next refresh
    this.scheduleRefresh();
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  /**
   * Format an ISO date string for display.
   *
   * @param iso - ISO 8601 date string
   * @returns Formatted date string (e.g., "Jan 15, 2024")
   *
   * @private
   */
  private formatDate(iso: string): string {
    try {
      const date = new Date(iso);
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  /**
   * Format satoshi amount for display.
   *
   * @param sats - Amount in satoshis
   * @returns Formatted string (e.g., "21k sats", "1.5M sats")
   *
   * @private
   */
  private formatSats(sats: number): string {
    if (sats >= 1_000_000) {
      return `${(sats / 1_000_000).toFixed(1)}M sats`;
    } else if (sats >= 1_000) {
      return `${(sats / 1_000).toFixed(1)}k sats`;
    }
    return `${sats} sats`;
  }

  /**
   * Escape HTML special characters to prevent XSS.
   *
   * Uses the browser's built-in text escaping via textContent.
   *
   * @param text - Text to escape
   * @returns HTML-safe string
   *
   * @private
   */
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize NostrSocialManager when DOM is ready.
 *
 * If the DOM is still loading, wait for DOMContentLoaded.
 * Otherwise, initialize immediately.
 */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new NostrSocialManager());
} else {
  new NostrSocialManager();
}
