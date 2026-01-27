import { describe, it, expect } from "vitest";
import { isRemoteNewer, extractShortHash } from "../sync";

describe("isRemoteNewer", () => {
  it("returns true when local is undefined", () => {
    expect(isRemoteNewer(undefined, "2024-01-01")).toBe(true);
  });

  it("returns false when remote is undefined", () => {
    expect(isRemoteNewer("2024-01-01", undefined)).toBe(false);
  });

  it("returns true when remote is newer", () => {
    expect(isRemoteNewer("2024-01-01", "2024-01-02")).toBe(true);
  });

  it("returns false when local is newer", () => {
    expect(isRemoteNewer("2024-01-02", "2024-01-01")).toBe(false);
  });

  it("returns false when dates are equal", () => {
    expect(isRemoteNewer("2024-01-01", "2024-01-01")).toBe(false);
  });

  it("handles ISO date strings with time", () => {
    expect(isRemoteNewer("2024-01-01T10:00:00Z", "2024-01-01T12:00:00Z")).toBe(true);
    expect(isRemoteNewer("2024-01-01T12:00:00Z", "2024-01-01T10:00:00Z")).toBe(false);
  });

  it("returns true when both are undefined (local missing means should update)", () => {
    // When local is undefined, we should update regardless of remote
    expect(isRemoteNewer(undefined, undefined)).toBe(true);
  });

  // Tests for real Matters.town date formats
  describe("Matters.town date formats", () => {
    it("handles full ISO format with milliseconds", () => {
      // Real Matters API format: "2025-05-09T18:32:27.769Z"
      expect(isRemoteNewer(
        "2025-05-09T18:32:27.769Z",
        "2025-05-09T18:32:27.769Z"
      )).toBe(false);

      expect(isRemoteNewer(
        "2025-05-08T21:10:51.834Z",
        "2025-05-09T18:32:27.769Z"
      )).toBe(true);
    });

    it("handles comparison between different precision levels", () => {
      // Local might have different precision than remote
      expect(isRemoteNewer(
        "2025-05-09T18:32:27Z",
        "2025-05-09T18:32:27.769Z"
      )).toBe(true); // Remote is technically later by 769ms
    });

    it("handles date-only vs full ISO comparison", () => {
      // Edge case: local file has date-only, remote has full timestamp
      expect(isRemoteNewer(
        "2025-05-09",
        "2025-05-09T18:32:27.769Z"
      )).toBe(true); // Date-only is treated as 00:00:00
    });

    it("handles same day with remote later time", () => {
      expect(isRemoteNewer(
        "2025-05-09T00:00:00.000Z",
        "2025-05-09T18:32:27.769Z"
      )).toBe(true);
    });
  });
});

describe("syncToLocalFiles", () => {
  it("exports syncToLocalFiles function", async () => {
    const module = await import("../sync");
    expect(typeof module.syncToLocalFiles).toBe("function");
  });
});

// ============================================================================
// Integration Tests with Mock Tauri
// ============================================================================

import { vi, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";

describe("syncToLocalFiles - skip unchanged content", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should skip homepage when content is unchanged", async () => {
    // Setup: Create existing homepage with same content that would be generated
    // The generateFrontmatter function creates frontmatter in a specific format
    const existingHomepage = `---
title: "Test User"
---

Test bio`;
    ctx.filesystem.setFile(`${ctx.projectPath}/index.md`, existingHomepage);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [], // no collections
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "Test bio" }
    );

    // Homepage should be skipped, not created
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.result.created).toBe(0);
  });

  it("should update homepage when content has changed", async () => {
    // Setup: Create existing homepage with DIFFERENT content
    const existingHomepage = `---
title: "Old Name"
---

Old bio`;
    ctx.filesystem.setFile(`${ctx.projectPath}/index.md`, existingHomepage);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [], // no collections
      "testuser",
      {},
      { displayName: "New Name", userName: "testuser", description: "New bio" }
    );

    // Homepage should be updated
    expect(result.result.updated).toBeGreaterThanOrEqual(1);

    // Verify content was updated
    const updatedContent = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(updatedContent).toContain("New Name");
    expect(updatedContent).toContain("New bio");
  });

  it("should skip collection when content is unchanged", async () => {
    // Setup: Create existing collection with same content that sync would generate
    const existingCollection = `---
title: "Test Collection"
is_collection: true
description: "Collection description"
---

Collection description`;
    ctx.filesystem.setFile(`${ctx.projectPath}/posts/test-collection/index.md`, existingCollection);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [{
        id: "1",
        title: "Test Collection",
        description: "Collection description",
        articles: [],
        cover: null
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "" }
    );

    // Collection should be skipped if content matches
    // result.skipped should include the collection
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
  });

  it("should update collection when content has changed", async () => {
    // Setup: Create existing collection with DIFFERENT content
    const existingCollection = `---
title: "Old Collection Name"
is_collection: true
---

Old description`;
    ctx.filesystem.setFile(`${ctx.projectPath}/posts/test-collection/index.md`, existingCollection);

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [{
        id: "1",
        title: "Test Collection",
        description: "New description",
        articles: [],
        cover: null
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "" }
    );

    // Collection should be updated
    expect(result.result.updated).toBeGreaterThanOrEqual(1);

    // Verify content was updated
    const updatedContent = ctx.filesystem.getFile(`${ctx.projectPath}/posts/test-collection/index.md`)?.content;
    expect(updatedContent).toContain("Test Collection");
    expect(updatedContent).toContain("New description");
  });
});

// ============================================================================
// extractShortHash Tests
// ============================================================================

describe("extractShortHash", () => {
  it("extracts shortHash from standard Matters URL", () => {
    const url = "https://matters.town/@testuser/test-article-abc123def";
    expect(extractShortHash(url)).toBe("abc123def");
  });

  it("extracts shortHash from URL with multiple hyphens in slug", () => {
    const url = "https://matters.town/@testuser/my-long-article-title-xyz789";
    expect(extractShortHash(url)).toBe("xyz789");
  });

  it("extracts shortHash from Chinese article URL", () => {
    const url = "https://matters.town/@testuser/测试文章-shortHash123";
    expect(extractShortHash(url)).toBe("shortHash123");
  });

  it("returns null for invalid URL", () => {
    expect(extractShortHash("not a url")).toBe(null);
  });

  it("returns null for URL without path segments", () => {
    expect(extractShortHash("https://matters.town/")).toBe(null);
  });

  it("returns null for URL with only slug (no hyphen)", () => {
    expect(extractShortHash("https://matters.town/@testuser/article")).toBe(null);
  });
});

// ============================================================================
// scanLocalArticles Tests
// ============================================================================

describe("scanLocalArticles", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("finds articles with Matters syndicated URLs", async () => {
    const articleContent = `---
title: "Test Article"
syndicated:
  - "https://matters.town/@testuser/test-article-abc123"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/posts/test-article.md`, articleContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(1);
    expect(articles[0].shortHash).toBe("abc123");
    expect(articles[0].title).toBe("Test Article");
  });

  it("ignores files without syndicated field", async () => {
    const articleContent = `---
title: "Local Only Article"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/posts/local-article.md`, articleContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(0);
  });

  it("ignores files with non-Matters syndicated URLs", async () => {
    const articleContent = `---
title: "Cross-posted Article"
syndicated:
  - "https://dev.to/testuser/article"
---

Article content`;
    ctx.filesystem.setFile(`${ctx.projectPath}/posts/devto-article.md`, articleContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(0);
  });

  it("skips index.md and README.md", async () => {
    const indexContent = `---
title: "Homepage"
syndicated:
  - "https://matters.town/@testuser/home-abc123"
---`;
    ctx.filesystem.setFile(`${ctx.projectPath}/index.md`, indexContent);
    ctx.filesystem.setFile(`${ctx.projectPath}/README.md`, indexContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(0);
  });

  it("skips _drafts folder", async () => {
    const draftContent = `---
title: "Draft Article"
syndicated:
  - "https://matters.town/@testuser/draft-abc123"
---`;
    ctx.filesystem.setFile(`${ctx.projectPath}/_drafts/draft.md`, draftContent);

    const { scanLocalArticles } = await import("../sync");
    const articles = await scanLocalArticles();

    expect(articles).toHaveLength(0);
  });
});
