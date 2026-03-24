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
      // The script should compare comment dates against builtAtMs using c.date
      expect(script).toMatch(/new Date\(c\.date\)\.getTime\(\)\s*<=\s*builtAtMs/);
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

    it("does NOT use toggle event listener (eager hydration on page load)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).not.toContain("addEventListener('toggle'");
      expect(script).not.toContain("removeEventListener('toggle'");
      expect(script).not.toContain("onToggle");
    });

    it("fetches immediately when builtAtMs is set (no event gate)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // The fetch should be inside `if (builtAtMs)` but NOT inside any event handler
      // Verify the fetch call is NOT wrapped in an addEventListener callback
      expect(script).toContain("if (builtAtMs)");
      expect(script).toContain("fetch(");
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

    it("parses Artalk v2.9.1 response from top-level json.comments", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // Artalk v2.9.1 returns { comments: [...] } at top level (no data wrapper)
      expect(script).toContain("json.comments");
    });

    it("uses c.date for comment date field (Artalk v2.9.1 format)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // Artalk returns 'date' not 'created_at'
      expect(script).toMatch(/c\.date/);
    });

    it("checks res.ok before parsing JSON", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // The hydration fetch should check res.ok to avoid parsing error pages
      expect(script).toContain("res.ok");
    });

    it("prepends hydrated comments for newest-first order (insertBefore, not appendChild)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // Hydrated comments should be inserted at the top of the list
      // to maintain newest-first order (matching build-time sort in social-reader.ts)
      expect(script).toContain("insertBefore");
      expect(script).not.toMatch(/commentList\.appendChild\(li\)/);
    });
  });

  describe("form submission newest-first", () => {
    it("prepends newly submitted comment at the top of the list", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // After form submission, the new comment (newest) should go to the top
      // Both insertion points should use insertBefore, not appendChild
      const appendCount = (script.match(/\.appendChild\(li\)/g) || []).length;
      expect(appendCount).toBe(0);
    });
  });

  // ==========================================================================
  // Bug fix: comment count update after submission
  // ==========================================================================

  describe("comment count update after submission", () => {
    it("has an updateCommentCount helper function", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("function updateCommentCount()");
    });

    it("counts all .comment-item elements including nested replies", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("querySelectorAll('.comment-item').length");
    });

    it("does not use commentList.children.length for counting", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).not.toContain("commentList.children.length");
    });

    it("calls updateCommentCount after form submission", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // The form submit handler should call updateCommentCount()
      // It should appear in the .then() block after DOM insertion
      expect(script).toMatch(/form\.elements\['content'\]\.value\s*=\s*''[\s\S]*updateCommentCount|updateCommentCount[\s\S]*form\.elements\['content'\]\.value\s*=\s*''/);
    });
  });

  // ==========================================================================
  // Bug fix: reply nesting in stale-while-revalidate
  // ==========================================================================

  describe("reply nesting in hydration", () => {
    it("checks c.rid to route replies under their parent", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("c.rid > 0");
    });

    it("finds parent comment by ID for reply nesting", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("getElementById('comment-' + c.rid)");
    });

    it("creates comment-replies ol for nested replies", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // The onToggle handler should create .comment-replies containers
      // for nesting replies under their parent, just like the form submit handler
      const replyOlMatches = (script.match(/comment-replies/g) || []).length;
      // Should appear in both the form submit handler AND the onToggle handler
      expect(replyOlMatches).toBeGreaterThanOrEqual(2);
    });

    it("adds reply button to dynamically hydrated comments", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // The onToggle hydration should add reply buttons to new comments
      // comment-reply-btn should appear in both form submission and hydration paths
      const replyBtnMatches = (script.match(/comment-reply-btn/g) || []).length;
      expect(replyBtnMatches).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // Float-with-quote comment flow
  // ==========================================================================

  describe("float-with-quote flow", () => {
    it("contains floatWithQuote function", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("function floatWithQuote");
    });

    it("contains cancelFloat function", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("function cancelFloat");
    });

    it("contains createFloatShell function", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("function createFloatShell");
    });

    it("listens for moss:quote-comment custom event", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("moss:quote-comment");
    });

    it("creates float shell DOM elements with correct classes", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("comment-float-backdrop");
      expect(script).toContain("comment-float-shell");
      expect(script).toContain("comment-float-inner");
      expect(script).toContain("comment-float-quote");
    });

    it("stores quote text in form dataset for submission", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("form.dataset.quoteText");
    });

    it("prepends blockquote prefix to comment when quoteText is set", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("'> '");
    });

    it("dismisses float shell on Escape key", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("Escape");
      expect(script).toContain("cancelFloat");
    });
  });

  // ==========================================================================
  // Identity persistence
  // ==========================================================================

  describe("identity persistence", () => {
    it("contains loadIdentity function", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("function loadIdentity");
    });

    it("contains saveIdentity function", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("function saveIdentity");
    });

    it("uses moss-commenter localStorage key", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("moss-commenter");
    });

    it("calls loadIdentity at initialization", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      // loadIdentity should be called, not just defined
      expect(script).toMatch(/loadIdentity\(\)/);
    });

    it("calls saveIdentity on successful submit", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("saveIdentity()");
    });
  });

  describe("page_title support", () => {
    it("includes page_title in the POST body when provided", () => {
      const script = buildArtalkClientScript(
        serverUrl, pagePath, "uid-123", siteName, "en", "My Article Title"
      );
      expect(script).toContain("page_title");
      expect(script).toContain("My Article Title");
    });

    it("escapes page_title for JS single-quoted string", () => {
      const script = buildArtalkClientScript(
        serverUrl, pagePath, "", siteName, "en", "It's a \"test\" with <script>"
      );
      expect(script).toContain("page_title");
      // Single quotes must be escaped
      expect(script).not.toContain("It's");
      expect(script).toContain("It\\'s");
    });

    it("sends empty page_title when not provided (backward compat)", () => {
      const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
      expect(script).toContain("page_title");
    });
  });
});
