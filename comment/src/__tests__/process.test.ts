/**
 * Tests for the process hook
 *
 * Validates that the process hook correctly:
 * - Skips when no server_url is configured
 * - Skips when no article-map.json exists (first build)
 * - Fetches comments for each page with a uid
 * - Writes results to .moss/social/comment.json
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock variables referenced in vi.mock factories
const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockHttpGet = vi.hoisted(() => vi.fn());

vi.mock("@symbiosis-lab/moss-api", () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  httpGet: mockHttpGet,
}));

import { process } from "../main";
import { clearDetectionCache } from "../fetcher";
import type { ProcessContext, ArticleMap } from "../types";

function makeContext(
  config: Record<string, unknown> = {},
  projectInfoOverrides: Record<string, unknown> = {}
): ProcessContext {
  return {
    project_info: { total_files: 10, homepage_file: "index.md", ...projectInfoOverrides },
    config,
  };
}

describe("process hook", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockHttpGet.mockReset();
    clearDetectionCache();
  });

  it("skips when no server_url is configured", async () => {
    const ctx = makeContext({});

    const result = await process(ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain("No server_url configured");
    // Should not attempt to read article-map or fetch anything
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it("skips when server_url is empty string", async () => {
    const ctx = makeContext({ server_url: "" });

    const result = await process(ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain("No server_url configured");
  });

  it("skips gracefully when article-map.json does not exist (first build)", async () => {
    const ctx = makeContext({
      server_url: "https://waline.example.com",
    });

    // article-map.json doesn't exist
    mockReadFile.mockRejectedValue(new Error("File not found"));

    const result = await process(ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain("No article map found");
    // Should have tried to read article-map.json
    expect(mockReadFile).toHaveBeenCalledWith(".moss/article-map.json");
    // Should not attempt to fetch comments
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it("skips pages without a uid in article-map", async () => {
    const ctx = makeContext({
      server_url: "https://waline.example.com",
    });

    const articleMap: ArticleMap = {
      articles: {
        "posts/no-uid/": {
          source_path: "posts/no-uid.md",
          url_path: "posts/no-uid/",
          // No uid field
        },
      },
    };

    // First call: article-map.json; second call: social data file
    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      // social file doesn't exist
      return Promise.reject(new Error("File not found"));
    });

    const result = await process(ctx);

    expect(result.success).toBe(true);
    // No pages had uids, so no fetching happened
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it("fetches Waline comments for pages with uids and writes social data", async () => {
    const ctx = makeContext({
      server_url: "https://waline.example.com",
    });

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "posts/hello.md",
          url_path: "posts/hello/",
          uid: "abc123",
        },
        "posts/world/": {
          source_path: "posts/world.md",
          url_path: "posts/world/",
          uid: "def456",
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      // social data file doesn't exist yet
      return Promise.reject(new Error("File not found"));
    });

    mockWriteFile.mockResolvedValue(undefined);

    // Mock httpGet for auto-detection probe + Waline API calls
    mockHttpGet.mockImplementation((url: string) => {
      // Auto-detection probe: /api/v2/conf returns 404 → waline
      if (url.endsWith("/api/v2/conf")) {
        return Promise.resolve({ ok: false, status: 404, text: () => "Not Found" });
      }
      if (url.includes("abc123")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            JSON.stringify({
              data: [
                {
                  objectId: "w1",
                  comment: "<p>Hello comment</p>",
                  insertedAt: "2025-06-15T10:00:00.000Z",
                  nick: "Alice",
                  link: "",
                  mail: "",
                  pid: null,
                  rid: null,
                  status: "approved",
                },
              ],
            }),
        });
      }
      if (url.includes("def456")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => JSON.stringify({ data: [] }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => "{}" });
    });

    const result = await process(ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain("Fetched comments");

    // Should have called httpGet: 1 detection probe + 2 comment fetches
    expect(mockHttpGet).toHaveBeenCalledTimes(3);
    expect(mockHttpGet).toHaveBeenCalledWith(
      "https://waline.example.com/api/v2/conf"
    );
    expect(mockHttpGet).toHaveBeenCalledWith(
      "https://waline.example.com/api/comment?path=abc123&pageSize=100"
    );
    expect(mockHttpGet).toHaveBeenCalledWith(
      "https://waline.example.com/api/comment?path=def456&pageSize=100"
    );

    // Should have written social data
    expect(mockWriteFile).toHaveBeenCalled();
    const writtenContent = mockWriteFile.mock.calls[
      mockWriteFile.mock.calls.length - 1
    ][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.articles["abc123"].comments).toHaveLength(1);
    expect(parsed.articles["abc123"].comments[0].id).toBe("w1");
  });

  it("fetches Artalk comments when server is auto-detected as artalk", async () => {
    const ctx = makeContext(
      { server_url: "https://artalk.example.com" },
      { site_name: "My Blog" }
    );

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "posts/hello.md",
          url_path: "posts/hello/",
          uid: "abc123",
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      return Promise.reject(new Error("File not found"));
    });

    mockWriteFile.mockResolvedValue(undefined);

    // Mock httpGet: detection probe returns 200 (Artalk), comment fetch returns data
    mockHttpGet.mockImplementation((url: string) => {
      if (url.endsWith("/api/v2/conf")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => JSON.stringify({ app_name: "Artalk" }),
        });
      }
      // Artalk comments endpoint
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          JSON.stringify({
            data: {
              comments: [
                {
                  id: 101,
                  content: "<p>Artalk comment</p>",
                  date: "2025-06-15T10:00:00.000Z",
                  nick: "Charlie",
                  email: "",
                  link: "",
                  rid: 0,
                  is_collapsed: false,
                  is_pending: false,
                },
              ],
            },
          }),
      });
    });

    const result = await process(ctx);

    expect(result.success).toBe(true);

    // Should have probed for Artalk first
    expect(mockHttpGet).toHaveBeenCalledWith(
      "https://artalk.example.com/api/v2/conf"
    );

    // Should have used Artalk API format
    expect(mockHttpGet).toHaveBeenCalledWith(
      "https://artalk.example.com/api/v2/comments?page_key=abc123&site_name=My%20Blog&limit=100"
    );

    // Should have written social data
    expect(mockWriteFile).toHaveBeenCalled();
    const writtenContent = mockWriteFile.mock.calls[
      mockWriteFile.mock.calls.length - 1
    ][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.articles["abc123"].comments).toHaveLength(1);
    expect(parsed.articles["abc123"].comments[0].id).toBe("101");
  });

  it("merges with existing social data", async () => {
    const ctx = makeContext({
      server_url: "https://waline.example.com",
    });

    const articleMap: ArticleMap = {
      articles: {
        "posts/hello/": {
          source_path: "posts/hello.md",
          url_path: "posts/hello/",
          uid: "abc123",
        },
      },
    };

    const existingSocialData = {
      schemaVersion: "1.0.0",
      updatedAt: "2025-06-14T00:00:00.000Z",
      articles: {
        "abc123": {
          comments: [
            {
              id: "w-old",
              content: "Old comment",
              createdAt: "2025-06-14T10:00:00.000Z",
              author: { displayName: "OldUser", name: "OldUser" },
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
        return Promise.resolve(JSON.stringify(existingSocialData));
      }
      return Promise.reject(new Error("File not found"));
    });

    mockWriteFile.mockResolvedValue(undefined);

    mockHttpGet.mockImplementation((url: string) => {
      // Detection probe: non-200 → waline
      if (url.endsWith("/api/v2/conf")) {
        return Promise.resolve({ ok: false, status: 404, text: () => "Not Found" });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          JSON.stringify({
            data: [
              {
                objectId: "w-new",
                comment: "<p>New comment</p>",
                insertedAt: "2025-06-15T10:00:00.000Z",
                nick: "NewUser",
                link: "",
                mail: "",
                pid: null,
                rid: null,
                status: "approved",
              },
            ],
          }),
      });
    });

    const result = await process(ctx);

    expect(result.success).toBe(true);

    // Should have merged old + new comments
    const writtenContent = mockWriteFile.mock.calls[
      mockWriteFile.mock.calls.length - 1
    ][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.articles["abc123"].comments).toHaveLength(2);

    const ids = parsed.articles["abc123"].comments.map(
      (c: any) => c.id
    );
    expect(ids).toContain("w-old");
    expect(ids).toContain("w-new");
  });

  it("handles fetch errors gracefully (continues with other pages)", async () => {
    const ctx = makeContext({
      server_url: "https://waline.example.com",
    });

    const articleMap: ArticleMap = {
      articles: {
        "posts/fail/": {
          source_path: "posts/fail.md",
          url_path: "posts/fail/",
          uid: "fail-uid",
        },
        "posts/success/": {
          source_path: "posts/success.md",
          url_path: "posts/success/",
          uid: "success-uid",
        },
      },
    };

    mockReadFile.mockImplementation((path: string) => {
      if (path === ".moss/article-map.json") {
        return Promise.resolve(JSON.stringify(articleMap));
      }
      return Promise.reject(new Error("File not found"));
    });

    mockWriteFile.mockResolvedValue(undefined);

    mockHttpGet.mockImplementation((url: string) => {
      // Detection probe: non-200 → waline
      if (url.endsWith("/api/v2/conf")) {
        return Promise.resolve({ ok: false, status: 404, text: () => "Not Found" });
      }
      if (url.includes("fail-uid")) {
        // Network error for this page
        return Promise.reject(new Error("Server down"));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          JSON.stringify({
            data: [
              {
                objectId: "w1",
                comment: "<p>Success!</p>",
                insertedAt: "2025-06-15T10:00:00.000Z",
                nick: "User",
                link: "",
                mail: "",
                pid: null,
                rid: null,
                status: "approved",
              },
            ],
          }),
      });
    });

    const result = await process(ctx);

    // Should still succeed overall
    expect(result.success).toBe(true);

    // The successful page's comments should be saved
    expect(mockWriteFile).toHaveBeenCalled();
    const writtenContent = mockWriteFile.mock.calls[
      mockWriteFile.mock.calls.length - 1
    ][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.articles["success-uid"]).toBeDefined();
    expect(parsed.articles["success-uid"].comments).toHaveLength(1);
  });
});
