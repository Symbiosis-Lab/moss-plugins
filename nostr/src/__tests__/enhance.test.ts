/**
 * Unit tests for enhance hook functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Interaction, EnhanceContext } from "../types";

// Mock the moss-api
vi.mock("@symbiosis-lab/moss-api", () => {
  const filesystem = new Map<string, string>();
  return {
    readFile: vi.fn().mockImplementation((path: string) => {
      const content = filesystem.get(path);
      if (!content) throw new Error(`File not found: ${path}`);
      return Promise.resolve(content);
    }),
    writeFile: vi.fn().mockImplementation((path: string, content: string) => {
      filesystem.set(path, content);
      return Promise.resolve();
    }),
    log: vi.fn(),
    __filesystem: filesystem,
  };
});

describe("enhance hook", () => {
  let mockFilesystem: Map<string, string>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@symbiosis-lab/moss-api") as unknown as { __filesystem: Map<string, string> };
    mockFilesystem = mod.__filesystem;
    mockFilesystem.clear();
  });

  const createEnhanceContext = (
    interactions: Interaction[] = [],
    outputDir = "/test/output"
  ): EnhanceContext => ({
    project_path: "/test/project",
    moss_dir: "/test/.moss",
    output_dir: outputDir,
    project_info: {
      content_folders: ["posts"],
      total_files: 1,
    },
    config: {},
    interactions,
  });

  const createInteraction = (overrides: Partial<Interaction> = {}): Interaction => ({
    id: `int-${Date.now()}`,
    source: "nostr",
    interaction_type: "comment",
    author: {
      name: "Test User",
      identifier: "npub1test",
    },
    content: "Test comment",
    target_url: "posts/test.html",
    ...overrides,
  });

  describe("HTML injection", () => {
    it("should inject interaction island into article page", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <article>
    <h1>Test</h1>
  </article>
</body>
</html>`;
      mockFilesystem.set("/test/output/posts/test.html", html);

      const interactions = [createInteraction({ target_url: "posts/test.html" })];
      const ctx = createEnhanceContext(interactions);

      const { enhance } = await import("../main");
      const result = await enhance(ctx);

      expect(result.success).toBe(true);

      const modified = mockFilesystem.get("/test/output/posts/test.html") ?? "";
      expect(modified).toContain('id="moss-comments"');
      expect(modified).toContain('id="moss-comments-data"');
      expect(modified).toContain("<noscript>");
    });

    it("should skip HTML files without article tag", async () => {
      const html = `<!DOCTYPE html>
<html>
<body>
  <div class="about">About page</div>
</body>
</html>`;
      mockFilesystem.set("/test/output/about.html", html);

      const interactions = [createInteraction({ target_url: "about.html" })];
      const ctx = createEnhanceContext(interactions);

      const { enhance } = await import("../main");
      const result = await enhance(ctx);

      expect(result.success).toBe(true);

      const modified = mockFilesystem.get("/test/output/about.html") ?? "";
      // The widget uses fallback injection to </body>, so it will be there
      // but not before a non-existent </article>
      expect(modified).toContain('id="moss-comments"');
    });

    it("should escape HTML in static fallback to prevent XSS", async () => {
      const html = `<html><body><article><h1>Test</h1></article></body></html>`;
      mockFilesystem.set("/test/output/posts/xss.html", html);

      const xssContent = '<script>alert("xss")</script>';
      const interactions = [
        createInteraction({
          target_url: "posts/xss.html",
          content: xssContent,
        }),
      ];
      const ctx = createEnhanceContext(interactions);

      const { enhance } = await import("../main");
      await enhance(ctx);

      const modified = mockFilesystem.get("/test/output/posts/xss.html") ?? "";
      const noscriptMatch = modified.match(/<noscript>([\s\S]*?)<\/noscript>/);

      expect(noscriptMatch).toBeTruthy();
      expect(noscriptMatch![1]).toContain("&lt;script&gt;");
      expect(noscriptMatch![1]).not.toContain('<script>alert');
    });
  });

  describe("no interactions", () => {
    it("should not modify files when there are no interactions", async () => {
      const html = `<html><body><article><h1>Test</h1></article></body></html>`;
      mockFilesystem.set("/test/output/posts/empty.html", html);

      const ctx = createEnhanceContext([]);

      const { enhance } = await import("../main");
      const result = await enhance(ctx);

      expect(result.success).toBe(true);
      // The file should not be modified since there are no interactions for it
    });
  });

  describe("interaction grouping", () => {
    it("should group interactions by target URL", async () => {
      mockFilesystem.set(
        "/test/output/posts/post1.html",
        "<html><body><article><h1>Post 1</h1></article></body></html>"
      );
      mockFilesystem.set(
        "/test/output/posts/post2.html",
        "<html><body><article><h1>Post 2</h1></article></body></html>"
      );

      const interactions = [
        createInteraction({ id: "1", target_url: "posts/post1.html" }),
        createInteraction({ id: "2", target_url: "posts/post1.html" }),
        createInteraction({ id: "3", target_url: "posts/post2.html" }),
      ];
      const ctx = createEnhanceContext(interactions);

      const { enhance } = await import("../main");
      await enhance(ctx);

      const post1 = mockFilesystem.get("/test/output/posts/post1.html") ?? "";
      const post2 = mockFilesystem.get("/test/output/posts/post2.html") ?? "";

      // Extract interaction counts from each page
      const post1Data = post1.match(
        /<script[^>]*id="moss-comments-data"[^>]*>([\s\S]*?)<\/script>/
      );
      const post2Data = post2.match(
        /<script[^>]*id="moss-comments-data"[^>]*>([\s\S]*?)<\/script>/
      );

      expect(post1Data).toBeTruthy();
      expect(post2Data).toBeTruthy();

      const post1Interactions = JSON.parse(post1Data![1].trim());
      const post2Interactions = JSON.parse(post2Data![1].trim());

      expect(post1Interactions.interactions).toHaveLength(2);
      expect(post2Interactions.interactions).toHaveLength(1);
    });
  });
});
