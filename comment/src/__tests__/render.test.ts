/**
 * Tests for comment section rendering
 *
 * Validates that renderCommentSection produces correct HTML for
 * different providers (artalk vs waline), collapsible details/summary,
 * form layout, and SVG icons.
 */

import { describe, it, expect } from "vitest";
import { renderCommentSection } from "../render";
import type { NormalizedComment } from "../types";

// ============================================================================
// Test data helpers
// ============================================================================

function makeComment(overrides: Partial<NormalizedComment> = {}): NormalizedComment {
  return {
    id: "c1",
    content_html: "<p>Test comment</p>",
    date: "2025-06-15T10:00:00.000Z",
    author: { name: "Alice", url: "" },
    source: "comment",
    ...overrides,
  };
}

const serverUrl = "https://artalk.example.com";
const submitScript = "/* dummy script */";

// ============================================================================
// Collapsible details/summary wrapper
// ============================================================================

describe("collapsible details/summary wrapper", () => {
  it("wraps output in <details> element (not open by default)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("<details>");
    expect(html).not.toContain("<details open");
  });

  it("includes a <summary> with comments-toggle class", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('<summary class="comments-toggle"');
  });

  it('shows "N comments" in summary when there are comments', () => {
    const comments = [
      makeComment({ id: "c1" }),
      makeComment({ id: "c2" }),
      makeComment({ id: "c3" }),
    ];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("3 comments");
  });

  it('shows "1 comment" (singular) for exactly one comment', () => {
    const comments = [makeComment({ id: "c1" })];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("1 comment");
    expect(html).not.toContain("1 comments");
  });

  it('shows "Comment" when there are 0 comments', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("Comment");
  });

  it("includes message-circle SVG icon in summary", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    // Check for the Lucide message-circle path
    expect(html).toContain("M2.992 16.342");
  });

  it("includes chevron SVG icon in summary", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("comments-chevron");
  });

  it("places form before comment list inside details (after summary)", () => {
    const comments = [makeComment()];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    const summaryEnd = html.indexOf("</summary>");
    const commentForm = html.indexOf("comment-form");
    const commentList = html.indexOf("comment-list");
    expect(summaryEnd).toBeLessThan(commentForm);
    expect(commentForm).toBeLessThan(commentList);
  });
});

// ============================================================================
// Form redesign - Artalk provider
// ============================================================================

describe("form redesign with provider=artalk", () => {
  it('includes name="name" input field', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('name="name"');
  });

  it('includes name="email" input field', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('name="email"');
  });

  it('includes name="content" textarea', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('name="content"');
  });

  it('includes an optional name="link" input field for website', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('name="link"');
    // Should NOT be required — website is optional
    expect(html).not.toMatch(/name="link"[^>]*required/);
  });

  it("places textarea before identity fields (textarea-first layout)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    const textareaPos = html.indexOf('name="content"');
    const namePos = html.indexOf('name="name"');
    const emailPos = html.indexOf('name="email"');
    expect(textareaPos).toBeLessThan(namePos);
    expect(textareaPos).toBeLessThan(emailPos);
  });

  it('marks the website placeholder as "(optional)"', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("(optional)");
  });

  it("wraps name/email/website in a comment-form-meta container", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("comment-form-meta");
  });

  it("all inputs have comment-field class", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    // Check that name, email, and link inputs all have the class
    const nameMatch = html.match(/<input[^>]*name="name"[^>]*/);
    const emailMatch = html.match(/<input[^>]*name="email"[^>]*/);
    const linkMatch = html.match(/<input[^>]*name="link"[^>]*/);
    expect(nameMatch?.[0]).toContain("comment-field");
    expect(emailMatch?.[0]).toContain("comment-field");
    expect(linkMatch?.[0]).toContain("comment-field");
  });

  it("has English placeholder on textarea by default", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('placeholder="Leave your thoughts"');
  });

  it("submit button shows 'Reply' text (not SVG icon)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('>Reply</button>');
    // SVG icon should NOT be present
    expect(html).not.toContain("M14.536 21.686");
    expect(html).not.toContain("visually-hidden");
  });

  it("submit button shows localized text for zh-hans", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "zh-hans");
    expect(html).toContain('>回复</button>');
  });

  it("submit button shows localized text for zh-hant", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "zh-hant");
    expect(html).toContain('>回覆</button>');
  });
});

// ============================================================================
// Form redesign - Waline provider (backward compat)
// ============================================================================

describe("form redesign with provider=waline (backward compat)", () => {
  it("does NOT include name/email input fields", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).not.toContain('name="name"');
    expect(html).not.toContain('name="email"');
  });

  it('includes name="comment" textarea', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).toContain('name="comment"');
  });

  it("works with default provider (no provider argument)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript);
    expect(html).toContain('name="comment"');
    expect(html).not.toContain('name="name"');
  });

  it("does NOT include a hidden url input (dead markup)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).not.toContain('type="hidden"');
  });

  it("has English placeholder on textarea by default", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).toContain('placeholder="Leave your thoughts"');
  });

  it("submit button shows 'Reply' text (not SVG icon)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).toContain('>Reply</button>');
    // SVG icon should NOT be present
    expect(html).not.toContain("M14.536 21.686");
  });

  it("wraps output in details/summary", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).toContain("<details>");
    expect(html).toContain("<summary");
  });
});

// ============================================================================
// Date formatting locale
// ============================================================================

describe("date formatting uses page language", () => {
  it("formats dates in English by default", () => {
    const comments = [makeComment({ date: "2025-06-15T10:00:00.000Z" })];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    // en-US: "Jun 15, 2025"
    expect(html).toContain("Jun 15, 2025");
  });

  it("formats dates in Chinese for zh-hans pages", () => {
    const comments = [makeComment({ date: "2025-06-15T10:00:00.000Z" })];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk", "zh-hans");
    // zh-Hans: "2025年6月15日"
    expect(html).toContain("2025年6月15日");
  });

  it("formats dates in Traditional Chinese for zh-hant pages", () => {
    const comments = [makeComment({ date: "2025-06-15T10:00:00.000Z" })];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk", "zh-hant");
    // zh-Hant: "2025年6月15日"
    expect(html).toContain("2025年6月15日");
  });
});

// ============================================================================
// data-built-at attribute (build timestamp for client-side hydration)
// ============================================================================

describe("data-built-at attribute", () => {
  it("includes data-built-at attribute on the section element", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toMatch(/data-built-at="/);
  });

  it("contains a valid ISO 8601 timestamp", () => {
    const before = new Date().toISOString();
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    const after = new Date().toISOString();

    const match = html.match(/data-built-at="([^"]+)"/);
    expect(match).not.toBeNull();
    const timestamp = match![1];

    // Must be a valid ISO 8601 date
    const parsed = new Date(timestamp);
    expect(parsed.toISOString()).toBe(timestamp);

    // Must be between before and after (generated at render time)
    expect(timestamp >= before).toBe(true);
    expect(timestamp <= after).toBe(true);
  });

  it("is present when there are comments", () => {
    const comments = [makeComment({ id: "c1" }), makeComment({ id: "c2" })];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toMatch(/data-built-at="/);
  });

  it("is present in form-only case (no comments, has server URL)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toMatch(/data-built-at="/);
  });

  it("is on the section.moss-comments element", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    // The attribute should be on the <section> tag itself
    expect(html).toMatch(/<section class="moss-comments"[^>]*data-built-at="/);
  });

  it("uses fetchedAt timestamp when provided", () => {
    const fetchedAt = "2026-03-13T14:13:00.543Z";
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "en", fetchedAt);
    expect(html).toContain(`data-built-at="${fetchedAt}"`);
  });

  it("falls back to current time when fetchedAt is not provided", () => {
    const before = new Date().toISOString();
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    const after = new Date().toISOString();

    const match = html.match(/data-built-at="([^"]+)"/);
    expect(match).not.toBeNull();
    const timestamp = match![1];
    expect(timestamp >= before).toBe(true);
    expect(timestamp <= after).toBe(true);
  });

  it("falls back to current time when fetchedAt is empty string", () => {
    const before = new Date().toISOString();
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "en", "");
    const after = new Date().toISOString();

    const match = html.match(/data-built-at="([^"]+)"/);
    expect(match).not.toBeNull();
    const timestamp = match![1];
    expect(timestamp >= before).toBe(true);
    expect(timestamp <= after).toBe(true);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("edge cases", () => {
  it("renders section wrapper even when no comments and no server URL", () => {
    const html = renderCommentSection([], "posts/test/", "", "");
    expect(html).toContain('<section class="moss-comments"');
    expect(html).not.toContain("comment-form-submit");
    expect(html).not.toContain("comment-list");
  });

  it("includes comment count in summary that counts top-level + replies", () => {
    const comments = [
      makeComment({ id: "c1" }),
      makeComment({ id: "c2", replyToId: "c1" }),
      makeComment({ id: "c3", replyToId: "c1" }),
    ];
    // Total is 3 (all comments, including replies)
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("3 comments");
  });

  it("renders comments-only section (no form) when serverUrl is empty", () => {
    const comments = [makeComment()];
    const html = renderCommentSection(comments, "posts/test/", "", "");
    expect(html).toContain("<details>");
    expect(html).toContain("1 comment");
    expect(html).toContain("comment-list");
    expect(html).not.toContain("comment-form-submit");
  });
});

// ============================================================================
// Per-comment reply button visibility
// ============================================================================

describe("per-comment reply button visibility", () => {
  it("shows reply button on server-sourced comments when server is configured", () => {
    const comments = [makeComment({ id: "c1", source: "comment" })];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("comment-reply-btn");
  });

  it("hides reply button on matters-sourced comments even when server is configured", () => {
    const comments = [makeComment({ id: "c1", source: "matters" })];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).not.toContain("comment-reply-btn");
  });

  it("hides reply button on webmention-sourced comments even when server is configured", () => {
    const comments = [makeComment({ id: "c1", source: "webmention" })];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).not.toContain("comment-reply-btn");
  });

  it("hides reply button on activitypub-sourced comments even when server is configured", () => {
    const comments = [makeComment({ id: "c1", source: "activitypub" })];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).not.toContain("comment-reply-btn");
  });

  it("hides all reply buttons when server is not configured", () => {
    const comments = [makeComment({ id: "c1", source: "comment" })];
    const html = renderCommentSection(comments, "posts/test/", "", "");
    expect(html).not.toContain("comment-reply-btn");
  });

  it("mixed sources: only server comments get reply buttons", () => {
    const comments = [
      makeComment({ id: "c1", source: "comment" }),
      makeComment({ id: "c2", source: "matters", author: { name: "Bob", url: "" } }),
    ];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    // Both comments should be rendered
    expect(html).toContain('id="comment-c1"');
    expect(html).toContain('id="comment-c2"');
    // c1 (server) should have reply btn, c2 (matters) should not
    const c1Start = html.indexOf('id="comment-c1"');
    const c2Start = html.indexOf('id="comment-c2"');
    const c1Section = html.substring(c1Start, c2Start);
    const c2Section = html.substring(c2Start);
    expect(c1Section).toContain("comment-reply-btn");
    expect(c2Section).not.toContain("comment-reply-btn");
  });
});

// ============================================================================
// Form autocomplete attributes
// ============================================================================

describe("artalk form autocomplete attributes", () => {
  it('has autocomplete="name" on name input', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('autocomplete="name"');
  });

  it('has autocomplete="email" on email input', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('autocomplete="email"');
  });

  it('has autocomplete="url" on link input', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('autocomplete="url"');
  });
});
