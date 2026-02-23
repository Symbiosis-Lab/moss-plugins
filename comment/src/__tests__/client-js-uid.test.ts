/**
 * Tests for client-side JS using uid as page key
 *
 * Validates that buildClientScript and buildArtalkClientScript
 * accept a uid parameter and use it as the page key for comment
 * submission instead of the URL path.
 */

import { describe, it, expect } from "vitest";
import { buildClientScript } from "../client-js";
import { buildArtalkClientScript } from "../providers/artalk";

describe("buildClientScript with uid parameter", () => {
  const serverUrl = "https://waline.example.com";
  const pagePath = "/posts/hello/";
  const uid = "abc-123-def";

  it("uses uid as the url field when uid is provided", () => {
    const script = buildClientScript(serverUrl, pagePath, uid);
    // The url field in the request body should be the uid, not pagePath
    expect(script).toContain(`url: '${uid}'`);
  });

  it("does not use the pagePath as the url field when uid is provided", () => {
    const script = buildClientScript(serverUrl, pagePath, uid);
    // The pagePath should NOT appear as the value of url in the body
    expect(script).not.toContain(`url: '${pagePath}'`);
  });

  it("falls back to pagePath when uid is not provided", () => {
    const script = buildClientScript(serverUrl, pagePath);
    expect(script).toContain(`url: '${pagePath}'`);
  });

  it("falls back to pagePath when uid is empty string", () => {
    const script = buildClientScript(serverUrl, pagePath, "");
    expect(script).toContain(`url: '${pagePath}'`);
  });

  it("properly escapes uid containing special characters", () => {
    const dangerousUid = "uid-with'quotes";
    const script = buildClientScript(serverUrl, pagePath, dangerousUid);
    // Should be escaped
    expect(script).not.toContain("uid-with'quotes");
    expect(script).toContain("uid-with\\'quotes");
  });

  it("properly escapes uid containing backslashes", () => {
    const uidWithBackslash = "uid\\test";
    const script = buildClientScript(serverUrl, pagePath, uidWithBackslash);
    expect(script).toContain("uid\\\\test");
  });

  it("escapes < in uid to prevent script injection", () => {
    const maliciousUid = "uid</script><script>alert(1)</script>";
    const script = buildClientScript(serverUrl, pagePath, maliciousUid);
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script>");
  });
});

describe("buildArtalkClientScript with uid parameter", () => {
  const serverUrl = "https://artalk.example.com";
  const pagePath = "/posts/hello/";
  const uid = "artalk-uid-789";
  const siteName = "Test Site";

  it("uses uid as the page_key field when uid is provided", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, uid, siteName);
    expect(script).toContain(`page_key: '${uid}'`);
  });

  it("does not use pagePath as page_key when uid is provided", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, uid, siteName);
    expect(script).not.toContain(`page_key: '${pagePath}'`);
  });

  it("falls back to pagePath when uid is not provided", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, "", siteName);
    expect(script).toContain(`page_key: '${pagePath}'`);
  });

  it("properly escapes uid containing special characters", () => {
    const dangerousUid = "uid-with'quotes";
    const script = buildArtalkClientScript(
      serverUrl,
      pagePath,
      dangerousUid,
      siteName
    );
    expect(script).not.toContain("uid-with'quotes");
    expect(script).toContain("uid-with\\'quotes");
  });

  it("still includes site_name in the request body", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, uid, siteName);
    expect(script).toContain("site_name");
    expect(script).toContain("Test Site");
  });

  it("still posts to the Artalk v2 API endpoint", () => {
    const script = buildArtalkClientScript(serverUrl, pagePath, uid, siteName);
    expect(script).toContain("/api/v2/comments");
  });
});
