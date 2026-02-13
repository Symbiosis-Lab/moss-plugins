/**
 * Shared types for Nostr plugin
 *
 * These types match the Rust types in moss core (plugins/types.rs).
 * They define the contract between the plugin and the Moss build system.
 *
 * @module types
 */

// ============================================================================
// Interaction Types
// ============================================================================

/**
 * Author information for a social interaction.
 *
 * Represents the person who created a comment, like, zap, or other interaction.
 * For Nostr, the identifier is typically an npub (NIP-19 encoded public key).
 *
 * @example
 * ```typescript
 * const author: InteractionAuthor = {
 *   name: "Alice",
 *   identifier: "npub1abc123...",
 *   avatar: "https://example.com/alice.jpg",
 *   profile_url: "https://njump.me/npub1abc123..."
 * };
 * ```
 */
export interface InteractionAuthor {
  /** Display name of the author (may be truncated npub if not available) */
  name?: string;

  /** URL to the author's avatar image */
  avatar?: string;

  /** URL to the author's profile page on a Nostr client */
  profile_url?: string;

  /** Unique identifier (npub for Nostr, @username for others) */
  identifier?: string;
}

/**
 * A social interaction from any platform (Nostr, Matters, webmentions, etc.).
 *
 * This is the universal format for social interactions that gets passed
 * between plugins and rendered into HTML pages.
 *
 * @example
 * ```typescript
 * const comment: Interaction = {
 *   id: "note1abc123...",
 *   source: "nostr",
 *   interaction_type: "comment",
 *   author: { name: "Alice", identifier: "npub1..." },
 *   content: "Great article!",
 *   published_at: "2024-01-15T10:30:00.000Z",
 *   source_url: "https://njump.me/note1abc123...",
 *   target_url: "posts/my-article.html"
 * };
 * ```
 */
export interface Interaction {
  /** Unique identifier for this interaction (event ID for Nostr) */
  id: string;

  /** Source platform: "nostr", "matters", "webmention", etc. */
  source: string;

  /** Type of interaction: "comment", "like", "repost", "zap", "mention" */
  interaction_type: string;

  /** Information about who created this interaction */
  author: InteractionAuthor;

  /** Text content of the interaction (for comments) */
  content?: string;

  /** HTML-formatted content (if available from source) */
  content_html?: string;

  /** ISO 8601 timestamp when the interaction was created */
  published_at?: string;

  /** URL to view this interaction on its source platform */
  source_url?: string;

  /** URL path of the article this interaction is for (relative to output_dir) */
  target_url: string;

  /**
   * Platform-specific metadata.
   *
   * For Nostr zaps, this includes:
   * - `amount`: number of sats
   * - `bolt11`: lightning invoice
   */
  meta?: Record<string, unknown>;
}

// ============================================================================
// Hook Context Types
// ============================================================================

/**
 * Information about the Moss project being built.
 *
 * Shared across all hook contexts to provide project metadata.
 */
export interface ProjectInfo {
  /** List of content folder paths relative to project root */
  content_folders: string[];

  /** Total number of content files in the project */
  total_files: number;

  /** Path to the homepage file (if detected) */
  homepage_file?: string;
}

/**
 * Context passed to the process hook.
 *
 * The process hook runs early in the build pipeline and is responsible for
 * fetching social interactions from external sources (Nostr relays, APIs, etc.).
 *
 * @example
 * ```typescript
 * async function process(ctx: ProcessContext): Promise<HookResult> {
 *   const relays = ctx.config.relays ?? [];
 *   const interactions = await fetchFromRelays(relays);
 *   return { success: true, interactions };
 * }
 * ```
 */
export interface ProcessContext {
  /** Absolute path to the project root directory */
  project_path: string;

  /** Absolute path to the .moss directory */
  moss_dir: string;

  /** Information about the project structure */
  project_info: ProjectInfo;

  /** Plugin configuration from moss.yaml */
  config: PluginConfig;
}

/**
 * Context passed to the enhance hook.
 *
 * The enhance hook runs after HTML generation and receives aggregated
 * interactions from all process hooks. It's responsible for injecting
 * interaction UI into the generated HTML pages.
 *
 * @example
 * ```typescript
 * async function enhance(ctx: EnhanceContext): Promise<HookResult> {
 *   for (const interaction of ctx.interactions) {
 *     const htmlPath = `${ctx.output_dir}/${interaction.target_url}`;
 *     // Inject interaction into HTML...
 *   }
 *   return { success: true };
 * }
 * ```
 */
export interface EnhanceContext {
  /** Absolute path to the project root directory */
  project_path: string;

  /** Absolute path to the .moss directory */
  moss_dir: string;

  /** Absolute path to the generated output directory */
  output_dir: string;

  /** Information about the project structure */
  project_info: ProjectInfo;

  /** Plugin configuration from moss.yaml */
  config: PluginConfig;

  /**
   * Aggregated interactions from ALL plugins' process hooks.
   *
   * This array contains interactions from Nostr, Matters, webmentions,
   * and any other sources. The enhance plugin is responsible for
   * rendering all of them.
   */
  interactions: Interaction[];
}

/**
 * Context passed to the syndicate hook.
 *
 * The syndicate hook runs after the build completes and is responsible
 * for publishing content to external platforms (Nostr relays, APIs, etc.).
 *
 * @example
 * ```typescript
 * async function syndicate(ctx: SyndicateContext): Promise<HookResult> {
 *   for (const article of ctx.articles) {
 *     await publishToNostr(article, ctx.config.nsec);
 *   }
 *   return { success: true };
 * }
 * ```
 */
export interface SyndicateContext {
  /** Absolute path to the project root directory */
  project_path: string;

  /** Absolute path to the .moss directory */
  moss_dir: string;

  /** Absolute path to the generated output directory */
  output_dir: string;

  /** Base URL of the site (from moss.yaml) */
  site_url: string;

  /** List of articles to potentially syndicate */
  articles: Article[];

  /** Plugin configuration from moss.yaml */
  config: PluginConfig;
}

/**
 * An article that can be syndicated to external platforms.
 *
 * Articles are extracted from the project's content files during the build.
 */
export interface Article {
  /** Title of the article (from frontmatter) */
  title: string;

  /** URL path relative to site root (e.g., "posts/my-article.html") */
  url_path: string;

  /** Full text/markdown content of the article */
  content?: string;

  /** Tags/categories for the article */
  tags?: string[];
}

// ============================================================================
// Hook Result Types
// ============================================================================

/**
 * Result returned from any plugin hook.
 *
 * All hooks return this structure to indicate success/failure and
 * optionally return data (like interactions from process hooks).
 *
 * @example
 * ```typescript
 * // Success with interactions
 * return {
 *   success: true,
 *   message: "Fetched 15 interactions",
 *   interactions: [...]
 * };
 *
 * // Failure
 * return {
 *   success: false,
 *   message: "Failed to connect to relay"
 * };
 * ```
 */
export interface HookResult {
  /** Whether the hook completed successfully */
  success: boolean;

  /** Human-readable status message (shown in build output) */
  message?: string;

  /**
   * Interactions fetched by process hooks.
   *
   * Only used by process hooks. These get aggregated and passed
   * to the enhance hook's EnhanceContext.interactions.
   */
  interactions?: Interaction[];
}

// ============================================================================
// Plugin Configuration
// ============================================================================

/**
 * Configuration for the Nostr plugin.
 *
 * Set in your project's moss.yaml under `plugins.nostr`:
 *
 * @example
 * ```yaml
 * plugins:
 *   nostr:
 *     relays:
 *       - wss://relay.damus.io
 *       - wss://nos.lol
 *     pubkey: npub1...
 *     nsec: nsec1...  # For publishing (keep secret!)
 * ```
 */
export interface PluginConfig {
  /**
   * List of Nostr relay WebSocket URLs to connect to.
   *
   * @example ["wss://relay.damus.io", "wss://nos.lol"]
   */
  relays?: string[];

  /**
   * Your Nostr public key (npub format).
   *
   * Used for filtering interactions to only those mentioning you.
   */
  pubkey?: string;

  /**
   * Your Nostr private key (nsec format) for signing published events.
   *
   * Required for the syndicate hook to publish articles.
   *
   * @security Never commit this to version control!
   */
  nsec?: string;

  /**
   * Base URL of your site (used in Nostr event metadata).
   *
   * @example "https://example.com"
   */
  site_url?: string;

  /** Additional configuration options (extensible) */
  [key: string]: unknown;
}

// ============================================================================
// Nostr-Specific Types
// ============================================================================

/**
 * Nostr user profile metadata (kind:0 event content).
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/01.md
 */
export interface NostrProfile {
  /** Display name */
  name?: string;

  /** Bio/description */
  about?: string;

  /** Profile picture URL */
  picture?: string;

  /** NIP-05 identifier (e.g., "alice@example.com") */
  nip05?: string;

  /** Lightning address for zaps (e.g., "alice@getalby.com") */
  lud16?: string;
}
