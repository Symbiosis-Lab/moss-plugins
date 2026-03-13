/**
 * Tests for social-reader buildUidToUrlMap
 *
 * Validates that buildUidToUrlMap correctly reads article-map.json
 * and builds a uid -> url_path mapping. Also tests backward
 * compatibility with buildSourceToUrlMap still working.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockListSocialFiles = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  listSocialFiles: mockListSocialFiles,
}));

import {
  buildUidToUrlMap,
  buildSourceToUrlMap,
  loadAllComments,
} from "../social-reader";

describe("buildUidToUrlMap", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockListSocialFiles.mockReset();
  });

  it("returns empty map when article-map.json does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("File not found"));

    const map = await buildUidToUrlMap();

    expect(map.size).toBe(0);
    expect(mockReadFile).toHaveBeenCalledWith(".moss/article-map.json");
  });

  it("returns empty map when article-map has no articles", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ articles: null }));

    const map = await buildUidToUrlMap();

    expect(map.size).toBe(0);
  });

  it("builds uid -> url_path mapping from article-map.json", async () => {
    const articleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "abc123",
        },
        "posts/world/": {
          source_path: "/Users/test/site/posts/world.md",
          url_path: "posts/world/",
          uid: "def456",
        },
      },
    };

    mockReadFile.mockResolvedValue(JSON.stringify(articleMap));

    const map = await buildUidToUrlMap();

    expect(map.size).toBe(2);
    expect(map.get("abc123")).toBe("posts/hello/");
    expect(map.get("def456")).toBe("posts/world/");
  });

  it("skips articles without a uid", async () => {
    const articleMap = {
      articles: {
        "posts/has-uid/": {
          source_path: "/Users/test/site/posts/has-uid.md",
          url_path: "posts/has-uid/",
          uid: "uid-123",
        },
        "posts/no-uid/": {
          source_path: "/Users/test/site/posts/no-uid.md",
          url_path: "posts/no-uid/",
          // no uid field
        },
      },
    };

    mockReadFile.mockResolvedValue(JSON.stringify(articleMap));

    const map = await buildUidToUrlMap();

    expect(map.size).toBe(1);
    expect(map.get("uid-123")).toBe("posts/has-uid/");
  });

  it("skips articles without url_path", async () => {
    const articleMap = {
      articles: {
        "posts/no-url/": {
          source_path: "/Users/test/site/posts/no-url.md",
          uid: "uid-no-url",
          // no url_path field
        },
      },
    };

    mockReadFile.mockResolvedValue(JSON.stringify(articleMap));

    const map = await buildUidToUrlMap();

    expect(map.size).toBe(0);
  });

  it("handles malformed JSON gracefully", async () => {
    mockReadFile.mockResolvedValue("not valid json");

    const map = await buildUidToUrlMap();

    expect(map.size).toBe(0);
  });
});

describe("buildSourceToUrlMap still works (backward compatibility)", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockListSocialFiles.mockReset();
    // Set up project path context for buildSourceToUrlMap
    (globalThis as any).__MOSS_INTERNAL_CONTEXT__ = {
      project_path: "/Users/test/site",
    };
  });

  it("still builds source_path -> url_path mapping", async () => {
    const articleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "abc123",
        },
      },
    };

    mockReadFile.mockResolvedValue(JSON.stringify(articleMap));

    const map = await buildSourceToUrlMap();

    expect(map.size).toBe(1);
    expect(map.get("posts/hello.md")).toBe("posts/hello/");
  });
});

describe("loadAllComments sort order", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockListSocialFiles.mockReset();
    mockListSocialFiles.mockResolvedValue([]);
  });

  it("sorts comments newest-first (descending by date)", async () => {
    const socialData = {
      articles: {
        "posts/hello.md": {
          comments: [
            { id: "old", content: "old", createdAt: "2023-01-01T00:00:00Z", author: { name: "A" } },
            { id: "new", content: "new", createdAt: "2024-06-15T00:00:00Z", author: { name: "B" } },
            { id: "mid", content: "mid", createdAt: "2023-07-01T00:00:00Z", author: { name: "C" } },
          ],
        },
      },
    };

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("comment.json")) return JSON.stringify(socialData);
      throw new Error("not found");
    });

    const result = await loadAllComments(["comment"]);
    const comments = result.get("posts/hello.md");

    expect(comments).toBeDefined();
    expect(comments!.length).toBe(3);
    // Newest first
    expect(comments![0].id).toBe("new");
    expect(comments![1].id).toBe("mid");
    expect(comments![2].id).toBe("old");
  });
});

describe("loadAllComments dynamic discovery", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockListSocialFiles.mockReset();
  });

  it("discovers sources from listSocialFiles", async () => {
    mockListSocialFiles.mockResolvedValue(["douban", "matters"]);

    const doubanData = {
      articles: {
        "posts/hello.md": {
          comments: [
            { id: "d1", content: "Great post!", createdAt: "2024-01-01T00:00:00Z", author: { name: "Alice" } },
          ],
        },
      },
    };

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("douban.json")) return JSON.stringify(doubanData);
      throw new Error("not found");
    });

    const result = await loadAllComments();
    const comments = result.get("posts/hello.md");

    expect(comments).toBeDefined();
    expect(comments!.length).toBe(1);
    expect(comments![0].id).toBe("d1");
    expect(comments![0].source).toBe("douban");
  });

  it("merges discovered sources with extraSources", async () => {
    mockListSocialFiles.mockResolvedValue(["douban"]);

    const doubanData = {
      articles: {
        "posts/hello.md": {
          comments: [
            { id: "d1", content: "From douban", createdAt: "2024-01-01T00:00:00Z", author: { name: "Alice" } },
          ],
        },
      },
    };

    const commentData = {
      articles: {
        "posts/hello.md": {
          comments: [
            { id: "c1", content: "From comment", createdAt: "2024-02-01T00:00:00Z", author: { name: "Bob" } },
          ],
        },
      },
    };

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("douban.json")) return JSON.stringify(doubanData);
      if (path.includes("comment.json")) return JSON.stringify(commentData);
      throw new Error("not found");
    });

    const result = await loadAllComments(["comment"]);
    const comments = result.get("posts/hello.md");

    expect(comments).toBeDefined();
    expect(comments!.length).toBe(2);
    // Both sources are present
    const sources = comments!.map((c) => c.source);
    expect(sources).toContain("douban");
    expect(sources).toContain("comment");
  });

  it("deduplicates sources", async () => {
    mockListSocialFiles.mockResolvedValue(["comment", "matters"]);

    const commentData = {
      articles: {
        "posts/hello.md": {
          comments: [
            { id: "c1", content: "A comment", createdAt: "2024-01-01T00:00:00Z", author: { name: "Alice" } },
          ],
        },
      },
    };

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("comment.json")) return JSON.stringify(commentData);
      throw new Error("not found");
    });

    const result = await loadAllComments(["comment"]);
    const comments = result.get("posts/hello.md");

    expect(comments).toBeDefined();
    // "comment" appears in both discovered and extraSources, but should only be read once
    expect(comments!.length).toBe(1);
    // Verify readFile was called only once for comment.json (not twice)
    const commentCalls = mockReadFile.mock.calls.filter(
      (call: string[]) => call[0] === ".moss/social/comment.json"
    );
    expect(commentCalls.length).toBe(1);
  });

  it("falls back to empty when listSocialFiles fails", async () => {
    mockListSocialFiles.mockRejectedValue(new Error("Tauri not available"));

    const commentData = {
      articles: {
        "posts/hello.md": {
          comments: [
            { id: "c1", content: "A comment", createdAt: "2024-01-01T00:00:00Z", author: { name: "Alice" } },
          ],
        },
      },
    };

    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("comment.json")) return JSON.stringify(commentData);
      throw new Error("not found");
    });

    // Should still work with just extraSources
    const result = await loadAllComments(["comment"]);
    const comments = result.get("posts/hello.md");

    expect(comments).toBeDefined();
    expect(comments!.length).toBe(1);
    expect(comments![0].id).toBe("c1");
  });

  it("works with no sources when both discovery and extraSources are empty", async () => {
    mockListSocialFiles.mockResolvedValue([]);

    const result = await loadAllComments();

    expect(result.size).toBe(0);
  });
});
