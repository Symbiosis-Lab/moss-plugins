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
    const html = '<img src="https://media.licdn.com/image.jpg" alt="A photo">';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![A photo](https://media.licdn.com/image.jpg)");
  });

  it("converts figures with images", () => {
    const html = '<figure><img src="https://media.licdn.com/img.jpg" alt=""><figcaption>Caption text</figcaption></figure>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![Caption text](https://media.licdn.com/img.jpg)");
  });

  it("converts code blocks", () => {
    const html = '<pre><code class="language-javascript">const x = 1;\nconsole.log(x);</code></pre>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("```javascript");
    expect(md).toContain("const x = 1;");
    expect(md).toContain("```");
  });

  it("converts the full test fixture", () => {
    const fixturePath = path.join(__dirname, "../../test-fixtures/linkedin-article.html");
    const html = fs.readFileSync(fixturePath, "utf-8");
    const md = htmlToMarkdown(html);

    // Verify key elements are present
    expect(md).toContain("## Introduction");
    expect(md).toContain("### Key Takeaways");
    expect(md).toContain("**bold text**");
    expect(md).toContain("*italic text*");
    expect(md).toContain("- First point");
    expect(md).toContain("1. Step one");
    expect(md).toContain("> Innovation distinguishes");
    expect(md).toContain("[LinkedIn](https://linkedin.com)");
    expect(md).toContain("![Cover image](https://media.licdn.com/example.jpg)");
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

  it("preserves canonical markdown image syntax", () => {
    // moss's image enhancement pipeline only sees ![alt](src) markdown.
    // Raw <img> emission would bypass placeholder/variant enhancement.
    const html = markdownToHtml("![alt](https://img.com/photo.jpg)");
    expect(html).toContain("![alt](https://img.com/photo.jpg)");
    expect(html).not.toContain("<img");
  });
});

describe("generateFrontmatter", () => {
  it("generates YAML frontmatter with LinkedIn fields", () => {
    const fm = generateFrontmatter({
      title: "Test Article",
      date: "2026-04-03",
      linkedin_url: "https://www.linkedin.com/pulse/test-article",
    });
    expect(fm).toContain("---");
    expect(fm).toContain("title: Test Article");
    expect(fm).toContain("date: 2026-04-03");
    expect(fm).toContain('linkedin_url: "https://www.linkedin.com/pulse/test-article"');
  });

  it("includes author field", () => {
    const fm = generateFrontmatter({
      title: "Test",
      author: "Jane Doe",
    });
    expect(fm).toContain("author: Jane Doe");
  });

  it("handles arrays", () => {
    const fm = generateFrontmatter({ tags: ["tech", "writing"] });
    expect(fm).toContain("tags:");
    expect(fm).toContain("  - tech");
    expect(fm).toContain("  - writing");
  });

  it("quotes values containing colons", () => {
    const fm = generateFrontmatter({ linkedin_url: "https://linkedin.com/pulse/test" });
    expect(fm).toContain('linkedin_url: "https://linkedin.com/pulse/test"');
  });
});

describe("parseFrontmatter", () => {
  it("parses frontmatter and body", () => {
    const content = "---\ntitle: Test\ndate: 2026-04-03\nauthor: Jane Doe\n---\nBody content here.";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.title).toBe("Test");
    expect(frontmatter.date).toBe("2026-04-03");
    expect(frontmatter.author).toBe("Jane Doe");
    expect(body).toBe("Body content here.");
  });

  it("returns empty frontmatter when none present", () => {
    const { frontmatter, body } = parseFrontmatter("Just body content.");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Just body content.");
  });
});
