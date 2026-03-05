/**
 * Tests for HTML injection utilities (inject.ts)
 */

import { describe, it, expect } from "vitest";
import { findInsertionPoint, injectCommentSection, injectCssLink, injectInlineStyle } from "../inject";

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

describe("injectCssLink", () => {
  it("injects <link> before </head>", () => {
    const html = "<html><head><title>Test</title></head><body></body></html>";
    const result = injectCssLink(html, "/moss-comments.css");
    expect(result).toContain('<link rel="stylesheet" href="/moss-comments.css">');
    expect(result.indexOf('<link rel="stylesheet"')).toBeLessThan(
      result.indexOf("</head>")
    );
  });

  it("returns original HTML when no </head>", () => {
    const html = "<body>no head</body>";
    expect(injectCssLink(html, "/style.css")).toBe(html);
  });
});

// ============================================================================
// Tests for injectInlineStyle (new function - TDD)
// ============================================================================

describe("injectInlineStyle", () => {
  const sampleCss = ".moss-comments { margin-top: 3rem; }";

  it("injects <style> before </head>", () => {
    const html = "<html><head><title>Test</title></head><body></body></html>";
    const result = injectInlineStyle(html, sampleCss);
    expect(result).toContain(`<style class="moss-comments-style">${sampleCss}</style>`);
    // Style should be before </head>
    expect(result.indexOf('<style class="moss-comments-style">')).toBeLessThan(
      result.indexOf("</head>")
    );
  });

  it("is idempotent - does not inject twice", () => {
    const html = "<html><head><title>Test</title></head><body></body></html>";
    const first = injectInlineStyle(html, sampleCss);
    const second = injectInlineStyle(first, sampleCss);
    expect(second).toBe(first);
    // Count occurrences of the style tag
    const matches = second.match(/moss-comments-style/g);
    expect(matches).toHaveLength(1);
  });

  it("returns original HTML when no </head>", () => {
    const html = "<body>no head tag</body>";
    const result = injectInlineStyle(html, sampleCss);
    expect(result).toBe(html);
  });

  it("returns original HTML when css is empty", () => {
    const html = "<html><head><title>Test</title></head><body></body></html>";
    const result = injectInlineStyle(html, "");
    expect(result).toBe(html);
  });

  it("handles uppercase </HEAD>", () => {
    const html = "<html><HEAD><title>Test</title></HEAD><body></body></html>";
    const result = injectInlineStyle(html, sampleCss);
    expect(result).toContain(`<style class="moss-comments-style">${sampleCss}</style>`);
  });

  it("preserves rest of HTML intact", () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>My Page</title></head>
<body>
<article>
<h1>Hello</h1>
<p>Content here.</p>
</article>
</body>
</html>`;
    const result = injectInlineStyle(html, sampleCss);
    // Original content still present
    expect(result).toContain("<h1>Hello</h1>");
    expect(result).toContain("<p>Content here.</p>");
    expect(result).toContain("</article>");
    // Style injected
    expect(result).toContain(`<style class="moss-comments-style">${sampleCss}</style>`);
  });

  it("works with multiline CSS", () => {
    const multilineCss = `.moss-comments {
  margin-top: 3rem;
  padding: 1rem;
}
.comment-item {
  border-bottom: 1px solid #ccc;
}`;
    const html = "<html><head><title>Test</title></head><body></body></html>";
    const result = injectInlineStyle(html, multilineCss);
    expect(result).toContain(multilineCss);
    expect(result).toContain('class="moss-comments-style"');
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
    "--moss-color-surface",
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
