/**
 * Tests for the comment form CSS redesign.
 *
 * Validates that:
 * - Design principles are documented as a block comment in the CSS
 * - The .comment-form card styling (background, border-radius) has been removed
 * - The .comment-form uses a flat border-bottom separator pattern
 * - The old special-case margin rule for details:not(:has(.comment-list)) is gone
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const cssPath = resolve(__dirname, "../../browser/moss-comments.css");
const css = readFileSync(cssPath, "utf-8");

describe("Design principles documentation", () => {
  it("documents the six design principles in a block comment", () => {
    expect(css).toContain("One surface");
    expect(css).toContain("Border language consistency");
    expect(css).toContain("Typographic continuity");
    expect(css).toContain("form is the first comment");
    expect(css).toContain("state, not surface");
    expect(css).toContain("Density matching");
  });

  it("cites the research references", () => {
    expect(css).toContain("ishadeed.com");
    expect(css).toContain("ia.net");
  });
});

describe("Comment form flattening", () => {
  it("does NOT have card-style background on .comment-form", () => {
    // Extract the .comment-form { ... } block (top-level, not nested)
    const formRule = extractTopLevelRule(css, ".comment-form");
    expect(formRule).toBeDefined();
    expect(formRule).not.toMatch(/background\s*:/);
    expect(formRule).not.toMatch(/border-radius\s*:/);
  });

  it("does NOT use border-bottom on .comment-form (field underlines provide separation)", () => {
    const formRule = extractTopLevelRule(css, ".comment-form");
    expect(formRule).toBeDefined();
    expect(formRule).not.toMatch(/border-bottom\s*:/);
  });

  it("uses margin-bottom (--moss-space-md) for breathing room before the first comment", () => {
    const formRule = extractTopLevelRule(css, ".comment-form");
    expect(formRule).toBeDefined();
    expect(formRule).toMatch(/margin.*0\s+0\s+var\(--moss-space-md/);
  });

  it("removes the special-case margin rule for no-comment-list state", () => {
    expect(css).not.toContain("details:not(:has(.comment-list))");
  });
});

/**
 * Extract the body of the first top-level rule matching the given selector.
 * Returns the content between the braces, or undefined if not found.
 */
function extractTopLevelRule(
  source: string,
  selector: string
): string | undefined {
  // Find the selector at the start of a line (possibly with whitespace),
  // followed by an opening brace. We need to match balanced braces.
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^${escapedSelector}\\s*\\{`,
    "m"
  );
  const match = source.match(pattern);
  if (!match || match.index === undefined) return undefined;

  let depth = 0;
  const start = source.indexOf("{", match.index);
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) {
      return source.slice(start + 1, i);
    }
  }
  return undefined;
}
