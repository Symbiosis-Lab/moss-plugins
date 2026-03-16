import { describe, it, expect } from "vitest";
import { detectSource, sourceDisplayName } from "../sources";

describe("detectSource", () => {
  it("detects NeoDB URLs", () => {
    expect(detectSource("https://neodb.social/book/abc123")).toBe("neodb");
    expect(detectSource("https://neodb.social/movie/xyz")).toBe("neodb");
  });

  it("detects Douban URLs", () => {
    expect(detectSource("https://book.douban.com/subject/12345/")).toBe("douban");
    expect(detectSource("https://movie.douban.com/subject/67890/")).toBe("douban");
  });

  it("detects TMDB URLs", () => {
    expect(detectSource("https://www.themoviedb.org/movie/12345")).toBe("tmdb");
    expect(detectSource("https://www.themoviedb.org/tv/67890")).toBe("tmdb");
  });

  it("detects Goodreads URLs", () => {
    expect(detectSource("https://www.goodreads.com/book/show/12345")).toBe("goodreads");
  });

  it("returns null for unrecognized URLs", () => {
    expect(detectSource("https://example.com/some/page")).toBeNull();
    expect(detectSource("https://amazon.com/book/12345")).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(detectSource("not a url")).toBeNull();
    expect(detectSource("")).toBeNull();
  });
});

describe("sourceDisplayName", () => {
  it("returns correct display names", () => {
    expect(sourceDisplayName("neodb")).toBe("NeoDB");
    expect(sourceDisplayName("douban")).toBe("Douban");
    expect(sourceDisplayName("tmdb")).toBe("TMDB");
    expect(sourceDisplayName("goodreads")).toBe("Goodreads");
  });
});
