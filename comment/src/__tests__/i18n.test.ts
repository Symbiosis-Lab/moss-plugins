/**
 * Tests for i18n infrastructure
 *
 * Validates:
 * - Translation table returns correct strings for all 3 languages and all keys
 * - parseLang() extracts lang from HTML and maps to supported locales
 * - renderSummaryText() outputs correct i18n text for each language
 * - renderCommentForm() uses i18n placeholders for each language
 */

import { describe, it, expect } from "vitest";
import { translations, parseLang, type Lang } from "../i18n";
import { renderCommentSection } from "../render";
import type { NormalizedComment } from "../types";

// ============================================================================
// Translation table
// ============================================================================

describe("translation table", () => {
  const allKeys = [
    "comment_count_zero",
    "comment_count_one",
    "comment_count_many",
    "placeholder",
    "name",
    "email_optional",
    "website_optional",
    "reply",
    "submitting",
    "comment_submitted",
    "network_error",
  ] as const;

  const langs: Lang[] = ["en", "zh-hans", "zh-hant"];

  it("has entries for all 3 languages", () => {
    for (const lang of langs) {
      expect(translations[lang]).toBeDefined();
    }
  });

  it("has all keys for every language", () => {
    for (const lang of langs) {
      for (const key of allKeys) {
        expect(translations[lang][key]).toBeDefined();
        expect(typeof translations[lang][key]).toBe("string");
        expect(translations[lang][key].length).toBeGreaterThan(0);
      }
    }
  });

  // Spot-check specific translations
  it("returns correct English strings", () => {
    const en = translations["en"];
    expect(en.comment_count_zero).toBe("Comment");
    expect(en.comment_count_one).toBe("1 comment");
    expect(en.comment_count_many).toBe("{n} comments");
    expect(en.placeholder).toBe("Leave your thoughts");
    expect(en.name).toBe("Name");
    expect(en.email_optional).toBe("Email (optional)");
    expect(en.website_optional).toBe("Website (optional)");
    expect(en.reply).toBe("Reply");
    expect(en.submitting).toBe("Submitting...");
    expect(en.comment_submitted).toBe("Comment submitted!");
    expect(en.network_error).toBe("Network error. Please try again.");
  });

  it("returns correct Simplified Chinese strings", () => {
    const zhHans = translations["zh-hans"];
    expect(zhHans.comment_count_zero).toBe("评论");
    expect(zhHans.comment_count_one).toBe("1条评论");
    expect(zhHans.comment_count_many).toBe("{n}条评论");
    expect(zhHans.placeholder).toBe("留下你的想法");
    expect(zhHans.name).toBe("名字");
    expect(zhHans.email_optional).toBe("邮箱（选填）");
    expect(zhHans.website_optional).toBe("网站（选填）");
    expect(zhHans.reply).toBe("回复");
    expect(zhHans.submitting).toBe("提交中...");
    expect(zhHans.comment_submitted).toBe("评论已提交！");
    expect(zhHans.network_error).toBe("网络错误，请重试。");
  });

  it("returns correct Traditional Chinese strings", () => {
    const zhHant = translations["zh-hant"];
    expect(zhHant.comment_count_zero).toBe("評論");
    expect(zhHant.comment_count_one).toBe("1條評論");
    expect(zhHant.comment_count_many).toBe("{n}條評論");
    expect(zhHant.placeholder).toBe("留下你的想法");
    expect(zhHant.name).toBe("名字");
    expect(zhHant.email_optional).toBe("電子郵件（選填）");
    expect(zhHant.website_optional).toBe("網站（選填）");
    expect(zhHant.reply).toBe("回覆");
    expect(zhHant.submitting).toBe("提交中...");
    expect(zhHant.comment_submitted).toBe("評論已提交！");
    expect(zhHant.network_error).toBe("網路錯誤，請重試。");
  });
});

// ============================================================================
// parseLang
// ============================================================================

describe("parseLang", () => {
  it('extracts lang="en" and returns "en"', () => {
    expect(parseLang('<html lang="en">')).toBe("en");
  });

  it('extracts lang="zh-hans" and returns "zh-hans"', () => {
    expect(parseLang('<html lang="zh-hans">')).toBe("zh-hans");
  });

  it('extracts lang="zh-hant" and returns "zh-hant"', () => {
    expect(parseLang('<html lang="zh-hant">')).toBe("zh-hant");
  });

  it('maps "zh-cn" to "zh-hans"', () => {
    expect(parseLang('<html lang="zh-cn">')).toBe("zh-hans");
  });

  it('maps "zh-CN" (uppercase) to "zh-hans"', () => {
    expect(parseLang('<html lang="zh-CN">')).toBe("zh-hans");
  });

  it('maps "zh-Hans" (mixed case) to "zh-hans"', () => {
    expect(parseLang('<html lang="zh-Hans">')).toBe("zh-hans");
  });

  it('maps "zh-tw" to "zh-hant"', () => {
    expect(parseLang('<html lang="zh-tw">')).toBe("zh-hant");
  });

  it('maps "zh-TW" (uppercase) to "zh-hant"', () => {
    expect(parseLang('<html lang="zh-TW">')).toBe("zh-hant");
  });

  it('maps "zh-Hant" (mixed case) to "zh-hant"', () => {
    expect(parseLang('<html lang="zh-Hant">')).toBe("zh-hant");
  });

  it('defaults to "en" for unsupported languages', () => {
    expect(parseLang('<html lang="fr">')).toBe("en");
    expect(parseLang('<html lang="ja">')).toBe("en");
    expect(parseLang('<html lang="de">')).toBe("en");
  });

  it('defaults to "en" when no lang attribute is found', () => {
    expect(parseLang("<html>")).toBe("en");
  });

  it('defaults to "en" for empty string input', () => {
    expect(parseLang("")).toBe("en");
  });

  it("works with full HTML document", () => {
    const html = `<!DOCTYPE html>
<html lang="zh-hans">
<head><title>Test</title></head>
<body><p>Hello</p></body>
</html>`;
    expect(parseLang(html)).toBe("zh-hans");
  });

  it("handles single-quoted lang attribute", () => {
    expect(parseLang("<html lang='zh-tw'>")).toBe("zh-hant");
  });

  it('maps plain "en-US" to "en"', () => {
    expect(parseLang('<html lang="en-US">')).toBe("en");
  });
});

// ============================================================================
// renderSummaryText with i18n
// ============================================================================

describe("renderSummaryText i18n", () => {
  const serverUrl = "https://artalk.example.com";
  const submitScript = "/* dummy script */";

  it("renders English summary for 0 comments", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "en");
    expect(html).toContain(">Comment<");
    // Should not contain Chinese zero-comment text
    expect(html).not.toContain(">评论<");
  });

  it("renders Simplified Chinese summary for 0 comments", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "zh-hans");
    expect(html).toContain(">评论<");
  });

  it("renders Traditional Chinese summary for 0 comments", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "zh-hant");
    expect(html).toContain(">評論<");
  });

  it("renders English summary for 1 comment", () => {
    const comments: NormalizedComment[] = [{
      id: "c1", content_html: "<p>Test</p>", date: "2025-01-01T00:00:00Z",
      author: { name: "Alice" }, source: "artalk",
    }];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk", "en");
    expect(html).toContain("1 comment");
    expect(html).not.toContain("1 comments");
  });

  it("renders Simplified Chinese summary for 1 comment", () => {
    const comments: NormalizedComment[] = [{
      id: "c1", content_html: "<p>Test</p>", date: "2025-01-01T00:00:00Z",
      author: { name: "Alice" }, source: "artalk",
    }];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk", "zh-hans");
    expect(html).toContain("1条评论");
  });

  it("renders English summary for multiple comments", () => {
    const comments: NormalizedComment[] = [
      { id: "c1", content_html: "<p>A</p>", date: "2025-01-01T00:00:00Z", author: { name: "Alice" }, source: "artalk" },
      { id: "c2", content_html: "<p>B</p>", date: "2025-01-01T00:00:00Z", author: { name: "Bob" }, source: "artalk" },
      { id: "c3", content_html: "<p>C</p>", date: "2025-01-01T00:00:00Z", author: { name: "Charlie" }, source: "artalk" },
    ];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk", "en");
    expect(html).toContain("3 comments");
  });

  it("renders Simplified Chinese summary for multiple comments", () => {
    const comments: NormalizedComment[] = [
      { id: "c1", content_html: "<p>A</p>", date: "2025-01-01T00:00:00Z", author: { name: "Alice" }, source: "artalk" },
      { id: "c2", content_html: "<p>B</p>", date: "2025-01-01T00:00:00Z", author: { name: "Bob" }, source: "artalk" },
    ];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk", "zh-hans");
    expect(html).toContain("2条评论");
  });

  it("renders Traditional Chinese summary for multiple comments", () => {
    const comments: NormalizedComment[] = [
      { id: "c1", content_html: "<p>A</p>", date: "2025-01-01T00:00:00Z", author: { name: "Alice" }, source: "artalk" },
      { id: "c2", content_html: "<p>B</p>", date: "2025-01-01T00:00:00Z", author: { name: "Bob" }, source: "artalk" },
      { id: "c3", content_html: "<p>C</p>", date: "2025-01-01T00:00:00Z", author: { name: "Charlie" }, source: "artalk" },
      { id: "c4", content_html: "<p>D</p>", date: "2025-01-01T00:00:00Z", author: { name: "Dave" }, source: "artalk" },
      { id: "c5", content_html: "<p>E</p>", date: "2025-01-01T00:00:00Z", author: { name: "Eve" }, source: "artalk" },
    ];
    const html = renderCommentSection(comments, "posts/test/", serverUrl, submitScript, "artalk", "zh-hant");
    expect(html).toContain("5條評論");
  });
});

// ============================================================================
// renderCommentForm with i18n
// ============================================================================

describe("renderCommentForm i18n", () => {
  const serverUrl = "https://artalk.example.com";
  const submitScript = "/* dummy script */";

  it("uses English placeholder on textarea (en)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "en");
    expect(html).toContain('placeholder="Leave your thoughts"');
  });

  it("uses Simplified Chinese placeholder on textarea (zh-hans)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "zh-hans");
    expect(html).toContain('placeholder="留下你的想法"');
  });

  it("uses Traditional Chinese placeholder on textarea (zh-hant)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "zh-hant");
    expect(html).toContain('placeholder="留下你的想法"');
  });

  it("uses English field labels for artalk form (en)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "en");
    expect(html).toContain('placeholder="Name"');
    expect(html).toContain('placeholder="Email (optional)"');
    expect(html).toContain('placeholder="Website (optional)"');
  });

  it("uses Simplified Chinese field labels for artalk form (zh-hans)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "zh-hans");
    expect(html).toContain('placeholder="名字"');
    expect(html).toContain('placeholder="邮箱（选填）"');
    expect(html).toContain('placeholder="网站（选填）"');
  });

  it("uses Traditional Chinese field labels for artalk form (zh-hant)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk", "zh-hant");
    expect(html).toContain('placeholder="名字"');
    expect(html).toContain('placeholder="電子郵件（選填）"');
    expect(html).toContain('placeholder="網站（選填）"');
  });

  it("uses English placeholder for waline form (en)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline", "en");
    expect(html).toContain('placeholder="Leave your thoughts"');
  });

  it("uses Simplified Chinese placeholder for waline form (zh-hans)", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "waline", "zh-hans");
    expect(html).toContain('placeholder="留下你的想法"');
  });

  it("defaults to English when lang is not specified", () => {
    const html = renderCommentSection([], "posts/test/", serverUrl, submitScript, "artalk");
    expect(html).toContain('placeholder="Leave your thoughts"');
    expect(html).toContain('placeholder="Name"');
  });
});
