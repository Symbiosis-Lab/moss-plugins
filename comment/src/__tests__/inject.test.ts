/**
 * Tests for HTML injection utilities (inject.ts)
 */

import { describe, it, expect } from "vitest";
import { findInsertionPoint, injectCommentSection, injectCssStyle, rootRelativePrefix } from "../inject";

// ============================================================================
// Existing tests for findInsertionPoint and injectCommentSection
// ============================================================================

describe("findInsertionPoint", () => {
  it("finds </article> as first priority", () => {
    const html = "<body><main><article>content</article></main></body>";
    const idx = findInsertionPoint(html);
    expect(idx).toBe(html.indexOf("</article>"));
  });

  it("finds </main> when no </article>", () => {
    const html = "<body><main>content</main></body>";
    const idx = findInsertionPoint(html);
    expect(idx).toBe(html.indexOf("</main>"));
  });

  it("finds </body> when no </article> or </main>", () => {
    const html = "<body>content</body>";
    const idx = findInsertionPoint(html);
    expect(idx).toBe(html.indexOf("</body>"));
  });

  it("returns -1 for plain text", () => {
    expect(findInsertionPoint("hello world")).toBe(-1);
  });
});

describe("injectCommentSection", () => {
  it("injects before </article>", () => {
    const html = "<article>content</article>";
    const result = injectCommentSection(html, "<div>comments</div>");
    expect(result).toContain("<div>comments</div>");
    expect(result).toContain("</article>");
    // Comment section should be before </article>
    expect(result!.indexOf("<div>comments</div>")).toBeLessThan(
      result!.indexOf("</article>")
    );
  });

  it("returns null when no insertion point", () => {
    expect(injectCommentSection("hello", "<div>comments</div>")).toBeNull();
  });
});

describe("injectCssStyle", () => {
  it("injects <style>CSS_CONTENT</style> before </head>", () => {
    const html = "<html><head><title>Test</title></head><body></body></html>";
    const css = ".moss-comments { margin-top: 3rem; }";
    const result = injectCssStyle(html, css);
    expect(result).toContain(`<style>${css}</style>`);
    expect(result.indexOf("<style>")).toBeLessThan(
      result.indexOf("</head>")
    );
  });

  it("returns html unchanged when css is empty string", () => {
    const html = "<html><head><title>Test</title></head><body></body></html>";
    expect(injectCssStyle(html, "")).toBe(html);
  });

  it("returns html unchanged when no </head> tag", () => {
    const html = "<body>no head</body>";
    expect(injectCssStyle(html, ".test { color: red; }")).toBe(html);
  });
});

// The injectInlineStyle tests above (in "injectCssStyle") cover all
// the inline style functionality. The old injectInlineStyle block has
// been consolidated into the injectCssStyle describe block.

// ============================================================================
// rootRelativePrefix
// ============================================================================

describe("rootRelativePrefix", () => {
  it("returns empty string for root path", () => {
    expect(rootRelativePrefix("")).toBe("");
    expect(rootRelativePrefix("/")).toBe("");
  });

  it("returns ../ for depth-1 paths", () => {
    expect(rootRelativePrefix("posts/")).toBe("../");
  });

  it("returns ../../ for depth-2 paths", () => {
    expect(rootRelativePrefix("posts/hello/")).toBe("../../");
  });

  it("returns ../../../ for depth-3 paths", () => {
    expect(rootRelativePrefix("articles/2024/post/")).toBe("../../../");
  });

  it("handles paths without trailing slash", () => {
    expect(rootRelativePrefix("posts/hello")).toBe("../../");
  });

  it("handles leading slash", () => {
    expect(rootRelativePrefix("/posts/hello/")).toBe("../../");
  });
});

// ============================================================================
// CSS Design System Compliance
// ============================================================================

import { readFileSync } from "fs";
import { resolve } from "path";

describe("moss-comments.css design system compliance", () => {
  const cssPath = resolve(__dirname, "../../browser/moss-comments.css");
  const css = readFileSync(cssPath, "utf-8");

  const deprecatedVars = [
    "--moss-background-alt",
    "--moss-text-primary",
    "--moss-text-muted",
    "--moss-accent",
    "--moss-font-base",
  ];

  for (const v of deprecatedVars) {
    it(`does not use deprecated variable ${v}`, () => {
      // Match the variable name but not as a substring of a longer name
      const pattern = new RegExp(`var\\(\\s*${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s,)]`);
      expect(css).not.toMatch(pattern);
    });
  }

  const requiredVars = [
    // --moss-color-surface was removed: the flattened comment form shares
    // the page background instead of using a separate surface color (P1).
    "--moss-color-text",
    "--moss-color-muted",
    "--moss-color-accent",
    "--moss-font-size",
  ];

  for (const v of requiredVars) {
    it(`uses design system variable ${v}`, () => {
      expect(css).toContain(v);
    });
  }
});
