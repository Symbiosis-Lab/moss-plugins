/**
 * Tests for the Artalk comment provider
 *
 * Validates that buildArtalkClientScript() generates correct inline JS
 * for POSTing comments to Artalk's v2 API.
 */

import { describe, it, expect } from "vitest";
import { buildArtalkClientScript } from "../../providers/artalk";

describe("buildArtalkClientScript", () => {
  const serverUrl = "https://comments.example.com";
  const pagePath = "/posts/hello-world/";
  const siteName = "MySite";

  it("returns a non-empty string", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, siteName);
    expect(script).toBeTruthy();
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
  });

  it("contains the Artalk API endpoint /api/v2/comments", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, siteName);
    expect(script).toContain("/api/v2/comments");
  });

  it("references field name 'content'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, siteName);
    // The script should reference 'content' as a field name in the request body
    expect(script).toContain("content");
  });

  it("references field name 'name'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, siteName);
    expect(script).toContain("name");
  });

  it("references field name 'email'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, siteName);
    expect(script).toContain("email");
  });

  it("references field name 'page_key'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, siteName);
    expect(script).toContain("page_key");
  });

  it("references field name 'site_name'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, siteName);
    expect(script).toContain("site_name");
  });

  it("properly escapes a server URL containing single quotes", () => {
    const dangerousUrl = "https://example.com/it's-a-trap";
    const script = buildArtalkClientScript(dangerousUrl, pagePath, siteName);
    // The raw single quote should NOT appear unescaped in the output
    // The escaped form \' should be present instead
    expect(script).not.toContain("it's-a-trap");
    expect(script).toContain("it\\'s-a-trap");
  });

  it("properly escapes the page path", () => {
    const dangerousPath = "/posts/it's-a-test/";
    const script = buildArtalkClientScript(serverUrl, dangerousPath, siteName);
    expect(script).not.toContain("it's-a-test");
    expect(script).toContain("it\\'s-a-test");
  });

  it("properly escapes the site name", () => {
    const dangerousSiteName = "O'Reilly's Site";
    const script = buildArtalkClientScript(serverUrl, pagePath, dangerousSiteName);
    expect(script).not.toContain("O'Reilly's Site");
    expect(script).toContain("O\\'Reilly\\'s Site");
  });

  it("properly escapes backslashes in server URL", () => {
    const urlWithBackslash = "https://example.com/path\\test";
    const script = buildArtalkClientScript(urlWithBackslash, pagePath, siteName);
    // Backslash should be double-escaped to prevent JS string breakout
    expect(script).toContain("path\\\\test");
    expect(script).not.toContain("path\\test'");
  });
});
