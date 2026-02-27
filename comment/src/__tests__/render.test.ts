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
    source: "artalk" as const,
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

  it('shows "Leave your thoughts" when there are 0 comments', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("Leave your thoughts");
  });

  it("includes message-circle SVG icon in summary", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    // Check for the Lucide message-circle path
    expect(html).toContain("M2.992 16.342");
  });

  it("places comment list and form inside details (after summary)", () => {
    const comments = [makeComment()];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk");
    const summaryEnd = html.indexOf("</summary>");
    const commentList = html.indexOf("comment-list");
    const commentForm = html.indexOf("comment-form");
    expect(summaryEnd).toBeLessThan(commentList);
    expect(summaryEnd).toBeLessThan(commentForm);
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

  it("submit button contains send SVG icon (paper plane)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    // Check for the Lucide send icon path
    expect(html).toContain("M14.536 21.686");
  });

  it("submit button has visually-hidden accessible text", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain("visually-hidden");
    // Should contain accessible text for the submit action
    expect(html).toMatch(/visually-hidden[^<]*<\/span>/);
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

  it("submit button contains send SVG icon", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).toContain("M14.536 21.686");
  });

  it("wraps output in details/summary", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).toContain("<details>");
    expect(html).toContain("<summary");
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("edge cases", () => {
  it("returns empty string when no comments and no server URL", () => {
    const html = renderCommentSection([], "posts/test/", "", "");
    expect(html).toBe("");
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
    expect(html).not.toContain("comment-form");
  });
});
