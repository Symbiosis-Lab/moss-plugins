/**
 * Tests for i18n support in client-side JS generation
 *
 * Validates that buildClientScript() and buildArtalkClientScript()
 * generate correct i18n strings for button text and status messages.
 *
 * These are build-time strings embedded directly in the generated inline JS.
 */

import { describe, it, expect } from "vitest";
import { buildClientScript } from "../client-js";
import { buildArtalkClientScript } from "../providers/artalk";

describe("buildClientScript i18n", () => {
  const serverUrl = "https://waline.example.com";
  const pagePath = "/posts/hello/";

  it("defaults to English strings when no lang is provided", () => {
    const script = buildClientScript(serverUrl, pagePath);
    expect(script).toContain("'Submitting...'");
    expect(script).toContain("'Reply'");
    expect(script).toContain("'Comment submitted!'");
    expect(script).toContain("'Network error. Please try again.'");
  });

  it("uses English strings when lang is 'en'", () => {
    const script = buildClientScript(serverUrl, pagePath, "", "en");
    expect(script).toContain("'Submitting...'");
    expect(script).toContain("'Reply'");
    expect(script).toContain("'Comment submitted!'");
    expect(script).toContain("'Network error. Please try again.'");
  });

  it("uses Simplified Chinese strings when lang is 'zh-hans'", () => {
    const script = buildClientScript(serverUrl, pagePath, "", "zh-hans");
    expect(script).toContain("'提交中...'");
    expect(script).toContain("'回复'");
    expect(script).toContain("'评论已提交！'");
    expect(script).toContain("'网络错误，请重试。'");
  });

  it("uses Traditional Chinese strings when lang is 'zh-hant'", () => {
    const script = buildClientScript(serverUrl, pagePath, "", "zh-hant");
    expect(script).toContain("'提交中...'");
    expect(script).toContain("'回覆'");
    expect(script).toContain("'評論已提交！'");
    expect(script).toContain("'網路錯誤，請重試。'");
  });

  it("does not contain hardcoded English when using zh-hans", () => {
    const script = buildClientScript(serverUrl, pagePath, "", "zh-hans");
    expect(script).not.toContain("'Submitting...'");
    // Check that the reset text uses i18n, not hardcoded 'Submit'
    expect(script).not.toContain("'Submit'");
    expect(script).not.toContain("'Comment submitted!'");
    expect(script).not.toContain("'Network error. Please try again.'");
  });

  it("still works with uid parameter alongside lang", () => {
    const uid = "uid-123";
    const script = buildClientScript(serverUrl, pagePath, uid, "zh-hans");
    expect(script).toContain(`url: '${uid}'`);
    // Should still have Chinese strings
    expect(script).toContain("'回复'");
  });
});

describe("buildArtalkClientScript i18n", () => {
  const serverUrl = "https://artalk.example.com";
  const pagePath = "/posts/hello/";
  const siteName = "MySite";

  it("defaults to English strings when no lang is provided", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toContain("'Submitting...'");
    expect(script).toContain("'Reply'");
    expect(script).toContain("'Comment submitted!'");
    expect(script).toContain("'Network error. Please try again.'");
  });

  it("uses English strings when lang is 'en'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "en");
    expect(script).toContain("'Submitting...'");
    expect(script).toContain("'Reply'");
    expect(script).toContain("'Comment submitted!'");
    expect(script).toContain("'Network error. Please try again.'");
  });

  it("uses Simplified Chinese strings when lang is 'zh-hans'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "zh-hans");
    expect(script).toContain("'提交中...'");
    expect(script).toContain("'回复'");
    expect(script).toContain("'评论已提交！'");
    expect(script).toContain("'网络错误，请重试。'");
  });

  it("uses Traditional Chinese strings when lang is 'zh-hant'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "zh-hant");
    expect(script).toContain("'提交中...'");
    expect(script).toContain("'回覆'");
    expect(script).toContain("'評論已提交！'");
    expect(script).toContain("'網路錯誤，請重試。'");
  });

  it("does not contain hardcoded English when using zh-hans", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "zh-hans");
    expect(script).not.toContain("'Submitting...'");
    expect(script).not.toContain("'Submit'");
    expect(script).not.toContain("'Comment submitted!'");
    expect(script).not.toContain("'Network error. Please try again.'");
  });

  it("still posts to the Artalk v2 API endpoint with lang set", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "zh-hans");
    expect(script).toContain("/api/v2/comments");
  });
});
