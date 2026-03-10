import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockFetchUrl = vi.hoisted(() => vi.fn());
const mockDownloadAsset = vi.hoisted(() => vi.fn());
const mockReadPluginFile = vi.hoisted(() => vi.fn());
const mockFileExists = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  fetchUrl: mockFetchUrl,
  downloadAsset: mockDownloadAsset,
  readPluginFile: mockReadPluginFile,
  fileExists: mockFileExists,
}));

import { process, enhance } from "../main";
import type { ProcessContext, EnhanceContext } from "../types";

import bookFixture from "./fixtures/neodb-book.json";

const makeProcessCtx = (): ProcessContext => ({
  project_info: { total_files: 10, homepage_file: null, site_name: "test" },
  config: {},
});

describe("process hook", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockFetchUrl.mockReset();
    mockDownloadAsset.mockReset();
    mockFileExists.mockReset();
  });

  it("skips when no article-map.json", async () => {
    mockReadFile.mockRejectedValue(new Error("Not found"));

    const result = await process(makeProcessCtx());
    expect(result.success).toBe(true);
    expect(result.message).toContain("No article map");
  });

  it("fetches NeoDB data for articles with neodb frontmatter", async () => {
    // article-map.json
    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify({
          articles: {
            "reading/test": {
              source_path: "reading/test.md",
              url_path: "reading/test/",
              uid: "abc12345",
            },
          },
        }));
      }
      if (path === "reading/test.md") {
        return Promise.resolve(
          "---\ntitle: Test\nneodb: https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp\nrating: 4\n---\nBody"
        );
      }
      if (path === ".moss/social/review.json") {
        return Promise.reject(new Error("Not found"));
      }
      return Promise.reject(new Error("Unknown file: " + path));
    });

    mockFetchUrl.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify(bookFixture),
    });

    mockDownloadAsset.mockResolvedValue({
      ok: true,
      status: 200,
      bytesWritten: 1000,
      actualPath: "reading/seeing-like-a-state.jpg",
    });

    mockFileExists.mockResolvedValue(false);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await process(makeProcessCtx());
    expect(result.success).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith(
      ".moss/social/review.json",
      expect.any(String)
    );
  });
});

describe("enhance hook", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockReadPluginFile.mockReset();
  });

  const makeEnhanceCtx = (files: Array<{ path: string; html: string }>): EnhanceContext => ({
    project_path: "/test",
    moss_dir: "/test/.moss",
    output_dir: "/test/.moss/site",
    project_info: { total_files: 10, homepage_file: null },
    config: {},
    interactions: [],
    files,
  });

  it("injects header and colophon into review pages", async () => {
    const reviewData = {
      schemaVersion: "1.0.0",
      updatedAt: "2026-03-10T00:00:00.000Z",
      articles: {
        abc12345: {
          neodb_url: "https://neodb.social/book/abc",
          category: "book",
          title: "Test Book",
          creator: ["Author Name"],
          year: 2020,
          publisher: "Publisher",
          pages: 300,
          isbn: "978-0-000-00000-0",
          community_rating: 8.0,
          community_rating_count: 100,
          cover_downloaded: false,
          cover_path: null,
          external_urls: { neodb: "https://neodb.social/book/abc" },
          writer_rating: 4,
          fetched_at: "2026-03-10T00:00:00.000Z",
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/social/review.json") return Promise.resolve(JSON.stringify(reviewData));
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify({
          articles: {
            "reading/test": {
              source_path: "reading/test.md",
              url_path: "reading/test/",
              uid: "abc12345",
            },
          },
        }));
      }
      return Promise.reject(new Error("Unknown: " + path));
    });

    mockReadPluginFile.mockResolvedValue(".review-header { color: red; }");

    const html = '<html><head><title>T</title></head><body><article><h1>Test Book</h1><p>body</p></article></body></html>';
    const result = await enhance(makeEnhanceCtx([{ path: "reading/test/index.html", html }]));

    expect(result.modified).toHaveLength(1);
    expect(result.modified![0].html).toContain('class="review-header"');
    expect(result.modified![0].html).toContain('class="review-colophon"');
    expect(result.modified![0].html).toContain("<style>");
  });

  it("skips pages without review data", async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/social/review.json") return Promise.resolve(JSON.stringify({ schemaVersion: "1.0.0", updatedAt: "", articles: {} }));
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify({
          articles: { "blog/post": { source_path: "blog/post.md", url_path: "blog/post/", uid: "xyz99999" } },
        }));
      }
      return Promise.reject(new Error("Unknown"));
    });
    mockReadPluginFile.mockResolvedValue("");

    const html = '<html><head></head><body><article><h1>No Review</h1><p>body</p></article></body></html>';
    const result = await enhance(makeEnhanceCtx([{ path: "blog/post/index.html", html }]));

    expect(result.modified).toHaveLength(0);
  });
});
