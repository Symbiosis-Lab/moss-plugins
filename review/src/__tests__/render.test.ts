import { describe, it, expect } from "vitest";
import { renderStars, renderHeader, renderColophon } from "../render";
import type { ReviewSocialEntry } from "../types";

const makeEntry = (overrides: Partial<ReviewSocialEntry> = {}): ReviewSocialEntry => ({
  source_url: "https://neodb.social/book/abc",
  source: "neodb",
  category: "book",
  title: "Seeing Like a State",
  creator: ["James C. Scott"],
  year: 1998,
  publisher: "Yale University Press",
  pages: 445,
  isbn: "9780300078152",
  community_rating: 8.2,
  community_rating_count: 45,
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
    const html = renderHeader(makeEntry(), "图片/cover.jpg");
    expect(html).toContain('class="review-header"');
    expect(html).toContain('class="review-cover"');
    expect(html).toContain("James C. Scott");
    expect(html).toContain("1998");
  });

  it("omits cover when coverUrl is null", () => {
    const html = renderHeader(makeEntry(), null);
    expect(html).not.toContain("<img");
    expect(html).toContain("James C. Scott");
  });

  it("returns empty when no creator and no year", () => {
    const html = renderHeader(makeEntry({ creator: [], year: null }), null);
    expect(html).toBe("");
  });

  it("shows only creator when no year", () => {
    const html = renderHeader(makeEntry({ year: null }), null);
    expect(html).toContain("James C. Scott");
    expect(html).not.toContain("·");
  });

  it("joins multiple creators with comma", () => {
    const html = renderHeader(makeEntry({ creator: ["Alice", "Bob"] }), null);
    expect(html).toContain("Alice, Bob");
  });

  it("prepends / to local cover path for root-relative resolution", () => {
    const html = renderHeader(makeEntry(), "assets/covers/book.jpg");
    expect(html).toContain('src="/assets/covers/book.jpg"');
  });

  it("prepends / to non-Latin local cover path", () => {
    const html = renderHeader(makeEntry(), "图片/cover.jpg");
    expect(html).toContain('src="/图片/cover.jpg"');
  });

  it("keeps external URL unchanged", () => {
    const html = renderHeader(makeEntry(), "https://example.com/cover.jpg");
    expect(html).toContain('src="https://example.com/cover.jpg"');
  });

  it("does not double-prefix already root-relative path", () => {
    const html = renderHeader(makeEntry(), "/assets/covers/book.jpg");
    expect(html).toContain('src="/assets/covers/book.jpg"');
    expect(html).not.toContain('src="//');
  });
});

describe("renderColophon", () => {
  it("renders card with title, rating, biblio, and links", () => {
    const html = renderColophon(makeEntry(), "图片/cover.jpg");
    expect(html).toContain('class="review-colophon"');
    expect(html).toContain('class="review-colophon-title"');
    expect(html).toContain("Seeing Like a State");
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

  it("renders cover image in colophon card", () => {
    const html = renderColophon(makeEntry(), "图片/cover.jpg");
    expect(html).toContain('class="review-colophon-cover"');
    expect(html).toContain('src="/图片/cover.jpg"');
  });

  it("renders colophon without cover when coverUrl is null", () => {
    const html = renderColophon(makeEntry(), null);
    expect(html).not.toContain("review-colophon-cover");
    expect(html).toContain("Seeing Like a State");
    expect(html).toContain("review-colophon-details");
  });

  it("renders creator and year in identity line", () => {
    const html = renderColophon(makeEntry(), null);
    expect(html).toContain('class="review-colophon-identity"');
    expect(html).toContain("James C. Scott");
    expect(html).toContain("1998");
  });

  it("renders ISBN when present", () => {
    const html = renderColophon(makeEntry(), null);
    expect(html).toContain("9780300078152");
  });

  it("omits ISBN when absent", () => {
    const html = renderColophon(makeEntry({ isbn: null }), null);
    expect(html).not.toContain("ISBN");
  });

  it("renders only NeoDB link when no externals", () => {
    const html = renderColophon(makeEntry({
      external_urls: { neodb: "https://neodb.social/book/abc" },
    }), null);
    expect(html).toContain("NeoDB");
    expect(html).not.toContain("Douban");
    expect(html).not.toContain("Goodreads");
  });

  it("always renders title even with minimal data", () => {
    const html = renderColophon(makeEntry({
      writer_rating: null,
      publisher: null,
      year: null,
      pages: null,
      isbn: null,
      external_urls: { neodb: "https://neodb.social/book/abc" },
      community_rating: null,
      community_rating_count: 0,
    }), null);
    expect(html).toContain("Seeing Like a State");
    expect(html).toContain("NeoDB");
  });

  it("omits biblio line when all parts missing", () => {
    const html = renderColophon(makeEntry({
      publisher: null, year: null, pages: null, isbn: null,
    }), null);
    expect(html).not.toContain('class="review-biblio"');
  });

  it("renders TMDB source name for tmdb entries", () => {
    const html = renderColophon(makeEntry({
      source: "tmdb",
      community_rating: 7.5,
      community_rating_count: 1200,
      external_urls: { tmdb: "https://www.themoviedb.org/movie/12345" },
    }), null);
    expect(html).toContain("TMDB 7.5/10");
    expect(html).toContain("1200 ratings");
    expect(html).not.toContain("NeoDB 7.5/10");
  });

  it("renders Douban source name for douban entries", () => {
    const html = renderColophon(makeEntry({
      source: "douban",
      community_rating: 9.0,
      community_rating_count: 500,
    }), null);
    expect(html).toContain("Douban 9.0/10");
  });

  it("omits identity line when no creator and no year", () => {
    const html = renderColophon(makeEntry({ creator: [], year: null }), null);
    expect(html).not.toContain('class="review-colophon-identity"');
  });

  it("omits links section when no external URLs", () => {
    const html = renderColophon(makeEntry({ external_urls: {} }), null);
    expect(html).not.toContain('class="review-links"');
  });
});
