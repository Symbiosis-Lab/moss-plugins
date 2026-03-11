import { describe, it, expect } from "vitest";
import { injectAfterH1, injectBeforeArticleEnd, injectCssInHead } from "../inject";

describe("injectAfterH1", () => {
  it("injects after closing </h1> inside article", () => {
    const html = '<article><h1>Title</h1><p>body</p></article>';
    const result = injectAfterH1(html, '<div class="review-header">header</div>');
    expect(result).toContain('</h1>\n<div class="review-header">header</div>');
  });

  it("returns null when no h1", () => {
    const html = '<article><p>no heading</p></article>';
    expect(injectAfterH1(html, "header")).toBeNull();
  });

  it("handles H1 with attributes", () => {
    const html = '<article><h1 class="title">Title</h1><p>body</p></article>';
    const result = injectAfterH1(html, "header");
    expect(result).toContain("</h1>\nheader");
  });
});

describe("injectBeforeArticleEnd", () => {
  it("injects before </article>", () => {
    const html = '<article><p>content</p></article>';
    const result = injectBeforeArticleEnd(html, '<footer>colophon</footer>');
    expect(result).toContain('<footer>colophon</footer>\n</article>');
  });

  it("returns null when no </article>", () => {
    expect(injectBeforeArticleEnd('<p>no article</p>', "colophon")).toBeNull();
  });

  it("colophon stays inside article even when comments follow outside", () => {
    // Comments are now outside <article>, so colophon simply goes before </article>
    const html = '<article><p>body</p></article><section class="moss-comments">comments</section>';
    const result = injectBeforeArticleEnd(html, '<footer>colophon</footer>');
    expect(result).toContain('<footer>colophon</footer>\n</article>');
    expect(result!.indexOf("colophon")).toBeLessThan(result!.indexOf("</article>"));
  });
});

describe("injectCssInHead", () => {
  it("injects <style> before </head>", () => {
    const html = '<html><head><title>T</title></head><body></body></html>';
    const result = injectCssInHead(html, ".review { color: red; }");
    expect(result).toContain('<style>.review { color: red; }</style>');
    expect(result.indexOf("<style>")).toBeLessThan(result.indexOf("</head>"));
  });

  it("returns unchanged when empty css", () => {
    const html = '<head></head>';
    expect(injectCssInHead(html, "")).toBe(html);
  });
});
