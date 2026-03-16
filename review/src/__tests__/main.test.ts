import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockFetchUrl = vi.hoisted(() => vi.fn());
const mockReadPluginFile = vi.hoisted(() => vi.fn());
const mockDownloadAsset = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  fetchUrl: mockFetchUrl,
  readPluginFile: mockReadPluginFile,
  downloadAsset: mockDownloadAsset,
}));

import { process, updateFrontmatterCover, detectCoverDirectory } from "../main";
import type { ProcessContext } from "../types";

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
  });

  it("skips when no article-map.json", async () => {
    mockReadFile.mockRejectedValue(new Error("Not found"));

    const result = await process(makeProcessCtx());
    expect(result.success).toBe(true);
    expect(result.message).toContain("No article map");
  });

  it("fetches NeoDB data for articles with review_of frontmatter", async () => {
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
          "---\ntitle: Test\nreview_of: https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp\nrating: 4\n---\nBody"
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
      actualPath: "assets/covers/16a8df666c-7506-45ff-b0e9-0344407335e0.jpg",
      bytesWritten: 1024,
      contentType: "image/jpeg",
    });

    mockWriteFile.mockResolvedValue(undefined);

    const result = await process(makeProcessCtx());
    expect(result.success).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith(
      ".moss/social/review.json",
      expect.any(String)
    );
  });

  it("downloads cover and updates frontmatter when cover_image_url exists", async () => {
    const mdContent = "---\ntitle: Test\nreview_of: https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp\nrating: 4\n---\nBody text here";

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
        return Promise.resolve(mdContent);
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
      actualPath: "assets/covers/cover.jpg",
      bytesWritten: 1024,
      contentType: "image/jpeg",
    });

    mockWriteFile.mockResolvedValue(undefined);

    await process(makeProcessCtx());

    // Should have called downloadAsset with the cover URL
    expect(mockDownloadAsset).toHaveBeenCalledWith(
      "https://neodb.social/m/book/2021/09/16a8df666c-7506-45ff-b0e9-0344407335e0.jpg",
      "assets/covers"
    );

    // Should have written updated frontmatter to the source file
    expect(mockWriteFile).toHaveBeenCalledWith(
      "reading/test.md",
      "---\ncover: assets/covers/cover.jpg\ntitle: Test\nreview_of: https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp\nrating: 4\n---\nBody text here"
    );

    // Social data should not contain cover_url (cover is in frontmatter, not review.json)
    const socialWriteCall = mockWriteFile.mock.calls.find(
      (c: string[]) => c[0] === ".moss/social/review.json"
    );
    expect(socialWriteCall).toBeDefined();
    const socialData = JSON.parse(socialWriteCall![1]);
    expect(socialData.articles.abc12345.cover_url).toBeUndefined();
    // Social data should include subtitle from NeoDB
    expect(socialData.articles.abc12345.subtitle).toBe("Facing the Future with Time-Tested Tools");
  });

  it("skips cover download when frontmatter already has cover", async () => {
    const mdContent = "---\ntitle: Test\nreview_of: https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp\ncover: my-custom-cover.jpg\n---\nBody";

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
        return Promise.resolve(mdContent);
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

    mockWriteFile.mockResolvedValue(undefined);

    await process(makeProcessCtx());

    // Should NOT have called downloadAsset — user already set a cover
    expect(mockDownloadAsset).not.toHaveBeenCalled();
  });

  it("continues gracefully when cover download fails", async () => {
    const mdContent = "---\ntitle: Test\nreview_of: https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp\n---\nBody";

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
        return Promise.resolve(mdContent);
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

    // Download fails
    mockDownloadAsset.mockRejectedValue(new Error("Network error"));

    mockWriteFile.mockResolvedValue(undefined);

    const result = await process(makeProcessCtx());

    // Should still succeed — cover download failure is non-fatal
    expect(result.success).toBe(true);

    // Social data should not contain cover_url
    const socialWriteCall = mockWriteFile.mock.calls.find(
      (c: string[]) => c[0] === ".moss/social/review.json"
    );
    expect(socialWriteCall).toBeDefined();
    const socialData = JSON.parse(socialWriteCall![1]);
    expect(socialData.articles.abc12345.cover_url).toBeUndefined();
  });

  it("skips cover download when download returns ok: false", async () => {
    const mdContent = "---\ntitle: Test\nreview_of: https://neodb.social/book/2ZSdZMnRJZKYD8QFRNNwrp\n---\nBody";

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
        return Promise.resolve(mdContent);
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

    // Download returns not ok
    mockDownloadAsset.mockResolvedValue({
      ok: false,
      status: 404,
      actualPath: "",
      bytesWritten: 0,
      contentType: null,
    });

    mockWriteFile.mockResolvedValue(undefined);

    await process(makeProcessCtx());

    // Should NOT have written to the source file (only social data)
    const sourceWriteCall = mockWriteFile.mock.calls.find(
      (c: string[]) => c[0] === "reading/test.md"
    );
    expect(sourceWriteCall).toBeUndefined();
  });
});

describe("updateFrontmatterCover", () => {
  it("inserts cover after opening --- when no cover exists", () => {
    const md = "---\ntitle: Test\nreview_of: https://neodb.social/book/abc\n---\nBody text";
    const result = updateFrontmatterCover(md, "assets/covers/cover.jpg");
    expect(result).toBe("---\ncover: assets/covers/cover.jpg\ntitle: Test\nreview_of: https://neodb.social/book/abc\n---\nBody text");
  });

  it("replaces existing cover line", () => {
    const md = "---\ntitle: Test\ncover: old-cover.jpg\nreview_of: https://neodb.social/book/abc\n---\nBody text";
    const result = updateFrontmatterCover(md, "assets/covers/new-cover.jpg");
    expect(result).toBe("---\ntitle: Test\ncover: assets/covers/new-cover.jpg\nreview_of: https://neodb.social/book/abc\n---\nBody text");
  });

  it("preserves body byte-for-byte", () => {
    const body = "\nSome body with special chars: 你好 & <tags>\n\nMore lines.";
    const md = `---\ntitle: Test\n---${body}`;
    const result = updateFrontmatterCover(md, "assets/covers/cover.jpg");
    expect(result).toBe(`---\ncover: assets/covers/cover.jpg\ntitle: Test\n---${body}`);
  });

  it("returns null when no frontmatter block exists", () => {
    const md = "No frontmatter here, just body text.";
    const result = updateFrontmatterCover(md, "assets/covers/cover.jpg");
    expect(result).toBeNull();
  });
});

describe("detectCoverDirectory", () => {
  it("returns most common image directory from article covers", () => {
    const articleMap = {
      articles: {
        "a": { source_path: "a.md", url_path: "a/", frontmatter: { cover: "图片/img1.jpg" } },
        "b": { source_path: "b.md", url_path: "b/", frontmatter: { cover: "图片/img2.png" } },
        "c": { source_path: "c.md", url_path: "c/", frontmatter: { cover: "assets/img3.jpg" } },
      },
    };
    expect(detectCoverDirectory(articleMap)).toBe("图片");
  });

  it("falls back to assets/covers when no articles have covers", () => {
    const articleMap = {
      articles: {
        "a": { source_path: "a.md", url_path: "a/", frontmatter: { title: "No cover" } },
      },
    };
    expect(detectCoverDirectory(articleMap)).toBe("assets/covers");
  });

  it("falls back to assets/covers when articles map is empty", () => {
    expect(detectCoverDirectory({ articles: {} })).toBe("assets/covers");
  });

  it("ignores external URLs", () => {
    const articleMap = {
      articles: {
        "a": { source_path: "a.md", url_path: "a/", frontmatter: { cover: "https://example.com/cover.jpg" } },
        "b": { source_path: "b.md", url_path: "b/", frontmatter: { cover: "图片/local.jpg" } },
      },
    };
    expect(detectCoverDirectory(articleMap)).toBe("图片");
  });

  it("ignores non-image covers (videos, HTML)", () => {
    const articleMap = {
      articles: {
        "a": { source_path: "a.md", url_path: "a/", frontmatter: { cover: "视频/movie.mov" } },
        "b": { source_path: "b.md", url_path: "b/", frontmatter: { cover: "交互/sketch.html" } },
        "c": { source_path: "c.md", url_path: "c/", frontmatter: { cover: "图片/photo.jpg" } },
      },
    };
    expect(detectCoverDirectory(articleMap)).toBe("图片");
  });

  it("handles covers without subdirectory", () => {
    const articleMap = {
      articles: {
        "a": { source_path: "a.md", url_path: "a/", frontmatter: { cover: "cover.jpg" } },
        "b": { source_path: "b.md", url_path: "b/", frontmatter: { cover: "photo.png" } },
      },
    };
    // Root directory "." should win
    expect(detectCoverDirectory(articleMap)).toBe(".");
  });
});

