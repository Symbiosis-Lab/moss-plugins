import { describe, it, expect } from "vitest";
import { renderStars, renderHeader, renderColophon } from "../render";
import type { ReviewSocialEntry } from "../types";

const makeEntry = (overrides: Partial<ReviewSocialEntry> = {}): ReviewSocialEntry => ({
  neodb_url: "https://neodb.social/book/abc",
  category: "book",
  title: "Seeing Like a State",
  creator: ["James C. Scott"],
  year: 1998,
  publisher: "Yale University Press",
  pages: 445,
  isbn: "9780300078152",
  community_rating: 8.2,
  community_rating_count: 45,
  cover_url: "https://neodb.social/m/book/cover.jpg",
  external_urls: {
    neodb: "https://neodb.social/book/abc",
    douban: "https://book.douban.com/subject/123/",
    goodreads: "https://www.goodreads.com/book/show/456",
    openlibrary: "https://openlibrary.org/works/OL789W",
  },
  writer_rating: 4,
  fetched_at: "2026-03-10T00:00:00.000Z",
  ...overrides,
});

describe("renderStars", () => {
  it("renders 5 filled stars for rating 5", () => {
    expect(renderStars(5)).toBe("★★★★★");
  });

  it("renders 1 filled + 4 empty for rating 1", () => {
    expect(renderStars(1)).toBe("★☆☆☆☆");
  });

  it("renders half star for 3.5", () => {
    expect(renderStars(3.5)).toBe("★★★✦☆");
  });

  it("renders all empty for 0", () => {
    expect(renderStars(0)).toBe("☆☆☆☆☆");
  });

  it("renders null rating as empty string", () => {
    expect(renderStars(null)).toBe("");
  });
});

describe("renderHeader", () => {
  it("renders cover + creator + year", () => {
    const html = renderHeader(makeEntry());
    expect(html).toContain('class="review-header"');
    expect(html).toContain('class="review-cover"');
    expect(html).toContain("James C. Scott");
    expect(html).toContain("1998");
  });

  it("omits cover when no URL", () => {
    const html = renderHeader(makeEntry({ cover_url: null }));
    expect(html).not.toContain("<img");
    expect(html).toContain("James C. Scott");
  });

  it("returns empty when no creator and no year", () => {
    const html = renderHeader(makeEntry({ creator: [], year: null }));
    expect(html).toBe("");
  });

  it("shows only creator when no year", () => {
    const html = renderHeader(makeEntry({ year: null }));
    expect(html).toContain("James C. Scott");
    expect(html).not.toContain("·");
  });

  it("joins multiple creators with comma", () => {
    const html = renderHeader(makeEntry({ creator: ["Alice", "Bob"] }));
    expect(html).toContain("Alice, Bob");
  });
});

describe("renderColophon", () => {
  it("renders rating + biblio + links", () => {
    const html = renderColophon(makeEntry());
    expect(html).toContain('class="review-colophon"');
    expect(html).toContain("★★★★☆"); // rating 4
    expect(html).toContain("NeoDB 8.2/10");
    expect(html).toContain("45 ratings");
    expect(html).toContain("Yale University Press");
    expect(html).toContain("445 pages");
    expect(html).toContain("Douban");
    expect(html).toContain("NeoDB");
    expect(html).toContain("Goodreads");
    expect(html).toContain("Open Library");
  });

  it("renders ISBN when present", () => {
    const html = renderColophon(makeEntry());
    expect(html).toContain("9780300078152");
  });

  it("omits ISBN when absent", () => {
    const html = renderColophon(makeEntry({ isbn: null }));
    expect(html).not.toContain("ISBN");
  });

  it("renders only NeoDB link when no externals", () => {
    const html = renderColophon(makeEntry({
      external_urls: { neodb: "https://neodb.social/book/abc" },
    }));
    expect(html).toContain("NeoDB");
    expect(html).not.toContain("Douban");
    expect(html).not.toContain("Goodreads");
  });

  it("returns empty when no rating and no data", () => {
    const html = renderColophon(makeEntry({
      writer_rating: null,
      publisher: null,
      year: null,
      pages: null,
      isbn: null,
      external_urls: { neodb: "https://neodb.social/book/abc" },
      community_rating: null,
      community_rating_count: 0,
    }));
    // Should still render because NeoDB link is always present
    expect(html).toContain("NeoDB");
  });

  it("omits biblio line when all parts missing", () => {
    const html = renderColophon(makeEntry({
      publisher: null, year: null, pages: null, isbn: null,
    }));
    expect(html).not.toContain('class="review-biblio"');
  });
});
