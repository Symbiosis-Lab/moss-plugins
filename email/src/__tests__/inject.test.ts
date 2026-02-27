/**
 * Unit tests for inject utilities (injectInlineStyle)
 */

import { describe, it, expect } from "vitest";
import { injectInlineStyle } from "../inject";

describe("injectInlineStyle", () => {
  const sampleCss = ".footer-subscribe-form { display: flex; }";

  it("should inject <style> before </head>", () => {
    const html = `<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>`;
    const result = injectInlineStyle(html, sampleCss);
    expect(result).toContain(`<style class="moss-email-style">${sampleCss}</style>`);
    expect(result).toContain("</head>");
  });

  it("should be idempotent — does not inject twice", () => {
    const html = `<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>`;
    const first = injectInlineStyle(html, sampleCss);
    const second = injectInlineStyle(first, sampleCss);
    expect(second).toBe(first);
  });

  it("should return original HTML when no </head>", () => {
    const html = `<html><body><p>No head tag</p></body></html>`;
    const result = injectInlineStyle(html, sampleCss);
    expect(result).toBe(html);
  });

  it("should return original HTML when CSS is empty", () => {
    const html = `<!DOCTYPE html><html><head></head><body></body></html>`;
    const result = injectInlineStyle(html, "");
    expect(result).toBe(html);
  });

  it("should handle uppercase </HEAD>", () => {
    const html = `<!DOCTYPE html><html><HEAD><title>Test</title></HEAD><body></body></html>`;
    const result = injectInlineStyle(html, sampleCss);
    expect(result).toContain(`<style class="moss-email-style">${sampleCss}</style>`);
  });

  it("should preserve rest of HTML intact", () => {
    const html = `<!DOCTYPE html><html><head><title>My Site</title></head><body><p>Content</p></body></html>`;
    const result = injectInlineStyle(html, sampleCss);
    expect(result).toContain("<title>My Site</title>");
    expect(result).toContain("<p>Content</p>");
  });

  it("should work with multiline CSS", () => {
    const multilineCss = `.footer-subscribe-form {
  display: flex;
  gap: 1rem;
}`;
    const html = `<!DOCTYPE html><html><head></head><body></body></html>`;
    const result = injectInlineStyle(html, multilineCss);
    expect(result).toContain(multilineCss);
  });
});
