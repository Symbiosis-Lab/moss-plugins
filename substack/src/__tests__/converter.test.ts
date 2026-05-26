import { describe, it, expect } from "vitest";
import { htmlToMarkdown, markdownToHtml, generateFrontmatter, parseFrontmatter } from "../converter";
import * as fs from "fs";
import * as path from "path";

describe("htmlToMarkdown", () => {
  it("converts plain paragraphs", () => {
    const html = "<p>First paragraph.</p><p>Second paragraph.</p>";
    const md = htmlToMarkdown(html);
    expect(md).toBe("First paragraph.\n\nSecond paragraph.\n");
  });

  it("converts headings", () => {
    const html = "<h2>Title</h2><h3>Subtitle</h3><h4>Section</h4>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("## Title");
    expect(md).toContain("### Subtitle");
    expect(md).toContain("#### Section");
  });

  it("strips Substack anchor link buttons from headings", () => {
    const html = `<h2 class="header-anchor-post">Headings<div class="header-anchor-parent"><button>Link</button></div></h2>`;
    const md = htmlToMarkdown(html);
    expect(md).toBe("## Headings\n");
    expect(md).not.toContain("Link");
    expect(md).not.toContain("button");
  });

  it("converts inline formatting", () => {
    const html = "<p><strong>bold</strong> <em>italic</em> <s>strike</s> <code>code</code></p>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("**bold**");
    expect(md).toContain("*italic*");
    expect(md).toContain("~~strike~~");
    expect(md).toContain("`code`");
  });

  it("converts unordered lists", () => {
    const html = "<ul><li>One</li><li>Two</li><li>Three</li></ul>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("- One");
    expect(md).toContain("- Two");
    expect(md).toContain("- Three");
  });

  it("converts ordered lists", () => {
    const html = "<ol><li>First</li><li>Second</li></ol>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("1. First");
    expect(md).toContain("2. Second");
  });

  it("converts blockquotes", () => {
    const html = "<blockquote><p>Quoted text.</p></blockquote>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("> Quoted text.");
  });

  it("converts links", () => {
    const html = '<p>See <a href="https://example.com">example</a>.</p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("[example](https://example.com)");
  });

  it("converts images", () => {
    const html = '<img src="https://cdn.substack.com/image.jpg" alt="A photo">';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![A photo](https://cdn.substack.com/image.jpg)");
  });

  it("converts figures with images", () => {
    const html = '<figure><img src="https://cdn.substack.com/img.jpg" alt=""><figcaption>Caption text</figcaption></figure>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![Caption text](https://cdn.substack.com/img.jpg)");
  });

  it("converts the full test fixture", () => {
    const fixturePath = path.join(__dirname, "../../test-fixtures/substack-article.html");
    const html = fs.readFileSync(fixturePath, "utf-8");
    const md = htmlToMarkdown(html);

    // Verify key elements are present
    expect(md).toContain("## Headings");
    expect(md).toContain("### Third Level");
    expect(md).toContain("#### Fourth Level");
    expect(md).toContain("**bold text**");
    expect(md).toContain("*italic text*");
    expect(md).toContain("~~strikethrough~~");
    expect(md).toContain("`inline code`");
    expect(md).toContain("- First item");
    expect(md).toContain("1. Step one");
    expect(md).toContain("> This is a blockquote");
    expect(md).toContain("[link to example.com](https://example.com)");

    // Verify Substack anchor buttons are stripped
    expect(md).not.toContain("header-anchor");
    expect(md).not.toContain("svg");
    expect(md).not.toContain("button");
  });

  it("handles empty input", () => {
    expect(htmlToMarkdown("")).toBe("\n");
  });
});

describe("markdownToHtml", () => {
  it("converts paragraphs", () => {
    const html = markdownToHtml("First paragraph.\n\nSecond paragraph.");
    expect(html).toContain("<p>First paragraph.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });

  it("converts headings", () => {
    const html = markdownToHtml("## Title\n\n### Subtitle");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<h3>Subtitle</h3>");
  });

  it("converts inline formatting", () => {
    const html = markdownToHtml("**bold** *italic* ~~strike~~ `code`");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<s>strike</s>");
    expect(html).toContain("<code>code</code>");
  });

  it("converts links", () => {
    const html = markdownToHtml("[example](https://example.com)");
    expect(html).toContain('<a href="https://example.com">example</a>');
  });

  it("leaves ![alt](src) markdown intact for moss's synthesizer", () => {
    // Per unified-image-emission Decision #9, plugins must emit canonical
    // CommonMark image syntax; moss's Tag::Image handler owns structural
    // HTML (LQIP / dims / <picture> / lazy loading).
    const html = markdownToHtml("![alt](https://img.com/photo.jpg)");
    expect(html).toContain("![alt](https://img.com/photo.jpg)");
    expect(html).not.toContain("<img");
  });
});

describe("generateFrontmatter", () => {
  it("generates YAML frontmatter", () => {
    const fm = generateFrontmatter({
      title: "Test Article",
      date: "2026-04-03",
      substack_id: 123,
    });
    expect(fm).toContain("---");
    expect(fm).toContain("title: Test Article");
    expect(fm).toContain("date: 2026-04-03");
    expect(fm).toContain("substack_id: 123");
  });

  it("handles arrays", () => {
    const fm = generateFrontmatter({ tags: ["tech", "writing"] });
    expect(fm).toContain("tags:");
    expect(fm).toContain("  - tech");
    expect(fm).toContain("  - writing");
  });

  it("quotes values containing colons", () => {
    const fm = generateFrontmatter({ substack_url: "https://example.substack.com/p/test" });
    expect(fm).toContain('substack_url: "https://example.substack.com/p/test"');
  });
});

describe("parseFrontmatter", () => {
  it("parses frontmatter and body", () => {
    const content = "---\ntitle: Test\ndate: 2026-04-03\n---\nBody content here.";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.title).toBe("Test");
    expect(frontmatter.date).toBe("2026-04-03");
    expect(body).toBe("Body content here.");
  });

  it("returns empty frontmatter when none present", () => {
    const { frontmatter, body } = parseFrontmatter("Just body content.");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Just body content.");
  });
});
