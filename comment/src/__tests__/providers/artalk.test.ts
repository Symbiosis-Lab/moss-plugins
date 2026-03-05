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
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toBeTruthy();
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
  });

  it("contains the Artalk API endpoint /api/v2/comments", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toContain("/api/v2/comments");
  });

  it("references field name 'content'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    // The script should reference 'content' as a field name in the request body
    expect(script).toContain("content");
  });

  it("references field name 'name'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toContain("name");
  });

  it("references field name 'email'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toContain("email");
  });

  it("references field name 'page_key'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toContain("page_key");
  });

  it("references field name 'site_name'", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toContain("site_name");
  });

  it("reads the optional 'link' field from the form", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toContain("form.elements['link']");
  });

  it("includes 'link' in the request body", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toMatch(/body\s*=\s*\{[\s\S]*link:/);
  });

  it("properly escapes a server URL containing single quotes", () => {
    const dangerousUrl = "https://example.com/it's-a-trap";
    const script = buildArtalkClientScript(dangerousUrl, pagePath, "", siteName);
    // The raw single quote should NOT appear unescaped in the output
    // The escaped form \' should be present instead
    expect(script).not.toContain("it's-a-trap");
    expect(script).toContain("it\\'s-a-trap");
  });

  it("properly escapes the page path", () => {
    const dangerousPath = "/posts/it's-a-test/";
    const script = buildArtalkClientScript(serverUrl, dangerousPath, "", siteName);
    expect(script).not.toContain("it's-a-test");
    expect(script).toContain("it\\'s-a-test");
  });

  it("properly escapes the site name", () => {
    const dangerousSiteName = "O'Reilly's Site";
    const script = buildArtalkClientScript(serverUrl, pagePath, "", dangerousSiteName);
    expect(script).not.toContain("O'Reilly's Site");
    expect(script).toContain("O\\'Reilly\\'s Site");
  });

  it("properly escapes backslashes in server URL", () => {
    const urlWithBackslash = "https://example.com/path\\test";
    const script = buildArtalkClientScript(urlWithBackslash, pagePath, "", siteName);
    // Backslash should be double-escaped to prevent JS string breakout
    expect(script).toContain("path\\\\test");
    expect(script).not.toContain("path\\test'");
  });

  it("escapes < to prevent </script> injection", () => {
    const maliciousUrl = "https://evil.com/</script><script>alert(1)</script>";
    const script = buildArtalkClientScript(maliciousUrl, pagePath, "", siteName);
    // The literal </script> must NOT appear — it would close the inline script block
    expect(script).not.toContain("</script>");
    // The < should be escaped to \u003c
    expect(script).toContain("\\u003c/script>");
  });

  // ==========================================================================
  // Form submission ID fix
  // ==========================================================================

  describe("form submission ID fix", () => {
    it("sets li.id = 'comment-' + data.id in submit handler", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("li.id = 'comment-' + data.id");
    });
  });

  // ==========================================================================
  // Fetch-on-open hydration
  // ==========================================================================

  describe("fetch-on-open hydration", () => {
    it("reads data-built-at attribute from moss-comments section", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("data-built-at");
    });

    it("parses builtAtMs from the data-built-at timestamp", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("builtAtMs");
    });

    it("fetches with sort_by=date_desc and flat_mode=true", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("sort_by=date_desc");
      expect(script).toContain("flat_mode=true");
    });

    it("contains date comparison for filtering (builtAtMs boundary)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // The script should compare comment dates against builtAtMs
      expect(script).toMatch(/new Date\(c\.created_at\)\.getTime\(\)\s*<=\s*builtAtMs/);
    });

    it("contains ID guard using document.getElementById", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("document.getElementById('comment-' + c.id)");
    });

    it("uses correct locale for en (en-US)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "en");
      expect(script).toContain("toLocaleDateString('en-US'");
    });

    it("uses correct locale for zh-hans (zh-CN)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "zh-hans");
      expect(script).toContain("toLocaleDateString('zh-CN'");
    });

    it("uses correct locale for zh-hant (zh-TW)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "zh-hant");
      expect(script).toContain("toLocaleDateString('zh-TW'");
    });

    it("contains i18n count update strings for en", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "en");
      expect(script).toContain("1 comment");
      expect(script).toContain("comments");
    });

    it("contains i18n count update strings for zh-hans", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName, "zh-hans");
      expect(script).toContain("1条评论");
    });

    it("listens for toggle event on details element", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("addEventListener('toggle'");
    });

    it("removes toggle listener after first fire (fire once)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("removeEventListener('toggle'");
    });

    it("constructs fetch URL with page_key and site_name params", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("page_key=");
      expect(script).toContain("site_name=");
    });

    it("uses uid as page_key when provided", () => {
      const uid = "abc-123";
      const script = buildArtalkClientScript(serverUrl, pagePath, uid, siteName);
      expect(script).toContain("page_key=abc-123");
    });

    it("creates comment elements with correct structure", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("comment-item");
      expect(script).toContain("comment-header");
      expect(script).toContain("comment-author");
      expect(script).toContain("comment-date");
      expect(script).toContain("comment-body");
    });

    it("escapes author name with HTML entities", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // The hydration code should escape author names to prevent XSS
      expect(script).toMatch(/c\.nick[\s\S]*replace[\s\S]*&amp;/);
    });

    it("catches fetch errors silently", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // Should have a .catch block for the hydration fetch
      // The hydration fetch should have its own catch
      expect(script).toMatch(/\.catch\(function/);
    });

    it("parses Artalk v2 response as json.data.comments (not json.data)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // Must match the Artalk v2 API shape: { data: { comments: [...] } }
      expect(script).toContain("json.data && json.data.comments");
    });

    it("checks res.ok before parsing JSON", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // The hydration fetch should check res.ok to avoid parsing error pages
      expect(script).toContain("res.ok");
    });
  });
});
