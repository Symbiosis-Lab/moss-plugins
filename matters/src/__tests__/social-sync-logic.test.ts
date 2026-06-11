/**
 * Unit tests for the social-fetch loop fixes in main.ts (issue #793).
 *
 * These tests cover the two logical conditions that were broken:
 *
 * 1. Count-skip unlock: the skip must NOT fire when storedCount matches
 *    remoteCount but we have zero stored comments (poisoned entry).
 *
 * 2. First-fetch poisoning fix: `sinceTimestamp` must be undefined (not
 *    lastSyncedAt) when the social key has no prior data.
 *
 * Both conditions are expressed as pure predicates here so they can be
 * tested without spinning up the full process hook.
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// Extracted predicates (mirror the inline expressions in main.ts Phase 8)
// ============================================================================

/**
 * Should the social fetch for this article be SKIPPED?
 *
 * Mirrors the condition at main.ts Phase 8 after the fix (issue #793):
 *   remoteCount !== undefined
 *   && storedCount !== undefined
 *   && remoteCount === storedCount
 *   && (remoteCount === 0 || existingComments.length > 0)
 */
function shouldSkipSocialFetch(
  remoteCount: number | undefined,
  storedCount: number | undefined,
  existingCommentsLength: number,
): boolean {
  return (
    remoteCount !== undefined &&
    storedCount !== undefined &&
    remoteCount === storedCount &&
    (remoteCount === 0 || existingCommentsLength > 0)
  );
}

/**
 * What sinceTimestamp should be passed to fetchArticleComments?
 *
 * Mirrors the expression at main.ts Phase 8 after the fix (issue #793):
 *   existingComments.length > 0 ? lastSyncedAt : undefined
 */
function resolveSinceTimestamp(
  existingCommentsLength: number,
  lastSyncedAt: string | undefined,
): string | undefined {
  return existingCommentsLength > 0 ? lastSyncedAt : undefined;
}

// ============================================================================
// Count-skip unlock tests
// ============================================================================

describe("shouldSkipSocialFetch — count-skip unlock (issue #793)", () => {
  it("does NOT skip when remoteCount=57, storedCount=57, existingComments=0 (poisoned entry)", () => {
    // This is the core regression: a poisoned entry where lastSyncedAt caused
    // an empty fetch but the count was recorded. The old code would skip here,
    // freezing the entry forever.
    expect(shouldSkipSocialFetch(57, 57, 0)).toBe(false);
  });

  it("skips when remoteCount=57, storedCount=57, existingComments=57 (healthy entry)", () => {
    expect(shouldSkipSocialFetch(57, 57, 57)).toBe(true);
  });

  it("skips when remoteCount=0, storedCount=0, existingComments=0 (article has no comments)", () => {
    // Zero remote count is a special case: nothing to fetch, safe to skip
    // even with zero stored comments because there are genuinely no comments.
    expect(shouldSkipSocialFetch(0, 0, 0)).toBe(true);
  });

  it("does NOT skip when counts differ (new comments arrived)", () => {
    expect(shouldSkipSocialFetch(58, 57, 55)).toBe(false);
  });

  it("does NOT skip when remoteCounts not available (discovery failed)", () => {
    expect(shouldSkipSocialFetch(undefined, 57, 55)).toBe(false);
  });

  it("does NOT skip when storedCount not yet set (first sync)", () => {
    expect(shouldSkipSocialFetch(10, undefined, 0)).toBe(false);
  });

  it("skips when remoteCount=1, storedCount=1, existingComments=1 (single comment, healthy)", () => {
    expect(shouldSkipSocialFetch(1, 1, 1)).toBe(true);
  });

  it("does NOT skip when remoteCount=5, storedCount=5, existingComments=0 (multi-comment poisoned)", () => {
    expect(shouldSkipSocialFetch(5, 5, 0)).toBe(false);
  });
});

// ============================================================================
// First-fetch poisoning fix tests
// ============================================================================

describe("resolveSinceTimestamp — first-fetch poisoning fix (issue #793)", () => {
  const oldTimestamp = "2024-01-01T00:00:00.000Z";

  it("returns undefined for a new key with no prior data", () => {
    // This is the core fix: for a fresh social key, we must NOT pass
    // lastSyncedAt as sinceTimestamp — it would drop all older comments.
    expect(resolveSinceTimestamp(0, oldTimestamp)).toBeUndefined();
  });

  it("returns lastSyncedAt when existing comments are present", () => {
    // For established keys, pass the timestamp to skip already-known pages.
    expect(resolveSinceTimestamp(42, oldTimestamp)).toBe(oldTimestamp);
  });

  it("returns undefined when existing comments=0, even if lastSyncedAt is set", () => {
    expect(resolveSinceTimestamp(0, "2025-06-10T00:00:00.000Z")).toBeUndefined();
  });

  it("returns undefined when lastSyncedAt is also undefined (no prior sync)", () => {
    expect(resolveSinceTimestamp(0, undefined)).toBeUndefined();
  });

  it("returns undefined even when lastSyncedAt is defined and comments=0", () => {
    // Regression guard: this was the poisoning path. The timestamp exists
    // from a prior process hook run, but no comments were fetched yet.
    expect(resolveSinceTimestamp(0, "2026-06-10T00:00:00.000Z")).toBeUndefined();
  });

  it("returns lastSyncedAt=undefined when existing comments > 0 but lastSyncedAt is undefined", () => {
    // Edge case: first-ever sync (no timestamp) but somehow we have comments.
    expect(resolveSinceTimestamp(3, undefined)).toBeUndefined();
  });
});
