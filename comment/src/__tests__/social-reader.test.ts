/**
 * Tests for social-reader buildUidToUrlMap
 *
 * Validates that buildUidToUrlMap correctly reads article-map.json
 * and builds a uid -> url_path mapping. Also tests backward
 * compatibility with buildSourceToUrlMap still working.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
}));

import {
  buildUidToUrlMap,
  buildSourceToUrlMap,
  loadAllComments,
} from "../social-reader";

describe("buildUidToUrlMap", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
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
