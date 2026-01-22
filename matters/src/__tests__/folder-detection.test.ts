/**
 * Tests for folder detection and sync configuration
 *
 * These tests verify:
 * 1. sync_drafts defaults to false (not true)
 * 2. Default article folder is "posts" (not language-based)
 * 3. Auto-detection of existing article folder by scanning for syndicated content
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";

// Import functions to test (these will need to be exported from sync.ts)
import {
  getDefaultFolderNames,
  detectArticleFolder,
  getArticleFolderName,
} from "../sync";

describe("Folder Detection", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ pluginName: "matters" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("getDefaultFolderNames", () => {
    it("returns 'posts' as the default article folder name", () => {
      const folders = getDefaultFolderNames();
      expect(folders.article).toBe("posts");
    });

    it("returns '_drafts' as the default drafts folder name", () => {
      const folders = getDefaultFolderNames();
      expect(folders.drafts).toBe("_drafts");
    });

    it("does not vary by language - always returns English names", () => {
      // The function should not take language parameter
      const folders = getDefaultFolderNames();
      expect(folders.article).toBe("posts");
      expect(folders.drafts).toBe("_drafts");
    });
  });

  describe("detectArticleFolder", () => {
    it("returns null when no folders exist", async () => {
      // Empty project - no folders
      const detected = await detectArticleFolder();
      expect(detected).toBeNull();
    });

    it("returns null when folders exist but have no Matters-synced content", async () => {
      // Create a folder with a markdown file that has no syndicated field
      ctx.filesystem.setFile(
        `${ctx.projectPath}/blog/test-article.md`,
        `---
title: "Test Article"
date: "2024-01-01"
---
Some content`
      );

      const detected = await detectArticleFolder();
      expect(detected).toBeNull();
    });

    it("detects folder containing files with syndicated matters.town URLs", async () => {
      // Create a folder with a Matters-synced article
      ctx.filesystem.setFile(
        `${ctx.projectPath}/文章/my-article.md`,
        `---
title: "My Article"
date: "2024-01-01"
syndicated:
  - "https://matters.town/@user/123-my-article"
---
Article content`
      );

      const detected = await detectArticleFolder();
      expect(detected).toBe("文章");
    });

    it("detects renamed folder (e.g., posts renamed to my-posts)", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/my-posts/article.md`,
        `---
title: "Article"
syndicated:
  - "https://matters.town/@guo/456-article"
---
Content`
      );

      const detected = await detectArticleFolder();
      expect(detected).toBe("my-posts");
    });

    it("ignores hidden folders (starting with dot)", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/.hidden/article.md`,
        `---
title: "Hidden Article"
syndicated:
  - "https://matters.town/@user/789"
---
Content`
      );

      const detected = await detectArticleFolder();
      expect(detected).toBeNull();
    });

    it("ignores underscore folders (drafts)", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/_drafts/draft.md`,
        `---
title: "Draft"
syndicated:
  - "https://matters.town/@user/draft-123"
---
Content`
      );

      const detected = await detectArticleFolder();
      expect(detected).toBeNull();
    });

    it("detects folder with nested subdirectories (collections)", async () => {
      // Article in a collection subfolder
      ctx.filesystem.setFile(
        `${ctx.projectPath}/writings/tech/article.md`,
        `---
title: "Tech Article"
syndicated:
  - "https://matters.town/@user/tech-article"
---
Content`
      );

      const detected = await detectArticleFolder();
      expect(detected).toBe("writings");
    });

    it("handles multiple folders - returns first one with Matters content", async () => {
      // Two folders, only one has Matters content
      ctx.filesystem.setFile(
        `${ctx.projectPath}/blog/regular.md`,
        `---
title: "Regular Blog"
---
Content`
      );
      ctx.filesystem.setFile(
        `${ctx.projectPath}/matters-articles/synced.md`,
        `---
title: "Synced"
syndicated:
  - "https://matters.town/@user/synced"
---
Content`
      );

      const detected = await detectArticleFolder();
      expect(detected).toBe("matters-articles");
    });
  });

  describe("getArticleFolderName", () => {
    it("uses explicitly configured folder when set", async () => {
      const config = { articleFolder: "my-custom-folder" };
      const folder = await getArticleFolderName(config);
      expect(folder).toBe("my-custom-folder");
    });

    it("auto-detects existing folder when not configured", async () => {
      ctx.filesystem.setFile(
        `${ctx.projectPath}/文章/article.md`,
        `---
title: "Article"
syndicated:
  - "https://matters.town/@user/article"
---
Content`
      );

      const config = {}; // No articleFolder set
      const folder = await getArticleFolderName(config);
      expect(folder).toBe("文章");
    });

    it("falls back to default 'posts' when nothing detected", async () => {
      const config = {}; // No articleFolder set, no existing content
      const folder = await getArticleFolderName(config);
      expect(folder).toBe("posts");
    });

    it("prefers explicit config over auto-detection", async () => {
      // Even if there's existing content in 文章/, use the configured folder
      ctx.filesystem.setFile(
        `${ctx.projectPath}/文章/article.md`,
        `---
title: "Article"
syndicated:
  - "https://matters.town/@user/article"
---
Content`
      );

      const config = { articleFolder: "posts" };
      const folder = await getArticleFolderName(config);
      expect(folder).toBe("posts");
    });
  });
});

describe("Sync Drafts Config", () => {
  let ctx: MockTauriContext;

  beforeEach(() => {
    ctx = setupMockTauri({ pluginName: "matters" });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("sync_drafts default value", () => {
    it("defaults to false when not specified in config", async () => {
      // Import the function that checks sync_drafts
      const { shouldSyncDrafts } = await import("../sync");

      const config = {}; // No sync_drafts set
      expect(shouldSyncDrafts(config)).toBe(false);
    });

    it("respects explicit true setting", async () => {
      const { shouldSyncDrafts } = await import("../sync");

      const config = { sync_drafts: true };
      expect(shouldSyncDrafts(config)).toBe(true);
    });

    it("respects explicit false setting", async () => {
      const { shouldSyncDrafts } = await import("../sync");

      const config = { sync_drafts: false };
      expect(shouldSyncDrafts(config)).toBe(false);
    });
  });
});
