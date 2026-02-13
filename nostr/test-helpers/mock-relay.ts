/**
 * Mock Nostr relay for testing
 *
 * Provides a controllable mock that simulates Nostr relay behavior
 * for unit and integration tests.
 */

import type { Filter, Event as NostrEvent } from "nostr-tools";

interface Subscription {
  id: string;
  filters: Filter[];
  onEvent: (event: NostrEvent) => void;
  onEose: () => void;
}

export class MockRelay {
  private subscriptions = new Map<string, Subscription>();
  private events: NostrEvent[] = [];
  private publishedEvents: NostrEvent[] = [];
  private shouldTimeout = false;
  private timeoutDelay = 0;
  private shouldRejectPublish = false;
  private connectDelay = 0;

  // Configure mock behavior
  setEvents(events: NostrEvent[]): void {
    this.events = events;
  }

  setTimeout(delay: number): void {
    this.shouldTimeout = true;
    this.timeoutDelay = delay;
  }

  setConnectDelay(delay: number): void {
    this.connectDelay = delay;
  }

  setRejectPublish(reject: boolean): void {
    this.shouldRejectPublish = reject;
  }

  getPublishedEvents(): NostrEvent[] {
    return [...this.publishedEvents];
  }

  clearPublishedEvents(): void {
    this.publishedEvents = [];
  }

  // Simulated relay methods
  async connect(): Promise<void> {
    if (this.connectDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.connectDelay));
    }
    if (this.shouldTimeout) {
      throw new Error("Connection timeout");
    }
  }

  subscribe(
    filters: Filter[],
    callbacks: { onevent: (e: NostrEvent) => void; oneose: () => void }
  ): { close: () => void } {
    const id = Math.random().toString(36).slice(2);

    // Simulate async event delivery
    setTimeout(() => {
      const matching = this.events.filter((e) => this.matchesFilter(e, filters));
      matching.forEach((e) => callbacks.onevent(e));
      callbacks.oneose();
    }, 10);

    return {
      close: () => {
        this.subscriptions.delete(id);
      },
    };
  }

  async publish(event: NostrEvent): Promise<void> {
    if (this.shouldRejectPublish) {
      throw new Error("Publish rejected by relay");
    }
    this.publishedEvents.push(event);
  }

  private matchesFilter(event: NostrEvent, filters: Filter[]): boolean {
    return filters.some((f) => {
      // Check kind filter
      if (f.kinds && !f.kinds.includes(event.kind)) return false;

      // Check #r tag filter (used for referencing URLs)
      if (f["#r"]) {
        const rTags = event.tags.filter((t) => t[0] === "r").map((t) => t[1]);
        if (!f["#r"].some((r) => rTags.includes(r))) return false;
      }

      // Check #e tag filter (event references)
      if (f["#e"]) {
        const eTags = event.tags.filter((t) => t[0] === "e").map((t) => t[1]);
        if (!f["#e"].some((e) => eTags.includes(e))) return false;
      }

      // Check #p tag filter (pubkey references)
      if (f["#p"]) {
        const pTags = event.tags.filter((t) => t[0] === "p").map((t) => t[1]);
        if (!f["#p"].some((p) => pTags.includes(p))) return false;
      }

      // Check author filter
      if (f.authors && !f.authors.includes(event.pubkey)) return false;

      // Check since filter
      if (f.since && event.created_at < f.since) return false;

      // Check until filter
      if (f.until && event.created_at > f.until) return false;

      return true;
    });
  }
}

// Factory functions for creating pre-configured mocks

export function createMockRelayWithComments(targetUrl: string, count: number): MockRelay {
  const relay = new MockRelay();
  const events = Array.from({ length: count }, (_, i) => createMockComment(targetUrl, i));
  relay.setEvents(events);
  return relay;
}

export function createMockRelayWithZaps(
  targetUrl: string,
  amounts: number[]
): MockRelay {
  const relay = new MockRelay();
  const events = amounts.map((amount, i) => createMockZap(targetUrl, amount, i));
  relay.setEvents(events);
  return relay;
}

export function createMockRelayWithTimeout(delay: number): MockRelay {
  const relay = new MockRelay();
  relay.setTimeout(delay);
  return relay;
}

// Event creation helpers

export function createMockComment(
  targetUrl: string,
  index: number,
  options?: {
    pubkey?: string;
    content?: string;
    createdAt?: number;
  }
): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `comment-${index}-${now}`,
    pubkey: options?.pubkey ?? `pubkey-${index}`,
    created_at: options?.createdAt ?? now - index * 3600,
    kind: 1,
    tags: [["r", targetUrl]],
    content: options?.content ?? `Test comment ${index}`,
    sig: `sig-${index}`,
  };
}

export function createMockZap(
  targetUrl: string,
  amount: number,
  index: number
): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `zap-${amount}-${index}`,
    pubkey: "zapper-pubkey",
    created_at: now - index * 1800,
    kind: 9735,
    tags: [
      ["r", targetUrl],
      ["amount", amount.toString()],
      ["bolt11", "lnbc..."], // Mock lightning invoice
    ],
    content: "",
    sig: `zapsig-${index}`,
  };
}

export function createMockLike(targetUrl: string, index: number): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `like-${index}`,
    pubkey: `liker-${index}`,
    created_at: now - index * 600,
    kind: 7, // Reaction kind
    tags: [["r", targetUrl]],
    content: "+",
    sig: `likesig-${index}`,
  };
}

export function createMockLongFormArticle(
  slug: string,
  title: string,
  content: string,
  tags: string[] = []
): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `article-${slug}`,
    pubkey: "author-pubkey",
    created_at: now,
    kind: 30023, // Long-form content (NIP-23)
    tags: [
      ["d", slug],
      ["title", title],
      ["published_at", now.toString()],
      ...tags.map((t) => ["t", t]),
    ],
    content,
    sig: "article-sig",
  };
}
