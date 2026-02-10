import { describe, it, expect } from "vitest";
import {
  addCanonicalLinkToContent,
  getArticleContent,
} from "../main";
import type { ArticleInfo } from "../types";

describe("addCanonicalLinkToContent", () => {
  const canonicalUrl = "https://example.com/posts/hello/";

  it("appends markdown canonical link for markdown content", () => {
    const result = addCanonicalLinkToContent("# Hello\n\nContent.", canonicalUrl, false);
    expect(result).toContain("---");
    expect(result).toContain(`[${canonicalUrl}](${canonicalUrl})`);
    expect(result).toContain("Originally published at");
    expect(result).not.toContain("<hr>");
  });

  it("appends HTML canonical link for HTML content", () => {
    const result = addCanonicalLinkToContent("<h1>Hello</h1><p>Content.</p>", canonicalUrl, true);
    expect(result).toContain("<hr>");
    expect(result).toContain(`<a href="${canonicalUrl}">`);
    expect(result).toContain("Originally published at");
    expect(result).not.toContain("---\n");
  });

  it("defaults to markdown mode when isHtml is omitted", () => {
    const result = addCanonicalLinkToContent("# Hello", canonicalUrl);
    expect(result).toContain("---");
    expect(result).not.toContain("<hr>");
  });
});

describe("getArticleContent", () => {
  const baseArticle: ArticleInfo = {
    source_path: "posts/test.md",
    title: "Test",
    content: "# Test\n\nMarkdown content.",
    frontmatter: {},
    url_path: "posts/test/",
    tags: [],
  };

  it("returns html_content when available", () => {
    const article: ArticleInfo = {
      ...baseArticle,
      html_content: "<h1>Test</h1>\n<p>Markdown content.</p>",
    };
    const result = getArticleContent(article);
    expect(result.content).toBe("<h1>Test</h1>\n<p>Markdown content.</p>");
    expect(result.isHtml).toBe(true);
  });

  it("falls back to markdown content when html_content is undefined", () => {
    const result = getArticleContent(baseArticle);
    expect(result.content).toBe("# Test\n\nMarkdown content.");
    expect(result.isHtml).toBe(false);
  });

  it("falls back to markdown content when html_content is empty string", () => {
    const article: ArticleInfo = {
      ...baseArticle,
      html_content: "",
    };
    const result = getArticleContent(article);
    expect(result.content).toBe("# Test\n\nMarkdown content.");
    expect(result.isHtml).toBe(false);
  });
});
