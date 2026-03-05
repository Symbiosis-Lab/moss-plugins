/**
 * Tests for the enhance hook
 *
 * Validates that the enhance hook correctly:
 * - Resolves uid-based social data keys to url paths
 * - Falls back to path-based keys for backward compatibility
 * - Passes uid to client-side scripts
 * - Builds urlPath -> uid reverse map for form generation
 *
 * Pure transformer pattern: HTML is passed via ctx.files and
 * modified HTML is returned via result.modified (no HTML file I/O).
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

import { enhance, filePathToUrlPath } from "../main";
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
    files: [],
  };
}

// Minimal HTML template with <article> and </article> tags
function makeArticleHtml(title: string = "Test", dataComments?: "true" | "false", lang?: string): string {
  const articleAttr = dataComments ? ` data-comments="${dataComments}"` : "";
  const langAttr = lang ? ` lang="${lang}"` : "";
  return `<!DOCTYPE html>
<html${langAttr}>
<head><title>${title}</title></head>
<body>
<article${articleAttr}>
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
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello") },
    ];

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
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);

    expect(result.success).toBe(true);
    expect(result.modified).toBeDefined();
    expect(result.modified!.length).toBeGreaterThan(0);

    // Find the modified HTML for the hello page
    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    // Check that the comment was injected
    expect(helloFile!.html).toContain("Great post!");
    expect(helloFile!.html).toContain("Alice");
  });

  it("falls back to path-based keys for backward compatibility", async () => {
    const ctx = makeEnhanceContext({});
    ctx.files = [
      { path: "posts/legacy/index.html", html: makeArticleHtml("Legacy") },
    ];

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
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);

    expect(result.success).toBe(true);

    // The legacy path-based comment should still be resolved
    const legacyFile = result.modified!.find(
      (f) => f.path === "posts/legacy/index.html"
    );
    expect(legacyFile).toBeDefined();
    expect(legacyFile!.html).toContain("Old-style comment");
  });

  it("prefers uid-based lookup over path-based when both exist", async () => {
    const ctx = makeEnhanceContext({});
    ctx.files = [
      { path: "posts/both/index.html", html: makeArticleHtml("Both") },
    ];

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
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    // Both comments should be present (they have different keys in social data)
    const bothFile = result.modified!.find(
      (f) => f.path === "posts/both/index.html"
    );
    expect(bothFile).toBeDefined();
    // The uid-based comment should be present
    expect(bothFile!.html).toContain("UID-based comment");
    // The path-based comment should also be present (merged from matters.json)
    expect(bothFile!.html).toContain("Path-based comment");
  });

  it("passes uid to client-side submit script (Waline)", async () => {
    // Detection probe: non-200 → waline
    mockHttpGet.mockResolvedValue({ ok: false, status: 404, text: () => "Not Found" });

    const ctx = makeEnhanceContext({
      server_url: "https://waline.example.com",
    });
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello") },
    ];

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
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    // The script should use uid as the url field, not the URL path
    expect(helloFile!.html).toContain("uid-hello-123");
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
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello") },
    ];

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
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    // The script should use uid as page_key, not the URL path
    expect(helloFile!.html).toContain("uid-artalk-456");
  });

  it("falls back to urlPath when uid is not available", async () => {
    // Detection probe: non-200 → waline
    mockHttpGet.mockResolvedValue({ ok: false, status: 404, text: () => "Not Found" });

    const ctx = makeEnhanceContext({
      server_url: "https://waline.example.com",
    });
    ctx.files = [
      { path: "posts/no-uid/index.html", html: makeArticleHtml("No UID") },
    ];

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
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const noUidFile = result.modified!.find(
      (f) => f.path === "posts/no-uid/index.html"
    );
    expect(noUidFile).toBeDefined();
    // Should fall back to URL path since there's no uid
    expect(noUidFile!.html).toContain("/posts/no-uid/");
  });
});

describe("enhance hook config.site_name override", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockReadPluginFile.mockReset();
    mockHttpGet.mockReset();
    clearDetectionCache();
    mockReadPluginFile.mockResolvedValue("/* comments css */");
    mockWriteFile.mockResolvedValue(undefined);

    (globalThis as any).__MOSS_INTERNAL_CONTEXT__ = {
      project_path: "/Users/test/site",
    };
  });

  it("uses config.site_name over project_info.site_name in Artalk submit script", async () => {
    // Detection probe: 200 → artalk
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({ app_name: "Artalk" }),
    });

    const ctx = makeEnhanceContext(
      { server_url: "https://artalk.example.com", site_name: "config-site" },
      { site_name: "project-site" }
    );
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello") },
    ];

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    // The injected script should use "config-site", NOT "project-site"
    expect(helloFile!.html).toContain("config-site");
    expect(helloFile!.html).not.toContain("project-site");
  });

  it("falls back to project_info.site_name when config.site_name is empty", async () => {
    // Detection probe: 200 → artalk
    mockHttpGet.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => JSON.stringify({ app_name: "Artalk" }),
    });

    const ctx = makeEnhanceContext(
      { server_url: "https://artalk.example.com", site_name: "" },
      { site_name: "project-site" }
    );
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello") },
    ];

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    // Should fall back to project_info.site_name
    expect(helloFile!.html).toContain("project-site");
  });
});

describe("enhance hook default_comments config", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockReadPluginFile.mockReset();
    mockHttpGet.mockReset();
    clearDetectionCache();
    mockReadPluginFile.mockResolvedValue("/* comments css */");
    mockWriteFile.mockResolvedValue(undefined);

    (globalThis as any).__MOSS_INTERNAL_CONTEXT__ = {
      project_path: "/Users/test/site",
    };
  });

  /**
   * Helper: set up a single-article scenario for default_comments tests.
   * The article map has one page; social data has one comment keyed by uid.
   * Sets ctx.files with the article HTML.
   */
  function setupSingleArticle(ctx: EnhanceContext, dataComments?: "true" | "false") {
    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
      },
    };

    const socialData = {
      schemaVersion: "1.0.0",
      articles: {
        "uid-hello": {
          comments: [
            {
              id: "c1",
              content: "<p>Nice article!</p>",
              createdAt: "2025-06-15T10:00:00.000Z",
              author: { displayName: "Tester", name: "Tester" },
            },
          ],
        },
      },
    };

    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello", dataComments) },
    ];

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      if (path === ".moss/social/comment.json") {
        return Promise.resolve(JSON.stringify(socialData));
      }
      return Promise.reject(new Error("File not found"));
    });
  }

  it("default_comments: false + no data attribute -> skips injection", async () => {
    const ctx = makeEnhanceContext({ default_comments: false });
    setupSingleArticle(ctx); // no data-comments attribute

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    // No files should have been modified (injection was skipped)
    expect(result.modified?.length ?? 0).toBe(0);
  });

  it('default_comments: false + data-comments="true" -> injects comments', async () => {
    const ctx = makeEnhanceContext({ default_comments: false });
    setupSingleArticle(ctx, "true"); // explicit opt-in

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    expect(helloFile!.html).toContain("Nice article!");
    expect(helloFile!.html).toContain("Tester");
  });

  it("default_comments: true (explicit) -> injects comments (existing behavior)", async () => {
    const ctx = makeEnhanceContext({ default_comments: true });
    setupSingleArticle(ctx); // no data-comments attribute

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    expect(helloFile!.html).toContain("Nice article!");
  });

  it("default_comments: undefined (not set) -> injects comments (backward compat)", async () => {
    const ctx = makeEnhanceContext({}); // no default_comments key
    setupSingleArticle(ctx);

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    expect(helloFile!.html).toContain("Nice article!");
  });

  it('data-comments="false" -> always skips, regardless of default_comments: true', async () => {
    const ctx = makeEnhanceContext({ default_comments: true });
    setupSingleArticle(ctx, "false"); // explicit opt-out

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    // Should NOT inject (explicit opt-out overrides default_comments: true)
    expect(result.modified?.length ?? 0).toBe(0);
  });

  it('data-comments="false" -> always skips, regardless of default_comments: false', async () => {
    const ctx = makeEnhanceContext({ default_comments: false });
    setupSingleArticle(ctx, "false"); // explicit opt-out

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    expect(result.modified?.length ?? 0).toBe(0);
  });
});

describe("enhance hook i18n lang detection", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockReadPluginFile.mockReset();
    mockHttpGet.mockReset();
    clearDetectionCache();
    mockReadPluginFile.mockResolvedValue("/* comments css */");
    mockWriteFile.mockResolvedValue(undefined);

    (globalThis as any).__MOSS_INTERNAL_CONTEXT__ = {
      project_path: "/Users/test/site",
    };
  });

  it('uses Chinese summary text when HTML has lang="zh-hans"', async () => {
    const ctx = makeEnhanceContext({});
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello", undefined, "zh-hans") },
    ];

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
      },
    };

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
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    // Summary should use Chinese text for 1 comment
    expect(helloFile!.html).toContain("1条评论");
    expect(helloFile!.html).not.toContain("1 comment");
  });

  it('uses Chinese placeholder when HTML has lang="zh-hans" and server_url is set', async () => {
    // Detection probe: non-200 → waline
    mockHttpGet.mockResolvedValue({ ok: false, status: 404, text: () => "Not Found" });

    const ctx = makeEnhanceContext({
      server_url: "https://waline.example.com",
    });
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello", undefined, "zh-hans") },
    ];

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    // Form placeholder should be Chinese (placeholder stays "留下你的想法")
    expect(helloFile!.html).toContain('placeholder="留下你的想法"');
    // Summary should be Chinese (0 comments = "评论")
    expect(helloFile!.html).toContain(">评论<");
  });

  it("defaults to English when HTML has no lang attribute", async () => {
    const ctx = makeEnhanceContext({});
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello") },
    ];

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
      },
    };

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
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);
    expect(result.success).toBe(true);

    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    // Should use English
    expect(helloFile!.html).toContain("1 comment");
  });
});

describe("enhance hook CSS delivery", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockReadPluginFile.mockReset();
    mockHttpGet.mockReset();
    clearDetectionCache();
    mockReadPluginFile.mockResolvedValue(".moss-comments { color: red; }");
    mockWriteFile.mockResolvedValue(undefined);

    (globalThis as any).__MOSS_INTERNAL_CONTEXT__ = {
      project_path: "/Users/test/site",
    };
  });

  it("writes CSS file to output directory once", async () => {
    const ctx = makeEnhanceContext({});
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello") },
    ];

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
      },
    };

    const socialData = {
      schemaVersion: "1",
      updatedAt: new Date().toISOString(),
      articles: {
        "uid-hello": {
          comments: [{
            id: "c1",
            content: "Nice!",
            createdAt: "2024-01-01T00:00:00Z",
            author: { displayName: "Alice" },
          }],
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
      return Promise.reject(new Error("File not found"));
    });

    await enhance(ctx);

    // CSS file should be written to output directory (still uses writeFile for non-HTML assets)
    const cssWriteCall = mockWriteFile.mock.calls.find(
      (call: any[]) => typeof call[0] === "string" && call[0].endsWith("moss-comments.css")
    );
    expect(cssWriteCall).toBeDefined();
    expect(cssWriteCall![0]).toBe(".moss/site/moss-comments.css");
    expect(cssWriteCall![1]).toContain(".moss-comments");
  });

  it("injects <link> tag instead of inline <style>", async () => {
    const ctx = makeEnhanceContext({});
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Hello") },
    ];

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
      },
    };

    const socialData = {
      schemaVersion: "1",
      updatedAt: new Date().toISOString(),
      articles: {
        "uid-hello": {
          comments: [{
            id: "c1",
            content: "Nice!",
            createdAt: "2024-01-01T00:00:00Z",
            author: { displayName: "Alice" },
          }],
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
      return Promise.reject(new Error("File not found"));
    });

    const result = await enhance(ctx);

    // Find the modified HTML
    const helloFile = result.modified!.find(
      (f) => f.path === "posts/hello/index.html"
    );
    expect(helloFile).toBeDefined();
    const writtenHtml = helloFile!.html;

    // Should have <link> to external CSS with depth-relative path
    // "posts/hello/" has depth 2, so prefix is "../../"
    expect(writtenHtml).toContain('<link rel="stylesheet" href="../../moss-comments.css">');

    // Should NOT have inline <style>
    expect(writtenHtml).not.toContain("moss-comments-style");
    expect(writtenHtml).not.toContain("<style");
  });

  it("writes CSS file only once even with multiple pages", async () => {
    const ctx = makeEnhanceContext({});
    ctx.files = [
      { path: "posts/hello/index.html", html: makeArticleHtml("Test") },
      { path: "posts/world/index.html", html: makeArticleHtml("Test") },
    ];

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "/Users/test/site/posts/hello.md",
          url_path: "posts/hello/",
          uid: "uid-hello",
        },
        "posts/world/": {
          source_path: "/Users/test/site/posts/world.md",
          url_path: "posts/world/",
          uid: "uid-world",
        },
      },
    };

    const socialData = {
      schemaVersion: "1",
      updatedAt: new Date().toISOString(),
      articles: {
        "uid-hello": {
          comments: [{
            id: "c1",
            content: "Nice!",
            createdAt: "2024-01-01T00:00:00Z",
            author: { displayName: "Alice" },
          }],
        },
        "uid-world": {
          comments: [{
            id: "c2",
            content: "Great!",
            createdAt: "2024-01-02T00:00:00Z",
            author: { displayName: "Bob" },
          }],
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
      return Promise.reject(new Error("File not found"));
    });

    await enhance(ctx);

    // CSS file should be written exactly once (still uses writeFile for non-HTML assets)
    const cssWriteCalls = mockWriteFile.mock.calls.filter(
      (call: any[]) => typeof call[0] === "string" && call[0].endsWith("moss-comments.css")
    );
    expect(cssWriteCalls).toHaveLength(1);
  });
});

describe("filePathToUrlPath", () => {
  it("converts directory index to trailing slash", () => {
    expect(filePathToUrlPath("posts/hello/index.html")).toBe("posts/hello/");
  });

  it("converts root index to empty string", () => {
    expect(filePathToUrlPath("index.html")).toBe("");
  });

  it("converts paginated page to path without extension", () => {
    expect(filePathToUrlPath("posts/hello/index-2.html")).toBe("posts/hello/index-2");
  });

  it("converts non-index page to path without extension", () => {
    expect(filePathToUrlPath("about.html")).toBe("about");
  });

  it("handles deeply nested directory index", () => {
    expect(filePathToUrlPath("a/b/c/index.html")).toBe("a/b/c/");
  });
});
