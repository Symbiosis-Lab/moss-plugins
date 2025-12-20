import { describe, it, expect } from "vitest";
import {
  htmlToMarkdown,
  generateFrontmatter,
  parseFrontmatter,
  regenerateFrontmatter,
  extractRemoteImageUrls,
  extractMarkdownLinks,
} from "../converter";

describe("htmlToMarkdown", () => {
  it("converts headings", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toBe("# Title\n\n");
    expect(htmlToMarkdown("<h2>Subtitle</h2>")).toBe("## Subtitle\n\n");
    expect(htmlToMarkdown("<h3>Section</h3>")).toBe("### Section\n\n");
  });

  it("converts paragraphs", () => {
    expect(htmlToMarkdown("<p>Hello world</p>")).toBe("Hello world\n\n");
  });

  it("converts bold text", () => {
    expect(htmlToMarkdown("<strong>bold</strong>")).toBe("**bold**");
    expect(htmlToMarkdown("<b>bold</b>")).toBe("**bold**");
  });

  it("converts italic text", () => {
    expect(htmlToMarkdown("<em>italic</em>")).toBe("*italic*");
    expect(htmlToMarkdown("<i>italic</i>")).toBe("*italic*");
  });

  it("converts inline code", () => {
    expect(htmlToMarkdown("<code>code</code>")).toBe("`code`");
  });

  it("converts code blocks", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    expect(htmlToMarkdown(html)).toContain("```\nconst x = 1;\n```");
  });

  it("converts code blocks with language", () => {
    const html = '<pre><code class="language-js">const x = 1;</code></pre>';
    expect(htmlToMarkdown(html)).toContain("```js\nconst x = 1;\n```");
  });

  it("converts links", () => {
    expect(htmlToMarkdown('<a href="https://example.com">link</a>')).toBe(
      "[link](https://example.com)"
    );
  });

  it("converts images", () => {
    expect(
      htmlToMarkdown('<img src="https://example.com/img.jpg" alt="image">')
    ).toBe("![image](https://example.com/img.jpg)");
  });

  it("converts unordered lists", () => {
    const html = "<ul><li>Item 1</li><li>Item 2</li></ul>";
    const result = htmlToMarkdown(html);
    expect(result).toContain("- Item 1");
    expect(result).toContain("- Item 2");
  });

  it("converts ordered lists", () => {
    const html = "<ol><li>First</li><li>Second</li></ol>";
    const result = htmlToMarkdown(html);
    expect(result).toContain("1. First");
    expect(result).toContain("2. Second");
  });

  it("converts blockquotes", () => {
    const html = "<blockquote>Quote text</blockquote>";
    expect(htmlToMarkdown(html)).toContain("> Quote text");
  });

  it("converts horizontal rules", () => {
    expect(htmlToMarkdown("<hr>")).toContain("---");
  });

  it("converts line breaks", () => {
    expect(htmlToMarkdown("line1<br>line2")).toBe("line1\nline2");
  });

  it("handles nested elements", () => {
    const html = "<p><strong><em>bold italic</em></strong></p>";
    expect(htmlToMarkdown(html)).toBe("***bold italic***\n\n");
  });

  it("handles figcaption", () => {
    const html = "<figure><img src='img.jpg' alt='test'><figcaption>Caption</figcaption></figure>";
    expect(htmlToMarkdown(html)).toContain("*Caption*");
  });

  it("handles empty figcaption without producing **", () => {
    const html = "<figure><img src='img.jpg' alt='test'><figcaption></figcaption></figure>";
    const result = htmlToMarkdown(html);
    expect(result).toBe("![test](img.jpg)");
    expect(result).not.toContain("**");
  });
});

describe("generateFrontmatter", () => {
  it("generates basic frontmatter", () => {
    const result = generateFrontmatter({ title: "Test Title" });
    expect(result).toContain("---");
    expect(result).toContain('title: "Test Title"');
  });

  it("escapes quotes in title", () => {
    const result = generateFrontmatter({ title: 'Test "Quote"' });
    expect(result).toContain('title: "Test \\"Quote\\""');
  });

  it("includes date and updated", () => {
    const result = generateFrontmatter({
      title: "Test",
      date: "2024-01-01",
      updated: "2024-01-02",
    });
    expect(result).toContain('date: "2024-01-01"');
    expect(result).toContain('updated: "2024-01-02"');
  });

  it("includes tags array", () => {
    const result = generateFrontmatter({
      title: "Test",
      tags: ["tag1", "tag2"],
    });
    expect(result).toContain("tags:");
    expect(result).toContain('  - "tag1"');
    expect(result).toContain('  - "tag2"');
  });

  it("includes cover", () => {
    const result = generateFrontmatter({
      title: "Test",
      cover: "cover.jpg",
    });
    expect(result).toContain('cover: "cover.jpg"');
  });

  it("includes syndicated URLs", () => {
    const result = generateFrontmatter({
      title: "Test",
      syndicated: ["https://example.com/article"],
    });
    expect(result).toContain("syndicated:");
    expect(result).toContain('  - "https://example.com/article"');
  });

  it("includes is_collection flag", () => {
    const result = generateFrontmatter({
      title: "Collection",
      is_collection: true,
    });
    expect(result).toContain("is_collection: true");
  });

  it("includes collections mapping", () => {
    const result = generateFrontmatter({
      title: "Test",
      collections: { "my-collection": 0, "other-collection": 1 },
    });
    expect(result).toContain("collections:");
    expect(result).toContain("  my-collection: 0");
    expect(result).toContain("  other-collection: 1");
  });
});

describe("parseFrontmatter", () => {
  it("parses basic frontmatter", () => {
    const content = `---
title: "Test Title"
---
Body content`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter.title).toBe("Test Title");
    expect(result?.body).toBe("Body content");
  });

  it("parses array values", () => {
    const content = `---
title: "Test"
tags:
  - "tag1"
  - "tag2"
---
Body`;
    const result = parseFrontmatter(content);
    expect(result?.frontmatter.tags).toEqual(["tag1", "tag2"]);
  });

  it("returns null for content without frontmatter", () => {
    const content = "Just some text without frontmatter";
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("returns null for malformed frontmatter", () => {
    const content = `---
title: Test
No closing delimiter`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  it("handles empty body", () => {
    const content = `---
title: "Test"
---
`;
    const result = parseFrontmatter(content);
    expect(result?.body).toBe("");
  });
});

describe("regenerateFrontmatter", () => {
  it("regenerates basic frontmatter", () => {
    const result = regenerateFrontmatter({ title: "Test" });
    expect(result).toContain("---");
    expect(result).toContain('title: "Test"');
  });

  it("preserves field order", () => {
    const result = regenerateFrontmatter({
      tags: ["a", "b"],
      title: "Test",
      date: "2024-01-01",
    });
    const lines = result.split("\n");
    const titleIndex = lines.findIndex((l) => l.includes("title:"));
    const dateIndex = lines.findIndex((l) => l.includes("date:"));
    const tagsIndex = lines.findIndex((l) => l === "tags:");
    expect(titleIndex).toBeLessThan(dateIndex);
    expect(dateIndex).toBeLessThan(tagsIndex);
  });

  it("handles boolean values", () => {
    const result = regenerateFrontmatter({ is_collection: true });
    expect(result).toContain("is_collection: true");
  });

  it("handles nested objects", () => {
    const result = regenerateFrontmatter({
      collections: { "col-1": 0, "col-2": 1 },
    });
    expect(result).toContain("collections:");
    expect(result).toContain("  col-1: 0");
  });
});

describe("extractRemoteImageUrls", () => {
  it("extracts HTTP image URLs", () => {
    const content = "![alt](http://example.com/image.jpg)";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("http://example.com/image.jpg");
  });

  it("extracts HTTPS image URLs", () => {
    const content = "![alt](https://example.com/image.png)";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com/image.png");
  });

  it("ignores local image paths", () => {
    const content = "![alt](./images/local.jpg)";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(0);
  });

  it("ignores relative paths", () => {
    const content = "![alt](assets/image.jpg)";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(0);
  });

  it("deduplicates URLs", () => {
    const content = `
![img1](https://example.com/image.jpg)
![img2](https://example.com/image.jpg)
`;
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(1);
  });

  it("extracts multiple different URLs", () => {
    const content = `
![img1](https://example.com/image1.jpg)
![img2](https://example.com/image2.png)
`;
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(2);
  });

  it("generates local filenames", () => {
    const content = "![alt](https://cdn.example.com/uploads/photo.jpg)";
    const result = extractRemoteImageUrls(content);
    expect(result[0].localFilename).toBe("photo.jpg");
  });

  it("handles empty content", () => {
    const result = extractRemoteImageUrls("");
    expect(result).toHaveLength(0);
  });

  it("handles content with no images", () => {
    const content = "Just some text without images";
    const result = extractRemoteImageUrls(content);
    expect(result).toHaveLength(0);
  });
});

describe("extractMarkdownLinks", () => {
  it("extracts markdown links", () => {
    const content = "Check out [my link](https://example.com)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
    expect(result[0].fullMatch).toBe("[my link](https://example.com)");
  });

  it("does NOT extract image syntax", () => {
    const content = "![alt text](https://example.com/image.jpg)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(0);
  });

  it("extracts links but not images in mixed content", () => {
    const content = `
Here is a [link](https://example.com) and
an image ![image](https://example.com/img.png) and
another [second link](https://other.com).
`;
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://example.com");
    expect(result[1].url).toBe("https://other.com");
  });

  it("extracts Matters.town article links", () => {
    const content = "Read my [previous article](https://matters.town/@alice/hello-world-abc123)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://matters.town/@alice/hello-world-abc123");
  });

  it("handles multiple links on same line", () => {
    const content = "[link1](https://a.com) and [link2](https://b.com)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://a.com");
    expect(result[1].url).toBe("https://b.com");
  });

  it("handles links with empty text", () => {
    const content = "[](https://example.com)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
  });

  it("handles relative links", () => {
    const content = "[local](./path/to/file.md)";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("./path/to/file.md");
  });

  it("handles empty content", () => {
    const result = extractMarkdownLinks("");
    expect(result).toHaveLength(0);
  });

  it("handles content with no links", () => {
    const content = "Just plain text without any links";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(0);
  });

  it("trims whitespace from URLs", () => {
    const content = "[link](  https://example.com  )";
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
  });
});
