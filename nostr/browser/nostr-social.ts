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

  /** Build timestamp (Unix seconds) - used for polling new comments */
  buildTime?: number;
}

/**
 * Nostr event structure for relay responses.
 */
interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
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

  /** Type of signer being used */
  private signerType: "nip07" | "local" | "iframe" | null = null;

  /** Local private key (if using local signer) */
  private localPrivateKey: Uint8Array | null = null;

  /** Timestamp of last known interaction (for polling new ones) */
  private lastKnownTimestamp: number = 0;

  /** Active WebSocket connections to relays */
  private activeRelays: Map<string, WebSocket> = new Map();

  /** Whether initial poll has completed */
  private initialPollDone: boolean = false;

  /** Set of already-known event IDs (to avoid duplicates) */
  private knownEventIds: Set<string> = new Set();

  /**
   * Create a new NostrSocialManager.
   *
   * Automatically initializes by finding the container element
   * and parsing embedded data.
   */
  constructor() {
    // Try both old and new container IDs for compatibility
    this.container =
      document.getElementById("moss-comments") ||
      document.getElementById("nostr-interactions");
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
   * 3. Tracks known event IDs to avoid duplicates
   * 4. Renders the interactive UI
   * 5. Starts polling for new comments
   *
   * @private
   */
  private init(): void {
    if (!this.container) {
      // No interaction section on this page
      return;
    }

    // Parse embedded data from the JSON script tag
    // Support both old and new element IDs
    const dataEl =
      document.getElementById("moss-comments-data") ||
      document.getElementById("interactions-data");
    if (dataEl) {
      try {
        this.data = JSON.parse(dataEl.textContent || "{}");
      } catch (e) {
        console.error("[Nostr Social] Failed to parse interaction data:", e);
        return;
      }
    }

    // Track already-known event IDs to avoid duplicates when polling
    if (this.data?.interactions) {
      for (const interaction of this.data.interactions) {
        this.knownEventIds.add(interaction.id);
        // Track the latest timestamp for incremental polling
        if (interaction.published_at) {
          const ts = Math.floor(new Date(interaction.published_at).getTime() / 1000);
          if (ts > this.lastKnownTimestamp) {
            this.lastKnownTimestamp = ts;
          }
        }
      }
    }

    // Use build time as minimum timestamp if no interactions exist
    if (this.lastKnownTimestamp === 0 && this.data?.buildTime) {
      this.lastKnownTimestamp = this.data.buildTime;
    }

    // Render the interactive UI
    this.render();

    // Start polling for new comments from relays
    this.startPolling();
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  /**
   * Render the complete interaction UI.
   *
   * Replaces the noscript fallback with interactive elements:
   * - Comment form (always visible, like Waline)
   * - Stats (likes, zaps)
   * - Comments list
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

    // Build the UI - comment form at top, then stats, then comments
    this.container.innerHTML = `
      <div class="social-header">
        <h3>Comments</h3>
      </div>

      ${this.renderCommentForm()}
      ${this.renderStats(likes, zaps)}
      ${this.renderComments(comments)}
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
   * Render the comment form (always visible, like Waline).
   *
   * Fields are shown directly without expansion.
   * Email field is only shown if host has email capability.
   *
   * @returns HTML string for comment form
   *
   * @private
   */
  private renderCommentForm(): string {
    // Check if host has email capability
    const hasEmailCapability = this.checkEmailCapability();

    // Load saved user info from localStorage
    const savedName = localStorage.getItem("moss_comment_name") || "";
    const savedEmail = localStorage.getItem("moss_comment_email") || "";
    const savedWebsite = localStorage.getItem("moss_comment_website") || "";

    return `
      <div class="comment-form" id="moss-comment-form">
        <div class="comment-form-header">
          <input
            type="text"
            id="comment-name"
            class="comment-input"
            placeholder="Name"
            value="${this.escapeHtml(savedName)}"
            maxlength="50"
          />
          ${
            hasEmailCapability
              ? `<input
            type="email"
            id="comment-email"
            class="comment-input"
            placeholder="Email"
            value="${this.escapeHtml(savedEmail)}"
            maxlength="100"
          />`
              : ""
          }
          <input
            type="url"
            id="comment-website"
            class="comment-input"
            placeholder="Website"
            value="${this.escapeHtml(savedWebsite)}"
            maxlength="200"
          />
        </div>
        <textarea
          id="comment-content"
          class="comment-textarea"
          placeholder="Write a comment..."
          rows="4"
          maxlength="2000"
        ></textarea>
        <div class="comment-form-footer">
          <div class="comment-form-info" id="comment-form-info">
            ${this.renderSignerInfo()}
          </div>
          <button id="comment-submit-btn" class="btn-primary">Post</button>
        </div>
      </div>
    `;
  }

  /**
   * Check if the host has email capability.
   *
   * @returns true if email notifications are supported
   * @private
   */
  private checkEmailCapability(): boolean {
    // Check for moss.host or configured email capability
    // This could be set in the embedded config data
    const config = this.data?.config || {};
    return config.email_notifications === true;
  }

  /**
   * Render signer info in the form footer.
   *
   * Shows identity status (logged in, local key, etc.)
   *
   * @returns HTML string for signer info
   * @private
   */
  private renderSignerInfo(): string {
    if (this.userPubkey) {
      // User is logged in
      const shortPubkey = this.userPubkey.slice(0, 8) + "...";
      return `<span class="signer-status logged-in">Connected: ${shortPubkey}</span>`;
    }
    // Not logged in yet - will resolve signer on first post
    return `<span class="signer-status">Identity will be created on first post</span>`;
  }

  /**
   * Render the reply form (hidden until login).
   *
   * @returns HTML string for reply form
   * @deprecated Use renderCommentForm instead
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
    // Comment submit button
    const commentSubmitBtn = document.getElementById("comment-submit-btn");
    if (commentSubmitBtn) {
      commentSubmitBtn.addEventListener("click", () => this.handleCommentSubmit());
    }

    // Save user info on input change (debounced)
    const nameInput = document.getElementById("comment-name") as HTMLInputElement;
    const emailInput = document.getElementById("comment-email") as HTMLInputElement;
    const websiteInput = document.getElementById("comment-website") as HTMLInputElement;

    if (nameInput) {
      nameInput.addEventListener("change", () => {
        localStorage.setItem("moss_comment_name", nameInput.value);
      });
    }
    if (emailInput) {
      emailInput.addEventListener("change", () => {
        localStorage.setItem("moss_comment_email", emailInput.value);
      });
    }
    if (websiteInput) {
      websiteInput.addEventListener("change", () => {
        localStorage.setItem("moss_comment_website", websiteInput.value);
      });
    }

    // Legacy: Login button (if present)
    const loginBtn = document.getElementById("nostr-login-btn");
    if (loginBtn) {
      loginBtn.addEventListener("click", () => this.handleLogin());
    }

    // Legacy: Reply submit button
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
   * Handle comment form submission.
   *
   * 1. Resolve signer (NIP-07 → moss-host → local)
   * 2. Create kind:1 event
   * 3. Sign and publish to relays
   * 4. Update UI
   *
   * @private
   */
  private async handleCommentSubmit(): Promise<void> {
    const contentInput = document.getElementById("comment-content") as HTMLTextAreaElement;
    const nameInput = document.getElementById("comment-name") as HTMLInputElement;
    const emailInput = document.getElementById("comment-email") as HTMLInputElement;
    const websiteInput = document.getElementById("comment-website") as HTMLInputElement;
    const submitBtn = document.getElementById("comment-submit-btn") as HTMLButtonElement;

    const content = contentInput?.value?.trim();
    if (!content) {
      alert("Please write a comment.");
      return;
    }

    // Disable button while posting
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Posting...";
    }

    try {
      // Resolve signer if not already done
      if (!this.userPubkey) {
        await this.resolveSigner();
      }

      // Get user info
      const name = nameInput?.value?.trim() || "";
      const email = emailInput?.value?.trim() || "";
      const website = websiteInput?.value?.trim() || "";

      // Get article URL from current page
      const articleUrl = window.location.href;

      // Get relays from config
      const relays = (this.data?.config?.relays as string[]) || [
        "wss://relay.damus.io",
        "wss://nos.lol",
      ];

      // Create and publish comment
      await this.publishComment(content, articleUrl, relays, { name, email, website });

      // Clear content input on success
      contentInput.value = "";

      // Show success message
      this.showTemporaryMessage("Comment posted! It may take a moment to appear.");

      // Trigger refresh to show the new comment
      setTimeout(() => this.refresh(), 2000);
    } catch (e) {
      console.error("[Nostr Social] Failed to post comment:", e);
      alert(`Failed to post comment: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      // Re-enable button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Post";
      }
    }
  }

  /**
   * Resolve the best available signer.
   *
   * Priority: NIP-07 → moss-host iframe → local key
   *
   * @private
   */
  private async resolveSigner(): Promise<void> {
    const win = window as WindowWithNostr;

    // Priority 1: NIP-07 browser extension
    if (win.nostr) {
      try {
        this.userPubkey = await win.nostr.getPublicKey();
        this.signerType = "nip07";
        this.updateSignerInfo();
        console.log("[Nostr Social] Using NIP-07 signer:", this.userPubkey.slice(0, 8) + "...");
        return;
      } catch (e) {
        console.warn("[Nostr Social] NIP-07 failed, trying fallback:", e);
      }
    }

    // Priority 2: moss-host iframe signer (TODO: implement)
    // const mossHostAvailable = await this.checkMossHostSigner();
    // if (mossHostAvailable) { ... }

    // Priority 3: Local key from IndexedDB or generate new
    const localKey = await this.getOrCreateLocalKey();
    this.localPrivateKey = localKey.key;
    this.userPubkey = this.getPublicKeyFromPrivate(localKey.key);
    this.signerType = "local";
    this.updateSignerInfo();
    console.log(
      "[Nostr Social] Using local signer:",
      this.userPubkey.slice(0, 8) + "...",
      localKey.isNew ? "(new)" : "(existing)"
    );
  }

  /**
   * Get or create a local private key.
   *
   * Stores in localStorage for persistence (IndexedDB would be better for security).
   *
   * @private
   */
  private async getOrCreateLocalKey(): Promise<{ key: Uint8Array; isNew: boolean }> {
    const stored = localStorage.getItem("moss_local_nsec");
    if (stored) {
      // Decode hex string to Uint8Array
      const key = new Uint8Array(stored.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
      return { key, isNew: false };
    }

    // Generate new key
    const key = crypto.getRandomValues(new Uint8Array(32));
    // Store as hex string
    const hex = Array.from(key)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem("moss_local_nsec", hex);
    return { key, isNew: true };
  }

  /**
   * Derive public key from private key.
   *
   * Uses secp256k1 schnorr. For browser, we use a simple implementation.
   *
   * @private
   */
  private getPublicKeyFromPrivate(privateKey: Uint8Array): string {
    // This is a placeholder - in production, use nostr-tools or noble-secp256k1
    // For now, we'll use a hash as a placeholder (NOT cryptographically correct)
    // TODO: Bundle proper secp256k1 for browser
    const hash = Array.from(privateKey)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hash; // Placeholder - should derive actual pubkey
  }

  /**
   * Update signer info display in the form.
   *
   * @private
   */
  private updateSignerInfo(): void {
    const infoEl = document.getElementById("comment-form-info");
    if (infoEl) {
      infoEl.innerHTML = this.renderSignerInfo();
    }
  }

  /**
   * Show a temporary message to the user.
   *
   * @param message - Message to display
   * @private
   */
  private showTemporaryMessage(message: string): void {
    const infoEl = document.getElementById("comment-form-info");
    if (infoEl) {
      const originalContent = infoEl.innerHTML;
      infoEl.innerHTML = `<span class="success-message">${this.escapeHtml(message)}</span>`;
      setTimeout(() => {
        infoEl.innerHTML = originalContent;
      }, 5000);
    }
  }

  /**
   * Publish a comment to Nostr relays.
   *
   * @param content - Comment text
   * @param articleUrl - URL of the article
   * @param relays - Relay URLs to publish to
   * @param metadata - Optional name, email, website
   * @private
   */
  private async publishComment(
    content: string,
    articleUrl: string,
    relays: string[],
    metadata: { name?: string; email?: string; website?: string }
  ): Promise<void> {
    const win = window as WindowWithNostr;

    // Build tags
    const tags: string[][] = [["r", articleUrl]];
    if (metadata.name) tags.push(["name", metadata.name]);
    if (metadata.website) tags.push(["website", metadata.website]);
    // Note: email is NOT included in public event - it's stored separately for notifications

    // Create unsigned event
    const unsignedEvent = {
      kind: 1,
      content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
    };

    let signedEvent: object;

    if (this.signerType === "nip07" && win.nostr) {
      // Sign with NIP-07 extension
      signedEvent = await win.nostr.signEvent(unsignedEvent);
    } else if (this.signerType === "local" && this.localPrivateKey) {
      // Sign locally (TODO: implement proper signing)
      // For now, this is a placeholder
      signedEvent = {
        ...unsignedEvent,
        id: "placeholder-id",
        pubkey: this.userPubkey,
        sig: "placeholder-sig",
      };
      console.warn("[Nostr Social] Local signing not fully implemented yet");
    } else {
      throw new Error("No signer available");
    }

    // Publish to relays
    await this.publishToRelays(signedEvent, relays);

    // If email provided, register for notifications (if moss-host available)
    if (metadata.email) {
      await this.registerForNotifications(signedEvent, metadata.email);
    }
  }

  /**
   * Publish a signed event to Nostr relays.
   *
   * @param event - Signed Nostr event
   * @param relays - Relay URLs
   * @private
   */
  private async publishToRelays(event: object, relays: string[]): Promise<void> {
    const promises = relays.map(async (relayUrl) => {
      try {
        const ws = new WebSocket(relayUrl);
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            ws.send(JSON.stringify(["EVENT", event]));
            // Wait a bit for the relay to process
            setTimeout(() => {
              ws.close();
              resolve();
            }, 1000);
          };
          ws.onerror = reject;
          setTimeout(() => reject(new Error("Timeout")), 5000);
        });
        console.log(`[Nostr Social] Published to ${relayUrl}`);
      } catch (e) {
        console.warn(`[Nostr Social] Failed to publish to ${relayUrl}:`, e);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Register for email notifications (moss-host only).
   *
   * @param event - The comment event
   * @param email - User's email address
   * @private
   */
  private async registerForNotifications(event: object, email: string): Promise<void> {
    // TODO: Implement notification registration with moss-host
    // This would encrypt the email and send to moss-host's notification service
    console.log("[Nostr Social] Notification registration not yet implemented");
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
  // Polling for New Comments
  // --------------------------------------------------------------------------

  /**
   * Start polling for new comments from relays.
   *
   * Immediately fetches new comments since build time, then
   * polls periodically for updates.
   *
   * @private
   */
  private startPolling(): void {
    // Get article URL for filtering
    const articleUrl = window.location.href.split("#")[0].split("?")[0];

    // Get relays from config
    const relays = (this.data?.config?.relays as string[]) || [
      "wss://relay.damus.io",
      "wss://nos.lol",
    ];

    // Initial poll - get comments since last known timestamp
    this.pollRelays(relays, articleUrl, this.lastKnownTimestamp);

    // Schedule periodic polling (every 30 seconds for responsiveness)
    setInterval(() => {
      this.pollRelays(relays, articleUrl, this.lastKnownTimestamp);
    }, 30 * 1000);
  }

  /**
   * Poll relays for new comments referencing the article.
   *
   * Uses NIP-01 REQ with filters for:
   * - kind:1 (text notes)
   * - "r" tag matching the article URL
   * - since: last known timestamp
   *
   * @param relays - Relay URLs to query
   * @param articleUrl - Article URL to filter by
   * @param since - Unix timestamp to fetch events after
   * @private
   */
  private pollRelays(relays: string[], articleUrl: string, since: number): void {
    // Create subscription ID
    const subId = `poll-${Date.now()}`;

    // NIP-01 filter for comments referencing this article
    const filter = {
      kinds: [1], // Text notes
      "#r": [articleUrl], // Events with "r" tag = article URL
      since: since + 1, // Only events after last known
      limit: 50,
    };

    const newEvents: NostrEvent[] = [];
    let completedRelays = 0;

    for (const relayUrl of relays) {
      this.queryRelay(relayUrl, subId, filter)
        .then((events) => {
          newEvents.push(...events);
        })
        .catch((e) => {
          console.warn(`[Nostr Social] Poll failed for ${relayUrl}:`, e);
        })
        .finally(() => {
          completedRelays++;
          // When all relays have responded, process new events
          if (completedRelays === relays.length) {
            this.processNewEvents(newEvents);
          }
        });
    }
  }

  /**
   * Query a single relay for events matching the filter.
   *
   * @param relayUrl - WebSocket URL of the relay
   * @param subId - Subscription ID
   * @param filter - NIP-01 filter object
   * @returns Promise resolving to array of events
   * @private
   */
  private queryRelay(
    relayUrl: string,
    subId: string,
    filter: object
  ): Promise<NostrEvent[]> {
    return new Promise((resolve, reject) => {
      const events: NostrEvent[] = [];
      const ws = new WebSocket(relayUrl);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(events); // Return whatever we got
      }, 10000);

      ws.onopen = () => {
        // Send REQ message per NIP-01
        ws.send(JSON.stringify(["REQ", subId, filter]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (Array.isArray(data)) {
            if (data[0] === "EVENT" && data[1] === subId && data[2]) {
              events.push(data[2] as NostrEvent);
            } else if (data[0] === "EOSE" && data[1] === subId) {
              // End of stored events - close connection
              clearTimeout(timeout);
              ws.send(JSON.stringify(["CLOSE", subId]));
              ws.close();
              resolve(events);
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error for ${relayUrl}`));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve(events);
      };
    });
  }

  /**
   * Process newly fetched events and add them to the UI.
   *
   * - Deduplicates against known events
   * - Converts to Interaction format
   * - Merges into existing data
   * - Re-renders the comments list
   *
   * @param events - New Nostr events from relays
   * @private
   */
  private processNewEvents(events: NostrEvent[]): void {
    // Deduplicate
    const newUniqueEvents = events.filter((e) => !this.knownEventIds.has(e.id));

    if (newUniqueEvents.length === 0) {
      if (!this.initialPollDone) {
        this.initialPollDone = true;
        console.log("[Nostr Social] Initial poll complete, no new comments");
      }
      return;
    }

    console.log(`[Nostr Social] Found ${newUniqueEvents.length} new comment(s)`);

    // Convert to Interaction format
    const newInteractions: Interaction[] = newUniqueEvents.map((event) => {
      // Extract metadata from tags
      const nameTag = event.tags.find((t) => t[0] === "name");
      const websiteTag = event.tags.find((t) => t[0] === "website");
      const rTag = event.tags.find((t) => t[0] === "r");

      return {
        id: event.id,
        source: "nostr",
        interaction_type: "comment",
        author: {
          name: nameTag?.[1] || undefined,
          profile_url: websiteTag?.[1] || undefined,
          identifier: event.pubkey,
        },
        content: event.content,
        published_at: new Date(event.created_at * 1000).toISOString(),
        target_url: rTag?.[1] || window.location.href,
        meta: {
          pubkey: event.pubkey,
        },
      };
    });

    // Add to known IDs
    for (const event of newUniqueEvents) {
      this.knownEventIds.add(event.id);
      if (event.created_at > this.lastKnownTimestamp) {
        this.lastKnownTimestamp = event.created_at;
      }
    }

    // Merge with existing interactions
    if (this.data) {
      this.data.interactions = [...this.data.interactions, ...newInteractions];
      // Sort by date (newest last for natural reading order)
      this.data.interactions.sort((a, b) => {
        const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
        const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
        return dateA - dateB;
      });
    }

    // Re-render the UI
    this.render();

    // Show notification for new comments (after initial poll)
    if (this.initialPollDone) {
      this.showNewCommentNotification(newInteractions.length);
    }

    this.initialPollDone = true;
  }

  /**
   * Show notification that new comments were found.
   *
   * @param count - Number of new comments
   * @private
   */
  private showNewCommentNotification(count: number): void {
    const message = count === 1 ? "1 new comment" : `${count} new comments`;
    this.showTemporaryMessage(`${message} loaded!`);
  }

  /**
   * Manual refresh trigger (e.g., after posting).
   *
   * @private
   */
  private async refresh(): Promise<void> {
    const articleUrl = window.location.href.split("#")[0].split("?")[0];
    const relays = (this.data?.config?.relays as string[]) || [
      "wss://relay.damus.io",
      "wss://nos.lol",
    ];
    this.pollRelays(relays, articleUrl, this.lastKnownTimestamp);
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
