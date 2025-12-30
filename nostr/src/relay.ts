/**
 * Nostr Relay Communication Module
 *
 * This module handles all communication with Nostr relays using the nostr-tools library.
 * It provides functions for:
 *
 * - Connecting to relays with timeout handling
 * - Subscribing to events and fetching interactions
 * - Publishing signed events to multiple relays
 * - Converting between Nostr events and the universal Interaction format
 * - Key management (decoding nsec, signing events)
 *
 * @module relay
 * @see https://github.com/nbd-wtf/nostr-tools
 */

import {
  Relay,
  type Filter,
  type Event as NostrEvent,
  nip19,
  getPublicKey,
  finalizeEvent,
  type UnsignedEvent,
} from "nostr-tools";
import type { Interaction, InteractionAuthor } from "./types";

// ============================================================================
// Constants
// ============================================================================

/**
 * Nostr event kinds used by this plugin.
 *
 * @see https://github.com/nostr-protocol/nips
 */

/** Kind 0: User metadata (profile info) - NIP-01 */
const KIND_METADATA = 0;

/** Kind 1: Short text note (tweets/posts) - NIP-01 */
const KIND_SHORT_NOTE = 1;

/** Kind 7: Reaction (like/emoji) - NIP-25 */
const KIND_REACTION = 7;

/** Kind 9735: Zap receipt - NIP-57 */
const KIND_ZAP_RECEIPT = 9735;

/** Kind 30023: Long-form content (articles) - NIP-23 */
const KIND_LONG_FORM = 30023;

/**
 * Timeout for initial relay connection (10 seconds).
 *
 * If a relay doesn't respond within this time, we skip it and try others.
 */
const RELAY_TIMEOUT_MS = 10000;

/**
 * Timeout for subscription queries (15 seconds).
 *
 * Events received after this timeout won't be included in results.
 */
const SUBSCRIPTION_TIMEOUT_MS = 15000;

// ============================================================================
// Relay Connection
// ============================================================================

/**
 * Connect to a Nostr relay with timeout handling.
 *
 * This function establishes a WebSocket connection to the relay and returns
 * the connected Relay instance. If the connection takes longer than
 * RELAY_TIMEOUT_MS, it throws an error.
 *
 * @param url - WebSocket URL of the relay (e.g., "wss://relay.damus.io")
 * @returns A connected Relay instance
 * @throws Error if connection times out or fails
 *
 * @example
 * ```typescript
 * try {
 *   const relay = await connectToRelay("wss://relay.damus.io");
 *   // Use relay...
 *   relay.close();
 * } catch (error) {
 *   console.error("Failed to connect:", error);
 * }
 * ```
 */
export async function connectToRelay(url: string): Promise<Relay> {
  const relay = new Relay(url);

  await Promise.race([
    relay.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timeout: ${url}`)), RELAY_TIMEOUT_MS)
    ),
  ]);

  return relay;
}

// ============================================================================
// Event Fetching
// ============================================================================

/**
 * Fetch events from a relay matching the given filters.
 *
 * Creates a subscription with the provided filters and collects all matching
 * events until EOSE (End of Stored Events) is received or timeout occurs.
 *
 * @param relay - Connected Relay instance
 * @param filters - Array of Nostr filters to match events against
 * @param timeoutMs - Maximum time to wait for events (default: 15 seconds)
 * @returns Array of matching Nostr events
 *
 * @example
 * ```typescript
 * const relay = await connectToRelay("wss://relay.damus.io");
 * const events = await fetchEvents(relay, [
 *   { kinds: [1], "#r": ["https://example.com/article"] }
 * ]);
 * relay.close();
 * ```
 */
export async function fetchEvents(
  relay: Relay,
  filters: Filter[],
  timeoutMs: number = SUBSCRIPTION_TIMEOUT_MS
): Promise<NostrEvent[]> {
  const events: NostrEvent[] = [];

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      sub.close();
      resolve(events);
    }, timeoutMs);

    const sub = relay.subscribe(filters, {
      onevent(event: NostrEvent) {
        events.push(event);
      },
      oneose() {
        clearTimeout(timeout);
        sub.close();
        resolve(events);
      },
    });
  });
}

/**
 * Fetch social interactions for article URLs from multiple Nostr relays.
 *
 * This is the main function for gathering interactions. It:
 * 1. Connects to all configured relays in parallel
 * 2. Queries each relay for comments, reactions, and zaps referencing the URLs
 * 3. Deduplicates events by ID (same event may appear on multiple relays)
 * 4. Converts Nostr events to the universal Interaction format
 * 5. Sorts results by timestamp (newest first)
 *
 * Relay failures are handled gracefully - if one relay fails, others continue.
 *
 * @param relayUrls - List of relay WebSocket URLs to query
 * @param articleUrls - List of article URLs to find interactions for
 * @returns Array of Interaction objects, sorted by timestamp (newest first)
 *
 * @example
 * ```typescript
 * const interactions = await fetchInteractionsFromRelays(
 *   ["wss://relay.damus.io", "wss://nos.lol"],
 *   ["https://example.com/posts/my-article"]
 * );
 *
 * for (const i of interactions) {
 *   console.log(`${i.interaction_type} from ${i.author.name}: ${i.content}`);
 * }
 * ```
 */
export async function fetchInteractionsFromRelays(
  relayUrls: string[],
  articleUrls: string[]
): Promise<Interaction[]> {
  if (relayUrls.length === 0 || articleUrls.length === 0) {
    return [];
  }

  const allInteractions: Interaction[] = [];
  const seenIds = new Set<string>();

  // Connect to each relay and fetch events in parallel
  const relayPromises = relayUrls.map(async (url) => {
    try {
      const relay = await connectToRelay(url);

      // Build filters for different interaction types
      // All use the "r" tag to reference article URLs
      const filters: Filter[] = [
        // Comments: kind:1 notes that reference an article URL
        { kinds: [KIND_SHORT_NOTE], "#r": articleUrls },

        // Reactions: kind:7 reactions (likes, emoji reactions)
        { kinds: [KIND_REACTION], "#r": articleUrls },

        // Zaps: kind:9735 zap receipts
        { kinds: [KIND_ZAP_RECEIPT], "#r": articleUrls },
      ];

      const events = await fetchEvents(relay, filters);
      relay.close();

      // Convert events to interactions, deduplicating by ID
      for (const event of events) {
        if (seenIds.has(event.id)) continue;
        seenIds.add(event.id);

        const interaction = eventToInteraction(event);
        if (interaction) {
          allInteractions.push(interaction);
        }
      }
    } catch (error) {
      // Log error but continue with other relays
      console.warn(`Failed to fetch from relay ${url}:`, error);
    }
  });

  // Wait for all relay queries to complete (or fail)
  await Promise.allSettled(relayPromises);

  // Sort by timestamp (newest first)
  allInteractions.sort((a, b) => {
    const timeA = a.published_at ? new Date(a.published_at).getTime() : 0;
    const timeB = b.published_at ? new Date(b.published_at).getTime() : 0;
    return timeB - timeA;
  });

  return allInteractions;
}

// ============================================================================
// Event Conversion
// ============================================================================

/**
 * Convert a Nostr event to the universal Interaction format.
 *
 * Maps Nostr event kinds to interaction types:
 * - kind:1 (note) → "comment"
 * - kind:7 (reaction) → "like"
 * - kind:9735 (zap receipt) → "zap"
 *
 * Events must have an "r" tag containing the target URL to be converted.
 *
 * @param event - Nostr event to convert
 * @returns Interaction object, or null if event can't be converted
 *
 * @internal
 */
function eventToInteraction(event: NostrEvent): Interaction | null {
  // Find the target URL from the "r" tag
  // This tag indicates which article/URL the interaction is for
  const rTag = event.tags.find((t) => t[0] === "r");
  if (!rTag) return null;

  const targetUrl = rTag[1];
  const author = eventToAuthor(event);

  // Map event kind to interaction type
  let interactionType: string;
  let content = event.content;
  const meta: Record<string, unknown> = {};

  switch (event.kind) {
    case KIND_SHORT_NOTE:
      // Kind 1: Regular text note = comment
      interactionType = "comment";
      break;

    case KIND_REACTION:
      // Kind 7: Reaction = like
      // Content is typically "+", "-", or an emoji
      interactionType = "like";
      content = event.content || "+";
      break;

    case KIND_ZAP_RECEIPT:
      // Kind 9735: Zap receipt = zap
      // Extract amount from the "amount" tag (in millisats)
      interactionType = "zap";
      const amountTag = event.tags.find((t) => t[0] === "amount");
      if (amountTag) {
        meta.amount = parseInt(amountTag[1], 10);
      }
      break;

    default:
      // Unknown event kind, skip
      return null;
  }

  return {
    id: event.id,
    source: "nostr",
    interaction_type: interactionType,
    author,
    content,
    published_at: new Date(event.created_at * 1000).toISOString(),
    source_url: `https://njump.me/${nip19.noteEncode(event.id)}`,
    target_url: targetUrl,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  };
}

/**
 * Extract author information from a Nostr event.
 *
 * Creates an InteractionAuthor from the event's pubkey. The name is set to
 * a truncated npub since we don't fetch profile metadata (kind:0 events)
 * during the build process.
 *
 * @param event - Nostr event to extract author from
 * @returns InteractionAuthor object
 *
 * @internal
 */
function eventToAuthor(event: NostrEvent): InteractionAuthor {
  // Convert hex pubkey to npub (bech32) format
  const npub = nip19.npubEncode(event.pubkey);

  return {
    identifier: npub,
    // Use truncated npub as display name
    // Full profile info would require fetching kind:0 events
    name: npub.slice(0, 12) + "...",
  };
}

// ============================================================================
// Event Publishing
// ============================================================================

/**
 * Result of publishing an event to multiple relays.
 */
export interface PublishResult {
  /** True if event was published to at least one relay */
  success: boolean;

  /** List of relay URLs that accepted the event */
  published: string[];

  /** List of relay URLs that rejected or failed */
  failed: string[];
}

/**
 * Publish a signed event to multiple Nostr relays.
 *
 * Attempts to publish the event to all provided relays in parallel.
 * Returns success if at least one relay accepts the event.
 *
 * @param relayUrls - List of relay WebSocket URLs to publish to
 * @param event - Signed Nostr event to publish
 * @returns PublishResult indicating which relays succeeded/failed
 *
 * @example
 * ```typescript
 * const event = signEvent(unsignedEvent, privateKey);
 * const result = await publishEvent(
 *   ["wss://relay.damus.io", "wss://nos.lol"],
 *   event
 * );
 *
 * if (result.success) {
 *   console.log(`Published to ${result.published.length} relays`);
 * }
 * if (result.failed.length > 0) {
 *   console.warn(`Failed on: ${result.failed.join(", ")}`);
 * }
 * ```
 */
export async function publishEvent(
  relayUrls: string[],
  event: NostrEvent
): Promise<PublishResult> {
  const published: string[] = [];
  const failed: string[] = [];

  const publishPromises = relayUrls.map(async (url) => {
    try {
      const relay = await connectToRelay(url);
      await relay.publish(event);
      relay.close();
      published.push(url);
    } catch (error) {
      console.warn(`Failed to publish to relay ${url}:`, error);
      failed.push(url);
    }
  });

  await Promise.allSettled(publishPromises);

  return {
    success: published.length > 0,
    published,
    failed,
  };
}

// ============================================================================
// Event Creation
// ============================================================================

/**
 * Article data for creating a NIP-23 long-form event.
 */
export interface ArticleEventData {
  /** Article title */
  title: string;

  /** Full markdown/text content */
  content: string;

  /** Unique slug/identifier for the "d" tag */
  slug: string;

  /** Article tags/categories */
  tags?: string[];

  /** Short summary/description */
  summary?: string;

  /** Cover image URL */
  image?: string;

  /** Original publish timestamp (unix seconds) */
  publishedAt?: number;
}

/**
 * Create a NIP-23 long-form content event for an article.
 *
 * Creates an unsigned event that can be signed and published to Nostr.
 * NIP-23 events use kind:30023 and include metadata tags for title,
 * published_at, summary, image, and hashtags.
 *
 * @param article - Article data to create event from
 * @param pubkey - Hex-encoded public key of the author
 * @returns Unsigned event (needs id and sig to be complete)
 *
 * @example
 * ```typescript
 * const unsignedEvent = createLongFormEvent(
 *   {
 *     title: "My Article",
 *     content: "# My Article\n\nContent here...",
 *     slug: "my-article",
 *     tags: ["nostr", "tech"]
 *   },
 *   pubkey
 * );
 *
 * const signedEvent = signEvent(unsignedEvent, privateKey);
 * await publishEvent(relays, signedEvent);
 * ```
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/23.md
 */
export function createLongFormEvent(
  article: ArticleEventData,
  pubkey: string
): Omit<NostrEvent, "id" | "sig"> {
  const now = Math.floor(Date.now() / 1000);
  const publishedAt = article.publishedAt || now;

  // Build event tags array
  const eventTags: string[][] = [
    // "d" tag: unique identifier for this article (allows updates)
    ["d", article.slug],

    // "title" tag: article title
    ["title", article.title],

    // "published_at" tag: original publication timestamp
    ["published_at", publishedAt.toString()],
  ];

  // Optional "summary" tag
  if (article.summary) {
    eventTags.push(["summary", article.summary]);
  }

  // Optional "image" tag for cover image
  if (article.image) {
    eventTags.push(["image", article.image]);
  }

  // "t" tags for hashtags (lowercase)
  if (article.tags) {
    article.tags.forEach((tag) => {
      eventTags.push(["t", tag.toLowerCase()]);
    });
  }

  return {
    kind: KIND_LONG_FORM,
    pubkey,
    created_at: now,
    tags: eventTags,
    content: article.content,
  };
}

// ============================================================================
// URL Utilities
// ============================================================================

/**
 * Extract a slug/identifier from a URL path.
 *
 * Used to generate the "d" tag value for NIP-23 events from article URLs.
 *
 * @param urlPath - URL or path to extract slug from
 * @returns Slug suitable for use as a "d" tag value
 *
 * @example
 * ```typescript
 * urlToIdentifier("https://example.com/posts/my-article")
 * // Returns: "my-article"
 *
 * urlToIdentifier("posts/my-article.html")
 * // Returns: "my-article"
 *
 * urlToIdentifier("/blog/2024/great-post.md")
 * // Returns: "great-post"
 * ```
 */
export function urlToIdentifier(urlPath: string): string {
  // Split path and filter out empty segments
  const parts = urlPath.split("/").filter(Boolean);

  // Get the last segment (filename)
  const last = parts[parts.length - 1] || "article";

  // Remove file extension (.html, .md)
  return last.replace(/\.(html|md)$/i, "");
}

// ============================================================================
// Key Management
// ============================================================================

/**
 * Decode a NIP-19 nsec key to raw private key bytes.
 *
 * @param nsec - NIP-19 encoded private key (starts with "nsec1")
 * @returns Private key as Uint8Array, or null if invalid
 *
 * @example
 * ```typescript
 * const privateKey = decodeNsec("nsec1...");
 * if (privateKey) {
 *   const pubkey = getPublicKeyFromPrivate(privateKey);
 *   const event = signEvent(unsignedEvent, privateKey);
 * }
 * ```
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/19.md
 */
export function decodeNsec(nsec: string): Uint8Array | null {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type === "nsec") {
      return decoded.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Derive the public key from a private key.
 *
 * @param privateKey - 32-byte private key
 * @returns Hex-encoded public key (64 characters)
 *
 * @example
 * ```typescript
 * const privateKey = decodeNsec("nsec1...");
 * const pubkey = getPublicKeyFromPrivate(privateKey);
 * console.log(`Publishing as ${pubkey.slice(0, 12)}...`);
 * ```
 */
export function getPublicKeyFromPrivate(privateKey: Uint8Array): string {
  return getPublicKey(privateKey);
}

/**
 * Sign and finalize a Nostr event.
 *
 * Takes an unsigned event and adds the id and sig fields by:
 * 1. Serializing the event to canonical JSON
 * 2. Hashing to get the event id
 * 3. Signing the hash with the private key
 *
 * @param unsignedEvent - Event without id and sig fields
 * @param privateKey - 32-byte private key for signing
 * @returns Complete signed event ready for publishing
 *
 * @example
 * ```typescript
 * const unsignedEvent = createLongFormEvent(article, pubkey);
 * const signedEvent = signEvent(unsignedEvent, privateKey);
 *
 * // signedEvent now has valid id and sig fields
 * await publishEvent(relays, signedEvent);
 * ```
 */
export function signEvent(
  unsignedEvent: Omit<NostrEvent, "id" | "sig">,
  privateKey: Uint8Array
): NostrEvent {
  return finalizeEvent(unsignedEvent as UnsignedEvent, privateKey);
}
