/**
 * Tests for the enhance hook
 *
 * Validates that the enhance hook correctly:
 * - Resolves uid-based social data keys to url paths
 * - Falls back to path-based keys for backward compatibility
 * - Passes uid to client-side scripts
 * - Builds urlPath -> uid reverse map for form generation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockReadPluginFile = vi.hoisted(() => vi.fn());
const mockHttpGet = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  readPluginFile: mockReadPluginFile,
  httpGet: mockHttpGet,
}));

import { enhance } from "../main";
import { clearDetectionCache } from "../fetcher";
import type { EnhanceContext, ArticleMap } from "../types";

function makeEnhanceContext(
  config: Record<string, unknown> = {},
  projectInfoOverrides: Record<string, unknown> = {}
): EnhanceContext {
  return {
    project_path: "/Users/test/site",
    moss_dir: "/Users/test/site/.moss",
    output_dir: "/Users/test/site/.moss/site",
    project_info: { total_files: 5, homepage_file: "index.md", ...projectInfoOverrides },
    config,
    interactions: [],
  };
}

// Minimal HTML template with <article> and </article> tags
function makeArticleHtml(title: string = "Test"): string {
  return `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
<article>
<h1>${title}</h1>
<p>Content here.</p>
</article>
</body>
</html>`;
}

describe("enhance hook uid resolution", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockReadPluginFile.mockReset();
    mockHttpGet.mockReset();
    clearDetectionCache();
    mockReadPluginFile.mockResolvedValue("/* comments css */");
    mockWriteFile.mockResolvedValue(undefined);

    // Set up project path context
    (globalThis as any).__MOSS_INTERNAL_CONTEXT__ = {
      project_path: "/Users/test/site",
    };
  });

  it("resolves uid-based social data keys to url paths", async () => {
    const ctx = makeEnhanceContext({});

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
      },
    };

    // Social data keyed by uid (new format)
    const socialData = {
      schemaVersion: "1.0.0",
      articles: {
        "uid-hello": {
          comments: [
            {
              id: "c1",
              content: "<p>Great post!</p>",
              createdAt: "2025-06-15T10:00:00.000Z",
              author: { displayName: "Alice", name: "Alice" },
            },
          ],
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      if (path === ".moss/social/comment.json") {
        return Promise.resolve(JSON.stringify(socialData));
      }
      if (path === ".moss/site/posts/hello/index.html") {
        return Promise.resolve(makeArticleHtml("Hello"));
      }
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);

    expect(result.success).toBe(true);

    // The HTML should have been written with injected comments
    const htmlWriteCalls = mockWriteFile.mock.calls.filter(
      (call: any[]) =>
        typeof call[0] === "string" && call[0].endsWith("index.html")
    );
    expect(htmlWriteCalls.length).toBeGreaterThan(0);

    // Find the written HTML for the hello page
    const helloHtml = htmlWriteCalls.find(
      (call: any[]) => call[0] === ".moss/site/posts/hello/index.html"
    );
    expect(helloHtml).toBeDefined();
    // Check that the comment was injected
    expect(helloHtml![1]).toContain("Great post!");
    expect(helloHtml![1]).toContain("Alice");
  });

  it("falls back to path-based keys for backward compatibility", async () => {
    const ctx = makeEnhanceContext({});

    const articleMap: ArticleMap = {
      articles: {
        "posts/legacy/": {
          source_path: "/Users/test/site/posts/legacy.md",
          url_path: "posts/legacy/",
          uid: "uid-legacy",
        },
      },
    };

    // Social data keyed by old-style path (legacy format)
    const socialData = {
      schemaVersion: "1.0.0",
      articles: {
        "posts/legacy.md": {
          comments: [
            {
              id: "c-legacy",
              content: "<p>Old-style comment</p>",
              createdAt: "2025-06-14T10:00:00.000Z",
              author: { displayName: "Bob", name: "Bob" },
            },
          ],
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      if (path.includes(".moss/social/matters.json")) {
        return Promise.resolve(JSON.stringify(socialData));
      }
      if (path === ".moss/site/posts/legacy/index.html") {
        return Promise.resolve(makeArticleHtml("Legacy"));
      }
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);

    expect(result.success).toBe(true);

    // The legacy path-based comment should still be resolved
    const helloHtml = mockWriteFile.mock.calls.find(
      (call: any[]) => call[0] === ".moss/site/posts/legacy/index.html"
    );
    expect(helloHtml).toBeDefined();
    expect(helloHtml![1]).toContain("Old-style comment");
  });

  it("prefers uid-based lookup over path-based when both exist", async () => {
    const ctx = makeEnhanceContext({});

    const articleMap: ArticleMap = {
      articles: {
        "posts/both/": {
          source_path: "/Users/test/site/posts/both.md",
          url_path: "posts/both/",
          uid: "uid-both",
        },
      },
    };

    // comment.json has uid-keyed data (should be preferred)
    const commentData = {
      schemaVersion: "1.0.0",
      articles: {
        "uid-both": {
          comments: [
            {
              id: "c-uid",
              content: "<p>UID-based comment</p>",
              createdAt: "2025-06-15T10:00:00.000Z",
              author: { displayName: "Charlie", name: "Charlie" },
            },
          ],
        },
      },
    };

    // matters.json has path-keyed data (should be fallback)
    const mattersData = {
      schemaVersion: "1.0.0",
      articles: {
        "posts/both.md": {
          comments: [
            {
              id: "c-path",
              content: "<p>Path-based comment</p>",
              createdAt: "2025-06-14T10:00:00.000Z",
              author: { displayName: "Dave", name: "Dave" },
            },
          ],
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      if (path === ".moss/social/comment.json") {
        return Promise.resolve(JSON.stringify(commentData));
      }
      if (path === ".moss/social/matters.json") {
        return Promise.resolve(JSON.stringify(mattersData));
      }
      if (path === ".moss/site/posts/both/index.html") {
        return Promise.resolve(makeArticleHtml("Both"));
      }
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    // Both comments should be present (they have different keys in social data)
    const htmlCall = mockWriteFile.mock.calls.find(
      (call: any[]) => call[0] === ".moss/site/posts/both/index.html"
    );
    expect(htmlCall).toBeDefined();
    // The uid-based comment should be present
    expect(htmlCall![1]).toContain("UID-based comment");
    // The path-based comment should also be present (merged from matters.json)
    expect(htmlCall![1]).toContain("Path-based comment");
  });

  it("passes uid to client-side submit script (Waline)", async () => {
    // Detection probe: non-200 → waline
    mockHttpGet.mockResolvedValue({ ok: false, status: 404, text: () => "Not Found" });

    const ctx = makeEnhanceContext({
      server_url: "https://waline.example.com",
    });

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello-123",
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      if (path === ".moss/site/posts/hello/index.html") {
        return Promise.resolve(makeArticleHtml("Hello"));
      }
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const htmlCall = mockWriteFile.mock.calls.find(
      (call: any[]) => call[0] === ".moss/site/posts/hello/index.html"
    );
    expect(htmlCall).toBeDefined();
    // The script should use uid as the url field, not the URL path
    expect(htmlCall![1]).toContain("uid-hello-123");
  });

  it("passes uid to client-side submit script (Artalk)", async () => {
    // Detection probe: 200 → artalk
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({ app_name: "Artalk" }),
    });

    const ctx = makeEnhanceContext(
      { server_url: "https://artalk.example.com" },
      { site_name: "Test Site" }
    );

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-artalk-456",
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      if (path === ".moss/site/posts/hello/index.html") {
        return Promise.resolve(makeArticleHtml("Hello"));
      }
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const htmlCall = mockWriteFile.mock.calls.find(
      (call: any[]) => call[0] === ".moss/site/posts/hello/index.html"
    );
    expect(htmlCall).toBeDefined();
    // The script should use uid as page_key, not the URL path
    expect(htmlCall![1]).toContain("uid-artalk-456");
  });

  it("falls back to urlPath when uid is not available", async () => {
    // Detection probe: non-200 → waline
    mockHttpGet.mockResolvedValue({ ok: false, status: 404, text: () => "Not Found" });

    const ctx = makeEnhanceContext({
      server_url: "https://waline.example.com",
    });

    const articleMap: ArticleMap = {
      articles: {
        "posts/no-uid/": {
          source_path: "/Users/test/site/posts/no-uid.md",
          url_path: "posts/no-uid/",
          // no uid
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      if (path === ".moss/site/posts/no-uid/index.html") {
        return Promise.resolve(makeArticleHtml("No UID"));
      }
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const htmlCall = mockWriteFile.mock.calls.find(
      (call: any[]) => call[0] === ".moss/site/posts/no-uid/index.html"
    );
    expect(htmlCall).toBeDefined();
    // Should fall back to URL path since there's no uid
    expect(htmlCall![1]).toContain("/posts/no-uid/");
  });
});
