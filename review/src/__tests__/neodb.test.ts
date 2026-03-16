import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetchUrl = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  fetchUrl: mockFetchUrl,
}));

import { parseNeoDBUrl, fetchNeoDBItem } from "../neodb";
import bookFixture from "./fixtures/neodb-book.json";
import movieFixture from "./fixtures/neodb-movie.json";

describe("parseNeoDBUrl", () => {
  it("extracts base and api path from book URL", () => {
    const result = parseNeoDBUrl("https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp");
    expect(result).toEqual({
      base: "https://neodb.social",
      apiPath: "/api/book/2ZSdZMnRJZKYD8QFRNNwrp",
    });
  });

  it("extracts from movie URL", () => {
    const result = parseNeoDBUrl("https://neodb.social/movie/44E3AK7EKtc9fb3lBBqZNr");
    expect(result).toEqual({
      base: "https://neodb.social",
      apiPath: "/api/movie/44E3AK7EKtc9fb3lBBqZNr",
    });
  });

  it("handles custom NeoDB instances", () => {
    const result = parseNeoDBUrl("https://my.neodb.instance/book/abc123");
    expect(result).toEqual({
      base: "https://my.neodb.instance",
      apiPath: "/api/book/abc123",
    });
  });

  it("handles tv/season paths", () => {
    const result = parseNeoDBUrl("https://neodb.social/tv/season/xyz789");
    expect(result).toEqual({
      base: "https://neodb.social",
      apiPath: "/api/tv/season/xyz789",
    });
  });

  it("returns null for invalid URLs", () => {
    expect(parseNeoDBUrl("not-a-url")).toBeNull();
    expect(parseNeoDBUrl("https://example.com")).toBeNull();
    expect(parseNeoDBUrl("")).toBeNull();
  });
});

describe("fetchNeoDBItem", () => {
  beforeEach(() => {
    mockFetchUrl.mockReset();
  });

  it("normalizes book response", async () => {
    mockFetchUrl.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify(bookFixture),
    });

    const item = await fetchNeoDBItem("https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp");

    expect(item).not.toBeNull();
    expect(item!.category).toBe("book");
    expect(item!.title).toBeTruthy();
    expect(item!.creator).toBeInstanceOf(Array);
    expect(item!.source).toBe("neodb");
    expect(item!.external_urls.neodb).toContain("neodb.social");
  });

  it("normalizes movie response", async () => {
    mockFetchUrl.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify(movieFixture),
    });

    const item = await fetchNeoDBItem("https://neodb.social/movie/44E3AK7EKtc9fb3lBBqZNr");

    expect(item).not.toBeNull();
    expect(item!.category).toBe("movie");
    expect(item!.source).toBe("neodb");
    expect(item!.external_urls.neodb).toContain("neodb.social");
  });

  it("returns null on 404", async () => {
    mockFetchUrl.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => "Not Found",
    });

    const item = await fetchNeoDBItem("https://neodb.social/book/nonexistent");
    expect(item).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetchUrl.mockRejectedValue(new Error("Network error"));

    const item = await fetchNeoDBItem("https://neodb.social/book/abc");
    expect(item).toBeNull();
  });

  it("extracts external URLs by domain", async () => {
    const fixture = {
      ...bookFixture,
      external_resources: [
        { url: "https://book.douban.com/subject/123/" },
        { url: "https://www.goodreads.com/book/show/456" },
        { url: "https://openlibrary.org/works/OL789W" },
      ],
    };
    mockFetchUrl.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify(fixture),
    });

    const item = await fetchNeoDBItem("https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp");

    expect(item!.external_urls.douban).toBe("https://book.douban.com/subject/123/");
    expect(item!.external_urls.goodreads).toBe("https://www.goodreads.com/book/show/456");
    expect(item!.external_urls.openlibrary).toBe("https://openlibrary.org/works/OL789W");
  });

  it("resolves relative cover_image_url against base", async () => {
    const fixture = { ...bookFixture, cover_image_url: "/m/item/cover.jpg" };
    mockFetchUrl.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify(fixture),
    });

    const item = await fetchNeoDBItem("https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp");

    expect(item!.cover_image_url).toBe("https://neodb.social/m/item/cover.jpg");
  });
});
