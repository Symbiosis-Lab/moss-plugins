import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseBookInfo,
  parseIntro,
  parseStarRating,
  parseCollectionDate,
  generateFrontmatter,
  itemToMarkdown,
} from "../converter";

describe("parseBookInfo", () => {
  it("parses structured book metadata from HTML", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "../../test-fixtures/book-info.html"),
      "utf-8"
    );
    const info = parseBookInfo(html);

    expect(info["出版年"]).toBe("2003-8");
    expect(info["ISBN"]).toBe("9787020042494");
    expect(info["页数"]).toBe("97");
    expect(info["装帧"]).toBe("平装");
    expect(info["定价"]).toBe("22.00元");
    expect(info["原作名"]).toBe("Le Petit Prince");
  });

  it("extracts linked author names", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "../../test-fixtures/book-info.html"),
      "utf-8"
    );
    const info = parseBookInfo(html);

    expect(info["作者"]).toBe("[法国] 安东尼·德·圣-埃克苏佩里");
    expect(info["译者"]).toBe("马振骋");
  });
});

describe("parseIntro", () => {
  it("strips show-more links from intro HTML", () => {
    const html = `<p>This is the book intro.</p><p><a href="javascript:void(0)" class="j a_show_full">(展开全部)</a></p>`;
    const text = parseIntro(html);
    expect(text).toBe("This is the book intro.");
    expect(text).not.toContain("展开全部");
  });

  it("handles plain text intro", () => {
    expect(parseIntro("<p>Simple intro.</p>")).toBe("Simple intro.");
  });
});

describe("parseStarRating", () => {
  it("parses allstar classes to 1-5 scale", () => {
    expect(parseStarRating("allstar50")).toBe(5);
    expect(parseStarRating("allstar40")).toBe(4);
    expect(parseStarRating("allstar30")).toBe(3);
    expect(parseStarRating("allstar20")).toBe(2);
    expect(parseStarRating("allstar10")).toBe(1);
  });

  it("returns 0 for no rating", () => {
    expect(parseStarRating("")).toBe(0);
    expect(parseStarRating("some-class")).toBe(0);
  });
});

describe("parseCollectionDate", () => {
  it("parses date and read status", () => {
    const { date, status } = parseCollectionDate("2016-07-22\n      读过");
    expect(date).toBe("2016-07-22");
    expect(status).toBe("done");
  });

  it("detects 'doing' status", () => {
    const { status } = parseCollectionDate("2026-01-15 在读");
    expect(status).toBe("doing");
  });

  it("detects 'wish' status", () => {
    const { status } = parseCollectionDate("2025-12-01 想读");
    expect(status).toBe("wish");
  });
});

describe("generateFrontmatter", () => {
  it("generates YAML frontmatter for a book review", () => {
    const fm = generateFrontmatter({
      title: "小王子",
      type: "review",
      media_type: "book",
      rating: 5,
      date_consumed: "2026-04-03",
      douban_url: "https://book.douban.com/subject/1084336/",
    });

    expect(fm).toContain("---");
    expect(fm).toContain("title: 小王子");
    expect(fm).toContain("type: review");
    expect(fm).toContain("media_type: book");
    expect(fm).toContain("rating: 5");
    expect(fm).toContain("date_consumed: 2026-04-03");
    expect(fm).toContain('douban_url: "https://book.douban.com/subject/1084336/"');
  });

  it("handles arrays", () => {
    const fm = generateFrontmatter({ tags: ["fiction", "classic"] });
    expect(fm).toContain("tags:");
    expect(fm).toContain("  - fiction");
    expect(fm).toContain("  - classic");
  });

  it("skips empty values", () => {
    const fm = generateFrontmatter({ title: "Test", empty: "", nullVal: null });
    expect(fm).toContain("title: Test");
    expect(fm).not.toContain("empty");
    expect(fm).not.toContain("nullVal");
  });
});

describe("itemToMarkdown", () => {
  it("produces a complete markdown file for a book review", () => {
    const md = itemToMarkdown(
      {
        title: "小王子",
        rating: 5,
        date: "2026-04-03",
        status: "done",
        comment: "A beautiful story about love and loss.",
        url: "https://book.douban.com/subject/1084336/",
        mediaType: "book",
        tags: ["fiction", "classic"],
      },
      {
        author: "[法国] 安东尼·德·圣-埃克苏佩里",
        intro: "A tale of a little prince from a tiny asteroid.",
        publisher: "人民文学出版社",
        isbn: "9787020042494",
      }
    );

    // Check frontmatter
    expect(md).toContain("title: 小王子");
    expect(md).toContain("type: review");
    expect(md).toContain("media_type: book");
    expect(md).toContain("rating: 5");
    expect(md).toContain("  - fiction");

    // Check body
    expect(md).toContain("A beautiful story about love and loss.");
    expect(md).toContain("## About");
    expect(md).toContain("A tale of a little prince from a tiny asteroid.");
  });

  it("works without detail info", () => {
    const md = itemToMarkdown({
      title: "Test Movie",
      rating: 4,
      date: "2026-01-01",
      status: "done",
      comment: "Good movie.",
      url: "https://movie.douban.com/subject/123456/",
      mediaType: "movie",
    });

    expect(md).toContain("title: Test Movie");
    expect(md).toContain("media_type: movie");
    expect(md).toContain("Good movie.");
    expect(md).not.toContain("## About");
  });
});
