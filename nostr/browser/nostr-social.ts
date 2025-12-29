/**
 * Nostr Social Interactions - Browser-side hydration
 *
 * This script runs in the browser to:
 * 1. Parse embedded interaction data
 * 2. Render interactive UI
 * 3. Handle login (NIP-07)
 * 4. Enable replies and zaps
 * 5. Refresh interactions from relays
 */

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

interface InteractionData {
  interactions: Interaction[];
  config: Record<string, unknown>;
}

class NostrSocialManager {
  private container: HTMLElement | null;
  private data: InteractionData | null = null;

  constructor() {
    this.container = document.getElementById("nostr-interactions");
    this.init();
  }

  private init(): void {
    if (!this.container) return;

    // Parse embedded data
    const dataEl = document.getElementById("interactions-data");
    if (dataEl) {
      try {
        this.data = JSON.parse(dataEl.textContent || "{}");
      } catch (e) {
        console.error("Failed to parse interaction data:", e);
        return;
      }
    }

    // Render UI
    this.render();

    // Schedule refresh
    this.scheduleRefresh();
  }

  private render(): void {
    if (!this.container || !this.data) return;

    const { interactions } = this.data;

    // Group by type
    const comments = interactions.filter((i) => i.interaction_type === "comment");
    const likes = interactions.filter((i) => i.interaction_type === "like");
    const zaps = interactions.filter((i) => i.interaction_type === "zap");

    this.container.innerHTML = `
      <div class="social-header">
        <h3>Responses</h3>
        <button id="nostr-login-btn" class="nostr-login">Login with Nostr</button>
      </div>

      ${this.renderStats(likes, zaps)}
      ${this.renderComments(comments)}
      ${this.renderReplyForm()}
    `;

    // Add event listeners
    this.attachEventListeners();
    this.container.classList.add("loaded");
  }

  private renderStats(likes: Interaction[], zaps: Interaction[]): string {
    if (likes.length === 0 && zaps.length === 0) return "";

    return `
      <div class="social-stats">
        ${likes.length > 0 ? `<span class="stat likes">👍 ${likes.length}</span>` : ""}
        ${zaps.length > 0 ? `<span class="stat zaps">⚡ ${zaps.length}</span>` : ""}
      </div>
    `;
  }

  private renderComments(comments: Interaction[]): string {
    if (comments.length === 0) {
      return '<p class="no-comments">No comments yet. Be the first to respond!</p>';
    }

    const commentHtml = comments
      .map((c) => {
        const avatar = c.author.avatar
          ? `<img src="${this.escapeHtml(c.author.avatar)}" alt="" class="avatar">`
          : '<div class="avatar-placeholder"></div>';

        const name = c.author.name || "Anonymous";
        const date = c.published_at ? this.formatDate(c.published_at) : "";

        return `
        <div class="comment" data-id="${c.id}">
          <div class="comment-header">
            ${avatar}
            <span class="author">${this.escapeHtml(name)}</span>
            <span class="source badge-${c.source}">${c.source}</span>
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

  private renderReplyForm(): string {
    return `
      <div class="reply-form" id="nostr-reply-form" style="display: none;">
        <textarea placeholder="Write a reply..." id="nostr-reply-input"></textarea>
        <div class="reply-actions">
          <button id="nostr-submit-reply" class="btn-primary">Reply</button>
          <button id="nostr-zap-btn" class="btn-zap">⚡ Zap</button>
        </div>
      </div>
    `;
  }

  private attachEventListeners(): void {
    // Login button
    const loginBtn = document.getElementById("nostr-login-btn");
    if (loginBtn) {
      loginBtn.addEventListener("click", () => this.handleLogin());
    }

    // Reply submit
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

  private async handleLogin(): Promise<void> {
    // Check for NIP-07 extension
    if (typeof window !== "undefined" && (window as any).nostr) {
      try {
        const pubkey = await (window as any).nostr.getPublicKey();
        console.log("Logged in as:", pubkey);

        // Show reply form
        const form = document.getElementById("nostr-reply-form");
        if (form) form.style.display = "block";

        // Update login button
        const btn = document.getElementById("nostr-login-btn");
        if (btn) {
          btn.textContent = `Logged in: ${pubkey.slice(0, 8)}...`;
          btn.classList.add("logged-in");
        }
      } catch (e) {
        console.error("Login failed:", e);
        alert("Login failed. Please try again.");
      }
    } else {
      alert(
        "No Nostr extension found. Please install a NIP-07 compatible extension like Alby or nos2x."
      );
    }
  }

  private async handleReply(): Promise<void> {
    const input = document.getElementById("nostr-reply-input") as HTMLTextAreaElement;
    if (!input || !input.value.trim()) return;

    // TODO: Implement reply posting via Nostr
    console.log("Posting reply:", input.value);
    alert("Reply posting coming soon!");
  }

  private async handleZap(): Promise<void> {
    // TODO: Implement zapping via NIP-57
    console.log("Zapping...");
    alert("Zapping coming soon!");
  }

  private scheduleRefresh(): void {
    // Refresh every 5 minutes
    setTimeout(() => this.refresh(), 5 * 60 * 1000);
  }

  private async refresh(): Promise<void> {
    // TODO: Fetch fresh interactions from relays
    console.log("Refreshing interactions...");
    this.scheduleRefresh();
  }

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

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new NostrSocialManager());
} else {
  new NostrSocialManager();
}
