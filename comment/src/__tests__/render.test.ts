/**
 * Tests for comment form rendering
 *
 * Validates that renderCommentForm produces correct HTML for
 * different providers (artalk vs waline).
 */

import { describe, it, expect } from "vitest";
import { renderCommentSection } from "../render";

describe("renderCommentForm with provider=artalk", () => {
  const serverUrl = "https://artalk.example.com";
  const submitScript = "/* dummy script */";

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
});

describe("renderCommentForm with provider=waline (backward compat)", () => {
  const serverUrl = "https://waline.example.com";
  const submitScript = "/* dummy script */";

  it("does NOT include name/email input fields", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    // Waline form should not have name="name" or name="email" inputs
    expect(html).not.toContain('name="name"');
    expect(html).not.toContain('name="email"');
  });

  it('includes name="comment" textarea', () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).toContain('name="comment"');
  });

  it("works with default provider (no provider argument)", () => {
    // When no provider is specified, should default to waline behavior
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript);
    expect(html).toContain('name="comment"');
    expect(html).not.toContain('name="name"');
  });

  it("does NOT include a hidden url input (dead markup)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline");
    expect(html).not.toContain('type="hidden"');
  });
});
