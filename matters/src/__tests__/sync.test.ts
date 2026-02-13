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
// Homepage Grid Generation Tests
// ============================================================================

describe("syncToLocalFiles - homepage grid from pinned works", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should generate :::grid 3 homepage when pinnedWorks has collections", async () => {
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], // no articles
      [], // no drafts
      [
        { id: "c1", title: "Travel Notes", description: "My travels", articles: [], cover: "https://example.com/cover.jpg" },
        { id: "c2", title: "Tech Essays", description: "Tech writing", articles: [], cover: undefined },
      ],
      "testuser",
      {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Hello world",
        pinnedWorks: [
          { id: "c1", type: "collection", title: "Travel Notes", cover: "https://example.com/cover.jpg" },
          { id: "c2", type: "collection", title: "Tech Essays", cover: undefined },
        ],
      }
    );

    expect(result.result.created).toBeGreaterThanOrEqual(1);
    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toBeDefined();
    expect(homepage).toContain(":::grid 3");
    expect(homepage).toContain("[Travel Notes](/articles/travel-notes/)");
    expect(homepage).toContain("[Tech Essays](/articles/tech-essays/)");
    expect(homepage).toContain(":::");
  });

  it("should generate :::grid 3 homepage with pinned articles", async () => {
    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [
        {
          id: "a1", title: "My Article", slug: "my-article", shortHash: "abc123",
          content: "<p>Content</p>", summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
      ],
      [],
      [],
      "testuser",
      {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Bio text",
        pinnedWorks: [
          { id: "a1", type: "article", title: "My Article", slug: "my-article", shortHash: "abc123" },
        ],
      }
    );

    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toBeDefined();
    expect(homepage).toContain(":::grid 3");
    expect(homepage).toContain("[My Article](/articles/my-article/)");
  });

  it("should generate :::grid 3 homepage with mixed pinned works", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1", title: "Standalone Article", slug: "standalone-article", shortHash: "hash1",
          content: "<p>Content</p>", summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
      ],
      [],
      [
        { id: "c1", title: "My Collection", description: "Desc", articles: [], cover: undefined },
      ],
      "testuser",
      {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Bio",
        pinnedWorks: [
          { id: "c1", type: "collection", title: "My Collection" },
          { id: "a1", type: "article", title: "Standalone Article", slug: "standalone-article", shortHash: "hash1" },
        ],
      }
    );

    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toContain(":::grid 3");
    expect(homepage).toContain("[My Collection](/articles/my-collection/)");
    expect(homepage).toContain("[Standalone Article](/articles/standalone-article/)");
  });

  it("should generate plain homepage when pinnedWorks is empty", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [], [], [], "testuser", {},
      { displayName: "Test User", userName: "testuser", description: "Just a bio", pinnedWorks: [] }
    );

    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toBeDefined();
    expect(homepage).not.toContain(":::grid");
    expect(homepage).toContain("Just a bio");
  });

  it("should still skip homepage when index.md already exists even with pinnedWorks", async () => {
    ctx.filesystem.setFile(`${ctx.projectPath}/index.md`, "---\ntitle: \"Existing\"\n---\n\nMy custom homepage");

    const { syncToLocalFiles } = await import("../sync");
    const result = await syncToLocalFiles(
      [], [], [], "testuser", {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Bio",
        pinnedWorks: [
          { id: "c1", type: "collection", title: "Pinned Collection" },
        ],
      }
    );

    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toContain("My custom homepage");
    expect(homepage).not.toContain(":::grid");
  });

  it("should link pinned article to its collection folder when in a collection", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1", title: "Article In Collection", slug: "article-in-collection", shortHash: "hash1",
          content: "<p>Content</p>", summary: "Summary",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
      ],
      [],
      [
        {
          id: "c1", title: "My Series", description: "A series",
          articles: [{ id: "a1", shortHash: "hash1", title: "Article In Collection", slug: "article-in-collection" }],
          cover: undefined,
        },
      ],
      "testuser",
      {},
      {
        displayName: "Test User",
        userName: "testuser",
        description: "Bio",
        pinnedWorks: [
          { id: "a1", type: "article", title: "Article In Collection", slug: "article-in-collection", shortHash: "hash1" },
        ],
      }
    );

    const homepage = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(homepage).toContain(":::grid 3");
    // Article should link to its collection folder path
    expect(homepage).toContain("[Article In Collection](/articles/my-series/article-in-collection/)");
  });
});

// ============================================================================
// Folder-mode Collection Order Tests
// ============================================================================

describe("syncToLocalFiles - folder-mode collection order", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ projectPath: "/test-project" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should generate order field with bare slugs in folder mode", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1", title: "First Article", slug: "first-article", shortHash: "hash1",
          content: "<p>First</p>", summary: "First",
          createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
        {
          id: "a2", title: "Second Article", slug: "second-article", shortHash: "hash2",
          content: "<p>Second</p>", summary: "Second",
          createdAt: "2024-01-02T00:00:00Z", tags: [],
        },
      ],
      [],
      [{
        id: "c1",
        title: "My Collection",
        description: "Collection desc",
        cover: undefined,
        articles: [
          { id: "a1", shortHash: "hash1", title: "First Article", slug: "first-article" },
          { id: "a2", shortHash: "hash2", title: "Second Article", slug: "second-article" },
        ],
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    const collectionIndex = ctx.filesystem.getFile(`${ctx.projectPath}/articles/my-collection/index.md`)?.content;
    expect(collectionIndex).toBeDefined();
    expect(collectionIndex).toContain("order:");
    expect(collectionIndex).toContain("first-article");
    expect(collectionIndex).toContain("second-article");
    // In folder mode, order should NOT have full paths
    expect(collectionIndex).not.toContain("posts/");
  });

  it("should preserve article ordering from Matters API", async () => {
    const { syncToLocalFiles } = await import("../sync");
    await syncToLocalFiles(
      [
        {
          id: "a1", title: "Third", slug: "third", shortHash: "h3",
          content: "<p>3</p>", summary: "3", createdAt: "2024-01-03T00:00:00Z", tags: [],
        },
        {
          id: "a2", title: "First", slug: "first", shortHash: "h1",
          content: "<p>1</p>", summary: "1", createdAt: "2024-01-01T00:00:00Z", tags: [],
        },
        {
          id: "a3", title: "Second", slug: "second", shortHash: "h2",
          content: "<p>2</p>", summary: "2", createdAt: "2024-01-02T00:00:00Z", tags: [],
        },
      ],
      [],
      [{
        id: "c1",
        title: "Ordered Collection",
        description: "",
        cover: undefined,
        articles: [
          // Matters API returns articles in specific order
          { id: "a2", shortHash: "h1", title: "First", slug: "first" },
          { id: "a3", shortHash: "h2", title: "Second", slug: "second" },
          { id: "a1", shortHash: "h3", title: "Third", slug: "third" },
        ],
      }],
      "testuser",
      {},
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    const collectionIndex = ctx.filesystem.getFile(`${ctx.projectPath}/articles/ordered-collection/index.md`)?.content;
    expect(collectionIndex).toBeDefined();
    // Order should match Matters API order: first, second, third
    const orderMatch = collectionIndex!.match(/order:\n([\s\S]*?)---/);
    expect(orderMatch).toBeTruthy();
    const orderLines = orderMatch![1].trim().split("\n").map((l: string) => l.trim());
    expect(orderLines[0]).toContain("first");
    expect(orderLines[1]).toContain("second");
    expect(orderLines[2]).toContain("third");
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
      { displayName: "Test User", userName: "testuser", description: "Test bio", pinnedWorks: [] }
    );

    // Homepage should be skipped, not created
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.result.created).toBe(0);
  });

  it("should skip homepage when local file already exists", async () => {
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
      { displayName: "New Name", userName: "testuser", description: "New bio", pinnedWorks: [] }
    );

    // Homepage should be skipped (local file preserved)
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);

    // Verify local content was NOT overwritten
    const preservedContent = ctx.filesystem.getFile(`${ctx.projectPath}/index.md`)?.content;
    expect(preservedContent).toContain("Old Name");
    expect(preservedContent).toContain("Old bio");
  });

  it("should skip collection when content is unchanged", async () => {
    // Setup: Create existing collection with same content that sync would generate
    const existingCollection = `---
title: "Test Collection"
is_collection: true
description: "Collection description"
---

Collection description`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/test-collection/index.md`, existingCollection);

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
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    // Collection should be skipped if content matches
    // result.skipped should include the collection
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);
  });

  it("should skip collection when local file already exists", async () => {
    // Setup: Create existing collection with DIFFERENT content
    const existingCollection = `---
title: "Old Collection Name"
is_collection: true
---

Old description`;
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/test-collection/index.md`, existingCollection);

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
      { displayName: "Test User", userName: "testuser", description: "", pinnedWorks: [] }
    );

    // Collection should be skipped (local file preserved)
    expect(result.result.skipped).toBeGreaterThanOrEqual(1);

    // Verify local content was NOT overwritten
    const preservedContent = ctx.filesystem.getFile(`${ctx.projectPath}/articles/test-collection/index.md`)?.content;
    expect(preservedContent).toContain("Old Collection Name");
    expect(preservedContent).toContain("Old description");
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
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/test-article.md`, articleContent);

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
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/local-article.md`, articleContent);

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
    ctx.filesystem.setFile(`${ctx.projectPath}/articles/devto-article.md`, articleContent);

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
