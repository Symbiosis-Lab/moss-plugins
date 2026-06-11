import { describe, it, expect } from "vitest";
import { htmlToMarkdown, generateFrontmatter, parseFrontmatter, extractHashtags } from "../converter";
import * as fs from "fs";
import * as path from "path";

describe("htmlToMarkdown", () => {
  it("converts plain paragraphs", () => {
    const html = "<p>First paragraph.</p><p>Second paragraph.</p>";
    const md = htmlToMarkdown(html);
    expect(md).toBe("First paragraph.\n\nSecond paragraph.\n");
  });

  it("converts images", () => {
    const html = '<img src="https://sns-webpic-qc.xhscdn.com/note1.jpg" alt="Photo">';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![Photo](https://sns-webpic-qc.xhscdn.com/note1.jpg)");
  });

  it("converts images with data-src", () => {
    const html = '<img data-src="https://sns-webpic-qc.xhscdn.com/note2.jpg" alt="Lazy">';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![Lazy](https://sns-webpic-qc.xhscdn.com/note2.jpg)");
  });

  it("converts hashtag links as plain text", () => {
    const html = '<p>Great day <a href="/page/topics/travel">#travel</a></p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("#travel");
    expect(md).not.toContain("[#travel]");
  });

  it("converts regular links normally", () => {
    const html = '<p>See <a href="https://example.com">example</a>.</p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("[example](https://example.com)");
  });

  it("converts figures with images", () => {
    const html = '<figure><img src="https://sns-webpic-qc.xhscdn.com/photo.jpg" alt=""><figcaption>A beautiful view</figcaption></figure>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![A beautiful view](https://sns-webpic-qc.xhscdn.com/photo.jpg)");
  });

  it("converts the full test fixture", () => {
    const fixturePath = path.join(__dirname, "../../test-fixtures/xhs-note.html");
    const html = fs.readFileSync(fixturePath, "utf-8");
    const md = htmlToMarkdown(html);

    // Verify key elements are present
    expect(md).toContain("![");
    expect(md).toContain("sns-webpic-qc.xhscdn.com");
    expect(md).toContain("cherry blossoms");
    expect(md).toContain("Kyoto");
  });

  it("handles empty input", () => {
    expect(htmlToMarkdown("")).toBe("\n");
  });
});

describe("extractHashtags", () => {
  it("extracts hashtags from topic links", () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      '<a href="/page/topics/travel">#travel</a> <a href="/page/topics/food">#food</a>',
      "text/html"
    );
    const tags = extractHashtags(doc);
    expect(tags).toContain("travel");
    expect(tags).toContain("food");
  });

  it("extracts hashtags from data attributes", () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      '<span data-type="hashtag">#photography</span>',
      "text/html"
    );
    const tags = extractHashtags(doc);
    expect(tags).toContain("photography");
  });

  it("extracts hashtags from plain text with Chinese characters", () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      "<p>Beautiful day #travel #photography</p>",
      "text/html"
    );
    const tags = extractHashtags(doc);
    expect(tags).toContain("travel");
    expect(tags).toContain("photography");
  });

  it("deduplicates hashtags", () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      '<a href="/page/topics/travel">#travel</a> <p>#travel is fun</p>',
      "text/html"
    );
    const tags = extractHashtags(doc);
    const travelCount = tags.filter((t) => t === "travel").length;
    expect(travelCount).toBe(1);
  });
});

describe("generateFrontmatter", () => {
  it("generates YAML frontmatter with basic fields", () => {
    const fm = generateFrontmatter({
      title: "Spring in Kyoto",
      date: "2026-03-28",
    });
    expect(fm).toContain("---");
    expect(fm).toContain("title: Spring in Kyoto");
    expect(fm).toContain("date: 2026-03-28");
  });

  it("handles tags array", () => {
    const fm = generateFrontmatter({ tags: ["travel", "japan", "cherry blossoms"] });
    expect(fm).toContain("tags:");
    expect(fm).toContain("  - travel");
    expect(fm).toContain("  - japan");
    expect(fm).toContain("  - cherry blossoms");
  });

  it("handles images array", () => {
    const fm = generateFrontmatter({
      images: [
        "https://sns-webpic-qc.xhscdn.com/img1.jpg",
        "https://sns-webpic-qc.xhscdn.com/img2.jpg",
      ],
    });
    expect(fm).toContain("images:");
    expect(fm).toContain("  - https://sns-webpic-qc.xhscdn.com/img1.jpg");
    expect(fm).toContain("  - https://sns-webpic-qc.xhscdn.com/img2.jpg");
  });

  it("quotes values containing colons", () => {
    const fm = generateFrontmatter({
      xiaohongshu_url: "https://www.xiaohongshu.com/explore/abc123",
    });
    expect(fm).toContain('xiaohongshu_url: "https://www.xiaohongshu.com/explore/abc123"');
  });

  it("generates full Xiaohongshu frontmatter", () => {
    const fm = generateFrontmatter({
      title: "Spring in Kyoto",
      date: "2026-03-28",
      tags: ["travel", "japan"],
      images: [
        "https://sns-webpic-qc.xhscdn.com/img1.jpg",
        "https://sns-webpic-qc.xhscdn.com/img2.jpg",
      ],
      xiaohongshu_url: "https://www.xiaohongshu.com/explore/abc123",
    });
    expect(fm).toContain("title: Spring in Kyoto");
    expect(fm).toContain("date: 2026-03-28");
    expect(fm).toContain("tags:");
    expect(fm).toContain("  - travel");
    expect(fm).toContain("images:");
    expect(fm).toContain("  - https://sns-webpic-qc.xhscdn.com/img1.jpg");
    expect(fm).toContain('xiaohongshu_url: "https://www.xiaohongshu.com/explore/abc123"');
  });
});

describe("parseFrontmatter", () => {
  it("parses frontmatter and body", () => {
    const content = "---\ntitle: Spring in Kyoto\ndate: 2026-03-28\n---\nBody content here.";
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.title).toBe("Spring in Kyoto");
    expect(frontmatter.date).toBe("2026-03-28");
    expect(body).toBe("Body content here.");
  });

  it("returns empty frontmatter when none present", () => {
    const { frontmatter, body } = parseFrontmatter("Just body content.");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Just body content.");
  });
});
