/**
 * Test fixtures for Nostr events
 *
 * Sample events for different Nostr event kinds used in testing.
 */

import type { Event as NostrEvent } from "nostr-tools";

// Sample comment (kind:1 note with r tag)
export const sampleComment: NostrEvent = {
  id: "abc123def456",
  pubkey: "npub1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
  created_at: 1700000000,
  kind: 1,
  tags: [["r", "https://example.com/post"]],
  content: "Great article! Really enjoyed reading this.",
  sig: "signature123abc",
};

// Sample zap receipt (kind:9735)
export const sampleZap: NostrEvent = {
  id: "zap456def789",
  pubkey: "zapper123pubkey456zapper123pubkey456zapper123pubkey456zapper12",
  created_at: 1700000001,
  kind: 9735,
  tags: [
    ["r", "https://example.com/post"],
    ["amount", "21000"], // 21 sats in millisats
    ["p", "author-pubkey-here"],
    ["bolt11", "lnbc210n1..."],
  ],
  content: "",
  sig: "zapsig456abc",
};

// Sample like/reaction (kind:7)
export const sampleLike: NostrEvent = {
  id: "like789abc123",
  pubkey: "liker789pubkey123liker789pubkey123liker789pubkey123liker789pub",
  created_at: 1700000002,
  kind: 7,
  tags: [["r", "https://example.com/post"]],
  content: "+",
  sig: "likesig789def",
};

// Sample long-form content (kind:30023 - NIP-23)
export const sampleLongForm: NostrEvent = {
  id: "article789xyz456",
  pubkey: "author123pubkey789author123pubkey789author123pubkey789author12",
  created_at: 1700000002,
  kind: 30023,
  tags: [
    ["d", "my-article-slug"],
    ["title", "My Article Title"],
    ["summary", "A brief summary of the article content"],
    ["published_at", "1700000000"],
    ["t", "nostr"],
    ["t", "decentralization"],
    ["image", "https://example.com/cover.jpg"],
  ],
  content: "# My Article\n\nThis is the full markdown content of the article...",
  sig: "articlesig789xyz",
};

// Sample repost (kind:6)
export const sampleRepost: NostrEvent = {
  id: "repost123abc456",
  pubkey: "reposter456pubkey789reposter456pubkey789reposter456pubkey789re",
  created_at: 1700000003,
  kind: 6,
  tags: [
    ["e", "original-event-id"],
    ["p", "original-author-pubkey"],
    ["r", "https://example.com/post"],
  ],
  content: "",
  sig: "repostsig123def",
};

// Helper to create multiple comments
export function createComments(targetUrl: string, count: number): NostrEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    ...sampleComment,
    id: `comment-${i}-${Date.now()}`,
    pubkey: `pubkey-${i}-${"0".repeat(56)}`.slice(0, 64),
    created_at: sampleComment.created_at - i * 3600,
    tags: [["r", targetUrl]],
    content: `Comment number ${i + 1}`,
  }));
}

// Helper to create multiple zaps with varying amounts
export function createZaps(targetUrl: string, amounts: number[]): NostrEvent[] {
  return amounts.map((amount, i) => ({
    ...sampleZap,
    id: `zap-${amount}-${i}`,
    created_at: sampleZap.created_at - i * 1800,
    tags: [
      ["r", targetUrl],
      ["amount", amount.toString()],
      ["p", "author-pubkey"],
      ["bolt11", `lnbc${amount}n1...`],
    ],
  }));
}

// Helper to create multiple likes
export function createLikes(targetUrl: string, count: number): NostrEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    ...sampleLike,
    id: `like-${i}-${Date.now()}`,
    pubkey: `liker-${i}-${"0".repeat(56)}`.slice(0, 64),
    created_at: sampleLike.created_at - i * 600,
    tags: [["r", targetUrl]],
  }));
}

// Helper to create a long-form article event
export function createLongFormArticle(options: {
  slug: string;
  title: string;
  content: string;
  tags?: string[];
  summary?: string;
}): NostrEvent {
  const now = Math.floor(Date.now() / 1000);
  const eventTags: string[][] = [
    ["d", options.slug],
    ["title", options.title],
    ["published_at", now.toString()],
  ];

  if (options.summary) {
    eventTags.push(["summary", options.summary]);
  }

  if (options.tags) {
    options.tags.forEach((t) => eventTags.push(["t", t]));
  }

  return {
    id: `article-${options.slug}-${now}`,
    pubkey: sampleLongForm.pubkey,
    created_at: now,
    kind: 30023,
    tags: eventTags,
    content: options.content,
    sig: `article-sig-${options.slug}`,
  };
}

// Sample author profile metadata (kind:0)
export const sampleProfile = {
  name: "Test User",
  about: "A test user for unit tests",
  picture: "https://example.com/avatar.jpg",
  nip05: "test@example.com",
  lud16: "test@getalby.com",
};

export const sampleProfileEvent: NostrEvent = {
  id: "profile123abc456",
  pubkey: sampleComment.pubkey,
  created_at: 1699999000,
  kind: 0,
  tags: [],
  content: JSON.stringify(sampleProfile),
  sig: "profilesig123abc",
};
