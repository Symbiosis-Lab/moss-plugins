/**
 * Common test utilities
 *
 * Shared utilities and helpers for tests across the Nostr plugin.
 */

import type { Interaction } from "../src/types";

// Create a sample interaction for testing
export function createInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: `int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source: "nostr",
    interaction_type: "comment",
    author: {
      name: "Test User",
      identifier: "npub1test...",
    },
    content: "Test comment content",
    target_url: "posts/test.html",
    ...overrides,
  };
}

// Create multiple interactions for a target URL
export function createInteractions(
  targetUrl: string,
  count: number,
  type: string = "comment"
): Interaction[] {
  return Array.from({ length: count }, (_, i) =>
    createInteraction({
      id: `int-${i}`,
      interaction_type: type,
      author: {
        name: `User ${i}`,
        identifier: `npub${i}`,
      },
      content: `${type} content ${i}`,
      target_url: targetUrl,
    })
  );
}

// Create a mock ProcessContext
export function createProcessContext(overrides: Record<string, unknown> = {}) {
  return {
    project_path: "/test/project",
    moss_dir: "/test/.moss",
    project_info: {
      content_folders: ["posts"],
      total_files: 1,
    },
    config: {
      relays: ["wss://relay.example.com"],
    },
    ...overrides,
  };
}

// Create a mock EnhanceContext
export function createEnhanceContext(
  interactions: Interaction[] = [],
  overrides: Record<string, unknown> = {}
) {
  return {
    project_path: "/test/project",
    moss_dir: "/test/.moss",
    output_dir: "/test/output",
    project_info: {
      content_folders: ["posts"],
      total_files: 1,
    },
    config: {},
    interactions,
    ...overrides,
  };
}

// Create a mock SyndicateContext
export function createSyndicateContext(
  articles: Array<{
    title: string;
    url_path: string;
    content?: string;
    tags?: string[];
  }> = [],
  overrides: Record<string, unknown> = {}
) {
  return {
    project_path: "/test/project",
    moss_dir: "/test/.moss",
    output_dir: "/test/output",
    site_url: "https://example.com",
    articles,
    config: {},
    ...overrides,
  };
}

// Wait for a condition with timeout
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// Delay utility for async tests
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
